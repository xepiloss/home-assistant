const fs = require('fs').promises;
const path = require('path');
const { formatBytes } = require('./packetFramer');
const { log, logError } = require('./utils');

const DEFAULT_WRITE_DELAY_MS = 1000;
const MAX_RECENT_SEEN_AT = 5;
const MAX_RECENT_CONTEXTS = 5;

function createPacketKey(record) {
    return [record.source, record.kind, record.hex].join('\t');
}

function normalizeTimestamp(value, fallback) {
    return typeof value === 'string' && value ? value : fallback;
}

function normalizePositiveInteger(value, fallback = 0) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizePositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toTimestampMs(timestamp) {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function calculateIntervalMs(previousTimestamp, nextTimestamp) {
    const previousMs = toTimestampMs(previousTimestamp);
    const nextMs = toTimestampMs(nextTimestamp);

    if (previousMs === undefined || nextMs === undefined || nextMs < previousMs) {
        return undefined;
    }

    return nextMs - previousMs;
}

function normalizeSeenTimestamps(record, fallback) {
    if (Array.isArray(record.seen_at) && record.seen_at.length > 0) {
        return record.seen_at.filter((value) => typeof value === 'string' && value);
    }

    if (Array.isArray(record.recent_seen_at) && record.recent_seen_at.length > 0) {
        return record.recent_seen_at.filter((value) => typeof value === 'string' && value);
    }

    if (typeof record.timestamp === 'string' && record.timestamp) {
        return [record.timestamp];
    }

    return fallback ? [fallback] : [];
}

function trimRecentTimestamps(timestamps) {
    return timestamps
        .filter((value) => typeof value === 'string' && value)
        .slice(-MAX_RECENT_SEEN_AT);
}

function mergeRecentTimestamps(existingTimestamps, incomingTimestamps) {
    return trimRecentTimestamps([
        ...(Array.isArray(existingTimestamps) ? existingTimestamps : []),
        ...(Array.isArray(incomingTimestamps) ? incomingTimestamps : []),
    ]);
}

function trimRecentContexts(contexts) {
    if (!Array.isArray(contexts)) {
        return [];
    }

    return contexts
        .filter((context) => context && typeof context === 'object' && !Array.isArray(context))
        .slice(-MAX_RECENT_CONTEXTS);
}

function mergeRecentContexts(existingContexts, incomingContexts) {
    return trimRecentContexts([
        ...(Array.isArray(existingContexts) ? existingContexts : []),
        ...(Array.isArray(incomingContexts) ? incomingContexts : []),
    ]);
}

function summarizeIntervals(timestamps) {
    const intervals = [];

    for (let index = 1; index < timestamps.length; index += 1) {
        const intervalMs = calculateIntervalMs(timestamps[index - 1], timestamps[index]);

        if (intervalMs !== undefined) {
            intervals.push(intervalMs);
        }
    }

    if (intervals.length === 0) {
        return { repeat_interval_count: 0 };
    }

    const totalMs = intervals.reduce((sum, intervalMs) => sum + intervalMs, 0);

    return {
        repeat_interval_count: intervals.length,
        repeat_interval_last_ms: intervals[intervals.length - 1],
        repeat_interval_min_ms: Math.min(...intervals),
        repeat_interval_max_ms: Math.max(...intervals),
        repeat_interval_avg_ms: Math.round(totalMs / intervals.length),
    };
}

function normalizeRepeatSummary(record, timestamps, hasFullSeenAt) {
    if (hasFullSeenAt) {
        return summarizeIntervals(timestamps);
    }

    const intervalCount = normalizePositiveInteger(record.repeat_interval_count);
    const lastIntervalMs = normalizePositiveNumber(record.repeat_interval_last_ms);
    const minIntervalMs = normalizePositiveNumber(record.repeat_interval_min_ms);
    const maxIntervalMs = normalizePositiveNumber(record.repeat_interval_max_ms);
    const averageIntervalMs = normalizePositiveNumber(record.repeat_interval_avg_ms);

    if (
        intervalCount > 0
        && lastIntervalMs !== undefined
        && minIntervalMs !== undefined
        && maxIntervalMs !== undefined
        && averageIntervalMs !== undefined
    ) {
        return {
            repeat_interval_count: intervalCount,
            repeat_interval_last_ms: lastIntervalMs,
            repeat_interval_min_ms: minIntervalMs,
            repeat_interval_max_ms: maxIntervalMs,
            repeat_interval_avg_ms: averageIntervalMs,
        };
    }

    return summarizeIntervals(timestamps);
}

function createPacketCapture({
    enabled = false,
    filePath = '/share/commax_unknown_packets.jsonl',
    now = () => new Date(),
    writeDelayMs = DEFAULT_WRITE_DELAY_MS,
} = {}) {
    const records = new Map();
    let loadPromise = null;
    let operationQueue = Promise.resolve();
    let writePromise = Promise.resolve();
    let flushTimer = null;
    let version = 0;
    let persistedVersion = 0;
    let hasLoggedStart = false;

    function markDirty() {
        version += 1;
    }

    function addRepeatInterval(record, intervalMs) {
        if (intervalMs === undefined) {
            return;
        }

        const previousCount = normalizePositiveInteger(record.repeat_interval_count);
        const previousAverage = normalizePositiveNumber(record.repeat_interval_avg_ms) || 0;
        const nextCount = previousCount + 1;

        record.repeat_interval_count = nextCount;
        record.repeat_interval_last_ms = intervalMs;
        record.repeat_interval_min_ms = Math.min(
            normalizePositiveNumber(record.repeat_interval_min_ms) ?? intervalMs,
            intervalMs,
        );
        record.repeat_interval_max_ms = Math.max(
            normalizePositiveNumber(record.repeat_interval_max_ms) ?? intervalMs,
            intervalMs,
        );
        record.repeat_interval_avg_ms = Math.round(((previousAverage * previousCount) + intervalMs) / nextCount);
    }

    function mergeRepeatSummary(existing, incoming) {
        const incomingCount = normalizePositiveInteger(incoming.repeat_interval_count);

        if (incomingCount === 0) {
            return;
        }

        const existingCount = normalizePositiveInteger(existing.repeat_interval_count);
        const existingAverage = normalizePositiveNumber(existing.repeat_interval_avg_ms) || 0;
        const incomingAverage = normalizePositiveNumber(incoming.repeat_interval_avg_ms) || 0;
        const mergedCount = existingCount + incomingCount;
        const minIntervals = [
            normalizePositiveNumber(existing.repeat_interval_min_ms),
            normalizePositiveNumber(incoming.repeat_interval_min_ms),
        ].filter((value) => value !== undefined);
        const maxIntervals = [
            normalizePositiveNumber(existing.repeat_interval_max_ms),
            normalizePositiveNumber(incoming.repeat_interval_max_ms),
        ].filter((value) => value !== undefined);

        existing.repeat_interval_count = mergedCount;
        existing.repeat_interval_last_ms = normalizePositiveNumber(incoming.repeat_interval_last_ms)
            ?? existing.repeat_interval_last_ms;
        existing.repeat_interval_min_ms = minIntervals.length > 0
            ? Math.min(...minIntervals)
            : existing.repeat_interval_min_ms;
        existing.repeat_interval_max_ms = maxIntervals.length > 0
            ? Math.max(...maxIntervals)
            : existing.repeat_interval_max_ms;
        existing.repeat_interval_avg_ms = Math.round(
            ((existingAverage * existingCount) + (incomingAverage * incomingCount)) / mergedCount,
        );
    }

    function upsertRecord(incoming) {
        const key = createPacketKey(incoming);
        const existing = records.get(key);

        if (!existing) {
            records.set(key, incoming);
            markDirty();
            return;
        }

        const previousLastSeen = existing.last_seen;
        existing.note = incoming.note || existing.note;
        existing.first_seen = existing.first_seen <= incoming.first_seen ? existing.first_seen : incoming.first_seen;
        existing.last_seen = existing.last_seen >= incoming.last_seen ? existing.last_seen : incoming.last_seen;
        existing.count += incoming.count;
        mergeRepeatSummary(existing, incoming);
        addRepeatInterval(existing, calculateIntervalMs(previousLastSeen, incoming.first_seen));
        existing.recent_seen_at = mergeRecentTimestamps(existing.recent_seen_at, incoming.recent_seen_at);
        const recentContexts = mergeRecentContexts(existing.recent_contexts, incoming.recent_contexts);
        if (recentContexts.length > 0) {
            existing.recent_contexts = recentContexts;
        } else {
            delete existing.recent_contexts;
        }
        markDirty();
    }

    function normalizeExistingRecord(record) {
        const fallbackTimestamp = normalizeTimestamp(record.timestamp, new Date().toISOString());
        const firstSeen = normalizeTimestamp(record.first_seen, fallbackTimestamp);
        const lastSeen = normalizeTimestamp(record.last_seen, fallbackTimestamp);
        const hasFullSeenAt = Array.isArray(record.seen_at) && record.seen_at.length > 0;
        const seenAt = normalizeSeenTimestamps(record, lastSeen);
        const repeatSummary = normalizeRepeatSummary(record, seenAt, hasFullSeenAt);

        const normalized = {
            source: record.source,
            kind: record.kind,
            note: record.note,
            length: record.length,
            header: record.header,
            hex: record.hex,
            first_seen: firstSeen <= lastSeen ? firstSeen : lastSeen,
            last_seen: lastSeen >= firstSeen ? lastSeen : firstSeen,
            count: Number.isInteger(record.count) && record.count > 0 ? record.count : seenAt.length || 1,
            recent_seen_at: trimRecentTimestamps(seenAt),
            ...repeatSummary,
        };

        const recentContexts = trimRecentContexts(record.recent_contexts);
        if (recentContexts.length > 0) {
            normalized.recent_contexts = recentContexts;
        }

        return normalized;
    }

    async function loadExistingRecords() {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const lines = data.split(/\r?\n/).filter((line) => line.trim());
            let needsRewrite = false;

            lines.forEach((line) => {
                try {
                    const parsed = JSON.parse(line);
                    const normalized = normalizeExistingRecord(parsed);
                    const key = createPacketKey(normalized);

                    if (
                        records.has(key)
                        || parsed.timestamp
                        || parsed.seen_at
                        || !parsed.recent_seen_at
                        || !parsed.first_seen
                        || !parsed.last_seen
                        || !Number.isInteger(parsed.count)
                    ) {
                        needsRewrite = true;
                    }

                    const beforeVersion = version;
                    upsertRecord(normalized);
                    version = beforeVersion;
                } catch (err) {
                    needsRewrite = true;
                    logError(`알 수 없는 패킷 캡처 기존 레코드 파싱 실패 (${filePath}):`, err);
                }
            });

            persistedVersion = needsRewrite ? -1 : version;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logError(`알 수 없는 패킷 캡처 기존 파일 읽기 실패 (${filePath}):`, err);
            }
        }
    }

    function ensureLoaded() {
        if (!loadPromise) {
            loadPromise = loadExistingRecords();
        }

        return loadPromise;
    }

    async function writeRecords() {
        if (persistedVersion === version) {
            return;
        }

        const targetVersion = version;
        const lines = Array.from(records.values()).map((record) => JSON.stringify(record));
        const contents = lines.length > 0 ? `${lines.join('\n')}\n` : '';
        const tempPath = `${filePath}.tmp`;

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(tempPath, contents, 'utf8');
        await fs.rename(tempPath, filePath);
        persistedVersion = targetVersion;
    }

    function queueWrite() {
        writePromise = writePromise
            .catch(() => undefined)
            .then(() => writeRecords())
            .catch((err) => {
                logError(`알 수 없는 패킷 캡처 저장 실패 (${filePath}):`, err);
            });
    }

    function scheduleWrite() {
        if (flushTimer) {
            return;
        }

        flushTimer = setTimeout(() => {
            flushTimer = null;
            queueWrite();
        }, writeDelayMs);
    }

    function createContextEntry(context, timestamp) {
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return null;
        }

        return {
            seen_at: timestamp,
            ...context,
        };
    }

    function createRecord({ source, kind, bytes, note, context }, timestamp) {
        const normalizedBytes = [...bytes];
        const record = {
            source,
            kind,
            note,
            length: normalizedBytes.length,
            header: normalizedBytes[0]?.toString(16).padStart(2, '0').toUpperCase(),
            hex: formatBytes(normalizedBytes),
            first_seen: timestamp,
            last_seen: timestamp,
            count: 1,
            recent_seen_at: [timestamp],
            repeat_interval_count: 0,
        };

        const contextEntry = createContextEntry(context, timestamp);
        if (contextEntry) {
            record.recent_contexts = [contextEntry];
        }

        return record;
    }

    function record({ source, kind, bytes, note, context }) {
        if (!enabled || !bytes || bytes.length === 0) {
            return;
        }

        if (!hasLoggedStart) {
            log(`알 수 없는 패킷 캡처를 시작합니다: ${filePath}`);
            hasLoggedStart = true;
        }

        const timestamp = now().toISOString();
        const entry = createRecord({ source, kind, bytes, note, context }, timestamp);

        operationQueue = operationQueue
            .catch(() => undefined)
            .then(async () => {
                await ensureLoaded();
                upsertRecord(entry);
                scheduleWrite();
            })
            .catch((err) => {
                logError(`알 수 없는 패킷 캡처 갱신 실패 (${filePath}):`, err);
            });
    }

    async function flush() {
        await operationQueue.catch(() => undefined);

        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
            queueWrite();
        }

        await writePromise.catch(() => undefined);
    }

    return {
        enabled,
        flush,
        record,
    };
}

module.exports = {
    createPacketCapture,
};

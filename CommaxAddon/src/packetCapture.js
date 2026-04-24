const fs = require('fs').promises;
const path = require('path');
const { formatBytes } = require('./packetFramer');
const { log, logError } = require('./utils');

const DEFAULT_WRITE_DELAY_MS = 1000;

function createPacketKey(record) {
    return [record.source, record.kind, record.hex].join('\t');
}

function normalizeTimestamp(value, fallback) {
    return typeof value === 'string' && value ? value : fallback;
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

    function mergeSeenTimestamps(existingTimestamps, incomingTimestamps) {
        return [...existingTimestamps, ...incomingTimestamps]
            .filter((value) => typeof value === 'string' && value);
    }

    function upsertRecord(incoming) {
        const key = createPacketKey(incoming);
        const existing = records.get(key);

        if (!existing) {
            records.set(key, incoming);
            markDirty();
            return;
        }

        existing.note = incoming.note || existing.note;
        existing.first_seen = existing.first_seen <= incoming.first_seen ? existing.first_seen : incoming.first_seen;
        existing.last_seen = existing.last_seen >= incoming.last_seen ? existing.last_seen : incoming.last_seen;
        existing.count += incoming.count;
        existing.seen_at = mergeSeenTimestamps(existing.seen_at, incoming.seen_at);
        markDirty();
    }

    function normalizeExistingRecord(record) {
        const fallbackTimestamp = normalizeTimestamp(record.timestamp, new Date().toISOString());
        const firstSeen = normalizeTimestamp(record.first_seen, fallbackTimestamp);
        const lastSeen = normalizeTimestamp(record.last_seen, fallbackTimestamp);
        const seenAt = normalizeSeenTimestamps(record, lastSeen);

        return {
            source: record.source,
            kind: record.kind,
            note: record.note,
            length: record.length,
            header: record.header,
            hex: record.hex,
            first_seen: firstSeen <= lastSeen ? firstSeen : lastSeen,
            last_seen: lastSeen >= firstSeen ? lastSeen : firstSeen,
            count: Number.isInteger(record.count) && record.count > 0 ? record.count : seenAt.length || 1,
            seen_at: seenAt,
        };
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

                    if (records.has(key) || parsed.timestamp || parsed.recent_seen_at || !parsed.seen_at || !parsed.first_seen || !parsed.last_seen) {
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

    function createRecord({ source, kind, bytes, note }, timestamp) {
        const normalizedBytes = [...bytes];

        return {
            source,
            kind,
            note,
            length: normalizedBytes.length,
            header: normalizedBytes[0]?.toString(16).padStart(2, '0').toUpperCase(),
            hex: formatBytes(normalizedBytes),
            first_seen: timestamp,
            last_seen: timestamp,
            count: 1,
            seen_at: [timestamp],
        };
    }

    function record({ source, kind, bytes, note }) {
        if (!enabled || !bytes || bytes.length === 0) {
            return;
        }

        if (!hasLoggedStart) {
            log(`알 수 없는 패킷 캡처를 시작합니다: ${filePath}`);
            hasLoggedStart = true;
        }

        const timestamp = now().toISOString();
        const entry = createRecord({ source, kind, bytes, note }, timestamp);

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

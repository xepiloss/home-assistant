const { log } = require('./utils');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;
const PACKET_TIMING_SAMPLE_LIMIT = 50;
const PACKET_TIMING_MIN_SAMPLES = 4;
const COMMAND_TX_BUDGET_MS = 14;
const COMMAND_TX_GUARD_MS = 8;
const COMMAND_SAFE_FLUSH_FALLBACK_MS = 120;
const PACKET_TIMING_CYCLE_MIN_KEYS = 4;
const PACKET_TIMING_LOG_LIMIT = 24;
const PACKET_TIMING_CYCLE_ANCHOR_PREFIX = '30 01 ';

const PERIODIC_PACKET_HEADERS = new Set([
    0x02, // thermostat query
    0x0F, // auxiliary query observed near living-information traffic
    0x10, // gas query/auxiliary
    0x20, // master light query
    0x24, // living-information current weather / outdoor dust
    0x25, // living-information forecast
    0x30, // light query
    0x47, // unchanged periodic frame
    0x48, // unchanged periodic frame
    0x76, // ventilation query
    0x77, // ventilation auxiliary/query
    0x79, // outlet query
    0x8F, // unknown repeating heartbeat candidate
    0xF7, // unchanged periodic frame / metering auxiliary
]);

const ACK_OR_COMMAND_RESPONSE_HEADERS = new Set([
    0x82, 0x84, // thermostat state/ACK
    0x90, 0x91, // gas state/ACK
    0xA0, 0xA2, // master light / elevator state/ACK
    0xA4, // living-information ACK
    0xB0, 0xB1, // light state/ACK
    0xF6, 0xF8, // ventilation state/ACK
    0xF9, 0xFA, // outlet state/ACK
]);

function byteToHex(byte) {
    return byte.toString(16).padStart(2, '0').toUpperCase();
}

function calculateChecksum(bytes) {
    return bytes.reduce((sum, byte) => (sum + byte) & 0xFF, 0);
}

function hasValidChecksum(bytes) {
    return Array.isArray(bytes)
        && bytes.length >= 8
        && calculateChecksum(bytes.slice(0, 7)) === bytes[7];
}

function getPacketTimingKey(bytes = []) {
    if (!Array.isArray(bytes) || bytes.length < 8 || !hasValidChecksum(bytes)) {
        return '';
    }

    const header = bytes[0];
    if (ACK_OR_COMMAND_RESPONSE_HEADERS.has(header) || !PERIODIC_PACKET_HEADERS.has(header)) {
        return '';
    }

    if (header === 0x8F) {
        return '8F';
    }

    return [header, bytes[1], bytes[2]].map(byteToHex).join(' ');
}

function createPacketIntervalMonitor(commandHandler, getSocket) {
    let lastReceiveTime = null;
    let currentPacketKey = '';
    let lastTimingReceiveTime = null;
    let lastTimingPacketKey = '';
    let windowStartTime = null;
    let hasChecked = false;
    let intervalTimer = null;
    let safeFlushTimer = null;
    let intervals = [];
    let cyclePacketKeys = new Set();
    const packetTimingStats = new Map();

    function recordPacketGap(packetKey, interval) {
        if (!packetKey || !Number.isFinite(interval) || interval <= 0 || interval > 1000) {
            return;
        }

        let stats = packetTimingStats.get(packetKey);
        if (!stats) {
            stats = [];
            packetTimingStats.set(packetKey, stats);
        }

        stats.push(interval);
        if (stats.length > PACKET_TIMING_SAMPLE_LIMIT) {
            stats.splice(0, stats.length - PACKET_TIMING_SAMPLE_LIMIT);
        }
    }

    function getEstimatedNextGap(packetKey) {
        const stats = packetTimingStats.get(packetKey);
        if (!stats || stats.length < PACKET_TIMING_MIN_SAMPLES) {
            return null;
        }

        const sorted = [...stats].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }

    function getAverageNextGap(packetKey) {
        const stats = packetTimingStats.get(packetKey);
        if (!stats || stats.length === 0) {
            return null;
        }

        return stats.reduce((sum, value) => sum + value, 0) / stats.length;
    }

    function describeTimingPacket(packetKey) {
        const parts = packetKey.split(' ');
        const header = parts[0];
        const deviceId = parts[1];
        const subtype = parts[2];

        switch (header) {
            case '02':
                return `난방 query ${deviceId || ''}`.trim();
            case '10':
                return `가스 query ${deviceId || ''}`.trim();
            case '20':
                return `일괄소등 query ${deviceId || ''}`.trim();
            case '24':
                return `생활정보 현재값 ${deviceId || ''} ${subtype || ''}`.trim();
            case '25':
                return `생활정보 예보 ${deviceId || ''} ${subtype || ''}`.trim();
            case '30':
                return `조명 query ${deviceId || ''} ${subtype || ''}`.trim();
            case '76':
            case '77':
                return `환기 query ${deviceId || ''} ${subtype || ''}`.trim();
            case '79':
                return `대기전력 query ${deviceId || ''} ${subtype || ''}`.trim();
            case '8F':
                return 'unknown heartbeat';
            default:
                return `주기 프레임 ${packetKey}`;
        }
    }

    function formatTimingSummaryEntries() {
        const entries = [...packetTimingStats.entries()]
            .filter(([, stats]) => stats.length >= PACKET_TIMING_MIN_SAMPLES)
            .map(([packetKey, stats]) => ({
                packetKey,
                label: describeTimingPacket(packetKey),
                count: stats.length,
                average: getAverageNextGap(packetKey),
            }))
            .sort((a, b) => a.packetKey.localeCompare(b.packetKey));

        if (entries.length === 0) {
            return [];
        }

        const visibleEntries = entries.slice(0, PACKET_TIMING_LOG_LIMIT);
        const hiddenCount = entries.length - visibleEntries.length;
        const formattedEntries = visibleEntries
            .map(({ packetKey, label, average, count }) => `${label} (${packetKey}) -> 평균 ${average.toFixed(1)}ms, 샘플 ${count}개`);

        if (hiddenCount > 0) {
            formattedEntries.push(`외 ${hiddenCount}개`);
        }

        return formattedEntries;
    }

    function isCycleAnchorPacket(packetKey) {
        return packetKey.startsWith(PACKET_TIMING_CYCLE_ANCHOR_PREFIX);
    }

    function recordTimingCycle(packetKey) {
        if (!packetKey) {
            return;
        }

        if (isCycleAnchorPacket(packetKey) && cyclePacketKeys.size >= PACKET_TIMING_CYCLE_MIN_KEYS) {
            const summaryEntries = formatTimingSummaryEntries();
            if (summaryEntries.length > 0) {
                log(`패킷 간극 학습 한바퀴 요약(조명 01 기준): ${summaryEntries.length}개`);
                summaryEntries.forEach((entry) => log(`  - ${entry}`));
            }
            cyclePacketKeys = new Set([packetKey]);
            return;
        }

        cyclePacketKeys.add(packetKey);
    }

    function flushQueueNow() {
        if (safeFlushTimer) {
            clearTimeout(safeFlushTimer);
            safeFlushTimer = null;
        }

        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    }

    function getSafeFlushDelay(now = Date.now()) {
        if (!lastTimingReceiveTime || !currentPacketKey) {
            return 0;
        }

        const estimatedGap = getEstimatedNextGap(currentPacketKey);
        if (!estimatedGap) {
            return 0;
        }

        const elapsed = now - lastTimingReceiveTime;
        const requiredBudget = COMMAND_TX_BUDGET_MS + COMMAND_TX_GUARD_MS;

        if (elapsed + requiredBudget <= estimatedGap) {
            return 0;
        }

        return Math.min(COMMAND_SAFE_FLUSH_FALLBACK_MS, Math.max(1, estimatedGap - elapsed + requiredBudget));
    }

    function flushQueue() {
        const delay = getSafeFlushDelay();
        if (delay <= 0) {
            flushQueueNow();
            return;
        }

        if (!safeFlushTimer) {
            safeFlushTimer = setTimeout(flushQueueNow, delay);
        }
    }

    function recordPacket(bytes) {
        const currentTime = Date.now();
        const packetKey = getPacketTimingKey(bytes);

        if (!hasChecked && windowStartTime === null) {
            windowStartTime = currentTime;
            log('10초 동안 패킷 수신 간격을 수집합니다.');
        }

        if (!hasChecked && lastReceiveTime !== null) {
            intervals.push(currentTime - lastReceiveTime);
        }

        if (packetKey && lastTimingReceiveTime !== null) {
            recordPacketGap(lastTimingPacketKey, currentTime - lastTimingReceiveTime);
        }

        lastReceiveTime = currentTime;
        if (packetKey) {
            lastTimingReceiveTime = currentTime;
            lastTimingPacketKey = packetKey;
            currentPacketKey = packetKey;
            recordTimingCycle(packetKey);
        }

        if (hasChecked || currentTime - windowStartTime < INTERVAL_WINDOW_MS) {
            return;
        }

        if (intervals.length === 0) {
            log('10초 동안 패킷이 수신되지 않았습니다. EW11 연결 상태를 확인하세요.');
            hasChecked = true;
            windowStartTime = null;
            return;
        }

        const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        log(`10초 패킷 수신 간격 평균: ${averageInterval.toFixed(2)}ms`);

        if (averageInterval >= THRESHOLD_INTERVAL_MS && !intervalTimer) {
            log(`10초 패킷 수신 간격 평균이 ${THRESHOLD_INTERVAL_MS}ms 이상이라 ${COMMAND_DRAIN_INTERVAL_MS}ms 주기 큐 배출을 시작합니다.`);
            intervalTimer = setInterval(flushQueue, COMMAND_DRAIN_INTERVAL_MS);
        }

        hasChecked = true;
        windowStartTime = null;
        intervals = [];
    }

    function stop() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
        if (safeFlushTimer) {
            clearTimeout(safeFlushTimer);
            safeFlushTimer = null;
        }
    }

    return {
        flushQueue,
        getEstimatedNextGap,
        getAverageNextGap,
        getSafeFlushDelay,
        recordPacket,
        stop,
    };
}

module.exports = {
    createPacketIntervalMonitor,
    getPacketTimingKey,
};

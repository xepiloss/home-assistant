const { log } = require('./utils');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;
const PACKET_TIMING_SAMPLE_LIMIT = 50;
const PACKET_TIMING_MIN_SAMPLES = 4;
const COMMAND_TX_BUDGET_MS = 14;
const COMMAND_TX_GUARD_MS = 8;
const COMMAND_SAFE_FLUSH_FALLBACK_MS = 120;
const QUERY_RESPONSE_TIMEOUT_MS = 80;
const PACKET_TIMING_CYCLE_MIN_KEYS = 4;
const PACKET_TIMING_LOG_LIMIT = 24;
const PACKET_TIMING_CYCLE_ANCHOR_KEY = 'light:01';
const LIFE_INFO_RESPONSE_KEY = 'life_info';

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

function getQueryTimingKey(bytes = []) {
    if (!Array.isArray(bytes) || bytes.length < 8 || !hasValidChecksum(bytes)) {
        return '';
    }

    switch (bytes[0]) {
        case 0x02:
            return `heating:${byteToHex(bytes[1])}`;
        case 0x10:
            return `gas:${byteToHex(bytes[1])}`;
        case 0x20:
            return `master_light:${byteToHex(bytes[2])}`;
        case 0x24:
        case 0x25:
            return LIFE_INFO_RESPONSE_KEY;
        case 0x30:
            return `light:${byteToHex(bytes[1])}`;
        case 0x76:
        case 0x77:
            return `fan:${byteToHex(bytes[1])}`;
        case 0x79:
            return `outlet:${byteToHex(bytes[2])}`;
        default:
            return '';
    }
}

function getResponseTimingKey(bytes = []) {
    if (!Array.isArray(bytes) || bytes.length < 8 || !hasValidChecksum(bytes)) {
        return '';
    }

    switch (bytes[0]) {
        case 0x82:
        case 0x84:
            return `heating:${byteToHex(bytes[2])}`;
        case 0x90:
        case 0x91:
            return `gas:${byteToHex(bytes[2])}`;
        case 0xA0:
        case 0xA2:
            return `master_light:${byteToHex(bytes[2])}`;
        case 0xA4:
            return LIFE_INFO_RESPONSE_KEY;
        case 0xB0:
        case 0xB1:
            return `light:${byteToHex(bytes[2])}`;
        case 0xF6:
        case 0xF8:
            return `fan:${byteToHex(bytes[2])}`;
        case 0xF9:
        case 0xFA:
            return `outlet:${byteToHex(bytes[2])}`;
        default:
            return '';
    }
}

function createPacketIntervalMonitor(commandHandler, getSocket) {
    let lastReceiveTime = null;
    let currentResponseKey = '';
    let lastResponseReceiveTime = null;
    let lastResponseKey = '';
    let pendingQuery = null;
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
        const [deviceType, deviceId] = packetKey.split(':');

        switch (deviceType) {
            case 'heating':
                return `난방 응답 ${deviceId || ''}`.trim();
            case 'gas':
                return `가스 응답 ${deviceId || ''}`.trim();
            case 'master_light':
                return `일괄소등 응답 ${deviceId || ''}`.trim();
            case 'life_info':
                return '생활정보 ACK';
            case 'light':
                return `조명 응답 ${deviceId || ''}`.trim();
            case 'fan':
                return `환기 응답 ${deviceId || ''}`.trim();
            case 'outlet':
                return `대기전력 응답 ${deviceId || ''}`.trim();
            default:
                return `응답 프레임 ${packetKey}`;
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
        return packetKey === PACKET_TIMING_CYCLE_ANCHOR_KEY;
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
        if (pendingQuery) {
            const elapsedSinceQuery = now - pendingQuery.receivedAt;
            if (elapsedSinceQuery < QUERY_RESPONSE_TIMEOUT_MS) {
                return QUERY_RESPONSE_TIMEOUT_MS - elapsedSinceQuery;
            }
            pendingQuery = null;
        }

        if (!lastResponseReceiveTime || !currentResponseKey) {
            return 0;
        }

        const estimatedGap = getEstimatedNextGap(currentResponseKey);
        if (!estimatedGap) {
            return 0;
        }

        const elapsed = now - lastResponseReceiveTime;
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
        const queryKey = getQueryTimingKey(bytes);
        const responseKey = getResponseTimingKey(bytes);

        if (!hasChecked && windowStartTime === null) {
            windowStartTime = currentTime;
            log('10초 동안 패킷 수신 간격을 수집합니다.');
        }

        if (!hasChecked && lastReceiveTime !== null) {
            intervals.push(currentTime - lastReceiveTime);
        }

        if (queryKey) {
            if (lastResponseReceiveTime !== null) {
                recordPacketGap(lastResponseKey, currentTime - lastResponseReceiveTime);
            }
            pendingQuery = {
                key: queryKey,
                receivedAt: currentTime,
            };
            recordTimingCycle(queryKey);
        }

        lastReceiveTime = currentTime;
        if (responseKey) {
            if (!pendingQuery || pendingQuery.key === responseKey) {
                pendingQuery = null;
            }
            lastResponseReceiveTime = currentTime;
            lastResponseKey = responseKey;
            currentResponseKey = responseKey;
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
    getQueryTimingKey,
    getResponseTimingKey,
};

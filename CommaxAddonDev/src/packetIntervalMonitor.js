const { log } = require('./utils');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;
const QUERY_RESPONSE_TIMEOUT_MS = 80;
const LIFE_INFO_RESPONSE_KEY = 'life_info';
const AUX_STATUS_RESPONSE_KEY = 'aux_status';
const AIR_QUALITY_RESPONSE_KEY = 'air_quality';

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
        case 0x0F:
            return AUX_STATUS_RESPONSE_KEY;
        case 0x10:
            return `gas:${byteToHex(bytes[1])}`;
        case 0x20:
            return `master_light:${byteToHex(bytes[2])}`;
        case 0x24:
        case 0x25:
            return LIFE_INFO_RESPONSE_KEY;
        case 0x30:
            return `light:${byteToHex(bytes[1])}`;
        case 0x48:
            return AIR_QUALITY_RESPONSE_KEY;
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
        case 0x8F:
            return AUX_STATUS_RESPONSE_KEY;
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
        case 0xC8:
            return AIR_QUALITY_RESPONSE_KEY;
        case 0xF6:
        case 0xF7:
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
    let pendingQuery = null;
    let windowStartTime = null;
    let hasChecked = false;
    let intervalTimer = null;
    let safeFlushTimer = null;
    let intervals = [];

    function getEstimatedNextGap(packetKey) {
        return null;
    }

    function getAverageNextGap(packetKey) {
        return null;
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
        return 0;
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
            pendingQuery = {
                key: queryKey,
                receivedAt: currentTime,
            };
        }

        lastReceiveTime = currentTime;
        if (responseKey) {
            if (!pendingQuery || pendingQuery.key === responseKey) {
                pendingQuery = null;
            }
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

const { log } = require('./utils');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;
const PACKET_TIMING_SAMPLE_LIMIT = 50;
const PACKET_TIMING_MIN_SAMPLES = 4;
const COMMAND_TX_BUDGET_MS = 14;
const COMMAND_TX_GUARD_MS = 8;
const COMMAND_SAFE_FLUSH_FALLBACK_MS = 120;

function createPacketIntervalMonitor(commandHandler, getSocket) {
    let lastReceiveTime = null;
    let lastPacketKey = '';
    let currentPacketKey = '';
    let windowStartTime = null;
    let hasChecked = false;
    let intervalTimer = null;
    let safeFlushTimer = null;
    let intervals = [];
    const packetTimingStats = new Map();

    function getPacketKey(bytes = []) {
        if (!Array.isArray(bytes) || bytes.length === 0) {
            return '';
        }

        const keyBytes = bytes.slice(0, Math.min(4, bytes.length));
        return keyBytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }

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
        if (!lastReceiveTime || !currentPacketKey) {
            return 0;
        }

        const estimatedGap = getEstimatedNextGap(currentPacketKey);
        if (!estimatedGap) {
            return 0;
        }

        const elapsed = now - lastReceiveTime;
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
        const packetKey = getPacketKey(bytes);

        if (!hasChecked && windowStartTime === null) {
            windowStartTime = currentTime;
            log('10초 동안 패킷 수신 간격을 수집합니다.');
        }

        if (!hasChecked && lastReceiveTime !== null) {
            intervals.push(currentTime - lastReceiveTime);
        }

        if (lastReceiveTime !== null) {
            recordPacketGap(lastPacketKey, currentTime - lastReceiveTime);
        }

        lastReceiveTime = currentTime;
        lastPacketKey = packetKey;
        currentPacketKey = packetKey;

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
        getSafeFlushDelay,
        recordPacket,
        stop,
    };
}

module.exports = {
    createPacketIntervalMonitor,
};

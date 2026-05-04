const { log } = require('./utils');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;

function createPacketIntervalMonitor(commandHandler, getSocket) {
    let lastReceiveTime = null;
    let windowStartTime = null;
    let hasChecked = false;
    let intervalTimer = null;
    let intervals = [];

    function flushQueue() {
        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    }

    function recordPacket() {
        const currentTime = Date.now();

        if (!hasChecked && windowStartTime === null) {
            windowStartTime = currentTime;
            log('10초 동안 패킷 수신 간격을 수집합니다.');
        }

        if (!hasChecked && lastReceiveTime !== null) {
            intervals.push(currentTime - lastReceiveTime);
        }

        lastReceiveTime = currentTime;

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
    }

    return {
        flushQueue,
        recordPacket,
        stop,
    };
}

module.exports = {
    createPacketIntervalMonitor,
};

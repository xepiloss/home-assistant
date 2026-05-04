const test = require('node:test');
const assert = require('node:assert/strict');

const { createPacketIntervalMonitor, getQueryTimingKey, getResponseTimingKey } = require('../src/packetIntervalMonitor');

function withMockedNow(timestamp, callback) {
    const originalNow = Date.now;
    Date.now = () => timestamp;
    try {
        return callback();
    } finally {
        Date.now = originalNow;
    }
}

function createMonitorHarness() {
    const writes = [];
    const commandHandler = {
        dequeueAndWrite(socket) {
            writes.push(socket);
        },
    };
    const socket = { writable: true };
    const monitor = createPacketIntervalMonitor(commandHandler, () => socket);

    return { monitor, writes, socket };
}

test('createPacketIntervalMonitor learns response-to-next-query timing', () => {
    const { monitor } = createMonitorHarness();
    const query = [0x30, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37];
    const response = [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9];

    withMockedNow(0, () => monitor.recordPacket(query));
    withMockedNow(20, () => monitor.recordPacket(response));
    withMockedNow(100, () => monitor.recordPacket(query));
    withMockedNow(120, () => monitor.recordPacket(response));
    withMockedNow(200, () => monitor.recordPacket(query));
    withMockedNow(220, () => monitor.recordPacket(response));
    withMockedNow(300, () => monitor.recordPacket(query));
    withMockedNow(320, () => monitor.recordPacket(response));
    withMockedNow(400, () => monitor.recordPacket(query));

    assert.equal(monitor.getEstimatedNextGap('light:07'), 80);
    withMockedNow(420, () => monitor.recordPacket(response));
    withMockedNow(440, () => {
        assert.equal(monitor.getSafeFlushDelay(), 0);
    });
    withMockedNow(485, () => {
        assert.equal(monitor.getSafeFlushDelay(), 37);
    });
});

test('createPacketIntervalMonitor normalizes queries and responses', () => {
    const { monitor } = createMonitorHarness();
    const queryA = [0x30, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37];
    const lightAck = [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9];

    assert.equal(getQueryTimingKey(queryA), 'light:07');
    assert.equal(getResponseTimingKey(lightAck), 'light:07');

    withMockedNow(0, () => monitor.recordPacket(queryA));
    withMockedNow(20, () => monitor.recordPacket(lightAck));
    withMockedNow(60, () => monitor.recordPacket(queryA));
    withMockedNow(80, () => monitor.recordPacket(lightAck));
    withMockedNow(120, () => monitor.recordPacket(queryA));
    withMockedNow(140, () => monitor.recordPacket(lightAck));
    withMockedNow(180, () => monitor.recordPacket(queryA));
    withMockedNow(200, () => monitor.recordPacket(lightAck));
    withMockedNow(240, () => monitor.recordPacket(queryA));

    assert.equal(monitor.getEstimatedNextGap('light:07'), 40);
});

test('createPacketIntervalMonitor blocks command flush between query and response', () => {
    const { monitor, writes } = createMonitorHarness();
    const query = [0x30, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37];
    const response = [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9];

    withMockedNow(0, () => monitor.recordPacket(query));
    withMockedNow(20, () => {
        assert.equal(monitor.getSafeFlushDelay(), 60);
    });
    assert.equal(writes.length, 0);

    withMockedNow(30, () => monitor.recordPacket(response));
    withMockedNow(31, () => {
        assert.equal(monitor.getSafeFlushDelay(), 0);
        monitor.flushQueue();
    });
    assert.equal(writes.length, 1);
});

test('createPacketIntervalMonitor delays queue flush when response-to-query gap is almost exhausted', () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let scheduledDelay = null;
    let scheduledCallback = null;

    global.setTimeout = (callback, delay) => {
        scheduledCallback = callback;
        scheduledDelay = delay;
        return { timer: true };
    };
    global.clearTimeout = () => {};

    try {
        const { monitor, writes, socket } = createMonitorHarness();
        const query = [0x30, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37];
        const response = [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9];

        withMockedNow(0, () => monitor.recordPacket(query));
        withMockedNow(20, () => monitor.recordPacket(response));
        withMockedNow(100, () => monitor.recordPacket(query));
        withMockedNow(120, () => monitor.recordPacket(response));
        withMockedNow(200, () => monitor.recordPacket(query));
        withMockedNow(220, () => monitor.recordPacket(response));
        withMockedNow(300, () => monitor.recordPacket(query));
        withMockedNow(320, () => monitor.recordPacket(response));
        withMockedNow(400, () => monitor.recordPacket(query));
        withMockedNow(420, () => monitor.recordPacket(response));

        withMockedNow(485, () => monitor.flushQueue());
        assert.equal(writes.length, 0);
        assert.equal(scheduledDelay, 37);

        scheduledCallback();
        assert.deepEqual(writes, [socket]);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

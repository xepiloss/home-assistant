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
    const auxQuery = [0x0F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F];
    const auxResponse = [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B];
    const airQualityQueryA = [0x48, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49];
    const airQualityQueryB = [0x48, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x4A];
    const airQualityResponseA = [0xC8, 0x21, 0x01, 0x07, 0x14, 0x00, 0x03, 0x08];
    const airQualityResponseB = [0xC8, 0x29, 0x01, 0x07, 0x14, 0x00, 0x00, 0x0D];
    const fanQuery = [0x77, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x78];
    const fanResponse = [0xF7, 0x20, 0x01, 0x00, 0x00, 0x00, 0x00, 0x18];

    assert.equal(getQueryTimingKey(queryA), 'light:07');
    assert.equal(getResponseTimingKey(lightAck), 'light:07');
    assert.equal(getQueryTimingKey(auxQuery), 'aux_status');
    assert.equal(getResponseTimingKey(auxResponse), 'aux_status');
    assert.equal(getQueryTimingKey(airQualityQueryA), 'air_quality');
    assert.equal(getQueryTimingKey(airQualityQueryB), 'air_quality');
    assert.equal(getResponseTimingKey(airQualityResponseA), 'air_quality');
    assert.equal(getResponseTimingKey(airQualityResponseB), 'air_quality');
    assert.equal(getQueryTimingKey(fanQuery), 'fan:01');
    assert.equal(getResponseTimingKey(fanResponse), 'fan:01');

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

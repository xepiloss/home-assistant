const test = require('node:test');
const assert = require('node:assert/strict');

const { createPacketIntervalMonitor, getPacketTimingKey } = require('../src/packetIntervalMonitor');

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

test('createPacketIntervalMonitor learns next-gap timing per packet signature', () => {
    const { monitor } = createMonitorHarness();
    const packetA = [0x30, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x34];
    const packetB = [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B];

    withMockedNow(0, () => monitor.recordPacket(packetA));
    withMockedNow(60, () => monitor.recordPacket(packetB));
    withMockedNow(100, () => monitor.recordPacket(packetA));
    withMockedNow(160, () => monitor.recordPacket(packetB));
    withMockedNow(200, () => monitor.recordPacket(packetA));
    withMockedNow(260, () => monitor.recordPacket(packetB));
    withMockedNow(300, () => monitor.recordPacket(packetA));
    withMockedNow(360, () => monitor.recordPacket(packetB));
    withMockedNow(400, () => monitor.recordPacket(packetA));

    assert.equal(monitor.getEstimatedNextGap('30 04 00'), 60);
    withMockedNow(405, () => {
        assert.equal(monitor.getSafeFlushDelay(), 0);
    });
    withMockedNow(445, () => {
        assert.equal(monitor.getSafeFlushDelay(), 37);
    });
});

test('createPacketIntervalMonitor normalizes periodic packets and skips ACK/state frames', () => {
    const { monitor } = createMonitorHarness();
    const queryA = [0x30, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37];
    const queryB = [0x30, 0x07, 0x01, 0x00, 0x00, 0x00, 0x00, 0x38];
    const lightAck = [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9];

    assert.equal(getPacketTimingKey(queryA), '30 07 00');
    assert.equal(getPacketTimingKey(queryB), '30 07 01');
    assert.equal(getPacketTimingKey(lightAck), '');

    withMockedNow(0, () => monitor.recordPacket(queryA));
    withMockedNow(20, () => monitor.recordPacket(lightAck));
    withMockedNow(60, () => monitor.recordPacket(queryA));
    withMockedNow(80, () => monitor.recordPacket(lightAck));
    withMockedNow(120, () => monitor.recordPacket(queryA));
    withMockedNow(140, () => monitor.recordPacket(lightAck));
    withMockedNow(180, () => monitor.recordPacket(queryA));
    withMockedNow(200, () => monitor.recordPacket(lightAck));
    withMockedNow(240, () => monitor.recordPacket(queryA));

    assert.equal(monitor.getEstimatedNextGap('30 07 00'), 60);
});

test('createPacketIntervalMonitor delays queue flush when current packet gap is almost exhausted', () => {
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
        const packetA = [0x30, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x34];
        const packetB = [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B];

        withMockedNow(0, () => monitor.recordPacket(packetA));
        withMockedNow(60, () => monitor.recordPacket(packetB));
        withMockedNow(100, () => monitor.recordPacket(packetA));
        withMockedNow(160, () => monitor.recordPacket(packetB));
        withMockedNow(200, () => monitor.recordPacket(packetA));
        withMockedNow(260, () => monitor.recordPacket(packetB));
        withMockedNow(300, () => monitor.recordPacket(packetA));
        withMockedNow(360, () => monitor.recordPacket(packetB));
        withMockedNow(400, () => monitor.recordPacket(packetA));

        withMockedNow(445, () => monitor.flushQueue());
        assert.equal(writes.length, 0);
        assert.equal(scheduledDelay, 37);

        scheduledCallback();
        assert.deepEqual(writes, [socket]);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

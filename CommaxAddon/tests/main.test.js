const test = require('node:test');
const assert = require('node:assert/strict');

const { createPacketIntervalMonitor } = require('../src/packetIntervalMonitor');

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

test('createPacketIntervalMonitor flushes queue without learned command delay', () => {
    const { monitor, writes, socket } = createMonitorHarness();

    withMockedNow(0, () => monitor.recordPacket());
    withMockedNow(20, () => monitor.recordPacket());
    withMockedNow(40, () => monitor.recordPacket());

    monitor.flushQueue();
    assert.deepEqual(writes, [socket]);
});

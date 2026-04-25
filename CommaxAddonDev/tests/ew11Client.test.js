const test = require('node:test');
const assert = require('node:assert/strict');

const Ew11Client = require('../src/ew11Client');
const { shouldLogUnknownPackets } = Ew11Client;

test('shouldLogUnknownPackets is disabled by default', () => {
    assert.equal(shouldLogUnknownPackets({}), false);
    assert.equal(shouldLogUnknownPackets({ COMMAX_LOG_UNKNOWN_PACKETS: 'false' }), false);
});

test('shouldLogUnknownPackets accepts common truthy values', () => {
    assert.equal(shouldLogUnknownPackets({ COMMAX_LOG_UNKNOWN_PACKETS: '1' }), true);
    assert.equal(shouldLogUnknownPackets({ COMMAX_LOG_UNKNOWN_PACKETS: 'true' }), true);
    assert.equal(shouldLogUnknownPackets({ COMMAX_LOG_UNKNOWN_PACKETS: 'ON' }), true);
});

test('handleIncomingData bypasses packet framing when disabled', () => {
    const received = [];
    const rawFrame = Buffer.from([0x57, 0x00, 0x00, 0x00, 0x00, 0x01, 0x8A]);
    const client = {
        usePacketFramer: false,
        onReceive: () => undefined,
        onDataCallback: (bytes) => received.push(bytes),
    };

    Ew11Client.prototype.handleIncomingData.call(client, rawFrame);

    assert.deepEqual(received, [[...rawFrame]]);
});

test('handleIncomingData reports dropped bytes to unknown packet capture', () => {
    const captured = [];
    const client = {
        usePacketFramer: true,
        packetFramer: {
            push() {
                return {
                    frames: [[0xB1, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xB3]],
                    dropped: [[0x57, 0x00, 0x00]],
                };
            },
        },
        logUnknownPackets: false,
        name: '메인 EW11',
        onReceive: () => undefined,
        onDataCallback() {},
        onUnknownPacket: (packet) => captured.push(packet),
    };

    Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x57, 0x00, 0x00]));

    assert.equal(captured.length, 1);
    assert.equal(captured[0].source, '메인 EW11');
    assert.equal(captured[0].kind, 'dropped_bytes');
    assert.deepEqual(captured[0].bytes, [0x57, 0x00, 0x00]);
});

test('handleIncomingData reports recovered state frames to unknown packet capture', () => {
    const captured = [];
    const frames = [];
    const client = {
        usePacketFramer: true,
        packetFramer: {
            push() {
                return {
                    frames: [[0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6]],
                    dropped: [[0x04, 0x00, 0x00, 0x00, 0x05, 0xBA]],
                    recovered: [[0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6]],
                };
            },
        },
        logUnknownPackets: false,
        name: '메인 EW11',
        onReceive: () => undefined,
        onDataCallback: (bytes) => frames.push(bytes),
        onUnknownPacket: (packet) => captured.push(packet),
    };

    Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x04]));

    assert.equal(captured.length, 2);
    assert.equal(captured[0].kind, 'dropped_bytes');
    assert.equal(captured[1].kind, 'recovered_state_frame');
    assert.deepEqual(frames, [[0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6]]);
});

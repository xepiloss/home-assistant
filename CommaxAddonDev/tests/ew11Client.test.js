const test = require('node:test');
const assert = require('node:assert/strict');

const Ew11Client = require('../src/ew11Client');
const { shouldLogUnknownPackets } = Ew11Client;

function withMockedNow(timestamp, callback) {
    const originalNow = Date.now;
    Date.now = () => timestamp;

    try {
        return callback();
    } finally {
        Date.now = originalNow;
    }
}

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
        getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
        lastOutboundCommand: null,
    };

    Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x57, 0x00, 0x00]));

    assert.equal(captured.length, 1);
    assert.equal(captured[0].source, '메인 EW11');
    assert.equal(captured[0].kind, 'dropped_bytes');
    assert.deepEqual(captured[0].bytes, [0x57, 0x00, 0x00]);
    assert.equal(captured[0].context.traffic_origin, 'stock_bus');
    assert.equal(captured[0].context.traffic_origin_detail, 'no_recent_addon_command');
    assert.equal(captured[0].context.chunk_hex, '57 00 00');
    assert.equal(captured[0].context.chunk_length, 3);
    assert.deepEqual(captured[0].context.emitted_frames_hex, ['B1 01 01 00 00 00 00 B3']);
    assert.deepEqual(captured[0].context.recovered_frames_hex, []);
    assert.deepEqual(captured[0].context.dropped_bytes_hex, ['57 00 00']);
    assert.equal(captured[0].context.dropped_index, 1);
    assert.equal(captured[0].context.dropped_count, 1);
    assert.equal(captured[0].context.pending_buffer_length, 0);
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
        getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
        lastOutboundCommand: null,
    };

    Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x04]));

    assert.equal(captured.length, 2);
    assert.equal(captured[0].kind, 'dropped_bytes');
    assert.equal(captured[1].kind, 'recovered_state_frame');
    assert.deepEqual(captured[0].context.recovered_frames_hex, ['B1 01 04 00 00 00 00 B6']);
    assert.deepEqual(captured[1].context.emitted_frames_hex, ['B1 01 04 00 00 00 00 B6']);
    assert.deepEqual(captured[1].context.recovered_frames_hex, ['B1 01 04 00 00 00 00 B6']);
    assert.deepEqual(frames, [[0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6]]);
});

test('recordOutboundCommand stores command context for later packet capture', () => {
    const client = {};
    const sentAt = Date.parse('2026-04-25T02:00:00.000Z');

    Ew11Client.prototype.recordOutboundCommand.call(
        client,
        Buffer.from([0x31, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x33]),
        sentAt
    );

    assert.deepEqual(client.lastOutboundCommand, {
        hex: '31 01 01 00 00 00 00 33',
        length: 8,
        sentAt,
    });
});

test('handleIncomingData marks dropped bytes near addon outbound commands', () => {
    withMockedNow(Date.parse('2026-04-25T02:00:00.500Z'), () => {
        const captured = [];
        const client = {
            usePacketFramer: true,
            packetFramer: {
                push() {
                    return {
                        frames: [],
                        dropped: [[0x1B, 0x00]],
                    };
                },
            },
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback() {},
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            lastOutboundCommand: {
                hex: '31 01 01 00 00 00 00 33',
                length: 8,
                sentAt: Date.parse('2026-04-25T02:00:00.000Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x1B, 0x00]));

        assert.equal(captured.length, 1);
        assert.equal(captured[0].context.traffic_origin, 'addon_command_window');
        assert.equal(captured[0].context.traffic_origin_detail, 'received_within_recent_addon_command_window');
        assert.equal(captured[0].context.last_outbound_command_hex, '31 01 01 00 00 00 00 33');
        assert.equal(captured[0].context.last_outbound_elapsed_ms, 500);
        assert.equal(captured[0].context.outbound_context_window_ms, 1000);
    });
});

test('handleIncomingData marks stale outbound command context as stock bus traffic', () => {
    withMockedNow(Date.parse('2026-04-25T02:00:02.000Z'), () => {
        const captured = [];
        const client = {
            usePacketFramer: true,
            packetFramer: {
                push() {
                    return {
                        frames: [],
                        dropped: [[0x1B]],
                    };
                },
            },
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback() {},
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            lastOutboundCommand: {
                hex: '31 01 01 00 00 00 00 33',
                length: 8,
                sentAt: Date.parse('2026-04-25T02:00:00.000Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x1B]));

        assert.equal(captured.length, 1);
        assert.equal(captured[0].context.traffic_origin, 'stock_bus');
        assert.equal(captured[0].context.traffic_origin_detail, 'last_addon_command_outside_context_window');
        assert.equal(captured[0].context.last_outbound_elapsed_ms, 2000);
    });
});

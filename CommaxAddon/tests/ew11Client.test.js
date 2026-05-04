const test = require('node:test');
const assert = require('node:assert/strict');

const Ew11Client = require('../src/ew11Client');
const { PacketFramer } = require('../src/packetFramer');
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

test('handleIncomingData forwards recovered state frames without recording successful recovery capture', () => {
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
                    recoveredDetails: [{
                        bytes: [0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6],
                        reason: 'checksum_valid_frame_after_resync',
                        offset: 6,
                        header: 'B1',
                        is_state_frame: true,
                    }],
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

    assert.equal(captured.length, 1);
    assert.equal(captured[0].kind, 'dropped_bytes');
    assert.deepEqual(captured[0].context.recovered_frames_hex, ['B1 01 04 00 00 00 00 B6']);
    assert.deepEqual(frames, [[0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6]]);
});

test('handleIncomingData skips capture for corrupted known frames when recovery succeeds', () => {
    const captured = [];
    const frames = [];
    const client = {
        usePacketFramer: true,
        packetFramer: {
            buffer: Buffer.from([0x02, 0x20, 0x00, 0x00, 0x00, 0x1C]),
            push() {
                this.buffer = Buffer.alloc(0);
                return {
                    frames: [[0x20, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x22]],
                    dropped: [[0x02, 0x20, 0x00, 0x00, 0x00, 0x1C]],
                    droppedDetails: [{
                        bytes: [0x02, 0x20, 0x00, 0x00, 0x00, 0x1C],
                        reason: 'checksum_mismatch_before_recovered_frame',
                        recovered_frame_hex: '20 01 01 00 00 00 00 22',
                        recovery_status: 'recovered',
                    }],
                    corrupted: [{
                        bytes: [0x02, 0x20, 0x00, 0x00, 0x00, 0x1C, 0x20, 0x01],
                        reason: 'checksum_mismatch_before_resync',
                        recovered_frame_hex: '20 01 01 00 00 00 00 22',
                        recovery_status: 'recovered',
                        recovered_offset: 6,
                    }],
                    recovered: [[0x20, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x22]],
                    recoveredDetails: [{
                        bytes: [0x20, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x22],
                        reason: 'checksum_valid_frame_after_resync',
                        offset: 6,
                        header: '20',
                        is_state_frame: false,
                    }],
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

    Ew11Client.prototype.handleIncomingData.call(client, Buffer.from([0x20, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x22]));

    assert.equal(captured.length, 0);
    assert.deepEqual(frames, [[0x20, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x22]]);
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

test('handleIncomingData skips known empty stock-bus dropped tail', () => {
    withMockedNow(Date.parse('2026-05-03T10:55:50.472Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            lastOutboundCommand: {
                hex: '31 07 00 00 00 00 00 38',
                length: 8,
                sentAt: Date.parse('2026-05-03T10:50:00.000Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
                0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
                0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
                0x29,
            ])
        );

        assert.equal(captured.length, 0);
        assert.equal(frames.length, 3);
    });
});

test('handleIncomingData recovers a recent light ACK tail split across dropped and pending bytes', () => {
    withMockedNow(Date.parse('2026-04-30T18:51:17.323Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            recoverRecentCommandAckTail: Ew11Client.prototype.recoverRecentCommandAckTail,
            getRecentCommandAckSpec: Ew11Client.prototype.getRecentCommandAckSpec,
            lastOutboundCommand: {
                hex: '31 04 01 00 00 00 00 36',
                length: 8,
                sentAt: Date.parse('2026-04-30T18:51:17.252Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x82, 0x80, 0x04, 0x23, 0x05, 0x00, 0x00, 0x2E,
                0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6,
            ])
        );

        assert.deepEqual(frames, [
            [0x82, 0x80, 0x04, 0x23, 0x05, 0x00, 0x00, 0x2E],
            [0xB1, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0xB6],
        ]);
        assert.equal(client.packetFramer.buffer.length, 0);
        assert.equal(captured.length, 0);
    });
});

test('handleIncomingData recovers a recent light ACK tail with a corrupted state byte', () => {
    withMockedNow(Date.parse('2026-04-29T22:48:51.421Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            recoverRecentCommandAckTail: Ew11Client.prototype.recoverRecentCommandAckTail,
            getRecentCommandAckSpec: Ew11Client.prototype.getRecentCommandAckSpec,
            lastOutboundCommand: {
                hex: '31 07 01 00 00 00 00 39',
                length: 8,
                sentAt: Date.parse('2026-04-29T22:48:51.354Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B,
                0x0B, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9,
            ])
        );

        assert.deepEqual(frames, [
            [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B],
            [0xB1, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9],
        ]);
        assert.equal(captured.length, 0);
    });
});

test('handleIncomingData recovers a recent outlet ACK tail', () => {
    withMockedNow(Date.parse('2026-05-03T22:00:00.080Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            recoverRecentCommandAckTail: Ew11Client.prototype.recoverRecentCommandAckTail,
            getRecentCommandAckSpec: Ew11Client.prototype.getRecentCommandAckSpec,
            lastOutboundCommand: {
                hex: '7A 02 01 01 00 00 00 7E',
                length: 8,
                sentAt: Date.parse('2026-05-03T22:00:00.010Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B,
                0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0xFC,
            ])
        );

        assert.deepEqual(frames, [
            [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B],
            [0xF9, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0xFC],
        ]);
        assert.equal(captured.length, 0);
    });
});

test('handleIncomingData recovers a recent ventilation ACK tail with a missing header and state', () => {
    withMockedNow(Date.parse('2026-05-03T22:01:00.080Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            recoverRecentCommandAckTail: Ew11Client.prototype.recoverRecentCommandAckTail,
            getRecentCommandAckSpec: Ew11Client.prototype.getRecentCommandAckSpec,
            lastOutboundCommand: {
                hex: '78 01 01 04 00 00 00 7E',
                length: 8,
                sentAt: Date.parse('2026-05-03T22:01:00.010Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B,
                0x01, 0x01, 0x00, 0x00, 0x00, 0xFE,
            ])
        );

        assert.deepEqual(frames, [
            [0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B],
            [0xF8, 0x04, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFE],
        ]);
        assert.equal(captured.length, 0);
    });
});

test('handleIncomingData does not recover ACK tails outside the addon command window', () => {
    withMockedNow(Date.parse('2026-04-29T22:48:53.421Z'), () => {
        const captured = [];
        const frames = [];
        const client = {
            usePacketFramer: true,
            packetFramer: new PacketFramer(),
            logUnknownPackets: false,
            name: '메인 EW11',
            onReceive: () => undefined,
            onDataCallback: (bytes) => frames.push(bytes),
            onUnknownPacket: (packet) => captured.push(packet),
            getTrafficOriginContext: Ew11Client.prototype.getTrafficOriginContext,
            recoverRecentCommandAckTail: Ew11Client.prototype.recoverRecentCommandAckTail,
            getRecentCommandAckSpec: Ew11Client.prototype.getRecentCommandAckSpec,
            lastOutboundCommand: {
                hex: '31 07 01 00 00 00 00 39',
                length: 8,
                sentAt: Date.parse('2026-04-29T22:48:51.354Z'),
            },
            outboundContextWindowMs: 1000,
        };

        Ew11Client.prototype.handleIncomingData.call(
            client,
            Buffer.from([
                0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B,
                0x0B, 0x07, 0x00, 0x00, 0x00, 0x00, 0xB9,
            ])
        );

        assert.deepEqual(frames, [[0x8F, 0x0A, 0x03, 0x05, 0x40, 0x04, 0x46, 0x2B]]);
        assert.equal(captured.length, 1);
        assert.equal(captured[0].kind, 'dropped_bytes');
        assert.equal(captured[0].context.traffic_origin, 'stock_bus');
    });
});

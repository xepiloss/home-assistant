const test = require('node:test');
const assert = require('node:assert/strict');

const {
    METERING_PACKET_LENGTHS,
    PRIMARY_PACKET_LENGTHS,
    PacketFramer,
    formatBytes,
    resolveMeteringFrameLength,
} = require('../src/packetFramer');

test('PacketFramer emits complete 8-byte frames immediately', () => {
    const framer = new PacketFramer();
    const lightFrame = Buffer.from([0xB1, 0x01, 0x01, 0, 0, 0, 0, 0]);
    const outletFrame = Buffer.from([0xF9, 0x01, 0x01, 0, 0, 0, 0, 0]);

    const result = framer.push(Buffer.concat([lightFrame, outletFrame]));

    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.frames, [[...lightFrame], [...outletFrame]]);
});

test('PacketFramer keeps only an incomplete tail until the next chunk', () => {
    const framer = new PacketFramer();
    const frame = Buffer.from([0x82, 0x81, 0x01, 0x24, 0x26, 0, 0, 0xEE]);

    assert.deepEqual(framer.push(frame.subarray(0, 3)), { frames: [], dropped: [] });
    assert.deepEqual(framer.push(frame.subarray(3)), { frames: [[...frame]], dropped: [] });
});

test('PacketFramer preserves long parking frames', () => {
    const framer = new PacketFramer();
    const frame = Buffer.from([
        0x2A, 0x00, 0x00, 0xBD, 0xC2, 0xB1, 0xAD, 0xC3,
        0xB2, 0xB2, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
        0xC2, 0xB2, 0xAE, 0xF0, 0xEE, 0xE7, 0x80, 0x80,
        0x80, 0x80, 0x80, 0x80, 0xB4, 0xB8, 0xB3, 0x80,
        0x80, 0xB3, 0xB3, 0xB4, 0x80, 0x80, 0xB5, 0xB4,
        0xB4, 0xB4, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
    ]);

    const result = framer.push(frame);

    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].length, 48);
});

test('PacketFramer extracts a 32-byte metering frame and following 8-byte frame', () => {
    const framer = new PacketFramer({ packetLengths: METERING_PACKET_LENGTHS });
    const meteringFrame = Buffer.from([
        0xF7, 0x30, 0x0F, 0x81, 0x19, 0x00, 0x00, 0x00,
        0x09, 0x57, 0x00, 0x00, 0x00, 0x00, 0x01, 0x03,
        0x32, 0x07, 0x21, 0x35, 0x00, 0x00, 0x00, 0x04,
        0x11, 0x39, 0x88, 0x00, 0x06, 0x33, 0xBC, 0x8E,
    ]);
    const fanFrame = Buffer.from([0xF6, 0x04, 0x01, 0x03, 0, 0, 0, 0]);

    const result = framer.push(Buffer.concat([meteringFrame, fanFrame]));

    assert.deepEqual(result.frames, [[...meteringFrame], [...fanFrame]]);
});

test('PacketFramer preserves variable-length F7 metering traffic', () => {
    const framer = new PacketFramer({ packetLengths: METERING_PACKET_LENGTHS });
    const pollFrame = Buffer.from([0xF7, 0x30, 0x0F, 0x0F, 0x00, 0xC7, 0x0C]);
    const ackFrame = Buffer.from([0xF7, 0x30, 0x0F, 0x8F, 0x02, 0x00, 0x1F, 0x5A, 0x40]);
    const requestFrame = Buffer.from([0xF7, 0x30, 0x0F, 0x01, 0x00, 0xC9, 0x00]);
    const stateFrame = Buffer.from([
        0xF7, 0x30, 0x0F, 0x81, 0x19, 0x00, 0x00, 0x00,
        0x09, 0x57, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
        0x61, 0x07, 0x21, 0x35, 0x00, 0x00, 0x00, 0x04,
        0x11, 0x39, 0x88, 0x00, 0x06, 0x33, 0xEE, 0xEE,
    ]);

    const result = framer.push(Buffer.concat([pollFrame, ackFrame, requestFrame, stateFrame]));

    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.frames, [
        [...pollFrame],
        [...ackFrame],
        [...requestFrame],
        [...stateFrame],
    ]);
});

test('PacketFramer keeps main EW11 F7 traffic as fixed 8-byte frames', () => {
    const framer = new PacketFramer({ packetLengths: PRIMARY_PACKET_LENGTHS });
    const frame = Buffer.from([0xF7, 0x79, 0x01, 0x01, 0x00, 0x00, 0x00, 0x72]);

    const result = framer.push(frame);

    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.frames, [[...frame]]);
});

test('resolveMeteringFrameLength waits for the F7 subtype byte', () => {
    assert.equal(resolveMeteringFrameLength(Buffer.from([0xF7, 0x30, 0x0F])), null);
    assert.equal(resolveMeteringFrameLength(Buffer.from([0xF7, 0x30, 0x0F, 0x0F])), 7);
    assert.equal(resolveMeteringFrameLength(Buffer.from([0xF7, 0x30, 0x0F, 0x8F])), 9);
    assert.equal(resolveMeteringFrameLength(Buffer.from([0xF7, 0x30, 0x0F, 0x81])), 32);
});

test('PacketFramer drops unknown bytes and resyncs to the next known header', () => {
    const framer = new PacketFramer();
    const lightFrame = Buffer.from([0xB1, 0x01, 0x01, 0, 0, 0, 0, 0]);

    const result = framer.push(Buffer.concat([Buffer.from([0x55, 0x66]), lightFrame]));

    assert.equal(formatBytes(result.dropped[0]), '55 66');
    assert.deepEqual(result.frames, [[...lightFrame]]);
});

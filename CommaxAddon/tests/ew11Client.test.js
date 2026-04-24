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
        onDataCallback: (bytes) => received.push(bytes),
    };

    Ew11Client.prototype.handleIncomingData.call(client, rawFrame);

    assert.deepEqual(received, [[...rawFrame]]);
});

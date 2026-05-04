const { calculateChecksum } = require('./deviceParser');

const KNOWN_IGNORED_PRIMARY_HEADERS = new Set([
    0x02, // thermostat query, paired with 0x04 command and 0x82/0x84 state frames
    0x0F, // auxiliary query observed near 0x8F and confirmed 0x24/0x25 information frames
    0x10, // gas query/auxiliary, paired with 0x11 command and 0x90 state frames
    0x11, // gas command observed on the wallpad bus
    0x20, // master light query, paired with 0x22 command and 0xA0/0xA2 state frames
    0x23, // elevator response/status on some Commax models
    0x30, // light query, paired with 0x31 command and 0xB0/0xB1 state frames
    0x76, // ventilation query, paired with 0x78 command and 0xF6/0xF8 state frames
    0x77, // ventilation auxiliary/query
    0x79, // outlet query, paired with 0x7A command and 0xF9/0xFA state frames
    0x8F, // unknown repeating heartbeat candidate; confirmed weather/dust payloads use 0x24/0x25
    0x90, // gas status frame
    0xA4, // life information ACK, observed after 0x24 frames
]);

// Observed unchanged on the main EW11 over 2026-04-25 04:00-10:39 KST.
// These are high-frequency periodic frames with valid checksums, but their
// semantic meaning is not identified yet. Keep exact matches out of the
// unknown-packet capture while still recording any byte-level variation.
const KNOWN_STABLE_PRIMARY_FRAMES = new Set([
    'F7 20 01 00 00 00 00 18',
    '47 01 00 00 00 00 00 48',
    '48 01 00 00 00 00 00 49',
    '48 01 01 00 00 00 00 4A',
    '48 01 02 00 00 00 00 4B',
    'AA 00 00 00 00 00 00 AA',
]);

function toHexKey(bytes) {
    return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
}

function hasValidChecksum(bytes) {
    return bytes.length >= 8 && calculateChecksum(bytes.slice(0, 7)) === bytes[7];
}

function isKnownStablePrimaryFrame(bytes) {
    return bytes
        && bytes.length === 8
        && KNOWN_STABLE_PRIMARY_FRAMES.has(toHexKey(bytes))
        && hasValidChecksum(bytes);
}

function isKnownIgnoredPrimaryFrame(bytes) {
    return bytes
        && bytes.length === 8
        && (
            isKnownStablePrimaryFrame(bytes)
            || (KNOWN_IGNORED_PRIMARY_HEADERS.has(bytes[0]) && hasValidChecksum(bytes))
        );
}

function isKnownIgnoredMeteringFrame(bytes) {
    return bytes
        && bytes[0] === 0xF7
        && bytes[1] === 0x30
        && bytes[2] === 0x0F
        && [0x0F, 0x8F, 0x01].includes(bytes[3])
        && [7, 9].includes(bytes.length);
}

module.exports = {
    isKnownIgnoredMeteringFrame,
    isKnownIgnoredPrimaryFrame,
    isKnownStablePrimaryFrame,
};

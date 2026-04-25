const { calculateChecksum } = require('./deviceParser');

const KNOWN_IGNORED_PRIMARY_HEADERS = new Set([
    0x02, // thermostat query
    0x0F, // life information query
    0x10, // gas query/auxiliary
    0x11, // gas command
    0x20, // master light query
    0x23, // elevator response/status on some Commax models
    0x30, // light query
    0x76, // ventilation query
    0x77, // ventilation auxiliary/query
    0x79, // outlet query
    0x90, // gas status
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
    '8F 0A 03 05 40 04 46 2B',
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

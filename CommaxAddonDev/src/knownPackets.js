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

function hasValidChecksum(bytes) {
    return bytes.length >= 8 && calculateChecksum(bytes.slice(0, 7)) === bytes[7];
}

function isKnownIgnoredPrimaryFrame(bytes) {
    return bytes
        && bytes.length === 8
        && KNOWN_IGNORED_PRIMARY_HEADERS.has(bytes[0])
        && hasValidChecksum(bytes);
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
};

const { calculateChecksum } = require('./utils');

const HVAC_MODES = Object.freeze(['off', 'cool', 'fan_only', 'dry', 'heat', 'auto']);
const FAN_MODES = Object.freeze(['silent', 'low', 'medium', 'high', 'power', 'auto']);
const SWING_MODES = Object.freeze(['auto', 'fix']);
const DEFAULT_TX_BYTE_0 = 0x80;
const DEFAULT_REQUEST_ID = 0xA3;
const RESPONSE_LENGTH = 16;
const RESPONSE_PREFIX = 0x10;

const MODE_BY_BYTE = Object.freeze({
    0x00: 'cool',
    0x01: 'dry',
    0x02: 'fan_only',
    0x03: 'auto',
    0x04: 'heat',
});

const BYTE_BY_MODE = Object.freeze(Object.fromEntries(
    Object.entries(MODE_BY_BYTE).map(([byte, mode]) => [mode, Number(byte)])
));

const FAN_MODE_BY_BITS = Object.freeze({
    0x10: 'low',
    0x20: 'medium',
    0x30: 'high',
    0x40: 'auto',
    0x50: 'silent',
    0x60: 'power',
});

const FAN_BITS_BY_MODE = Object.freeze(Object.fromEntries(
    Object.entries(FAN_MODE_BY_BITS).map(([bits, mode]) => [mode, Number(bits)])
));

const SWING_MODE_BY_BITS = Object.freeze({
    0x00: 'fix',
    0x08: 'auto',
});

const SWING_BITS_BY_MODE = Object.freeze(Object.fromEntries(
    Object.entries(SWING_MODE_BY_BITS).map(([bits, mode]) => [mode, Number(bits)])
));

const OPER_BYTES = Object.freeze({
    offUnlocked: 0x02,
    onUnlocked: 0x03,
    offLocked: 0x06,
    onLocked: 0x07,
});

function padDeviceId(deviceId) {
    return String(deviceId).padStart(2, '0');
}

function encodeTargetTemperature(temperature) {
    const parsed = Number.parseInt(temperature, 10);
    if (!Number.isFinite(parsed)) {
        return 24 - 15;
    }

    return Math.max(18, Math.min(30, parsed)) - 15;
}

function encodeModeByte({ hvacMode = 'cool', fanMode = 'auto', swingMode = 'auto' } = {}) {
    const modeBits = BYTE_BY_MODE[hvacMode] ?? BYTE_BY_MODE.cool;
    const fanBits = FAN_BITS_BY_MODE[fanMode] ?? FAN_BITS_BY_MODE.auto;
    const swingBits = SWING_BITS_BY_MODE[swingMode] ?? SWING_BITS_BY_MODE.auto;
    return modeBits + fanBits + swingBits;
}

function createPacket(deviceId, operationByte, {
    targetTemperature = 24,
    hvacMode = 'cool',
    fanMode = 'auto',
    swingMode = 'auto',
    txByte0 = DEFAULT_TX_BYTE_0,
    requestId = DEFAULT_REQUEST_ID,
} = {}) {
    const deviceIdByte = Number.parseInt(deviceId, 10);
    const bytes = [
        txByte0,
        0x00,
        requestId,
        deviceIdByte,
        operationByte,
        encodeModeByte({ hvacMode, fanMode, swingMode }),
        encodeTargetTemperature(targetTemperature),
    ];

    return Buffer.from([...bytes, calculateChecksum(bytes)]);
}

function createStatusRequest(deviceId, currentState = {}, protocolOptions = {}) {
    return createPacket(deviceId, 0x00, { ...currentState, ...protocolOptions });
}

function createControlPacket(deviceId, action, currentState = {}, protocolOptions = {}) {
    const isOn = Boolean(currentState.isOn);
    const packetState = { ...currentState, ...protocolOptions };

    switch (action) {
        case 'turn_on':
            return createPacket(deviceId, OPER_BYTES.onUnlocked, packetState);
        case 'turn_off':
            return createPacket(deviceId, OPER_BYTES.offUnlocked, packetState);
        case 'lock_on':
            return createPacket(deviceId, isOn ? OPER_BYTES.onLocked : OPER_BYTES.offLocked, packetState);
        case 'lock_off':
            return createPacket(deviceId, isOn ? OPER_BYTES.onUnlocked : OPER_BYTES.offUnlocked, packetState);
        default:
            return createStatusRequest(deviceId, currentState, protocolOptions);
    }
}

function parseCurrentTemperature(byte) {
    if (byte === undefined || byte === 0xFF) {
        return null;
    }

    if (byte <= 0x28) {
        return null;
    }

    return Math.round(((192 - byte) / 3) * 10) / 10;
}

function parseTargetTemperature(byte) {
    if (byte === undefined || byte === 0xFF) {
        return null;
    }

    return (byte & 0x0F) + 15;
}

function parseHvacMode(byte, operationByte) {
    if (!Boolean(operationByte & 0x01)) {
        return 'off';
    }

    return MODE_BY_BYTE[byte & 0x07] || 'auto';
}

function parseFanMode(byte) {
    return FAN_MODE_BY_BITS[byte & 0x70] || 'auto';
}

function parseSwingMode(byte) {
    return SWING_MODE_BY_BITS[byte & 0x08] || 'fix';
}

function parseStatusPacket(bytes, { supportedHvacModes = HVAC_MODES } = {}) {
    if (!bytes || bytes.length !== RESPONSE_LENGTH) {
        return null;
    }

    if (bytes[0] !== RESPONSE_PREFIX) {
        return null;
    }

    if (calculateChecksum(bytes.slice(0, RESPONSE_LENGTH - 1)) !== bytes[RESPONSE_LENGTH - 1]) {
        return null;
    }

    const deviceIdByte = bytes[4];
    if (!Number.isInteger(deviceIdByte)) {
        return null;
    }

    let hvacMode = parseHvacMode(bytes[6], bytes[1]);
    if (!supportedHvacModes.includes(hvacMode)) {
        hvacMode = Boolean(bytes[1] & 0x01) ? 'cool' : 'off';
    }
    const fanMode = parseFanMode(bytes[6]);
    const swingMode = parseSwingMode(bytes[6]);
    const targetTemperature = parseTargetTemperature(bytes[7]);
    const currentTemperature = parseCurrentTemperature(bytes[8]);
    const pipeTemperature1 = parseCurrentTemperature(bytes[9]);
    const pipeTemperature2 = parseCurrentTemperature(bytes[10]);
    const isOn = Boolean(bytes[1] & 0x01);
    const locked = Boolean(bytes[1] & 0x04);
    const plasma = Boolean(bytes[1] & 0x10);
    const errorCode = bytes[5];
    const zoneActiveLoad = bytes[11];
    const zonePowerState = bytes[12];
    const zoneDesignLoad = bytes[13];
    const oduTotalLoad = bytes[14];
    const zoneRunning = zonePowerState === 0;

    return {
        deviceId: padDeviceId(deviceIdByte),
        operationByte: bytes[1],
        modeByte: bytes[6],
        errorCode,
        isOn,
        locked,
        plasma,
        zoneRunning,
        hvacMode,
        fanMode,
        swingMode,
        targetTemperature,
        currentTemperature,
        pipeTemperature1,
        pipeTemperature2,
        zoneActiveLoad,
        zonePowerState,
        zoneDesignLoad,
        oduTotalLoad,
        rawHex: Buffer.from(bytes).toString('hex').toUpperCase(),
        raw: [...bytes],
    };
}

module.exports = {
    BYTE_BY_MODE,
    DEFAULT_REQUEST_ID,
    DEFAULT_TX_BYTE_0,
    FAN_MODES,
    FAN_BITS_BY_MODE,
    HVAC_MODES,
    OPER_BYTES,
    RESPONSE_LENGTH,
    RESPONSE_PREFIX,
    SWING_MODES,
    SWING_BITS_BY_MODE,
    createControlPacket,
    createPacket,
    createStatusRequest,
    encodeModeByte,
    encodeTargetTemperature,
    padDeviceId,
    parseCurrentTemperature,
    parseFanMode,
    parseHvacMode,
    parseSwingMode,
    parseStatusPacket,
    parseTargetTemperature,
};

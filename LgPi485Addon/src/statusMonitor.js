const { formatBytes, log } = require('./utils');

function toHex(byte) {
    return `0x${byte.toString(16).padStart(2, '0').toUpperCase()}`;
}

function summarize(parsed) {
    const raw = parsed.raw || [];
    const targetByte = raw[7] ?? 0;

    return {
        operation: raw[1],
        modeByte: raw[6],
        targetByte,
        targetLowNibble: targetByte & 0x0F,
        targetHighNibble: (targetByte >> 4) & 0x0F,
        decodedTarget: parsed.targetTemperature,
        currentTempByte: raw[8],
        currentTemperature: parsed.currentTemperature,
        pipe1Byte: raw[9],
        pipe2Byte: raw[10],
        rawHex: parsed.rawHex,
    };
}

function formatSummary(summary) {
    return [
        `op=${toHex(summary.operation)}`,
        `mode=${toHex(summary.modeByte)}`,
        `targetByte=${toHex(summary.targetByte)}`,
        `targetLow=${summary.targetLowNibble}`,
        `targetHigh=${summary.targetHighNibble}`,
        `target=${summary.decodedTarget}`,
        `roomByte=${toHex(summary.currentTempByte)}`,
        `room=${summary.currentTemperature}`,
        `pipe1Byte=${toHex(summary.pipe1Byte)}`,
        `pipe2Byte=${toHex(summary.pipe2Byte)}`,
    ].join(' ');
}

function diffSummary(previous, current) {
    if (!previous) {
        return 'baseline';
    }

    return Object.entries(current)
        .filter(([key, value]) => key !== 'rawHex' && previous[key] !== value)
        .map(([key, value]) => `${key}:${previous[key]}->${value}`)
        .join(', ');
}

function createStatusMonitor({ enabled = false, deviceIds = [], logUnchanged = false, logger = log } = {}) {
    const watchedDeviceIds = new Set(deviceIds.map((id) => String(id).padStart(2, '0')));
    const previousByDeviceId = new Map();

    return {
        observe(parsed) {
            if (!enabled || !parsed) {
                return;
            }

            if (watchedDeviceIds.size > 0 && !watchedDeviceIds.has(parsed.deviceId)) {
                return;
            }

            const current = summarize(parsed);
            const previous = previousByDeviceId.get(parsed.deviceId);
            const diff = diffSummary(previous, current);

            previousByDeviceId.set(parsed.deviceId, current);

            if (!logUnchanged && previous && diff === '') {
                return;
            }

            logger(`LG PI485 monitor ${parsed.deviceId}: ${formatSummary(current)} diff=${diff || 'none'} raw=${formatBytes(parsed.raw)}`);
        },
    };
}

module.exports = {
    createStatusMonitor,
    diffSummary,
    summarize,
};

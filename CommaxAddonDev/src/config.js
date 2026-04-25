const fs = require('fs');
const { log, logError } = require('./utils');

const OPTIONS_PATH = '/data/options.json';

const ENV_TO_OPTION = Object.freeze({
    MQTT_TOPIC_PREFIX: 'mqtt_topic_prefix',
    MQTT_BROKER_URL: 'mqtt_broker_url',
    MQTT_PORT: 'mqtt_port',
    MQTT_USERNAME: 'mqtt_username',
    MQTT_PASSWORD: 'mqtt_password',
    EW11_HOST: 'ew11_host',
    EW11_PORT: 'ew11_port',
    EW11_METERING_HOST: 'ew11_metering_host',
    EW11_METERING_PORT: 'ew11_metering_port',
    COMMAX_MONTHLY_METERING_USAGE_PERIOD: 'monthly_metering_usage_period',
    COMMAX_MONTHLY_WATER_USAGE: 'monthly_water_usage',
    COMMAX_MONTHLY_ELECTRIC_USAGE: 'monthly_electric_usage',
    COMMAX_MONTHLY_WARM_USAGE: 'monthly_warm_usage',
    COMMAX_MONTHLY_HEAT_USAGE: 'monthly_heat_usage',
    COMMAX_MONTHLY_GAS_USAGE: 'monthly_gas_usage',
    COMMAX_UNKNOWN_PACKET_CAPTURE_ENABLED: 'unknown_packet_capture_enabled',
    COMMAX_UNKNOWN_PACKET_CAPTURE_PATH: 'unknown_packet_capture_path',
    COMMAX_ELEVATOR_MODE: 'elevator_mode',
    COMMAX_ELEVATOR_RS485_CALL_COMMAND: 'elevator_rs485_call_command',
    COMMAX_ELEVATOR_RS485_CALL_ON_FRAME: 'elevator_rs485_call_on_frame',
    COMMAX_ELEVATOR_RS485_CALLING_FRAME: 'elevator_rs485_calling_frame',
    COMMAX_ELEVATOR_RS485_RELEASED_FRAME: 'elevator_rs485_released_frame',
});

const ELEVATOR_MODES = Object.freeze(['off', 'mqtt', 'rs485']);

const DEFAULT_CONFIG = Object.freeze({
    mqtt: {
        topicPrefix: 'devcommax',
        host: '',
        port: 1883,
        username: '',
        password: '',
    },
    ew11: {
        host: '',
        port: 8899,
    },
    metering: {
        host: '',
        port: 8899,
    },
    packetCapture: {
        enabled: false,
        path: '/share/commax_unknown_packets.jsonl',
    },
    elevator: {
        mode: 'mqtt',
        deviceId: '01',
        callCommand: 'A0 01 01 00 08 D7 00 81',
        callOnFrame: '22 01 40 07 00 00 00 6A',
        callingFrame: '26 01 01 42 00 01 05 70',
        releasedFrame: '26 01 01 00 00 00 00 28',
    },
});

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalNumber(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseMonthlyMeteringPeriod(value) {
    if (value === undefined || value === null || value === '') {
        return '';
    }

    const period = String(value).trim();
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
        return '';
    }

    const month = Number(match[2]);
    if (month < 1 || month > 12) {
        return '';
    }

    return period;
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function formatHexBytes(bytes) {
    return bytes
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
}

function parseHexFrame(value, fallback = '') {
    const rawValue = value === undefined || value === null || value === ''
        ? fallback
        : String(value).trim();

    if (!rawValue) {
        return {
            hex: '',
            bytes: [],
            invalid: '',
        };
    }

    const compact = String(rawValue).replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(compact) || compact.length !== 16) {
        return {
            hex: '',
            bytes: [],
            invalid: String(rawValue).trim(),
        };
    }

    const bytes = compact.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16));
    const checksum = bytes.slice(0, 7).reduce((sum, byte) => sum + byte, 0) & 0xFF;
    if (bytes[7] !== checksum) {
        return {
            hex: '',
            bytes: [],
            invalid: String(rawValue).trim(),
        };
    }

    return {
        hex: formatHexBytes(bytes),
        bytes,
        invalid: '',
    };
}

function normalizeElevatorMode(value) {
    const mode = String(value || DEFAULT_CONFIG.elevator.mode).trim().toLowerCase();
    return ELEVATOR_MODES.includes(mode) ? mode : DEFAULT_CONFIG.elevator.mode;
}

function normalizeElevatorConfig(raw = {}) {
    const callCommand = parseHexFrame(
        raw.elevator_rs485_call_command,
        DEFAULT_CONFIG.elevator.callCommand
    );
    const callOnFrame = parseHexFrame(
        raw.elevator_rs485_call_on_frame,
        DEFAULT_CONFIG.elevator.callOnFrame
    );
    const callingFrame = parseHexFrame(
        raw.elevator_rs485_calling_frame,
        DEFAULT_CONFIG.elevator.callingFrame
    );
    const releasedFrame = parseHexFrame(
        raw.elevator_rs485_released_frame,
        DEFAULT_CONFIG.elevator.releasedFrame
    );

    return {
        mode: normalizeElevatorMode(raw.elevator_mode),
        deviceId: DEFAULT_CONFIG.elevator.deviceId,
        callCommand,
        frames: {
            callOn: callOnFrame,
            calling: callingFrame,
            released: releasedFrame,
        },
        invalid: {
            mode: raw.elevator_mode !== undefined
                && !ELEVATOR_MODES.includes(String(raw.elevator_mode).trim().toLowerCase())
                ? String(raw.elevator_mode).trim()
                : '',
            callCommand: callCommand.invalid,
            callOnFrame: callOnFrame.invalid,
            callingFrame: callingFrame.invalid,
            releasedFrame: releasedFrame.invalid,
        },
    };
}

function normalizeMonthlyMeteringUsageOverrides(raw = {}) {
    const rawPeriod = raw.monthly_metering_usage_period;
    const period = parseMonthlyMeteringPeriod(rawPeriod);
    const hasInvalidPeriod = rawPeriod !== undefined
        && rawPeriod !== null
        && String(rawPeriod).trim() !== ''
        && period === '';

    return {
        period,
        invalidPeriod: hasInvalidPeriod ? String(rawPeriod).trim() : '',
        values: {
            water_acc_meter: parseOptionalNumber(raw.monthly_water_usage),
            electric_acc_meter: parseOptionalNumber(raw.monthly_electric_usage),
            warm_acc_meter: parseOptionalNumber(raw.monthly_warm_usage),
            heat_acc_meter: parseOptionalNumber(raw.monthly_heat_usage),
            gas_acc_meter: parseOptionalNumber(raw.monthly_gas_usage),
        },
    };
}

function normalizeConfig(raw = {}) {
    return {
        mqtt: {
            topicPrefix: raw.mqtt_topic_prefix || DEFAULT_CONFIG.mqtt.topicPrefix,
            host: raw.mqtt_broker_url || DEFAULT_CONFIG.mqtt.host,
            port: parseInteger(raw.mqtt_port, DEFAULT_CONFIG.mqtt.port),
            username: raw.mqtt_username || DEFAULT_CONFIG.mqtt.username,
            password: raw.mqtt_password || DEFAULT_CONFIG.mqtt.password,
        },
        ew11: {
            host: raw.ew11_host || DEFAULT_CONFIG.ew11.host,
            port: parseInteger(raw.ew11_port, DEFAULT_CONFIG.ew11.port),
        },
        metering: {
            host: raw.ew11_metering_host || DEFAULT_CONFIG.metering.host,
            port: parseInteger(raw.ew11_metering_port, DEFAULT_CONFIG.metering.port),
        },
        monthlyMeteringUsageOverrides: normalizeMonthlyMeteringUsageOverrides(raw),
        packetCapture: {
            enabled: parseBoolean(raw.unknown_packet_capture_enabled, DEFAULT_CONFIG.packetCapture.enabled),
            path: raw.unknown_packet_capture_path || DEFAULT_CONFIG.packetCapture.path,
        },
        elevator: normalizeElevatorConfig(raw),
    };
}

function readEnvOptions(env = process.env) {
    const envOptions = {};

    Object.entries(ENV_TO_OPTION).forEach(([envName, optionName]) => {
        const value = env[envName] ?? env[optionName];
        if (value !== undefined) {
            envOptions[optionName] = value;
        }
    });

    return envOptions;
}

function readOptionsFile(optionsPath) {
    try {
        const optionsData = fs.readFileSync(optionsPath, 'utf8');
        return JSON.parse(optionsData);
    } catch (err) {
        if (err.code === 'ENOENT') {
            log(`No ${optionsPath} found, using defaults/env.`);
            return {};
        }

        logError(`Failed to load ${optionsPath}, using defaults/env:`, err);
        return {};
    }
}

function loadConfig(optionsPath = process.env.COMMAX_OPTIONS_PATH || OPTIONS_PATH, env = process.env) {
    return normalizeConfig({
        ...readOptionsFile(optionsPath),
        ...readEnvOptions(env),
    });
}

module.exports = {
    DEFAULT_CONFIG,
    ENV_TO_OPTION,
    OPTIONS_PATH,
    loadConfig,
    normalizeConfig,
    normalizeElevatorConfig,
    parseHexFrame,
    normalizeMonthlyMeteringUsageOverrides,
    parseBoolean,
    parseMonthlyMeteringPeriod,
    parseOptionalNumber,
    readEnvOptions,
};

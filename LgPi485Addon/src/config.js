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
    LG_PI485_TX_BYTE_0: 'tx_byte_0',
    LG_PI485_REQUEST_ID: 'request_id',
    LG_PI485_INDOOR_UNITS: 'indoor_units',
    LG_PI485_INDOOR_UNIT_IDS: 'indoor_unit_ids',
    LG_PI485_COOLING_ONLY: 'cooling_only',
    LG_PI485_SUPPORTED_HVAC_MODES: 'supported_hvac_modes',
    LG_PI485_CONTROL_ENABLED: 'control_enabled',
    LG_PI485_LOG_STATUS_POLLING: 'log_status_polling',
    LG_PI485_MONITOR_ENABLED: 'monitor_enabled',
    LG_PI485_MONITOR_DEVICE_IDS: 'monitor_device_ids',
    LG_PI485_MONITOR_LOG_UNCHANGED: 'monitor_log_unchanged',
    LG_PI485_POLL_INTERVAL_MS: 'poll_interval_ms',
    LG_PI485_POLL_SPACING_MS: 'poll_spacing_ms',
    LG_PI485_COMMAND_DRAIN_INTERVAL_MS: 'command_drain_interval_ms',
    LG_PI485_UNKNOWN_PACKET_CAPTURE_ENABLED: 'unknown_packet_capture_enabled',
    LG_PI485_UNKNOWN_PACKET_CAPTURE_PATH: 'unknown_packet_capture_path',
});

const DEFAULT_CONFIG = Object.freeze({
    mqtt: {
        topicPrefix: 'devlg',
        host: '',
        port: 1883,
        username: '',
        password: '',
    },
    ew11: {
        host: '',
        port: 8899,
    },
    protocol: {
        txByte0: 0x80,
        requestId: 0xA3,
    },
    indoorUnits: 6,
    indoorUnitIds: [0, 1, 2, 3, 4, 5],
    coolingOnly: true,
    supportedHvacModes: ['off', 'cool', 'fan_only', 'dry', 'auto'],
    controlEnabled: true,
    logStatusPolling: false,
    monitor: {
        enabled: false,
        deviceIds: [],
        logUnchanged: false,
    },
    pollIntervalMs: 2000,
    pollSpacingMs: 150,
    commandDrainIntervalMs: 50,
    packetCapture: {
        enabled: false,
        path: '/share/lg_pi485_unknown_packets.jsonl',
    },
});

function parseInteger(value, fallback, { min = Number.MIN_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function parseByte(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const parsed = typeof value === 'string' && value.trim().toLowerCase().startsWith('0x')
        ? Number.parseInt(value, 16)
        : Number.parseInt(value, 10);

    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : fallback;
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

function parseIndoorUnitIds(value, fallbackCount) {
    if (Array.isArray(value)) {
        const ids = value
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
        if (ids.length > 0) {
            return [...new Set(ids)];
        }
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const ids = value
            .split(',')
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
        if (ids.length > 0) {
            return [...new Set(ids)];
        }
    }

    return Array.from({ length: fallbackCount }, (_, index) => index);
}

function parseList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }

    return [];
}

function normalizeConfig(raw = {}) {
    const indoorUnits = parseInteger(raw.indoor_units, DEFAULT_CONFIG.indoorUnits, { min: 1 });
    const coolingOnly = parseBoolean(raw.cooling_only, DEFAULT_CONFIG.coolingOnly);
    const supportedHvacModes = parseList(raw.supported_hvac_modes);

    return {
        mqtt: {
            topicPrefix: raw.mqtt_topic_prefix || DEFAULT_CONFIG.mqtt.topicPrefix,
            host: raw.mqtt_broker_url || DEFAULT_CONFIG.mqtt.host,
            port: parseInteger(raw.mqtt_port, DEFAULT_CONFIG.mqtt.port, { min: 1 }),
            username: raw.mqtt_username || DEFAULT_CONFIG.mqtt.username,
            password: raw.mqtt_password || DEFAULT_CONFIG.mqtt.password,
        },
        ew11: {
            host: raw.ew11_host || DEFAULT_CONFIG.ew11.host,
            port: parseInteger(raw.ew11_port, DEFAULT_CONFIG.ew11.port, { min: 1 }),
        },
        protocol: {
            txByte0: parseByte(raw.tx_byte_0, DEFAULT_CONFIG.protocol.txByte0),
            requestId: parseByte(raw.request_id, DEFAULT_CONFIG.protocol.requestId),
        },
        indoorUnits,
        indoorUnitIds: parseIndoorUnitIds(raw.indoor_unit_ids, indoorUnits),
        coolingOnly,
        supportedHvacModes: supportedHvacModes.length > 0
            ? supportedHvacModes
            : (coolingOnly ? DEFAULT_CONFIG.supportedHvacModes : ['off', 'cool', 'fan_only', 'dry', 'heat', 'auto']),
        controlEnabled: parseBoolean(raw.control_enabled, DEFAULT_CONFIG.controlEnabled),
        logStatusPolling: parseBoolean(raw.log_status_polling, DEFAULT_CONFIG.logStatusPolling),
        monitor: {
            enabled: parseBoolean(raw.monitor_enabled, DEFAULT_CONFIG.monitor.enabled),
            deviceIds: parseIndoorUnitIds(raw.monitor_device_ids, 0),
            logUnchanged: parseBoolean(raw.monitor_log_unchanged, DEFAULT_CONFIG.monitor.logUnchanged),
        },
        pollIntervalMs: parseInteger(raw.poll_interval_ms, DEFAULT_CONFIG.pollIntervalMs, { min: 500 }),
        pollSpacingMs: parseInteger(raw.poll_spacing_ms, DEFAULT_CONFIG.pollSpacingMs, { min: 0 }),
        commandDrainIntervalMs: parseInteger(raw.command_drain_interval_ms, DEFAULT_CONFIG.commandDrainIntervalMs, { min: 10 }),
        packetCapture: {
            enabled: parseBoolean(raw.unknown_packet_capture_enabled, DEFAULT_CONFIG.packetCapture.enabled),
            path: raw.unknown_packet_capture_path || DEFAULT_CONFIG.packetCapture.path,
        },
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

function loadConfig(optionsPath = process.env.LG_PI485_OPTIONS_PATH || OPTIONS_PATH, env = process.env) {
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
    parseByte,
    parseBoolean,
    parseIndoorUnitIds,
    parseList,
    readEnvOptions,
};

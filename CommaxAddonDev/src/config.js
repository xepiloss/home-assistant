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
});

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
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeMonthlyMeteringUsageOverrides(raw = {}) {
    return {
        period: raw.monthly_metering_usage_period || '',
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
    normalizeMonthlyMeteringUsageOverrides,
    parseOptionalNumber,
    readEnvOptions,
};

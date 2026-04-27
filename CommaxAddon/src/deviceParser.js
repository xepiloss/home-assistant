const { log, logError } = require('./utils');
const { createTopicBuilder } = require('./topics');

const WALLPAD_DEVICE = Object.freeze({
    identifiers: ['Commax'],
    name: '월패드',
    manufacturer: 'Commax',
});

const AIR_QUALITY_SENSORS = [
    {
        id: 'co2',
        name: '이산화탄소',
        uniqueId: 'commax_co2',
        unit: 'ppm',
        deviceClass: 'carbon_dioxide',
        icon: 'mdi:molecule-co2',
    },
    {
        id: 'pm2_5',
        name: '초미세먼지(PM2.5)',
        uniqueId: 'commax_pm2_5',
        unit: 'µg/m³',
        deviceClass: 'pm25',
        icon: 'mdi:air-filter',
    },
    {
        id: 'pm10',
        name: '미세먼지(PM10)',
        uniqueId: 'commax_pm10',
        unit: 'µg/m³',
        deviceClass: 'pm10',
        icon: 'mdi:blur',
    },
];

const AIR_QUALITY_DISCOVERY_ID = 'commax_air_quality';
const AIR_QUALITY_ICON_DISCOVERY_ID = 'commax_air_quality_icons_v2';

const METERING_SENSORS = [
    {
        id: 'water_meter',
        name: '실시간 수도 사용량',
        uniqueId: 'commax_water_meter',
        unit: 'm³/h',
        deviceClass: 'volume_flow_rate',
        stateClass: 'measurement',
        displayPrecision: 0,
        icon: 'mdi:water-pump',
    },
    {
        id: 'electric_meter',
        name: '실시간 전기 사용량',
        uniqueId: 'commax_electric_meter',
        unit: 'W',
        deviceClass: 'power',
        stateClass: 'measurement',
        displayPrecision: 0,
        icon: 'mdi:flash',
    },
    {
        id: 'warm_meter',
        name: '실시간 온수 사용량',
        uniqueId: 'commax_warm_meter',
        unit: 'm³/h',
        deviceClass: 'volume_flow_rate',
        stateClass: 'measurement',
        displayPrecision: 0,
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_meter',
        name: '실시간 난방 사용량',
        uniqueId: 'commax_heat_meter',
        unit: 'kW',
        deviceClass: 'power',
        stateClass: 'measurement',
        displayPrecision: 1,
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_meter',
        name: '실시간 가스 사용량',
        uniqueId: 'commax_gas_meter',
        unit: 'm³/h',
        deviceClass: 'volume_flow_rate',
        stateClass: 'measurement',
        displayPrecision: 0,
        icon: 'mdi:fire',
    },
    {
        id: 'water_acc_meter',
        name: '누적 수도 사용량',
        uniqueId: 'commax_water_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:water',
    },
    {
        id: 'electric_acc_meter',
        name: '누적 전기 사용량',
        uniqueId: 'commax_electric_acc_meter',
        unit: 'kWh',
        deviceClass: 'energy',
        displayPrecision: 1,
        icon: 'mdi:transmission-tower',
    },
    {
        id: 'warm_acc_meter',
        name: '누적 온수 사용량',
        uniqueId: 'commax_warm_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_acc_meter',
        name: '누적 난방 사용량',
        uniqueId: 'commax_heat_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 2,
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_acc_meter',
        name: '누적 가스 사용량',
        uniqueId: 'commax_gas_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:fire',
    },
];

const METERING_DISCOVERY_ID = 'commax_metering';
const METERING_ICON_DISCOVERY_ID = 'commax_metering_realtime_precision_v4';
const MONTHLY_METERING_DISCOVERY_ID = 'commax_metering_monthly';
const MONTHLY_METERING_ICON_DISCOVERY_ID = 'commax_metering_monthly_precision_v3';
const PARKING_ICON_DISCOVERY_VERSION = 2;
const WALLPAD_TIME_DISCOVERY_VERSION = 5;
const WALLPAD_TIME_DISCOVERY_ID = 'commax_wallpad_time';
const LIFE_INFO_RAW_DISCOVERY_ID = 'commax_life_info_raw';
const LIFE_INFO_TEMPERATURE_DISCOVERY_VERSION = 3;
const LIFE_INFO_TEMPERATURE_DISCOVERY_ID = 'commax_life_info_temperature';
const LIFE_INFO_CURRENT_WEATHER_DISCOVERY_VERSION = 1;
const LIFE_INFO_OUTDOOR_WEATHER_DISCOVERY_ID = 'commax_life_info_outdoor_weather';
const LIFE_INFO_OUTDOOR_HUMIDITY_DISCOVERY_ID = 'commax_life_info_outdoor_humidity';
const LIFE_INFO_OUTDOOR_PM10_DISCOVERY_ID = 'commax_life_info_outdoor_pm10';
const LIFE_INFO_FORECAST_DISCOVERY_VERSION = 1;
const LIFE_INFO_FORECAST_WEATHER_DISCOVERY_ID = 'commax_life_info_forecast_weather';
const LIFE_INFO_FORECAST_HIGH_TEMPERATURE_DISCOVERY_ID = 'commax_life_info_forecast_high_temperature';
const LIFE_INFO_FORECAST_LOW_TEMPERATURE_DISCOVERY_ID = 'commax_life_info_forecast_low_temperature';
const ELEVATOR_FLOOR_DISCOVERY_VERSION = 1;
const ELEVATOR_MQTT_FLOOR_STATE_TOPIC = 'commax/ev';
const MAX_LIGHT_DEVICE_ID = 0x20;

const MONTHLY_METERING_SENSORS = [
    {
        id: 'water_monthly_meter',
        sourceId: 'water_acc_meter',
        name: '이번달 수도 사용량',
        uniqueId: 'commax_water_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:water',
    },
    {
        id: 'electric_monthly_meter',
        sourceId: 'electric_acc_meter',
        name: '이번달 전기 사용량',
        uniqueId: 'commax_electric_monthly_meter',
        unit: 'kWh',
        deviceClass: 'energy',
        displayPrecision: 1,
        icon: 'mdi:flash',
    },
    {
        id: 'warm_monthly_meter',
        sourceId: 'warm_acc_meter',
        name: '이번달 온수 사용량',
        uniqueId: 'commax_warm_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_monthly_meter',
        sourceId: 'heat_acc_meter',
        name: '이번달 난방 사용량',
        uniqueId: 'commax_heat_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 2,
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_monthly_meter',
        sourceId: 'gas_acc_meter',
        name: '이번달 가스 사용량',
        uniqueId: 'commax_gas_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        displayPrecision: 1,
        icon: 'mdi:fire',
    },
];

const MONTHLY_METERING_SOURCE_LABELS = Object.freeze({
    water_acc_meter: '수도 누적',
    electric_acc_meter: '전기 누적',
    warm_acc_meter: '온수 누적',
    heat_acc_meter: '난방 누적',
    gas_acc_meter: '가스 누적',
});
const monthlyUsageLogCache = new WeakMap();

function calculateChecksum(bytes) {
    return bytes.reduce((sum, byte) => sum + byte, 0) & 0xFF;
}

function byteToHex(byte) {
    return byte.toString(16).padStart(2, '0');
}

function formatBytes(bytes) {
    return bytes.map((byte) => byteToHex(byte).toUpperCase()).join(' ');
}

function compactFrameHex(bytesOrFrame) {
    if (!bytesOrFrame) {
        return '';
    }

    if (Array.isArray(bytesOrFrame)) {
        return bytesOrFrame.map(byteToHex).join('').toUpperCase();
    }

    if (Array.isArray(bytesOrFrame.bytes)) {
        return compactFrameHex(bytesOrFrame.bytes);
    }

    if (typeof bytesOrFrame.hex === 'string') {
        return bytesOrFrame.hex.replace(/\s+/g, '').toUpperCase();
    }

    return '';
}

function decodeBcdString(bytes) {
    return bytes.map(byteToHex).join('');
}

function decodeBcdNumber(bytes) {
    return Number.parseInt(decodeBcdString(bytes), 10);
}

function decodeBcdByte(byte) {
    const high = byte >> 4;
    const low = byte & 0x0F;

    if (high > 9 || low > 9) {
        return null;
    }

    return high * 10 + low;
}

function decodeBcdByteOrRaw(byte) {
    const value = decodeBcdByte(byte);
    return value === null ? byte : value;
}

const WEATHER_CONDITION_LABELS = Object.freeze({
    0: '토네이도',
    1: '열대 폭풍',
    2: '허리케인',
    3: '강한 뇌우',
    4: '뇌우',
    5: '비/눈',
    6: '비/진눈깨비',
    7: '눈/진눈깨비',
    8: '어는 이슬비',
    9: '이슬비',
    10: '어는 비',
    11: '소나기',
    12: '소나기',
    13: '눈발',
    14: '약한 눈 소나기',
    15: '날리는 눈',
    16: '눈',
    17: '우박',
    18: '진눈깨비',
    19: '먼지',
    20: '안개',
    21: '연무',
    22: '연기',
    23: '돌풍',
    24: '바람',
    25: '추움',
    26: '흐림',
    27: '대체로 흐림',
    28: '대체로 흐림',
    29: '흐림',
    30: '부분적으로 흐림',
    31: '맑음',
    32: '맑음',
    33: '맑음',
    34: '맑음',
    35: '비/우박',
    36: '더움',
    37: '국지성 뇌우',
    38: '산발성 뇌우',
    39: '산발성 뇌우',
    40: '산발성 소나기',
    41: '폭설',
    42: '산발성 눈 소나기',
    43: '폭설',
    44: '부분적으로 흐림',
    45: '뇌우성 소나기',
    46: '눈 소나기',
    47: '국지성 뇌우성 소나기',
    3200: '정보 없음',
});

function describeWeatherCode(code) {
    return WEATHER_CONDITION_LABELS[code] || `알 수 없음(${code})`;
}

function decodeSignedByte(byte) {
    return byte > 0x7F ? byte - 0x100 : byte;
}

function cloneDeviceInfo() {
    return {
        ...WALLPAD_DEVICE,
        identifiers: [...WALLPAD_DEVICE.identifiers],
    };
}

function applyIcon(config, sensor) {
    if (sensor.icon) {
        config.icon = sensor.icon;
    }

    return config;
}

function buildContext(options = {}) {
    const topicPrefix = options.topicPrefix || 'devcommax';
    return {
        monthlyUsageConfig: options.monthlyUsageConfig || null,
        monthlyMeteringState: options.monthlyMeteringState || null,
        saveState: options.saveState || (async () => undefined),
        topics: options.topics || createTopicBuilder(topicPrefix),
    };
}

function publishRetained(mqttClient, topic, message, options = {}, callback) {
    mqttClient.publish(topic, String(message), { retain: true, ...options }, callback);
}

function publishAvailability(mqttClient, topic, status) {
    publishRetained(mqttClient, topic, status, { qos: 1 });
}

function publishDiscovery(mqttClient, topic, payload, onSuccess, errorMessage) {
    mqttClient.publish(topic, JSON.stringify(payload), { retain: true }, async (err) => {
        if (err) {
            logError(errorMessage, err);
            return;
        }

        if (onSuccess) {
            await onSuccess();
        }
    });
}

function deleteDiscovery(mqttClient, topic, onSuccess, errorMessage) {
    mqttClient.publish(topic, '', { retain: true }, async (err) => {
        if (err) {
            logError(errorMessage, err);
            return;
        }

        if (onSuccess) {
            await onSuccess();
        }
    });
}

function parseOutletPacket(bytes) {
    if (bytes.length !== 8 || ![0xF9, 0xFA].includes(bytes[0])) {
        return null;
    }

    const stateByte = bytes[1];
    let state;

    switch (stateByte) {
        case 0x11:
            state = 'AUTO_ON';
            break;
        case 0x01:
            state = 'MANUAL_ON';
            break;
        case 0x00:
            state = 'MANUAL_OFF';
            break;
        case 0x10:
            state = 'AUTO_OFF';
            break;
        default:
            return null;
    }

    const checksum = bytes[7];
    if (calculateChecksum(bytes.slice(0, 7)) !== checksum) {
        return null;
    }

    return {
        deviceId: byteToHex(bytes[2]),
        state,
        mode: bytes[3] === 0x10 ? 'current' : 'standby',
        power: decodeBcdNumber([bytes[5], bytes[6]]),
    };
}

function analyzeAndDiscoverOutlet(bytes, discoveredOutlets, mqttClient, options = {}) {
    const parsed = parseOutletPacket(bytes);
    if (!parsed) {
        return;
    }

    const { saveState, topics } = buildContext(options);
    const { deviceId, state, mode, power } = parsed;
    const uniqueId = `commax_outlet_${deviceId}`;

    if (!discoveredOutlets.has(uniqueId)) {
        const switchConfig = {
            name: `대기전력 ${deviceId}`,
            unique_id: uniqueId,
            state_topic: topics.path('outlet', deviceId, 'state'),
            command_topic: topics.path('outlet', deviceId, 'set'),
            availability_topic: topics.availability('outlet', deviceId),
            payload_on: 'ON',
            payload_off: 'OFF',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        };

        const currentPowerConfig = {
            name: `대기전력 ${deviceId} 실시간`,
            unique_id: `${uniqueId}_current_power`,
            state_topic: topics.path('outlet', deviceId, 'current_power'),
            availability_topic: topics.availability('outlet', deviceId, 'current_power'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: 'W',
            device_class: 'power',
            device: cloneDeviceInfo(),
        };

        const standbyPowerConfig = {
            name: `대기전력 ${deviceId} 차단값`,
            unique_id: `${uniqueId}_standby_power`,
            state_topic: topics.path('outlet', deviceId, 'standby_power'),
            command_topic: topics.path('outlet', deviceId, 'standby_power', 'set'),
            availability_topic: topics.availability('outlet', deviceId, 'standby_power'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: 'W',
            device_class: 'power',
            min: 0,
            max: 50,
            mode: 'box',
            device: cloneDeviceInfo(),
        };

        const standbyModeConfig = {
            name: `대기전력 ${deviceId} 모드`,
            unique_id: `${uniqueId}_standby_mode`,
            state_topic: topics.path('outlet', deviceId, 'standby_mode'),
            command_topic: topics.path('outlet', deviceId, 'standby_mode', 'set'),
            availability_topic: topics.availability('outlet', deviceId, 'standby_mode'),
            payload_on: 'AUTO',
            payload_off: 'MANUAL',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('switch', uniqueId),
            switchConfig,
            async () => {
                discoveredOutlets.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('outlet', deviceId), 'available');
                publishAvailability(mqttClient, topics.availability('outlet', deviceId, 'standby_mode'), 'available');
                publishAvailability(mqttClient, topics.availability('outlet', deviceId, 'standby_power'), 'available');
                publishAvailability(mqttClient, topics.availability('outlet', deviceId, 'current_power'), 'available');
            },
            `Failed to publish switch discovery for ${uniqueId}:`
        );

        publishRetained(mqttClient, topics.discovery('sensor', `${uniqueId}_current_power`), JSON.stringify(currentPowerConfig));
        publishRetained(mqttClient, topics.discovery('number', `${uniqueId}_standby_power`), JSON.stringify(standbyPowerConfig));
        publishRetained(mqttClient, topics.discovery('switch', `${uniqueId}_standby_mode`), JSON.stringify(standbyModeConfig));
    }

    const simplifiedState = state === 'AUTO_ON' || state === 'MANUAL_ON' ? 'ON' : 'OFF';
    const standbyMode = state === 'AUTO_ON' || state === 'AUTO_OFF' ? 'AUTO' : 'MANUAL';

    publishRetained(mqttClient, topics.path('outlet', deviceId, 'state'), simplifiedState);
    publishRetained(mqttClient, topics.path('outlet', deviceId, 'standby_mode'), standbyMode);

    if (mode === 'current') {
        publishRetained(mqttClient, topics.path('outlet', deviceId, 'current_power'), power);
    } else {
        publishRetained(mqttClient, topics.path('outlet', deviceId, 'standby_power'), power);
    }
}

function isValidLightDeviceId(deviceId) {
    if (typeof deviceId !== 'string' || !/^[0-9A-F]{2}$/i.test(deviceId)) {
        return false;
    }

    const numericId = Number.parseInt(deviceId, 16);
    return numericId >= 0x01 && numericId <= MAX_LIGHT_DEVICE_ID;
}

function isValidLightStatePacket(bytes) {
    if (bytes.length !== 8 || ![0xB0, 0xB1].includes(bytes[0])) {
        return false;
    }

    if (calculateChecksum(bytes.slice(0, 7)) !== bytes[7]) {
        return false;
    }

    if (![0x00, 0x01].includes(bytes[1])) {
        return false;
    }

    if (!isValidLightDeviceId(byteToHex(bytes[2]))) {
        return false;
    }

    if (bytes[3] !== 0x00 || bytes[4] !== 0x00 || ![0x00, 0x05].includes(bytes[6])) {
        return false;
    }

    if (bytes[6] === 0x05) {
        return bytes[5] >= 0x00 && bytes[5] <= 0x05;
    }

    return bytes[5] === 0x00;
}

function clearInvalidLightDiscoveries(discoveredLights, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    const invalidIds = [...discoveredLights]
        .filter((uniqueId) => uniqueId.startsWith('commax_light_'))
        .map((uniqueId) => uniqueId.replace('commax_light_', ''))
        .filter((deviceId) => !isValidLightDeviceId(deviceId));

    if (invalidIds.length === 0) {
        return false;
    }

    invalidIds.forEach((deviceId) => {
        publishRetained(mqttClient, topics.discovery('light', `light_${deviceId}`), '');
        publishRetained(mqttClient, topics.path('light', deviceId, 'state'), '');
        publishRetained(mqttClient, topics.path('light', deviceId, 'brightness'), '');
        publishAvailability(mqttClient, topics.availability('light', deviceId), 'unavailable');
        discoveredLights.delete(`commax_light_${deviceId}`);
        log(`비정상 조명 Discovery 정리 : 조명 ${deviceId}`);
    });

    void saveState();
    return true;
}

function analyzeAndDiscoverLight(bytes, discoveredLights, mqttClient, options = {}) {
    if (!isValidLightStatePacket(bytes)) {
        return false;
    }

    const { saveState, topics } = buildContext(options);
    const deviceId = byteToHex(bytes[2]);
    const power = bytes[1] === 0x01 ? 'ON' : 'OFF';
    const brightness = bytes[5];
    const canSetBrightness = bytes[6] === 0x05;
    const uniqueId = `commax_light_${deviceId}`;

    if (!discoveredLights.has(uniqueId)) {
        const discoveryPayload = {
            name: `조명 ${deviceId}`,
            unique_id: uniqueId,
            state_topic: topics.path('light', deviceId, 'state'),
            command_topic: topics.path('light', deviceId, 'set'),
            availability_topic: topics.availability('light', deviceId),
            payload_on: 'ON',
            payload_off: 'OFF',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        };

        if (canSetBrightness) {
            discoveryPayload.brightness_state_topic = topics.path('light', deviceId, 'brightness');
            discoveryPayload.brightness_command_topic = topics.path('light', deviceId, 'brightness', 'set');
            discoveryPayload.brightness_scale = 5;
        }

        publishDiscovery(
            mqttClient,
            topics.discovery('light', `light_${deviceId}`),
            discoveryPayload,
            async () => {
                discoveredLights.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('light', deviceId), 'available');
            },
            `Failed to publish light discovery for ${deviceId}:`
        );
    }

    publishRetained(mqttClient, topics.path('light', deviceId, 'state'), power);
    if (canSetBrightness) {
        publishRetained(mqttClient, topics.path('light', deviceId, 'brightness'), brightness);
    }

    return true;
}

function toLetter(byte) {
    return byte >= 0xA0 && byte <= 0xDA
        ? String.fromCharCode(65 + (byte - 0xC1))
        : '';
}

function decodeParkingText(bytes) {
    const paddingBytes = new Set([0x00, 0x80, 0xFF]);
    let start = 0;
    let end = bytes.length;

    while (start < end && paddingBytes.has(bytes[start])) {
        start += 1;
    }

    while (end > start && paddingBytes.has(bytes[end - 1])) {
        end -= 1;
    }

    const chars = bytes.slice(start, end).map(toLetter);
    if (chars.length === 0 || !chars.every(Boolean)) {
        return '';
    }

    const text = chars.join('');
    if (/^\d+$/.test(text)) {
        return text.length === 4 ? text : '';
    }

    return text.length >= 2 ? text : '';
}

function analyzeParkingAreaAndCarNumber(bytes, parkingState, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    let parkingArea;
    let carNumber;

    if (bytes[0] === 0x2A && bytes.length >= 10) {
        if (bytes[4] === 0x80 && bytes[5] === 0x80) {
            parkingArea = '-';
            carNumber = '-';
        } else {
            parkingArea = bytes.slice(4, 11).map(toLetter).join('');
            if (bytes.length >= 42) {
                carNumber = decodeParkingText(bytes.slice(38, 42));
            }
        }
    }

    if (bytes[0] === 0x80 && bytes[1] !== 0x80 && bytes.length >= 10) {
        carNumber = decodeParkingText(bytes.slice(6, 10));
    }

    const needsParkingIconUpdate = parkingState.iconDiscoveryVersion !== PARKING_ICON_DISCOVERY_VERSION;

    if (parkingArea && (!parkingState.parkingDiscovered || needsParkingIconUpdate)) {
        const parkingConfig = {
            name: '주차 위치',
            unique_id: 'commax_parking_area',
            state_topic: topics.path('parking', 'area'),
            availability_topic: topics.availability('parking', 'area'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            icon: 'mdi:map-marker',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', 'parking_area'),
            parkingConfig,
            async () => {
                parkingState.parkingDiscovered = true;
                parkingState.iconDiscoveryVersion = PARKING_ICON_DISCOVERY_VERSION;
                await saveState();
                publishAvailability(mqttClient, topics.availability('parking', 'area'), 'available');
            },
            'Failed to publish parking area discovery:'
        );
    }

    if (carNumber && (!parkingState.carNumberDiscovered || needsParkingIconUpdate)) {
        const carNumberConfig = {
            name: '주차 차량',
            unique_id: 'commax_car_number',
            state_topic: topics.path('parking', 'car_number'),
            availability_topic: topics.availability('parking', 'car_number'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            icon: 'mdi:car',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', 'car_number'),
            carNumberConfig,
            async () => {
                parkingState.carNumberDiscovered = true;
                parkingState.iconDiscoveryVersion = PARKING_ICON_DISCOVERY_VERSION;
                await saveState();
                publishAvailability(mqttClient, topics.availability('parking', 'car_number'), 'available');
            },
            'Failed to publish car number discovery:'
        );
    }

    if (parkingArea) {
        log(`주차위치 수신 : ${parkingArea}`);
        publishRetained(mqttClient, topics.path('parking', 'area'), parkingArea);
    }

    if (carNumber) {
        log(`차량번호 수신 : ${carNumber}`);
        publishRetained(mqttClient, topics.path('parking', 'car_number'), carNumber);
    }
}

function parseTemperaturePacket(bytes) {
    if (bytes.length !== 8 || ![0x82, 0x84].includes(bytes[0])) {
        return null;
    }

    if (calculateChecksum(bytes.slice(0, 7)) !== bytes[7]) {
        return null;
    }

    let state = 'unknown';
    if (bytes[1] === 0x80) {
        state = 'off';
    } else if (bytes[1] === 0x81) {
        state = 'idle';
    } else if (bytes[1] === 0x83) {
        state = 'heating';
    }

    return {
        deviceId: byteToHex(bytes[2]),
        state,
        currentTemp: bytes[3] === 0xFF ? null : decodeBcdString([bytes[3]]),
        targetTemp: bytes[4] === 0xFF ? null : decodeBcdString([bytes[4]]),
    };
}

function analyzeAndDiscoverTemperature(bytes, discoveredTemps, mqttClient, options = {}) {
    const parsed = parseTemperaturePacket(bytes);
    if (!parsed) {
        return;
    }

    const { saveState, topics } = buildContext(options);
    const { deviceId, state, currentTemp, targetTemp } = parsed;
    const uniqueId = `commax_temp_${deviceId}`;

    if (!discoveredTemps.has(uniqueId)) {
        const climateConfig = {
            name: `난방 ${deviceId}`,
            unique_id: uniqueId,
            mode_cmd_t: topics.path('temp', deviceId, 'set_mode'),
            mode_stat_t: topics.path('temp', deviceId, 'mode'),
            curr_temp_t: topics.path('temp', deviceId, 'current_temp'),
            min_temp: '5',
            max_temp: '30',
            temp_cmd_t: topics.path('temp', deviceId, 'set_temp'),
            temp_stat_t: topics.path('temp', deviceId, 'target_temp'),
            availability_topic: topics.availability('temp', deviceId),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            modes: ['off', 'heat'],
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('climate', uniqueId),
            climateConfig,
            async () => {
                discoveredTemps.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('temp', deviceId), 'available');
            },
            `Failed to publish temperature discovery for ${deviceId}:`
        );
    }

    publishRetained(mqttClient, topics.path('temp', deviceId, 'mode'), state === 'off' ? 'off' : 'heat');

    if (currentTemp !== null) {
        publishRetained(mqttClient, topics.path('temp', deviceId, 'current_temp'), currentTemp);
    }

    if (targetTemp !== null) {
        publishRetained(mqttClient, topics.path('temp', deviceId, 'target_temp'), targetTemp);
    }
}

function parseVentilationPacket(bytes) {
    if (bytes.length !== 8 || ![0xF6, 0xF8].includes(bytes[0])) {
        return null;
    }

    if (calculateChecksum(bytes.slice(0, 7)) !== bytes[7]) {
        return null;
    }

    return {
        mode: bytes[1],
        speed: bytes[3],
    };
}

function analyzeAndDiscoverVentilation(bytes, discoveredFans, mqttClient, options = {}) {
    const parsed = parseVentilationPacket(bytes);
    if (!parsed) {
        return;
    }

    const { saveState, topics } = buildContext(options);
    const { mode, speed } = parsed;
    const deviceId = '01';
    const uniqueId = `commax_fan_${deviceId}`;

    if (!discoveredFans.has(uniqueId)) {
        const fanConfig = {
            name: '환기',
            unique_id: uniqueId,
            command_topic: topics.path('fan', deviceId, 'set'),
            state_topic: topics.path('fan', deviceId, 'state'),
            availability_topic: topics.availability('fan', deviceId),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            percentage_command_topic: topics.path('fan', deviceId, 'set_speed'),
            percentage_state_topic: topics.path('fan', deviceId, 'speed'),
            preset_mode_command_topic: topics.path('fan', deviceId, 'set_mode'),
            preset_mode_state_topic: topics.path('fan', deviceId, 'mode'),
            preset_modes: ['auto', 'manual', 'bypass'],
            speed_range_min: 1,
            speed_range_max: 3,
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('fan', uniqueId),
            fanConfig,
            async () => {
                discoveredFans.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('fan', deviceId), 'available');
            },
            'Failed to publish ventilation discovery:'
        );
    }

    const state = mode === 0x00 ? 'OFF' : 'ON';
    const modeStr = mode === 0x01 ? 'auto' : mode === 0x07 ? 'bypass' : 'manual';
    const speedStr = speed === 0x01 ? '1' : speed === 0x02 ? '2' : speed === 0x03 ? '3' : '1';

    publishRetained(mqttClient, topics.path('fan', deviceId, 'state'), state);
    publishRetained(mqttClient, topics.path('fan', deviceId, 'mode'), modeStr);
    publishRetained(mqttClient, topics.path('fan', deviceId, 'speed'), speedStr);
}

function getElevatorFrameKind(bytes, elevatorConfig = {}) {
    const frameKey = compactFrameHex(bytes);
    const frames = elevatorConfig.frames || {};

    if (frameKey && frameKey === compactFrameHex(frames.callOn)) {
        return 'callOn';
    }

    if (frameKey && frameKey === compactFrameHex(frames.calling)) {
        return 'calling';
    }

    if (frameKey && frameKey === compactFrameHex(frames.released)) {
        return 'released';
    }

    return '';
}

function getElevatorDeviceIdFromFrame(bytes, elevatorConfig = {}) {
    if (elevatorConfig.deviceId) {
        return elevatorConfig.deviceId;
    }

    if (bytes[0] === 0x26 && bytes.length > 2) {
        return byteToHex(bytes[2]);
    }

    if (bytes.length > 1) {
        return byteToHex(bytes[1]);
    }

    return '01';
}

function getElevatorStatusFromFrameKind(frameKind) {
    if (frameKind === 'callOn' || frameKind === 'calling') {
        return 'ON';
    }

    if (frameKind === 'released') {
        return 'OFF';
    }

    return '';
}

function publishElevatorDiscovery(discoveredElevators, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    const elevatorConfig = options.elevator || {};
    if (elevatorConfig.mode === 'off') {
        return false;
    }

    const elevatorId = elevatorConfig.deviceId || '01';
    const uniqueId = `commax_elevator_${elevatorId}`;
    const floorDiscoveryId = `${uniqueId}_floor_sensors_v${ELEVATOR_FLOOR_DISCOVERY_VERSION}`;
    const shouldPublishSwitch = !discoveredElevators.has(uniqueId);
    const shouldPublishFloorSensors = elevatorConfig.mode === 'mqtt' && !discoveredElevators.has(floorDiscoveryId);

    if (!shouldPublishSwitch && !shouldPublishFloorSensors) {
        return false;
    }

    if (options.initialStatus) {
        publishRetained(mqttClient, topics.path('elevator', elevatorId, 'status'), options.initialStatus);
    }

    if (shouldPublishSwitch) {
        const switchConfig = {
            name: '엘레베이터',
            unique_id: `${uniqueId}_switch`,
            command_topic: topics.path('elevator', elevatorId, 'set'),
            state_topic: topics.path('elevator', elevatorId, 'status'),
            availability_topic: topics.availability('elevator', elevatorId),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('switch', `${uniqueId}_switch`),
            switchConfig,
            async () => {
                discoveredElevators.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('elevator', elevatorId), 'available');
            },
            'Failed to publish elevator discovery:'
        );
    }

    if (shouldPublishFloorSensors) {
        [
            { index: 1, key: 'ev1_floor', name: '엘리베이터 1 현재층' },
            { index: 2, key: 'ev2_floor', name: '엘리베이터 2 현재층' },
        ].forEach((sensor, sensorIndex, sensors) => {
            const sensorConfig = {
                name: sensor.name,
                unique_id: `${uniqueId}_floor_${sensor.index}`,
                state_topic: ELEVATOR_MQTT_FLOOR_STATE_TOPIC,
                value_template: `{{ value_json.${sensor.key} | default('-') }}`,
                icon: 'mdi:elevator',
                device: cloneDeviceInfo(),
            };

            publishDiscovery(
                mqttClient,
                topics.discovery('sensor', `${uniqueId}_floor_${sensor.index}`),
                sensorConfig,
                sensorIndex === sensors.length - 1
                    ? async () => {
                        discoveredElevators.add(floorDiscoveryId);
                        await saveState();
                    }
                    : null,
                'Failed to publish elevator floor discovery:'
            );
        });
    }

    return true;
}

function clearElevatorDiscovery(discoveredElevators, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    const elevatorConfig = options.elevator || {};
    const elevatorId = elevatorConfig.deviceId || '01';
    const uniqueId = `commax_elevator_${elevatorId}`;
    const floorDiscoveryId = `${uniqueId}_floor_sensors_v${ELEVATOR_FLOOR_DISCOVERY_VERSION}`;

    publishRetained(mqttClient, topics.discovery('switch', `${uniqueId}_switch`), '');
    publishRetained(mqttClient, topics.discovery('sensor', `${uniqueId}_floor_1`), '');
    publishRetained(mqttClient, topics.discovery('sensor', `${uniqueId}_floor_2`), '');
    publishRetained(mqttClient, topics.path('elevator', elevatorId, 'status'), '');
    publishAvailability(mqttClient, topics.availability('elevator', elevatorId), 'unavailable');

    const removedSwitch = discoveredElevators.delete(uniqueId);
    const removedFloorSensors = discoveredElevators.delete(floorDiscoveryId);

    if (removedSwitch || removedFloorSensors) {
        void saveState();
    }

    return true;
}

function clearElevatorFloorDiscovery(discoveredElevators, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    const elevatorConfig = options.elevator || {};
    const elevatorId = elevatorConfig.deviceId || '01';
    const uniqueId = `commax_elevator_${elevatorId}`;
    const floorDiscoveryId = `${uniqueId}_floor_sensors_v${ELEVATOR_FLOOR_DISCOVERY_VERSION}`;

    publishRetained(mqttClient, topics.discovery('sensor', `${uniqueId}_floor_1`), '');
    publishRetained(mqttClient, topics.discovery('sensor', `${uniqueId}_floor_2`), '');

    if (discoveredElevators.delete(floorDiscoveryId)) {
        void saveState();
    }

    return true;
}

function analyzeAndDiscoverElevator(bytes, discoveredElevators, mqttClient, options = {}) {
    const elevatorConfig = options.elevator || {};
    if (elevatorConfig.mode === 'off') {
        return false;
    }

    const frameKind = getElevatorFrameKind(bytes, elevatorConfig);
    if (!frameKind) {
        return false;
    }

    const { topics } = buildContext(options);
    const elevatorId = getElevatorDeviceIdFromFrame(bytes, elevatorConfig);
    publishElevatorDiscovery(discoveredElevators, mqttClient, {
        ...options,
        elevator: {
            ...elevatorConfig,
            deviceId: elevatorId,
        },
    });

    const status = getElevatorStatusFromFrameKind(frameKind);
    if (status) {
        publishRetained(mqttClient, topics.path('elevator', elevatorId, 'status'), status);
    }

    return true;
}

function parseMasterLightPacket(bytes) {
    if (bytes.length !== 8 || ![0xA0, 0xA2].includes(bytes[0])) {
        return null;
    }

    if (bytes[4] === 0x28 && bytes[5] === 0xD7) {
        return null;
    }

    if (calculateChecksum(bytes.slice(0, 7)) !== bytes[7]) {
        return null;
    }

    return {
        deviceId: byteToHex(bytes[2]),
        state: bytes[1],
    };
}

function analyzeAndDiscoverMasterLight(bytes, discoveredMasterLights, mqttClient, options = {}) {
    const parsed = parseMasterLightPacket(bytes);
    if (!parsed) {
        return;
    }

    const { saveState, topics } = buildContext(options);
    const uniqueId = 'commax_master_light_01';

    if (!discoveredMasterLights.has(uniqueId)) {
        const switchConfig = {
            name: '일괄소등',
            unique_id: uniqueId,
            command_topic: topics.path('master_light', 'set'),
            state_topic: topics.path('master_light', 'state'),
            availability_topic: topics.availability('master_light'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('switch', uniqueId),
            switchConfig,
            async () => {
                discoveredMasterLights.add(uniqueId);
                await saveState();
                publishAvailability(mqttClient, topics.availability('master_light'), 'available');
            },
            'Failed to publish master light discovery:'
        );
    }

    publishRetained(mqttClient, topics.path('master_light', 'state'), parsed.state === 0x01 ? 'ON' : 'OFF');
}

function analyzeAndDiscoverAirQuality(bytes, discoveredSensors, mqttClient, options = {}) {
    if (!bytes || bytes.length < 7 || bytes[0] !== 0xC8) {
        return false;
    }

    const { saveState, topics } = buildContext(options);
    const co2Value = decodeBcdNumber([bytes[3], bytes[4]]);
    const particleValue = decodeBcdString([bytes[6]]);

    if (!discoveredSensors.has(AIR_QUALITY_DISCOVERY_ID) || !discoveredSensors.has(AIR_QUALITY_ICON_DISCOVERY_ID)) {
        AIR_QUALITY_SENSORS.forEach((sensor) => {
            const sensorConfig = applyIcon({
                name: sensor.name,
                unique_id: sensor.uniqueId,
                state_topic: topics.path('air_quality', sensor.id, 'state'),
                availability_topic: topics.availability('air_quality', sensor.id),
                payload_available: 'available',
                payload_not_available: 'unavailable',
                unit_of_measurement: sensor.unit,
                device_class: sensor.deviceClass,
                device: cloneDeviceInfo(),
            }, sensor);

            publishDiscovery(
                mqttClient,
                topics.discovery('sensor', sensor.uniqueId),
                sensorConfig,
                async () => {
                    if (!discoveredSensors.has(AIR_QUALITY_DISCOVERY_ID) || !discoveredSensors.has(AIR_QUALITY_ICON_DISCOVERY_ID)) {
                        discoveredSensors.add(AIR_QUALITY_DISCOVERY_ID);
                        discoveredSensors.add(AIR_QUALITY_ICON_DISCOVERY_ID);
                        await saveState();
                    }

                    publishAvailability(mqttClient, topics.availability('air_quality', sensor.id), 'available');
                },
                `Failed to publish ${sensor.id} discovery:`
            );
        });
    }

    publishRetained(mqttClient, topics.path('air_quality', 'co2', 'state'), co2Value);

    if ((bytes[1] & 0x0F) === 1) {
        publishRetained(mqttClient, topics.path('air_quality', 'pm2_5', 'state'), particleValue);
    } else {
        publishRetained(mqttClient, topics.path('air_quality', 'pm10', 'state'), particleValue);
    }

    return true;
}

function hasValidChecksum(bytes) {
    return bytes.length >= 8 && calculateChecksum(bytes.slice(0, 7)) === bytes[7];
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function isValidWallpadDateTime({ year, month, day, hour, minute, second }) {
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        && date.getUTCHours() === hour
        && date.getUTCMinutes() === minute
        && date.getUTCSeconds() === second;
}

function parseWallpadTimePacket(bytes) {
    if (!bytes || bytes.length !== 8 || bytes[0] !== 0x7F || !hasValidChecksum(bytes)) {
        return null;
    }

    const parts = bytes.slice(1, 7).map(decodeBcdByte);
    if (parts.some((value) => value === null)) {
        return null;
    }

    const [yearByte, month, day, hour, minute, second] = parts;
    const wallpadTime = {
        year: 2000 + yearByte,
        month,
        day,
        hour,
        minute,
        second,
    };

    if (!isValidWallpadDateTime(wallpadTime)) {
        return null;
    }

    wallpadTime.period = `${wallpadTime.year}-${pad2(month)}`;
    wallpadTime.display = `${wallpadTime.period}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
    wallpadTime.iso = `${wallpadTime.period}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`;

    return wallpadTime;
}

function analyzeAndDiscoverWallpadTime(bytes, lifeInfoState, mqttClient, options = {}) {
    const parsed = parseWallpadTimePacket(bytes);
    if (!parsed) {
        return false;
    }

    const { saveState, topics } = buildContext(options);

    lifeInfoState.lastWallpadTime = parsed;

    const needsDiscoveryUpdate = lifeInfoState.wallpadTimeDiscoveryVersion !== WALLPAD_TIME_DISCOVERY_VERSION;

    if (needsDiscoveryUpdate) {
        const sensorConfig = {
            name: '월패드 시간',
            unique_id: WALLPAD_TIME_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'wallpad_time', 'state'),
            availability_topic: topics.availability('life_info', 'wallpad_time'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            entity_category: 'diagnostic',
            enabled_by_default: false,
            icon: 'mdi:clock-time-four-outline',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', WALLPAD_TIME_DISCOVERY_ID),
            sensorConfig,
            async () => {
                lifeInfoState.wallpadTimeDiscovered = true;
                lifeInfoState.wallpadTimeDiscoveryVersion = WALLPAD_TIME_DISCOVERY_VERSION;
                await saveState();
                publishAvailability(mqttClient, topics.availability('life_info', 'wallpad_time'), 'available');
            },
            'Failed to publish wallpad time discovery:'
        );
    }

    if (needsDiscoveryUpdate || lifeInfoState.lastPublishedWallpadTime !== parsed.display) {
        lifeInfoState.lastPublishedWallpadTime = parsed.display;
        publishRetained(mqttClient, topics.path('life_info', 'wallpad_time', 'state'), parsed.display);
    }

    return true;
}

function parseLifeInfoPacket(bytes) {
    if (!bytes || bytes.length !== 8 || bytes[0] !== 0x8F || !hasValidChecksum(bytes)) {
        return null;
    }

    return {
        raw: formatBytes(bytes),
        temperatureCode: decodeBcdByteOrRaw(bytes[1]),
        weatherCode: bytes[2],
        dustCode: bytes[3],
        value1: decodeBcdByteOrRaw(bytes[4]),
        value2: bytes[5],
        value3: decodeBcdByteOrRaw(bytes[6]),
    };
}

function analyzeAndDiscoverLifeInfo(bytes, lifeInfoState, mqttClient, options = {}) {
    if (!parseLifeInfoPacket(bytes)) {
        return false;
    }

    const { saveState, topics } = buildContext(options);

    if (!lifeInfoState.rawPacketDiscoveryDeleteSent) {
        deleteDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_RAW_DISCOVERY_ID),
            async () => {
                lifeInfoState.rawPacketDiscoveryDeleteSent = true;

                if (lifeInfoState.rawPacketDiscovered) {
                    lifeInfoState.rawPacketDiscovered = false;
                    await saveState();
                }
            },
            'Failed to delete life information packet discovery:'
        );
    }

    return true;
}

function parseLifeInfoCurrentWeatherPacket(bytes) {
    if (!bytes || bytes.length !== 8 || bytes[0] !== 0x24 || !hasValidChecksum(bytes)) {
        return null;
    }

    if (bytes[1] !== 0x01 || bytes[2] !== 0x01 || bytes[6] !== 0x00) {
        return null;
    }

    const weatherCode = bytes[3];
    const humidity = decodeBcdByte(bytes[4]);
    const temperature = decodeSignedByte(bytes[5]);
    if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
        return null;
    }

    if (!Number.isFinite(temperature) || temperature < -50 || temperature > 60) {
        return null;
    }

    return {
        deviceId: byteToHex(bytes[2]),
        weather: describeWeatherCode(weatherCode),
        weatherCode,
        weatherCodeHex: byteToHex(weatherCode).toUpperCase(),
        humidity,
        temperature,
        raw: formatBytes(bytes),
    };
}

function parseLifeInfoTemperaturePacket(bytes) {
    return parseLifeInfoCurrentWeatherPacket(bytes);
}

function analyzeAndDiscoverLifeInfoCurrentWeather(bytes, lifeInfoState, mqttClient, options = {}) {
    const parsed = parseLifeInfoCurrentWeatherPacket(bytes);
    if (!parsed) {
        return false;
    }

    const { saveState, topics } = buildContext(options);
    const needsTemperatureDiscoveryUpdate = lifeInfoState.lifeInfoTemperatureDiscoveryVersion !== LIFE_INFO_TEMPERATURE_DISCOVERY_VERSION;
    const needsCurrentWeatherDiscoveryUpdate = lifeInfoState.lifeInfoCurrentWeatherDiscoveryVersion !== LIFE_INFO_CURRENT_WEATHER_DISCOVERY_VERSION;

    if (!lifeInfoState.lifeInfoTemperatureDiscovered || needsTemperatureDiscoveryUpdate) {
        const sensorConfig = {
            name: '실외 온도',
            unique_id: LIFE_INFO_TEMPERATURE_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'outdoor_temperature', 'state'),
            json_attributes_topic: topics.path('life_info', 'outdoor_temperature', 'attributes'),
            availability_topic: topics.availability('life_info', 'outdoor_temperature'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: '°C',
            device_class: 'temperature',
            state_class: 'measurement',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_TEMPERATURE_DISCOVERY_ID),
            sensorConfig,
            async () => {
                lifeInfoState.lifeInfoTemperatureDiscovered = true;
                lifeInfoState.lifeInfoTemperatureDiscoveryVersion = LIFE_INFO_TEMPERATURE_DISCOVERY_VERSION;
                await saveState();
                publishAvailability(mqttClient, topics.availability('life_info', 'outdoor_temperature'), 'available');
            },
            'Failed to publish life information temperature discovery:'
        );
    }

    if (!lifeInfoState.lifeInfoCurrentWeatherDiscovered || needsCurrentWeatherDiscoveryUpdate) {
        const weatherConfig = {
            name: '실외 날씨',
            unique_id: LIFE_INFO_OUTDOOR_WEATHER_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'outdoor_weather', 'state'),
            json_attributes_topic: topics.path('life_info', 'outdoor_weather', 'attributes'),
            availability_topic: topics.availability('life_info', 'outdoor_weather'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            icon: 'mdi:weather-partly-cloudy',
            device: cloneDeviceInfo(),
        };

        const humidityConfig = {
            name: '실외 습도',
            unique_id: LIFE_INFO_OUTDOOR_HUMIDITY_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'outdoor_humidity', 'state'),
            json_attributes_topic: topics.path('life_info', 'outdoor_humidity', 'attributes'),
            availability_topic: topics.availability('life_info', 'outdoor_humidity'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: '%',
            device_class: 'humidity',
            state_class: 'measurement',
            device: cloneDeviceInfo(),
        };

        const onDiscoverySuccess = async () => {
            lifeInfoState.lifeInfoCurrentWeatherDiscovered = true;
            lifeInfoState.lifeInfoCurrentWeatherDiscoveryVersion = LIFE_INFO_CURRENT_WEATHER_DISCOVERY_VERSION;
            await saveState();
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_OUTDOOR_WEATHER_DISCOVERY_ID),
            weatherConfig,
            async () => {
                await onDiscoverySuccess();
                publishAvailability(mqttClient, topics.availability('life_info', 'outdoor_weather'), 'available');
            },
            'Failed to publish life information outdoor weather discovery:'
        );

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_OUTDOOR_HUMIDITY_DISCOVERY_ID),
            humidityConfig,
            async () => {
                await onDiscoverySuccess();
                publishAvailability(mqttClient, topics.availability('life_info', 'outdoor_humidity'), 'available');
            },
            'Failed to publish life information outdoor humidity discovery:'
        );
    }

    publishRetained(mqttClient, topics.path('life_info', 'outdoor_temperature', 'state'), parsed.temperature);
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_temperature', 'attributes'), JSON.stringify({
        weather: parsed.weather,
        weather_code: parsed.weatherCode,
        weather_code_hex: parsed.weatherCodeHex,
        humidity: parsed.humidity,
        device_id: parsed.deviceId,
        raw: parsed.raw,
    }));
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_weather', 'state'), parsed.weather);
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_weather', 'attributes'), JSON.stringify({
        weather_code: parsed.weatherCode,
        weather_code_hex: parsed.weatherCodeHex,
        humidity: parsed.humidity,
        temperature: parsed.temperature,
        device_id: parsed.deviceId,
        raw: parsed.raw,
    }));
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_humidity', 'state'), parsed.humidity);
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_humidity', 'attributes'), JSON.stringify({
        weather: parsed.weather,
        weather_code: parsed.weatherCode,
        weather_code_hex: parsed.weatherCodeHex,
        temperature: parsed.temperature,
        device_id: parsed.deviceId,
        raw: parsed.raw,
    }));

    return true;
}

function analyzeAndDiscoverLifeInfoTemperature(bytes, lifeInfoState, mqttClient, options = {}) {
    return analyzeAndDiscoverLifeInfoCurrentWeather(bytes, lifeInfoState, mqttClient, options);
}

function parseLifeInfoForecastPacket(bytes) {
    if (!bytes || bytes.length !== 8 || bytes[0] !== 0x25 || !hasValidChecksum(bytes)) {
        return null;
    }

    if (bytes[1] !== 0x01 || bytes[2] !== 0x01 || bytes[3] !== 0x00) {
        return null;
    }

    const weatherCode = bytes[4];
    const highTemperature = decodeBcdByteOrRaw(bytes[5]);
    const lowTemperature = decodeBcdByteOrRaw(bytes[6]);
    if (!Number.isFinite(highTemperature) || !Number.isFinite(lowTemperature)) {
        return null;
    }

    if (highTemperature < -50 || highTemperature > 70 || lowTemperature < -50 || lowTemperature > 70) {
        return null;
    }

    return {
        deviceId: byteToHex(bytes[2]),
        weather: describeWeatherCode(weatherCode),
        weatherCode,
        weatherCodeHex: byteToHex(weatherCode).toUpperCase(),
        highTemperature,
        lowTemperature,
        raw: formatBytes(bytes),
    };
}

function analyzeAndDiscoverLifeInfoForecast(bytes, lifeInfoState, mqttClient, options = {}) {
    const parsed = parseLifeInfoForecastPacket(bytes);
    if (!parsed) {
        return false;
    }

    const { saveState, topics } = buildContext(options);
    const needsDiscoveryUpdate = lifeInfoState.lifeInfoForecastDiscoveryVersion !== LIFE_INFO_FORECAST_DISCOVERY_VERSION;

    if (!lifeInfoState.lifeInfoForecastDiscovered || needsDiscoveryUpdate) {
        const weatherConfig = {
            name: '예보 날씨',
            unique_id: LIFE_INFO_FORECAST_WEATHER_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'forecast_weather', 'state'),
            json_attributes_topic: topics.path('life_info', 'forecast_weather', 'attributes'),
            availability_topic: topics.availability('life_info', 'forecast_weather'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            icon: 'mdi:weather-partly-cloudy',
            device: cloneDeviceInfo(),
        };

        const highTemperatureConfig = {
            name: '예보 최고 온도',
            unique_id: LIFE_INFO_FORECAST_HIGH_TEMPERATURE_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'forecast_high_temperature', 'state'),
            json_attributes_topic: topics.path('life_info', 'forecast_high_temperature', 'attributes'),
            availability_topic: topics.availability('life_info', 'forecast_high_temperature'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: '°C',
            device_class: 'temperature',
            state_class: 'measurement',
            device: cloneDeviceInfo(),
        };

        const lowTemperatureConfig = {
            name: '예보 최저 온도',
            unique_id: LIFE_INFO_FORECAST_LOW_TEMPERATURE_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'forecast_low_temperature', 'state'),
            json_attributes_topic: topics.path('life_info', 'forecast_low_temperature', 'attributes'),
            availability_topic: topics.availability('life_info', 'forecast_low_temperature'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: '°C',
            device_class: 'temperature',
            state_class: 'measurement',
            device: cloneDeviceInfo(),
        };

        const onDiscoverySuccess = async () => {
            lifeInfoState.lifeInfoForecastDiscovered = true;
            lifeInfoState.lifeInfoForecastDiscoveryVersion = LIFE_INFO_FORECAST_DISCOVERY_VERSION;
            await saveState();
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_FORECAST_WEATHER_DISCOVERY_ID),
            weatherConfig,
            async () => {
                await onDiscoverySuccess();
                publishAvailability(mqttClient, topics.availability('life_info', 'forecast_weather'), 'available');
            },
            'Failed to publish life information forecast weather discovery:'
        );

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_FORECAST_HIGH_TEMPERATURE_DISCOVERY_ID),
            highTemperatureConfig,
            async () => {
                await onDiscoverySuccess();
                publishAvailability(mqttClient, topics.availability('life_info', 'forecast_high_temperature'), 'available');
            },
            'Failed to publish life information forecast high temperature discovery:'
        );

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_FORECAST_LOW_TEMPERATURE_DISCOVERY_ID),
            lowTemperatureConfig,
            async () => {
                await onDiscoverySuccess();
                publishAvailability(mqttClient, topics.availability('life_info', 'forecast_low_temperature'), 'available');
            },
            'Failed to publish life information forecast low temperature discovery:'
        );
    }

    const attributes = {
        weather: parsed.weather,
        weather_code: parsed.weatherCode,
        weather_code_hex: parsed.weatherCodeHex,
        high_temperature: parsed.highTemperature,
        low_temperature: parsed.lowTemperature,
        device_id: parsed.deviceId,
        raw: parsed.raw,
    };

    publishRetained(mqttClient, topics.path('life_info', 'forecast_weather', 'state'), parsed.weather);
    publishRetained(mqttClient, topics.path('life_info', 'forecast_weather', 'attributes'), JSON.stringify(attributes));
    publishRetained(mqttClient, topics.path('life_info', 'forecast_high_temperature', 'state'), parsed.highTemperature);
    publishRetained(mqttClient, topics.path('life_info', 'forecast_high_temperature', 'attributes'), JSON.stringify(attributes));
    publishRetained(mqttClient, topics.path('life_info', 'forecast_low_temperature', 'state'), parsed.lowTemperature);
    publishRetained(mqttClient, topics.path('life_info', 'forecast_low_temperature', 'attributes'), JSON.stringify(attributes));

    return true;
}

function parseLifeInfoOutdoorPm10Packet(bytes) {
    if (!bytes || bytes.length !== 8 || bytes[0] !== 0x24 || !hasValidChecksum(bytes)) {
        return null;
    }

    if (bytes[1] !== 0x02 || bytes[2] !== 0x01 || bytes[3] !== 0x00 || bytes[5] !== 0x00 || bytes[6] !== 0x00) {
        return null;
    }

    const pm10 = bytes[4];
    if (!Number.isFinite(pm10) || pm10 > 500) {
        return null;
    }

    return {
        deviceId: byteToHex(bytes[2]),
        pm10,
        raw: formatBytes(bytes),
    };
}

function analyzeAndDiscoverLifeInfoOutdoorPm10(bytes, lifeInfoState, mqttClient, options = {}) {
    const parsed = parseLifeInfoOutdoorPm10Packet(bytes);
    if (!parsed) {
        return false;
    }

    const { saveState, topics } = buildContext(options);

    if (!lifeInfoState.lifeInfoOutdoorPm10Discovered) {
        const sensorConfig = {
            name: '실외 미세먼지',
            unique_id: LIFE_INFO_OUTDOOR_PM10_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'outdoor_pm10', 'state'),
            json_attributes_topic: topics.path('life_info', 'outdoor_pm10', 'attributes'),
            availability_topic: topics.availability('life_info', 'outdoor_pm10'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: 'µg/m³',
            device_class: 'pm10',
            state_class: 'measurement',
            icon: 'mdi:blur',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', LIFE_INFO_OUTDOOR_PM10_DISCOVERY_ID),
            sensorConfig,
            async () => {
                lifeInfoState.lifeInfoOutdoorPm10Discovered = true;
                await saveState();
                publishAvailability(mqttClient, topics.availability('life_info', 'outdoor_pm10'), 'available');
            },
            'Failed to publish life information outdoor PM10 discovery:'
        );
    }

    publishRetained(mqttClient, topics.path('life_info', 'outdoor_pm10', 'state'), parsed.pm10);
    publishRetained(mqttClient, topics.path('life_info', 'outdoor_pm10', 'attributes'), JSON.stringify({
        device_id: parsed.deviceId,
        raw: parsed.raw,
    }));

    return true;
}

function isMeteringPacket(bytes) {
    return bytes
        && bytes.length === 32
        && bytes[0] === 0xF7
        && bytes[1] === 0x30
        && bytes[3] === 0x81;
}

function getMonthlyMeteringPeriod(date = new Date()) {
    if (typeof date === 'string') {
        const match = date.match(/^(\d{4})-(\d{2})/);
        if (match) {
            return `${match[1]}-${match[2]}`;
        }
    }

    if (date && typeof date === 'object' && Number.isInteger(date.year) && Number.isInteger(date.month)) {
        return `${date.year}-${pad2(date.month)}`;
    }

    const fallbackDate = date instanceof Date ? date : new Date();
    const year = fallbackDate.getFullYear();
    const month = String(fallbackDate.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getMonthlyMeteringDateSource(date = new Date()) {
    if (date && typeof date === 'object' && Number.isInteger(date.year) && Number.isInteger(date.month)) {
        return '월패드 시간 기준';
    }

    return '시스템 시간 기준';
}

function roundMeteringValue(value) {
    return Math.round(value * 1000) / 1000;
}

function getMonthlyMeteringSourceLabel(sourceId) {
    return MONTHLY_METERING_SOURCE_LABELS[sourceId] || sourceId;
}

function shouldLogMonthlyUsageFormula(monthlyMeteringState, period, sourceId, usage, baseline) {
    let loggedKeys = monthlyUsageLogCache.get(monthlyMeteringState);
    if (!loggedKeys) {
        loggedKeys = new Set();
        monthlyUsageLogCache.set(monthlyMeteringState, loggedKeys);
    }

    const key = `${period}:${sourceId}:${usage}:${baseline}`;
    if (loggedKeys.has(key)) {
        return false;
    }

    loggedKeys.add(key);
    return true;
}

function logMonthlyUsageFormula(type, period, sourceId, usage, currentValue, baseline) {
    const calculatedUsage = roundMeteringValue(currentValue - baseline);
    log(`월간 검침 보정 ${type} (${period}, ${getMonthlyMeteringSourceLabel(sourceId)}): 입력 보정값=${usage}, 현재 누적값=${currentValue}, 월초 누적 기준값=${baseline}, 현재 이번달 사용량=${calculatedUsage}, 계산식=${currentValue} - ${baseline} = ${calculatedUsage}`);
}

function getConfiguredMonthlyUsageEntries(usageConfig, values, period, appliedUsageConfig) {
    const entries = [];
    let changed = false;

    Object.entries(usageConfig?.values || {}).forEach(([sourceId, usage]) => {
        const currentValue = values[sourceId];
        if (usage === undefined || currentValue === undefined) {
            return;
        }

        if (!Number.isFinite(usage) || usage < 0) {
            if (appliedUsageConfig.ignoredValues[sourceId] !== usage) {
                log(`월간 검침 보정 무시 (${period}, ${getMonthlyMeteringSourceLabel(sourceId)}): 입력 보정값=${usage}. 숫자가 아니거나 음수라 적용하지 않습니다.`);
                appliedUsageConfig.ignoredValues[sourceId] = usage;
                changed = true;
            }
            return;
        }

        if (!Number.isFinite(currentValue) || usage > currentValue) {
            if (appliedUsageConfig.ignoredValues[sourceId] !== usage) {
                log(`월간 검침 보정 무시 (${period}, ${getMonthlyMeteringSourceLabel(sourceId)}): 입력 보정값=${usage}, 현재 누적값=${currentValue}. 입력 보정값이 현재 누적값보다 커서 월초 누적 기준값을 계산할 수 없습니다.`);
                appliedUsageConfig.ignoredValues[sourceId] = usage;
                changed = true;
            }
            return;
        }

        entries.push([sourceId, usage]);
    });

    return { changed, entries };
}

function applyConfiguredMonthlyUsage(monthlyMeteringState, usageConfig, period, values) {
    if (!usageConfig || usageConfig.period !== period) {
        return false;
    }

    let changed = false;
    const appliedUsageConfig = monthlyMeteringState.appliedUsageConfig || {
        period: null,
        values: {},
        ignoredValues: {},
    };

    if (appliedUsageConfig.period !== period) {
        appliedUsageConfig.period = period;
        appliedUsageConfig.values = {};
        appliedUsageConfig.ignoredValues = {};
        changed = true;
    }

    if (!appliedUsageConfig.values) {
        appliedUsageConfig.values = {};
    }

    if (!appliedUsageConfig.ignoredValues) {
        appliedUsageConfig.ignoredValues = {};
    }

    const configuredEntries = getConfiguredMonthlyUsageEntries(usageConfig, values, period, appliedUsageConfig);
    changed = configuredEntries.changed || changed;

    if (configuredEntries.entries.length === 0) {
        monthlyMeteringState.appliedUsageConfig = appliedUsageConfig;
        return changed;
    }

    configuredEntries.entries.forEach(([sourceId, usage]) => {
        if (appliedUsageConfig.values[sourceId] === usage && monthlyMeteringState.baselines[sourceId] !== undefined) {
            const baseline = monthlyMeteringState.baselines[sourceId];
            if (shouldLogMonthlyUsageFormula(monthlyMeteringState, period, sourceId, usage, baseline)) {
                logMonthlyUsageFormula('유지', period, sourceId, usage, values[sourceId], baseline);
            }
            return;
        }

        const baseline = roundMeteringValue(values[sourceId] - usage);

        if (monthlyMeteringState.baselines[sourceId] !== baseline) {
            monthlyMeteringState.baselines[sourceId] = baseline;
            changed = true;
        }

        logMonthlyUsageFormula('적용', period, sourceId, usage, values[sourceId], baseline);
        shouldLogMonthlyUsageFormula(monthlyMeteringState, period, sourceId, usage, baseline);

        appliedUsageConfig.values[sourceId] = usage;
        delete appliedUsageConfig.ignoredValues[sourceId];
        changed = true;
    });

    monthlyMeteringState.appliedUsageConfig = appliedUsageConfig;

    return changed;
}

function calculateMonthlyMeteringValues(values, monthlyMeteringState, date = new Date(), usageConfig = null) {
    if (!monthlyMeteringState) {
        return { changed: false, values: {} };
    }

    const period = getMonthlyMeteringPeriod(date);
    const previousPeriod = monthlyMeteringState.period;
    const dateSource = getMonthlyMeteringDateSource(date);
    let changed = false;

    if (previousPeriod !== period) {
        monthlyMeteringState.period = period;
        monthlyMeteringState.baselines = {};
        monthlyMeteringState.appliedUsageConfig = {
            period: null,
            values: {},
        };
        changed = true;
    }

    if (applyConfiguredMonthlyUsage(monthlyMeteringState, usageConfig, period, values)) {
        changed = true;
    }

    const monthlyValues = {};

    MONTHLY_METERING_SENSORS.forEach((sensor) => {
        const currentValue = values[sensor.sourceId];
        const baseline = monthlyMeteringState.baselines[sensor.sourceId];

        if (baseline === undefined || currentValue < baseline) {
            monthlyMeteringState.baselines[sensor.sourceId] = currentValue;
            monthlyValues[sensor.id] = 0;
            changed = true;
            const periodReason = previousPeriod && previousPeriod !== period
                ? `${dateSource} 월 변경 ${previousPeriod} -> ${period}`
                : `${dateSource} ${period} 초기 설정`;
            log(`월간 검침 자동 기준값 설정 (${periodReason}, ${getMonthlyMeteringSourceLabel(sensor.sourceId)}): 현재 누적값=${currentValue}, 월초 누적 기준값=${currentValue}`);
            return;
        }

        monthlyValues[sensor.id] = roundMeteringValue(currentValue - baseline);
    });

    return { changed, values: monthlyValues };
}

function analyzeAndDiscoverMetering(bytes, discoveredMeters, mqttClient, options = {}) {
    if (!isMeteringPacket(bytes)) {
        return false;
    }

    const { monthlyMeteringState, monthlyUsageConfig, saveState, topics } = buildContext(options);
    const monthlyMeteringDate = options.monthlyMeteringDate || new Date();
    const values = {
        water_meter: decodeBcdNumber([bytes[5], bytes[6]]),
        water_acc_meter: decodeBcdNumber([bytes[7], bytes[8], bytes[9]]) / 10,
        gas_meter: decodeBcdNumber([bytes[10], bytes[11]]),
        gas_acc_meter: decodeBcdNumber([bytes[12], bytes[13], bytes[14]]) / 10,
        electric_meter: decodeBcdNumber([bytes[15], bytes[16]]),
        electric_acc_meter: decodeBcdNumber([bytes[17], bytes[18], bytes[19]]) / 10,
        warm_meter: decodeBcdNumber([bytes[20], bytes[21]]),
        warm_acc_meter: decodeBcdNumber([bytes[22], bytes[23], bytes[24]]) / 10,
        heat_meter: decodeBcdNumber([bytes[25], bytes[26]]) / 10,
        heat_acc_meter: decodeBcdNumber([bytes[27], bytes[28], bytes[29]]) / 100,
    };

    const monthlyResult = calculateMonthlyMeteringValues(values, monthlyMeteringState, monthlyMeteringDate, monthlyUsageConfig);

    if (!discoveredMeters.has(METERING_DISCOVERY_ID) || !discoveredMeters.has(METERING_ICON_DISCOVERY_ID)) {
        METERING_SENSORS.forEach((sensor) => {
            const sensorConfig = applyIcon({
                name: sensor.name,
                unique_id: sensor.uniqueId,
                state_topic: topics.path('smart_metering', sensor.id, 'state'),
                availability_topic: topics.availability('smart_metering', sensor.id),
                payload_available: 'available',
                payload_not_available: 'unavailable',
                unit_of_measurement: sensor.unit,
                device_class: sensor.deviceClass,
                state_class: sensor.stateClass,
                device: cloneDeviceInfo(),
            }, sensor);
            if (sensor.displayPrecision !== undefined) {
                sensorConfig.suggested_display_precision = sensor.displayPrecision;
            }

            publishDiscovery(
                mqttClient,
                topics.discovery('sensor', sensor.uniqueId),
                sensorConfig,
                async () => {
                    if (!discoveredMeters.has(METERING_DISCOVERY_ID) || !discoveredMeters.has(METERING_ICON_DISCOVERY_ID)) {
                        discoveredMeters.add(METERING_DISCOVERY_ID);
                        discoveredMeters.add(METERING_ICON_DISCOVERY_ID);
                        await saveState();
                    }

                    publishAvailability(mqttClient, topics.availability('smart_metering', sensor.id), 'available');
                },
                `Failed to publish ${sensor.id} discovery:`
            );
        });
    }

    if (!discoveredMeters.has(MONTHLY_METERING_DISCOVERY_ID) || !discoveredMeters.has(MONTHLY_METERING_ICON_DISCOVERY_ID)) {
        MONTHLY_METERING_SENSORS.forEach((sensor) => {
            const sensorConfig = applyIcon({
                name: sensor.name,
                unique_id: sensor.uniqueId,
                state_topic: topics.path('smart_metering', sensor.id, 'state'),
                availability_topic: topics.availability('smart_metering', sensor.id),
                payload_available: 'available',
                payload_not_available: 'unavailable',
                unit_of_measurement: sensor.unit,
                device_class: sensor.deviceClass,
                state_class: 'total_increasing',
                device: cloneDeviceInfo(),
            }, sensor);
            if (sensor.displayPrecision !== undefined) {
                sensorConfig.suggested_display_precision = sensor.displayPrecision;
            }

            publishDiscovery(
                mqttClient,
                topics.discovery('sensor', sensor.uniqueId),
                sensorConfig,
                async () => {
                    if (!discoveredMeters.has(MONTHLY_METERING_DISCOVERY_ID) || !discoveredMeters.has(MONTHLY_METERING_ICON_DISCOVERY_ID)) {
                        discoveredMeters.add(MONTHLY_METERING_DISCOVERY_ID);
                        discoveredMeters.add(MONTHLY_METERING_ICON_DISCOVERY_ID);
                        await saveState();
                    }

                    publishAvailability(mqttClient, topics.availability('smart_metering', sensor.id), 'available');
                },
                `Failed to publish ${sensor.id} discovery:`
            );
        });
    }

    Object.entries(values).forEach(([sensorId, value]) => {
        publishRetained(mqttClient, topics.path('smart_metering', sensorId, 'state'), value);
    });

    Object.entries(monthlyResult.values).forEach(([sensorId, value]) => {
        publishRetained(mqttClient, topics.path('smart_metering', sensorId, 'state'), value);
    });

    if (monthlyResult.changed) {
        void saveState();
    }

    return true;
}

module.exports = {
    AIR_QUALITY_SENSORS,
    METERING_SENSORS,
    MONTHLY_METERING_SENSORS,
    WALLPAD_DEVICE,
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverElevator,
    analyzeAndDiscoverLifeInfo,
    analyzeAndDiscoverLifeInfoCurrentWeather,
    analyzeAndDiscoverLifeInfoForecast,
    analyzeAndDiscoverLifeInfoOutdoorPm10,
    analyzeAndDiscoverLifeInfoTemperature,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMasterLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverOutlet,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverVentilation,
    analyzeAndDiscoverWallpadTime,
    analyzeParkingAreaAndCarNumber,
    calculateChecksum,
    clearElevatorDiscovery,
    clearElevatorFloorDiscovery,
    clearInvalidLightDiscoveries,
    applyConfiguredMonthlyUsage,
    calculateMonthlyMeteringValues,
    getMonthlyMeteringPeriod,
    isMeteringPacket,
    parseMasterLightPacket,
    parseLifeInfoCurrentWeatherPacket,
    parseLifeInfoForecastPacket,
    parseOutletPacket,
    parseLifeInfoPacket,
    parseLifeInfoOutdoorPm10Packet,
    parseLifeInfoTemperaturePacket,
    parseTemperaturePacket,
    parseVentilationPacket,
    parseWallpadTimePacket,
    publishElevatorDiscovery,
};

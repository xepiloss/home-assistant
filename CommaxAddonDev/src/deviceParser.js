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
        deviceClass: 'water',
        icon: 'mdi:water-pump',
    },
    {
        id: 'electric_meter',
        name: '실시간 전기 사용량',
        uniqueId: 'commax_electric_meter',
        unit: 'W',
        deviceClass: 'power',
        icon: 'mdi:flash',
    },
    {
        id: 'warm_meter',
        name: '실시간 온수 사용량',
        uniqueId: 'commax_warm_meter',
        unit: 'm³/h',
        deviceClass: 'water',
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_meter',
        name: '실시간 난방 사용량',
        uniqueId: 'commax_heat_meter',
        unit: 'kW',
        deviceClass: 'power',
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_meter',
        name: '실시간 가스 사용량',
        uniqueId: 'commax_gas_meter',
        unit: 'm³/h',
        deviceClass: 'water',
        icon: 'mdi:fire',
    },
    {
        id: 'water_acc_meter',
        name: '누적 수도 사용량',
        uniqueId: 'commax_water_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:water',
    },
    {
        id: 'electric_acc_meter',
        name: '누적 전기 사용량',
        uniqueId: 'commax_electric_acc_meter',
        unit: 'kWh',
        deviceClass: 'energy',
        icon: 'mdi:transmission-tower',
    },
    {
        id: 'warm_acc_meter',
        name: '누적 온수 사용량',
        uniqueId: 'commax_warm_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_acc_meter',
        name: '누적 난방 사용량',
        uniqueId: 'commax_heat_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_acc_meter',
        name: '누적 가스 사용량',
        uniqueId: 'commax_gas_acc_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:fire',
    },
];

const METERING_DISCOVERY_ID = 'commax_metering';
const METERING_ICON_DISCOVERY_ID = 'commax_metering_icons_v2';
const MONTHLY_METERING_DISCOVERY_ID = 'commax_metering_monthly';
const MONTHLY_METERING_ICON_DISCOVERY_ID = 'commax_metering_monthly_icons_v2';
const PARKING_ICON_DISCOVERY_VERSION = 2;
const WALLPAD_TIME_DISCOVERY_ID = 'commax_wallpad_time';
const LIFE_INFO_RAW_DISCOVERY_ID = 'commax_life_info_raw';

const MONTHLY_METERING_SENSORS = [
    {
        id: 'water_monthly_meter',
        sourceId: 'water_acc_meter',
        name: '이번달 수도 사용량',
        uniqueId: 'commax_water_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:water',
    },
    {
        id: 'electric_monthly_meter',
        sourceId: 'electric_acc_meter',
        name: '이번달 전기 사용량',
        uniqueId: 'commax_electric_monthly_meter',
        unit: 'kWh',
        deviceClass: 'energy',
        icon: 'mdi:flash',
    },
    {
        id: 'warm_monthly_meter',
        sourceId: 'warm_acc_meter',
        name: '이번달 온수 사용량',
        uniqueId: 'commax_warm_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:water-thermometer',
    },
    {
        id: 'heat_monthly_meter',
        sourceId: 'heat_acc_meter',
        name: '이번달 난방 사용량',
        uniqueId: 'commax_heat_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:radiator',
    },
    {
        id: 'gas_monthly_meter',
        sourceId: 'gas_acc_meter',
        name: '이번달 가스 사용량',
        uniqueId: 'commax_gas_monthly_meter',
        unit: 'm³',
        deviceClass: 'water',
        icon: 'mdi:fire',
    },
];

function calculateChecksum(bytes) {
    return bytes.reduce((sum, byte) => sum + byte, 0) & 0xFF;
}

function byteToHex(byte) {
    return byte.toString(16).padStart(2, '0');
}

function formatBytes(bytes) {
    return bytes.map((byte) => byteToHex(byte).toUpperCase()).join(' ');
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

function analyzeAndDiscoverLight(bytes, discoveredLights, mqttClient, options = {}) {
    if (bytes.length !== 8 || ![0xB0, 0xB1].includes(bytes[0])) {
        return;
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
}

function toLetter(byte) {
    return byte >= 0xA0 && byte <= 0xDA
        ? String.fromCharCode(65 + (byte - 0xC1))
        : '';
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
        }
    }

    if (bytes[0] === 0x80 && bytes[1] !== 0x80 && bytes.length >= 10) {
        carNumber = bytes.slice(6, 10).map(toLetter).join('');
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

function analyzeAndDiscoverElevator(bytes, discoveredElevators, mqttClient, options = {}) {
    const { saveState, topics } = buildContext(options);
    const elevatorId = '01';
    const uniqueId = `commax_elevator_${elevatorId}`;

    if (!discoveredElevators.has(uniqueId)) {
        publishRetained(mqttClient, topics.path('elevator', elevatorId, 'status'), 'OFF');

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

    void bytes;
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
    wallpadTime.display = `${wallpadTime.period}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
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

    if (!lifeInfoState.wallpadTimeDiscovered) {
        const sensorConfig = {
            name: '월패드 시간',
            unique_id: WALLPAD_TIME_DISCOVERY_ID,
            state_topic: topics.path('life_info', 'wallpad_time', 'state'),
            availability_topic: topics.availability('life_info', 'wallpad_time'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            icon: 'mdi:clock-time-four-outline',
            device: cloneDeviceInfo(),
        };

        publishDiscovery(
            mqttClient,
            topics.discovery('sensor', WALLPAD_TIME_DISCOVERY_ID),
            sensorConfig,
            async () => {
                lifeInfoState.wallpadTimeDiscovered = true;
                await saveState();
                publishAvailability(mqttClient, topics.availability('life_info', 'wallpad_time'), 'available');
            },
            'Failed to publish wallpad time discovery:'
        );
    }

    publishRetained(mqttClient, topics.path('life_info', 'wallpad_time', 'state'), parsed.display);

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

function roundMeteringValue(value) {
    return Math.round(value * 1000) / 1000;
}

function getConfiguredMonthlyUsageEntries(usageConfig, values) {
    return Object.entries(usageConfig?.values || {})
        .filter(([, usage]) => usage !== undefined)
        .filter(([sourceId]) => values[sourceId] !== undefined);
}

function applyConfiguredMonthlyUsage(monthlyMeteringState, usageConfig, period, values) {
    if (!usageConfig || usageConfig.period !== period) {
        return false;
    }

    const configuredEntries = getConfiguredMonthlyUsageEntries(usageConfig, values);
    if (configuredEntries.length === 0) {
        return false;
    }

    let changed = false;
    const appliedUsageConfig = monthlyMeteringState.appliedUsageConfig || {
        period: null,
        values: {},
    };

    if (appliedUsageConfig.period !== period) {
        appliedUsageConfig.period = period;
        appliedUsageConfig.values = {};
        changed = true;
    }

    configuredEntries.forEach(([sourceId, usage]) => {
        if (appliedUsageConfig.values[sourceId] === usage && monthlyMeteringState.baselines[sourceId] !== undefined) {
            return;
        }

        const baseline = roundMeteringValue(values[sourceId] - usage);

        if (monthlyMeteringState.baselines[sourceId] !== baseline) {
            monthlyMeteringState.baselines[sourceId] = baseline;
            changed = true;
        }

        appliedUsageConfig.values[sourceId] = usage;
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
    let changed = false;

    if (monthlyMeteringState.period !== period) {
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
        water_acc_meter: decodeBcdNumber([bytes[8], bytes[9]]) / 10,
        gas_meter: decodeBcdNumber([bytes[10], bytes[11]]),
        gas_acc_meter: decodeBcdNumber([bytes[13], bytes[14]]) / 10,
        electric_meter: decodeBcdNumber([bytes[15], bytes[16]]),
        electric_acc_meter: decodeBcdNumber([bytes[17], bytes[18], bytes[19]]) / 10,
        warm_meter: decodeBcdNumber([bytes[20], bytes[21]]),
        warm_acc_meter: decodeBcdNumber([bytes[23], bytes[24]]) / 10,
        heat_meter: decodeBcdNumber([bytes[25], bytes[26]]) / 10,
        heat_acc_meter: decodeBcdNumber([bytes[28], bytes[29]]) / 100,
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
                device: cloneDeviceInfo(),
            }, sensor);

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
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMasterLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverOutlet,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverVentilation,
    analyzeAndDiscoverWallpadTime,
    analyzeParkingAreaAndCarNumber,
    calculateChecksum,
    applyConfiguredMonthlyUsage,
    calculateMonthlyMeteringValues,
    getMonthlyMeteringPeriod,
    isMeteringPacket,
    parseMasterLightPacket,
    parseOutletPacket,
    parseLifeInfoPacket,
    parseTemperaturePacket,
    parseVentilationPacket,
    parseWallpadTimePacket,
};

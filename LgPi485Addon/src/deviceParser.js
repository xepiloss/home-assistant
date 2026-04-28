const {
    FAN_MODES,
    HVAC_MODES,
    SWING_MODES,
    parseStatusPacket,
} = require('./lgProtocol');

const AIRCON_DEVICE = Object.freeze({
    identifiers: ['LG_PI485'],
    name: 'LG PI485 에어컨',
    manufacturer: 'LG',
});

function cloneDeviceInfo() {
    return {
        ...AIRCON_DEVICE,
        identifiers: [...AIRCON_DEVICE.identifiers],
    };
}

function publishAsync(mqttClient, topic, message, options = {}) {
    return new Promise((resolve, reject) => {
        mqttClient.publish(topic, String(message), options, (err) => {
            if (err) {
                reject(err);
                return;
            }

            resolve();
        });
    });
}

function createClimateDiscoveryPayload({ deviceId, topics, supportedHvacModes = HVAC_MODES }) {
    const baseTopic = topics.path('climate', deviceId);

    return {
        name: `LG 에어컨 ${deviceId}`,
        unique_id: `lg_aircon_${deviceId}`,
        modes: supportedHvacModes,
        mode_state_topic: `${baseTopic}/mode`,
        mode_command_topic: `${baseTopic}/set_mode`,
        current_temperature_topic: `${baseTopic}/current_temp`,
        temperature_state_topic: `${baseTopic}/target_temp`,
        temperature_command_topic: `${baseTopic}/set_temp`,
        min_temp: 18,
        max_temp: 30,
        temp_step: 1,
        fan_modes: FAN_MODES,
        fan_mode_state_topic: `${baseTopic}/fan_mode`,
        fan_mode_command_topic: `${baseTopic}/set_fan_mode`,
        swing_modes: SWING_MODES,
        swing_mode_state_topic: `${baseTopic}/swing_mode`,
        swing_mode_command_topic: `${baseTopic}/set_swing_mode`,
        availability_topic: topics.availability('climate', deviceId),
        payload_available: 'available',
        payload_not_available: 'unavailable',
        device: cloneDeviceInfo(),
    };
}

function createTemperatureSensorDiscovery({ deviceId, sensorId, name, stateTopic }) {
    return {
        name: `LG 에어컨 ${deviceId} ${name}`,
        unique_id: `lg_aircon_${deviceId}_${sensorId}`,
        state_topic: stateTopic,
        unit_of_measurement: '°C',
        device_class: 'temperature',
        state_class: 'measurement',
        enabled_by_default: true,
        availability_topic: stateTopic.replace(/\/[^/]+$/, '/availability'),
        payload_available: 'available',
        payload_not_available: 'unavailable',
        device: cloneDeviceInfo(),
    };
}

function createBinarySensorDiscovery({ deviceId, sensorId, name, stateTopic, deviceClass }) {
    const payload = {
        name: `LG 에어컨 ${deviceId} ${name}`,
        unique_id: `lg_aircon_${deviceId}_${sensorId}`,
        state_topic: stateTopic,
        payload_on: 'ON',
        payload_off: 'OFF',
        availability_topic: stateTopic.replace(/\/[^/]+$/, '/availability'),
        payload_available: 'available',
        payload_not_available: 'unavailable',
        device: cloneDeviceInfo(),
    };

    if (deviceClass) {
        payload.device_class = deviceClass;
    }

    return payload;
}

function createSwitchDiscovery({ deviceId, switchId, name, stateTopic, commandTopic, deviceClass }) {
    const payload = {
        name: `LG 에어컨 ${deviceId} ${name}`,
        unique_id: `lg_aircon_${deviceId}_${switchId}`,
        state_topic: stateTopic,
        command_topic: commandTopic,
        payload_on: 'ON',
        payload_off: 'OFF',
        availability_topic: stateTopic.replace(/\/[^/]+$/, '/availability'),
        payload_available: 'available',
        payload_not_available: 'unavailable',
        device: cloneDeviceInfo(),
    };

    if (deviceClass) {
        payload.device_class = deviceClass;
    }

    return payload;
}

function createTextSensorDiscovery({ deviceId, sensorId, name, stateTopic }) {
    return {
        name: `LG 에어컨 ${deviceId} ${name}`,
        unique_id: `lg_aircon_${deviceId}_${sensorId}`,
        state_topic: stateTopic,
        entity_category: 'diagnostic',
        enabled_by_default: true,
        availability_topic: stateTopic.replace(/\/[^/]+$/, '/availability'),
        payload_available: 'available',
        payload_not_available: 'unavailable',
        device: cloneDeviceInfo(),
    };
}

async function ensureClimateDiscovered(deviceId, state, mqttClient, { saveState, topics, supportedHvacModes }) {
    const uniqueId = `lg_aircon_${deviceId}`;
    if (!state.discoveryPublishedThisRun) {
        state.discoveryPublishedThisRun = new Set();
    }

    if (state.discoveryPublishedThisRun.has(uniqueId)) {
        return;
    }

    await publishAsync(
        mqttClient,
        topics.discovery('climate', uniqueId),
        JSON.stringify(createClimateDiscoveryPayload({ deviceId, topics, supportedHvacModes })),
        { retain: true }
    );

    const baseTopic = topics.path('climate', deviceId);
    const diagnosticSensors = [
        ['pipe1_temp', '배관1 온도', `${baseTopic}/pipe1_temp`],
        ['pipe2_temp', '배관2 온도', `${baseTopic}/pipe2_temp`],
    ];

    await Promise.all(diagnosticSensors.map(([sensorId, name, stateTopic]) => publishAsync(
        mqttClient,
        topics.discovery('sensor', `lg_aircon_${deviceId}_${sensorId}`),
        JSON.stringify(createTemperatureSensorDiscovery({ deviceId, sensorId, name, stateTopic })),
        { retain: true }
    )));

    const binarySensors = [
        ['power', '가동', `${baseTopic}/power`, 'power'],
        ['lock', '잠금', `${baseTopic}/lock`, null],
        ['plasma', '공기청정', `${baseTopic}/plasma`, null],
        ['zone_running', '존 가동', `${baseTopic}/zone_running`, null],
    ];

    await Promise.all(binarySensors.map(([sensorId, name, stateTopic, deviceClass]) => publishAsync(
        mqttClient,
        topics.discovery('binary_sensor', `lg_aircon_${deviceId}_${sensorId}`),
        JSON.stringify(createBinarySensorDiscovery({ deviceId, sensorId, name, stateTopic, deviceClass })),
        { retain: true }
    )));

    const switches = [
        ['power_switch', '전원 스위치', `${baseTopic}/power`, `${baseTopic}/set_power`, 'switch'],
        ['lock_switch', '잠금 스위치', `${baseTopic}/lock`, `${baseTopic}/set_lock`, null],
    ];

    await Promise.all(switches.map(([switchId, name, stateTopic, commandTopic, deviceClass]) => publishAsync(
        mqttClient,
        topics.discovery('switch', `lg_aircon_${deviceId}_${switchId}`),
        JSON.stringify(createSwitchDiscovery({ deviceId, switchId, name, stateTopic, commandTopic, deviceClass })),
        { retain: true }
    )));

    await publishAsync(
        mqttClient,
        topics.discovery('text_sensor', `lg_aircon_${deviceId}_raw_frame`),
        JSON.stringify(createTextSensorDiscovery({
            deviceId,
            sensorId: 'raw_frame',
            name: 'raw frame',
            stateTopic: `${baseTopic}/raw_frame`,
        })),
        { retain: true }
    );

    const loadSensors = [
        ['error_code', '에러 코드', `${baseTopic}/error_code`],
        ['zone_active_load', '존 현재 부하', `${baseTopic}/zone_active_load`],
        ['zone_power_state', '존 전원 상태값', `${baseTopic}/zone_power_state`],
        ['zone_design_load', '존 설계 부하', `${baseTopic}/zone_design_load`],
        ['odu_total_load', '실외기 총 부하', `${baseTopic}/odu_total_load`],
    ];

    await Promise.all(loadSensors.map(([sensorId, name, stateTopic]) => publishAsync(
        mqttClient,
        topics.discovery('sensor', `lg_aircon_${deviceId}_${sensorId}`),
        JSON.stringify({
            name: `LG 에어컨 ${deviceId} ${name}`,
            unique_id: `lg_aircon_${deviceId}_${sensorId}`,
            state_topic: stateTopic,
            entity_category: 'diagnostic',
            enabled_by_default: true,
            availability_topic: stateTopic.replace(/\/[^/]+$/, '/availability'),
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: cloneDeviceInfo(),
        }),
        { retain: true }
    )));

    const isNewDiscovery = !state.discoveredClimateUnits.has(uniqueId);
    state.discoveredClimateUnits.add(uniqueId);
    state.discoveryPublishedThisRun.add(uniqueId);
    if (isNewDiscovery) {
        await saveState();
    }
    await publishAsync(mqttClient, topics.availability('climate', deviceId), 'available', { retain: true, qos: 1 });
}

async function analyzeAndDiscoverClimate(bytes, state, mqttClient, { saveState, topics, supportedHvacModes, statusMonitor }) {
    const parsed = parseStatusPacket(bytes, { supportedHvacModes });
    if (!parsed) {
        return false;
    }

    statusMonitor?.observe(parsed);

    await ensureClimateDiscovered(parsed.deviceId, state, mqttClient, { saveState, topics, supportedHvacModes });

    state.climateStates[parsed.deviceId] = {
        ...state.climateStates[parsed.deviceId],
        ...parsed,
        updatedAt: new Date().toISOString(),
    };

    const baseTopic = topics.path('climate', parsed.deviceId);
    const publishes = [
        publishAsync(mqttClient, `${baseTopic}/mode`, parsed.hvacMode, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/fan_mode`, parsed.fanMode, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/swing_mode`, parsed.swingMode, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/power`, parsed.isOn ? 'ON' : 'OFF', { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/lock`, parsed.locked ? 'ON' : 'OFF', { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/plasma`, parsed.plasma ? 'ON' : 'OFF', { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/zone_running`, parsed.zoneRunning ? 'ON' : 'OFF', { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/raw_frame`, parsed.rawHex, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/error_code`, parsed.errorCode, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/zone_active_load`, parsed.zoneActiveLoad, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/zone_power_state`, parsed.zonePowerState, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/zone_design_load`, parsed.zoneDesignLoad, { retain: true }),
        publishAsync(mqttClient, `${baseTopic}/odu_total_load`, parsed.oduTotalLoad, { retain: true }),
    ];

    if (parsed.currentTemperature !== null) {
        publishes.push(publishAsync(mqttClient, `${baseTopic}/current_temp`, parsed.currentTemperature, { retain: true }));
    }

    if (parsed.targetTemperature !== null) {
        publishes.push(publishAsync(mqttClient, `${baseTopic}/target_temp`, parsed.targetTemperature, { retain: true }));
    }

    if (parsed.pipeTemperature1 !== null) {
        publishes.push(publishAsync(mqttClient, `${baseTopic}/pipe1_temp`, parsed.pipeTemperature1, { retain: true }));
    }

    if (parsed.pipeTemperature2 !== null) {
        publishes.push(publishAsync(mqttClient, `${baseTopic}/pipe2_temp`, parsed.pipeTemperature2, { retain: true }));
    }

    await Promise.all(publishes);
    return true;
}

module.exports = {
    AIRCON_DEVICE,
    analyzeAndDiscoverClimate,
    createClimateDiscoveryPayload,
};

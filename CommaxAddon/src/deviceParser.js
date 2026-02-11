const { log, logError } = require('./utils');

const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

function calculateChecksum(bytes) {
    const sum = bytes.reduce((acc, byte) => acc + byte, 0);
    return sum & 0xFF;
}

function parseOutletPacket(bytes) {
    const header = bytes[0];
    const state = bytes[1];
    const deviceId = bytes[2];
    const mode = bytes[3];
    const reserved = bytes[4];
    const powerHigh = bytes[5];
    const powerLow = bytes[6];
    const checksum = bytes[7];

    if (bytes.length !== 8 || ![0xF9, 0xFA].includes(bytes[0])) return null;

    let stateStr;
    switch (state) {
        case 0x11:
            stateStr = 'AUTO_ON';
            break;
        case 0x01:
            stateStr = 'MANUAL_ON';
            break;
        case 0x00:
            stateStr = 'MANUAL_OFF';
            break;
        case 0x10:
            stateStr = 'AUTO_OFF';
            break;
        default:
            return null;
    }

    const isCurrentMode = (mode === 0x10);
    const powerStr = powerHigh.toString(16).padStart(2, '0') + powerLow.toString(16).padStart(2, '0');
    const power = parseInt(powerStr, 10);
    const calculatedChecksum = calculateChecksum(bytes.slice(0, 7));
    const isValid = (calculatedChecksum === checksum);

    return {
        deviceId: deviceId.toString(16).padStart(2, '0'),
        state: stateStr,
        mode: isCurrentMode ? 'current' : 'standby',
        power: power,
        valid: isValid
    };
}

function analyzeAndDiscoverOutlet(bytes, discoveredOutlets, mqttClient, saveState) {
    const parsed = parseOutletPacket(bytes);
    if (!parsed || !parsed.valid) {
        // log('체크섬 오류 :', bytes.map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase());
        return;
    }

    const {deviceId, state, mode, power} = parsed;
    const uniqueId = `commax_outlet_${deviceId}`;
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

    if (!discoveredOutlets.has(uniqueId)) {
        const discoveryTopic = `homeassistant/switch/${uniqueId}/config`;
        const switchConfig = {
            name: `대기전력 ${deviceId}`,
            unique_id: uniqueId,
            state_topic: `${topicPrefix}/outlet/${deviceId}/state`,
            command_topic: `${topicPrefix}/outlet/${deviceId}/set`,
            availability_topic: `${topicPrefix}/outlet/${deviceId}/availability`,
            payload_on: 'ON',
            payload_off: 'OFF',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        const currentPowerConfig = {
            name: `대기전력 ${deviceId} 실시간`,
            unique_id: `${uniqueId}_current_power`,
            state_topic: `${topicPrefix}/outlet/${deviceId}/current_power`,
            availability_topic: `${topicPrefix}/outlet/${deviceId}/current_power/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: 'W',
            device_class: 'power',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        const standbyPowerConfig = {
            name: `대기전력 ${deviceId} 차단값`,
            unique_id: `${uniqueId}_standby_power`,
            state_topic: `${topicPrefix}/outlet/${deviceId}/standby_power`,
            command_topic: `${topicPrefix}/outlet/${deviceId}/standby_power/set`,
            availability_topic: `${topicPrefix}/outlet/${deviceId}/standby_power/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            unit_of_measurement: 'W',
            device_class: 'power',
            min: 0,
            max: 50,
            mode: 'box',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        const standbyModeConfig = {
            name: `대기전력 ${deviceId} 모드`,
            unique_id: `${uniqueId}_standby_mode`,
            state_topic: `${topicPrefix}/outlet/${deviceId}/standby_mode`,
            command_topic: `${topicPrefix}/outlet/${deviceId}/standby_mode/set`,
            availability_topic: `${topicPrefix}/outlet/${deviceId}/standby_mode/availability`,
            payload_on: 'AUTO',
            payload_off: 'MANUAL',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        mqttClient.publish(discoveryTopic, JSON.stringify(switchConfig), {retain: true}, async (err) => {
            if (err) {
                logError(`Failed to publish switch discovery for ${uniqueId}:`, err);
            } else {
                discoveredOutlets.add(uniqueId);
                await saveState(state);
                mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/availability`, 'available', { retain: true, qos: 1 });
                mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/standby_mode/availability`, 'available', { retain: true, qos: 1 });
                mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/standby_power/availability`, 'available', { retain: true, qos: 1 });
                mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/current_power/availability`, 'available', { retain: true, qos: 1 });
            }
        });
        mqttClient.publish(`homeassistant/sensor/${uniqueId}_current_power/config`, JSON.stringify(currentPowerConfig), {retain: true});
        mqttClient.publish(`homeassistant/number/${uniqueId}_standby_power/config`, JSON.stringify(standbyPowerConfig), {retain: true});
        mqttClient.publish(`homeassistant/switch/${uniqueId}_standby_mode/config`, JSON.stringify(standbyModeConfig), {retain: true});
    }

    const simplifiedState = (state === 'AUTO_ON' || state === 'MANUAL_ON') ? 'ON' : 'OFF';
    const standbyMode = (state === 'AUTO_ON' || state === 'AUTO_OFF') ? 'AUTO' : 'MANUAL';

    mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/state`, simplifiedState, {retain: true});
    mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/standby_mode`, standbyMode, {retain: true});

    if (mode === 'current') {
        mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/current_power`, power.toString(), {retain: true});
    } else if (mode === 'standby') {
        mqttClient.publish(`${topicPrefix}/outlet/${deviceId}/standby_power`, power.toString(), {retain: true});
    }
}

function analyzeAndDiscoverLight(bytes, discoveredLights, mqttClient, saveState) {
    if (bytes.length !== 8 || ![0xB0, 0xB1].includes(bytes[0])) return null;

    const deviceId = bytes[2].toString(16).padStart(2, '0');
    const power = bytes[1];
    const brightness = bytes[5];
    const canSetBrightness = bytes[6] === 0x05;
    const uniqueId = `commax_light_${deviceId}`;

    const lightData = {
        power: power === 0x01 ? 'ON' : 'OFF',
        brightness: brightness,
        canSetBrightness: canSetBrightness
    };

    if (!discoveredLights.has(uniqueId)) {
        const discoveryTopic = `homeassistant/light/light_${deviceId}/config`;
        const discoveryPayload = {
            name: `조명 ${deviceId}`,
            unique_id: uniqueId,
            state_topic: `${topicPrefix}/light/${deviceId}/state`,
            command_topic: `${topicPrefix}/light/${deviceId}/set`,
            availability_topic: `${topicPrefix}/light/${deviceId}/availability`,
            payload_on: 'ON',
            payload_off: 'OFF',
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        if (canSetBrightness) {
            discoveryPayload.brightness_state_topic = `${topicPrefix}/light/${deviceId}/brightness`;
            discoveryPayload.brightness_command_topic = `${topicPrefix}/light/${deviceId}/brightness/set`;
            discoveryPayload.brightness_scale = 5;
        }

        mqttClient.publish(discoveryTopic, JSON.stringify(discoveryPayload), {retain: true}, async (err) => {
            if (err) {
                logError(`Failed to publish light discovery for ${deviceId}:`, err);
            } else {
                discoveredLights.add(uniqueId);
                await saveState(discoveredLights);
                mqttClient.publish(`${topicPrefix}/light/${deviceId}/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    mqttClient.publish(`${topicPrefix}/light/${deviceId}/state`, lightData.power, {retain: true});
    if (canSetBrightness) {
        mqttClient.publish(`${topicPrefix}/light/${deviceId}/brightness`, lightData.brightness.toString(), {retain: true});
    }
}

function analyzeParkingAreaAndCarNumber(bytes, parkingState, mqttClient, saveState) {
    let parkingArea, carNumber;

    const toLetter = (byte) => byte >= 0xA0 && byte <= 0xDA
        ? String.fromCharCode(65 + (byte - 0xC1))
        : '';

    if (bytes[0] === 0x2A && bytes.length >= 10) {
        // 입차 정보 없음
        if (bytes[4] === 0x80 && bytes[5] === 0x80) {
            parkingArea = '-';
            carNumber = '-';
        } else {
            // 인덱스 4~10: parkingArea (7바이트 -> 문자열)
            const segment1 = bytes.slice(4, 11);
            parkingArea = segment1.map(toLetter).join('');
        }
    }

    if (bytes[0] === 0x80 && bytes[1] !== 0x80 && bytes.length >= 10) {
        const segment2 = bytes.slice(6, 10); // 인덱스 6~9
        carNumber = segment2.map(toLetter).join('');
    }

    if (parkingArea && !parkingState.parkingDiscovered) {
        const parkingDiscoveryTopic = `homeassistant/sensor/parking_area/config`;
        const parkingConfig = {
            name: "주차 위치",
            unique_id: "commax_parking_area",
            state_topic: `${topicPrefix}/parking/area`,
            availability_topic: `${topicPrefix}/parking/area/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        mqttClient.publish(parkingDiscoveryTopic, JSON.stringify(parkingConfig), {retain: true}, async (err) => {
            if (err) {
                logError('Failed to publish parking area discovery:', err);
            } else {
                parkingState.parkingDiscovered = true;
                await saveState(parkingState);
                mqttClient.publish(`${topicPrefix}/parking/area/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    if (carNumber && !parkingState.carNumberDiscovered) {
        const carNumberDiscoveryTopic = `homeassistant/sensor/car_number/config`;
        const carNumberConfig = {
            name: "주차 차량",
            unique_id: "commax_car_number",
            state_topic: `${topicPrefix}/parking/car_number`,
            availability_topic: `${topicPrefix}/parking/car_number/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax",
            }
        };

        mqttClient.publish(carNumberDiscoveryTopic, JSON.stringify(carNumberConfig), {retain: true}, async (err) => {
            if (err) {
                logError('Failed to publish car number discovery:', err);
            } else {
                parkingState.carNumberDiscovered = true;
                await saveState(parkingState);
                mqttClient.publish(`${topicPrefix}/parking/car_number/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    if (parkingArea) {
        log(`주차위치 수신 : ${parkingArea}`);
        mqttClient.publish(`${topicPrefix}/parking/area`, parkingArea, {retain: true});
    }
    if (carNumber) {
        log(`차량번호 수신 : ${carNumber}`);
        mqttClient.publish(`${topicPrefix}/parking/car_number`, carNumber, {retain: true});
    }
}

function parseTemperaturePacket(bytes) {
    if (bytes.length !== 8 || ![0x82, 0x84].includes(bytes[0])) return null;
    const deviceId = bytes[2];
    const state = bytes[1] === 0x80 ? 'off' : bytes[1] === 0x81 ? 'idle' : bytes[1] === 0x83 ? 'heating' : 'unknown';
    const currentTemp = bytes[3] === 0xFF ? null : bytes[3].toString(16).padStart(2, '0');
    const targetTemp = bytes[4] === 0xFF ? null : bytes[4].toString(16).padStart(2, '0');
    const checksum = bytes[7];

    if (calculateChecksum(bytes.slice(0, 7)) !== checksum) {
        // log('체크섬 오류 :', bytes.map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase());
        return null;
    }
    return {deviceId: deviceId.toString(16).padStart(2, '0'), state, currentTemp, targetTemp};
}

function analyzeAndDiscoverTemperature(bytes, discoveredTemps, mqttClient, saveState) {
    const parsed = parseTemperaturePacket(bytes);
    if (!parsed) return;
    const {deviceId, state, currentTemp, targetTemp} = parsed;
    const uniqueId = `commax_temp_${deviceId}`;
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';
    if (!discoveredTemps.has(uniqueId)) {
        const climateConfig = {
            name: `난방 ${deviceId}`,
            unique_id: uniqueId,
            mode_cmd_t: `${topicPrefix}/temp/${deviceId}/set_mode`,
            mode_stat_t: `${topicPrefix}/temp/${deviceId}/mode`,
            curr_temp_t: `${topicPrefix}/temp/${deviceId}/current_temp`,
            min_temp: "5",
            max_temp: "30",
            temp_cmd_t: `${topicPrefix}/temp/${deviceId}/set_temp`,
            temp_stat_t: `${topicPrefix}/temp/${deviceId}/target_temp`,
            availability_topic: `${topicPrefix}/temp/${deviceId}/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            modes: ["off", "heat"],
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax"
            }
        };
        mqttClient.publish(`homeassistant/climate/${uniqueId}/config`, JSON.stringify(climateConfig), {retain: true}, async (err) => {
            if (!err) {
                discoveredTemps.add(uniqueId);
                await saveState(state);
                mqttClient.publish(`${topicPrefix}/temp/${deviceId}/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }
    const mode = state === 'off' ? 'off' : 'heat';
    mqttClient.publish(`${topicPrefix}/temp/${deviceId}/mode`, mode, {retain: true});
    if (currentTemp !== null) {
        mqttClient.publish(`${topicPrefix}/temp/${deviceId}/current_temp`, currentTemp.toString(), {retain: true});
    }
    if (targetTemp !== null) {
        mqttClient.publish(`${topicPrefix}/temp/${deviceId}/target_temp`, targetTemp.toString(), {retain: true});
    }
}

function parseVentilationPacket(bytes) {
    if (bytes.length !== 8 || ![0xF6, 0xF8].includes(bytes[0])) return null;

    const mode = bytes[1]; // 0x00: 꺼짐, 0x01: 자동, 0x04: 수동, 0x07: 바이패스
    const speed = bytes[3]; // 0x00: 꺼짐, 0x01: 약풍, 0x02: 중풍, 0x03: 강풍
    const checksum = bytes[7];

    if (calculateChecksum(bytes.slice(0, 7)) !== checksum) return null;

    return {mode, speed};
}

function analyzeAndDiscoverVentilation(bytes, discoveredFans, mqttClient, saveState) {
    const parsed = parseVentilationPacket(bytes);
    if (!parsed) return;

    const {mode, speed} = parsed;
    const deviceId = "01"; // 디바이스 ID가 없으므로 고정값 사용 (필요 시 수정)
    const uniqueId = `commax_fan_${deviceId}`;
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

    if (!discoveredFans.has(uniqueId)) {
        const fanConfig = {
            name: `환기`,
            unique_id: uniqueId,
            command_topic: `${topicPrefix}/fan/${deviceId}/set`,
            state_topic: `${topicPrefix}/fan/${deviceId}/state`,
            availability_topic: `${topicPrefix}/fan/${deviceId}/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            percentage_command_topic: `${topicPrefix}/fan/${deviceId}/set_speed`,
            percentage_state_topic: `${topicPrefix}/fan/${deviceId}/speed`,
            preset_mode_command_topic: `${topicPrefix}/fan/${deviceId}/set_mode`,
            preset_mode_state_topic: `${topicPrefix}/fan/${deviceId}/mode`,
            preset_modes: ["auto", "manual", "bypass"],
            speed_range_min: 1,
            speed_range_max: 3,
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax"
            }
        };

        mqttClient.publish(`homeassistant/fan/${uniqueId}/config`, JSON.stringify(fanConfig), {retain: true}, async (err) => {
            if (!err) {
                discoveredFans.add(uniqueId);
                await saveState(discoveredFans);
                mqttClient.publish(`${topicPrefix}/fan/${deviceId}/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    const state = mode === 0x00 ? 'OFF' : 'ON';
    const modeStr = mode === 0x01 ? 'auto' : mode === 0x07 ? 'bypass' : 'manual';
    const speedVal = speed === 0x01 ? "1" : speed === 0x02 ? "2" : speed === 0x03 ? "3" : "1"; // 1: 약풍, 2: 중풍, 3: 강풍

    mqttClient.publish(`${topicPrefix}/fan/${deviceId}/state`, state, {retain: true});
    mqttClient.publish(`${topicPrefix}/fan/${deviceId}/mode`, modeStr, {retain: true});
    mqttClient.publish(`${topicPrefix}/fan/${deviceId}/speed`, speedVal, {retain: true});
}

// 엘레베이터는 내부망 SOAP 통신으로 대체함
// function parseElevatorPacket(bytes) {
//     if (bytes.length !== 8 || ![0x26, 0xA2].includes(bytes[0])) return null;
//
//     const header = bytes[0];
//     const deviceId = bytes[1]; // 0x01
//     const state = bytes[3]; // 0x00: 완료, 0x42: 호출 중
//     const checksum = bytes[7];
//
//     if (calculateChecksum(bytes.slice(0, 7)) !== checksum) return null;
//
//     return {header, deviceId, state};
// }

function analyzeAndDiscoverElevator(bytes, discoveredElevators, mqttClient, saveState) {
    // const parsed = parseElevatorPacket(bytes);
    // if (!parsed) return;
    // const { header, deviceId, state: elevatorState } = parsed;

    const elevatorId = "01"; // 디바이스 ID가 없으므로 고정값 사용
    const uniqueId = `commax_elevator_${elevatorId}`;
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

    if (!discoveredElevators.has(uniqueId)) {
        mqttClient.publish(`${topicPrefix}/elevator/${elevatorId}/status`, "OFF", { retain: true });

        const switchConfig = {
            name: `엘레베이터`,
            unique_id: `${uniqueId}_switch`,
            command_topic: `${topicPrefix}/elevator/${elevatorId}/set`,
            state_topic: `${topicPrefix}/elevator/${elevatorId}/status`,
            availability_topic: `${topicPrefix}/elevator/${elevatorId}/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax"
            }
        };

        mqttClient.publish(`homeassistant/switch/${uniqueId}_switch/config`, JSON.stringify(switchConfig), { retain: true }, async (err) => {
            if (!err) {
                discoveredElevators.add(uniqueId);
                await saveState(discoveredElevators);
                mqttClient.publish(`${topicPrefix}/elevator/${elevatorId}/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    // 상태 퍼블리싱 - 내부망 SOAP 통신으로 대체함
    // if (header === 0xA2) {
    //     // ACK: 엘레베이터 호출 시작
    //     log(`Elevator ${elevatorId}: Calling...`);
    //     mqttClient.publish(`${topicPrefix}/elevator/${elevatorId}/status`, "ON", { retain: true });
    // } else if (header === 0x26) {
    //     if (elevatorState === 0x42) {
    //         // 엘레베이터 호출 중 (필요 시 추가 로깅)
    //         log(`Elevator ${elevatorId}: Calling...`);
    //         mqttClient.publish(`${topicPrefix}/elevator/${elevatorId}/status`, "ON", { retain: true });
    //     } else if (elevatorState === 0x00) {
    //         // 호출 완료
    //         log(`Elevator ${elevatorId}: Call completed`);
    //         mqttClient.publish(`${topicPrefix}/elevator/${elevatorId}/status`, "OFF", { retain: true });
    //     }
    // }
}

function parseMasterLightPacket(bytes) {
    if (bytes.length !== 8 || ![0xA0, 0xA2].includes(bytes[0])) return null;

    // 엘레베이터 패킷과 헤더가 같아서 추가 처리 함
    if(bytes[4] === 0x28 && bytes[5] === 0xD7) return null;

    const header = bytes[0];
    const deviceId = bytes[2]; // 0x01
    const state = bytes[1]; // 0x00: OFF, 0x01: ON
    const checksum = bytes[7];

    if (calculateChecksum(bytes.slice(0, 7)) !== checksum) return null;

    return { header, deviceId, state };
}

function analyzeAndDiscoverMasterLight(bytes, discoveredMasterLights, mqttClient, saveState) {
    const parsed = parseMasterLightPacket(bytes);
    if (!parsed) return;

    const { header, deviceId, state } = parsed;
    const masterLightId = "01"; // 디바이스 ID 고정
    const uniqueId = `commax_master_light_${masterLightId}`;
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

    if (!discoveredMasterLights.has(uniqueId)) {
        const switchConfig = {
            name: `일괄소등`,
            unique_id: uniqueId,
            command_topic: `${topicPrefix}/master_light/set`,
            state_topic: `${topicPrefix}/master_light/state`,
            availability_topic: `${topicPrefix}/master_light/availability`,
            payload_available: 'available',
            payload_not_available: 'unavailable',
            device: {
                identifiers: ["Commax"],
                name: "월패드",
                manufacturer: "Commax"
            }
        };

        mqttClient.publish(`homeassistant/switch/${uniqueId}/config`, JSON.stringify(switchConfig), { retain: true }, async (err) => {
            if (!err) {
                discoveredMasterLights.add(uniqueId);
                await saveState(discoveredMasterLights);
                mqttClient.publish(`${topicPrefix}/master_light/availability`, 'available', { retain: true, qos: 1 });
            }
        });
    }

    // 상태 퍼블리싱 (A0 패킷)
    const stateStr = state === 0x01 ? "ON" : "OFF";
    mqttClient.publish(`${topicPrefix}/master_light/state`, stateStr, { retain: true });
}

function analyzeAndDiscoverAirQuality(bytes, discoveredSensors, mqttClient, saveState) {
    if (bytes[0] !== 0xC8) return;

    const deviceId = bytes[1];
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'devcommax';

    // CO2 값 추출 (4-5자리 결합)
    const co2Value = parseInt(`${bytes[3].toString(16).padStart(2, '0')}${bytes[4].toString(16).padStart(2, '0')}`);

    // PM2.5 또는 PM10 값 추출 (7자리, 16진수 값을 문자열로 유지)
    const particleValue = bytes[6].toString(16).padStart(2, '0'); // 예: 0x12 → "12"

    // 센서 ID 설정
    const uniqueId = 'commax_air_quality';
    const sensors = [
        {
            id: 'co2',
            name: '이산화탄소',
            unique_id: 'commax_co2',
            state_topic: `${topicPrefix}/air_quality/co2/state`,
            availability_topic: `${topicPrefix}/air_quality/co2/availability`,
            unit_of_measurement: 'ppm',
            device_class: 'carbon_dioxide',
            precision: 0,
        },
        {
            id: 'pm2_5',
            name: '초미세먼지(PM2.5)',
            unique_id: 'commax_pm2_5',
            state_topic: `${topicPrefix}/air_quality/pm2_5/state`,
            availability_topic: `${topicPrefix}/air_quality/pm2_5/availability`,
            unit_of_measurement: 'µg/m³',
            device_class: 'pm25',
            precision: 0,
        },
        {
            id: 'pm10',
            name: '미세먼지(PM10)',
            unique_id: 'commax_pm10',
            state_topic: `${topicPrefix}/air_quality/pm10/state`,
            availability_topic: `${topicPrefix}/air_quality/pm10/availability`,
            unit_of_measurement: 'µg/m³',
            device_class: 'pm10',
            precision: 0,
        },
    ];

    if (!discoveredSensors.has(uniqueId)) {
        sensors.forEach(sensor => {
            const sensorConfig = {
                name: sensor.name,
                unique_id: sensor.unique_id,
                state_topic: sensor.state_topic,
                availability_topic: sensor.availability_topic,
                payload_available: 'available',
                payload_not_available: 'unavailable',
                unit_of_measurement: sensor.unit_of_measurement,
                device_class: sensor.device_class,
                device: {
                    identifiers: ["Commax"],
                    name: "월패드",
                    manufacturer: "Commax"
                }
            };

            mqttClient.publish(
                `homeassistant/sensor/${sensor.unique_id}/config`,
                JSON.stringify(sensorConfig),
                { retain: true },
                (err) => {
                    if (!err) {
                        discoveredSensors.add(uniqueId);
                        saveState(discoveredSensors);
                        mqttClient.publish(sensor.availability_topic, 'available', { retain: true, qos: 1 });
                    }
                }
            );
        });
    }

    // 상태 업데이트
    // CO2는 모든 패킷에 포함
    mqttClient.publish(`${topicPrefix}/air_quality/co2/state`, co2Value.toString(), { retain: true });

    // DeviceID 뒷자리에 따라 PM2.5 또는 PM10 퍼블리싱
    const deviceIdLastDigit = deviceId & 0x0F; // 하위 4비트 (뒷자리)
    if (deviceIdLastDigit === 1) {
        // PM2.5
        mqttClient.publish(`${topicPrefix}/air_quality/pm2_5/state`, particleValue, { retain: true });
    } else {
        // PM10
        mqttClient.publish(`${topicPrefix}/air_quality/pm10/state`, particleValue, { retain: true });
    }
}

function analyzeAndDiscoverMetering(bytes, discoveredMeters, mqttClient, saveState) {

    if (bytes[0] !== 0xF7 || bytes[1] !== 0x30 || bytes.length !== 32) return;
    if (bytes[3] !== 0x81) return;

        const water = parseInt(bytes[5].toString(16).padStart(2, '0') + bytes[6].toString(16).padStart(2, '0'),10);
        const accWater = parseInt(bytes[8].toString(16).padStart(2, '0') + bytes[9].toString(16).padStart(2, '0'),10) / 10;

        const warm = parseInt(bytes[20].toString(16).padStart(2, '0') + bytes[21].toString(16).padStart(2, '0'),10);
        const accWarm = parseInt(bytes[23].toString(16).padStart(2, '0') + bytes[24].toString(16).padStart(2, '0'),10) / 10;

        const electric = parseInt(bytes[15].toString(16).padStart(2, '0') + bytes[16].toString(16).padStart(2, '0'),10);
        const accElectric = parseInt(bytes[17].toString(16).padStart(2, '0') + bytes[18].toString(16).padStart(2, '0')+ bytes[19].toString(16).padStart(2, '0'),10) / 10;

        const heat = parseInt(bytes[25].toString(16).padStart(2, '0') + bytes[26].toString(16).padStart(2, '0'),10) / 10;
        const accHeat = parseInt(bytes[28].toString(16).padStart(2, '0') + bytes[29].toString(16).padStart(2, '0'),10) / 100;

        const gas      	= parseInt(bytes[10].toString(16).padStart(2, '0') + bytes[11].toString(16).padStart(2, '0'),10);
        const accGas 	= parseInt(bytes[13].toString(16).padStart(2, '0') + bytes[14].toString(16).padStart(2, '0'),10) / 10;

        // log(`실시간 전력 : ${electric} / 실시간 수도 : ${water} / 실시간 온수 : ${warm} / 실시간 난방 : ${heat}`);
        // log(`누적 전력 : ${accElectric} / 누적 수도 : ${accWater} / 누적 온수 : ${accWarm} / 누적 난방 : ${accHeat}`);

        // 센서 ID 설정
        const uniqueId = 'commax_metering';
        const sensors = [
            {
                id: 'water_meter',
                name: '실시간 수도 사용량',
                unique_id: 'commax_water_meter_v1',
                state_topic: `${topicPrefix}/smart_metering/water_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/water_meter/availability`,
                unit_of_measurement: 'm³/h',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'electric_meter',
                name: '실시간 전기 사용량',
                unique_id: 'commax_electric_meter',
                state_topic: `${topicPrefix}/smart_metering/electric_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/electric_meter/availability`,
                unit_of_measurement: 'W',
                device_class: 'power',
                precision: 1,
            },
            {
                id: 'warm_meter',
                name: '실시간 온수 사용량',
                unique_id: 'commax_warm_meter_v1',
                state_topic: `${topicPrefix}/smart_metering/warm_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/warm_meter/availability`,
                unit_of_measurement: 'm³/h',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'heat_meter',
                name: '실시간 난방 사용량',
                unique_id: 'commax_heat_meter',
                state_topic: `${topicPrefix}/smart_metering/heat_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/heat_meter/availability`,
                unit_of_measurement: 'kW',
                device_class: 'power',
                precision: 1,
            },
            {
                id: 'gas_meter',
                name: '실시간 가스 사용량',
                unique_id: 'commax_gas_meter',
                state_topic: `${topicPrefix}/smart_metering/gas_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/gas_meter/availability`,
                unit_of_measurement: 'm³/h',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'water_acc_meter',
                name: '누적 수도 사용량',
                unique_id: 'commax_water_acc_meter_v1',
                state_topic: `${topicPrefix}/smart_metering/water_acc_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/water_acc_meter/availability`,
                unit_of_measurement: 'm³',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'electric_acc_meter',
                name: '누적 전기 사용량',
                unique_id: 'commax_electric_acc_meter',
                state_topic: `${topicPrefix}/smart_metering/electric_acc_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/electric_acc_meter/availability`,
                unit_of_measurement: 'kWh',
                device_class: 'energy',
                precision: 1,
            },
            {
                id: 'warm_acc_meter',
                name: '누적 온수 사용량',
                unique_id: 'commax_warm_acc_meter',
                state_topic: `${topicPrefix}/smart_metering/warm_acc_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/warm_acc_meter/availability`,
                unit_of_measurement: 'm³',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'heat_acc_meter',
                name: '누적 난방 사용량',
                unique_id: 'commax_heat_acc_meter',
                state_topic: `${topicPrefix}/smart_metering/heat_acc_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/heat_acc_meter/availability`,
                unit_of_measurement: 'm³',
                device_class: 'water',
                precision: 1,
            },
            {
                id: 'gas_acc_meter',
                name: '누적 가스 사용량',
                unique_id: 'commax_gas_acc_meter',
                state_topic: `${topicPrefix}/smart_metering/gas_acc_meter/state`,
                availability_topic: `${topicPrefix}/smart_metering/gas_acc_meter/availability`,
                unit_of_measurement: 'm³',
                device_class: 'water',
                precision: 1,
            },
        ];

        if (!discoveredMeters.has(uniqueId)) {
            sensors.forEach(sensor => {
                const sensorConfig = {
                    name: sensor.name,
                    unique_id: sensor.unique_id,
                    state_topic: sensor.state_topic,
                    availability_topic: sensor.availability_topic,
                    payload_available: 'available',
                    payload_not_available: 'unavailable',
                    unit_of_measurement: sensor.unit_of_measurement,
                    device_class: sensor.device_class,
                    device: {
                        identifiers: ["Commax"],
                        name: "월패드",
                        manufacturer: "Commax"
                    }
                };
                mqttClient.publish(
                  `homeassistant/sensor/${sensor.unique_id}/config`,
                  JSON.stringify(sensorConfig),
                  { retain: true },
                  (err) => {
                      if (!err) {
                          discoveredMeters.add(uniqueId);
                          saveState(discoveredMeters);
                          mqttClient.publish(sensor.availability_topic, 'available', { retain: true, qos: 1 });
                      }
                  }
                );
            });
        }

        mqttClient.publish(`${topicPrefix}/smart_metering/water_meter/state`, water.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/water_acc_meter/state`, accWater.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/electric_meter/state`, electric.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/electric_acc_meter/state`, accElectric.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/warm_meter/state`, warm.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/warm_acc_meter/state`, accWarm.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/heat_meter/state`, heat.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/heat_acc_meter/state`, accHeat.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/gas_meter/state`, gas.toString(), { retain: true });
        mqttClient.publish(`${topicPrefix}/smart_metering/gas_acc_meter/state`, accGas.toString(), { retain: true });
    }


module.exports = {
    analyzeAndDiscoverOutlet,
    analyzeAndDiscoverLight,
    analyzeParkingAreaAndCarNumber,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverVentilation,
    analyzeAndDiscoverElevator,
    analyzeAndDiscoverMasterLight,
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverMetering,
    calculateChecksum
};

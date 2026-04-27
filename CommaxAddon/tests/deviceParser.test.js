const test = require('node:test');
const assert = require('node:assert/strict');

const {
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverElevator,
    analyzeAndDiscoverLifeInfo,
    analyzeAndDiscoverLifeInfoCurrentWeather,
    analyzeAndDiscoverLifeInfoForecast,
    analyzeAndDiscoverLifeInfoOutdoorPm10,
    analyzeAndDiscoverLifeInfoTemperature,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverWallpadTime,
    analyzeParkingAreaAndCarNumber,
    applyConfiguredMonthlyUsage,
    calculateChecksum,
    calculateMonthlyMeteringValues,
    clearElevatorDiscovery,
    clearInvalidLightDiscoveries,
    clearInvalidTemperatureDiscoveries,
    getMonthlyMeteringPeriod,
    isMeteringPacket,
    parseLifeInfoCurrentWeatherPacket,
    parseLifeInfoForecastPacket,
    parseLifeInfoPacket,
    parseLifeInfoOutdoorPm10Packet,
    parseLifeInfoTemperaturePacket,
    parseMasterLightPacket,
    parseTemperaturePacket,
    parseWallpadTimePacket,
    publishElevatorDiscovery,
} = require('../src/deviceParser');
const { createTopicBuilder } = require('../src/topics');

function createMqttStub() {
    const calls = [];

    return {
        calls,
        publish(topic, message, options, callback) {
            calls.push({ topic, message, options });
            if (callback) {
                callback(null);
            }
        },
    };
}

function bytesFromHex(hex) {
    return hex.split(/\s+/).map((byte) => Number.parseInt(byte, 16));
}

function findDiscoveryPayload(mqttClient, topic) {
    const call = mqttClient.calls.find((item) => item.topic === topic);
    return call ? JSON.parse(call.message) : null;
}

test('parseTemperaturePacket decodes BCD temperature bytes', () => {
    const bytes = [0x82, 0x81, 0x01, 0x24, 0x26, 0x00, 0x00];
    bytes.push(calculateChecksum(bytes));

    const parsed = parseTemperaturePacket(bytes);

    assert.deepEqual(parsed, {
        deviceId: '01',
        state: 'idle',
        currentTemp: '24',
        targetTemp: '26',
    });
});

test('parseTemperaturePacket rejects heating device ids above the configured count', () => {
    const bytes = [0x82, 0x81, 0x05, 0x24, 0x26, 0x00, 0x00];
    bytes.push(calculateChecksum(bytes));

    assert.equal(parseTemperaturePacket(bytes, { maxDevices: 4 }), null);
    assert.deepEqual(parseTemperaturePacket(bytes, { maxDevices: 8 }), {
        deviceId: '05',
        state: 'idle',
        currentTemp: '24',
        targetTemp: '26',
    });
});

test('analyzeAndDiscoverTemperature ignores extra heating frames before ACK handling', () => {
    const mqttClient = createMqttStub();
    const discoveredTemps = new Set();
    const bytes = [0x82, 0x81, 0x05, 0x24, 0x26, 0x00, 0x00];
    bytes.push(calculateChecksum(bytes));

    assert.equal(analyzeAndDiscoverTemperature(bytes, discoveredTemps, mqttClient, {
        topics: createTopicBuilder('devcommax'),
        maxDevices: 4,
    }), false);
    assert.equal(mqttClient.calls.length, 0);
    assert.equal(discoveredTemps.size, 0);
});

test('parseMasterLightPacket ignores elevator packets sharing the same header', () => {
    const bytes = [0xA0, 0x01, 0x01, 0x00, 0x28, 0xD7, 0x00];
    bytes.push(calculateChecksum(bytes));

    assert.equal(parseMasterLightPacket(bytes), null);
});

test('analyzeAndDiscoverElevator publishes configured call and release states', async () => {
    const mqttClient = createMqttStub();
    const discoveredElevators = new Set();
    let saveCount = 0;
    const options = {
        saveState: async () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
        elevator: {
            deviceId: '01',
            frames: {
                callOn: { bytes: bytesFromHex('22 01 40 07 00 00 00 6A') },
                calling: { bytes: bytesFromHex('26 01 01 42 00 01 05 70') },
                released: { bytes: bytesFromHex('26 01 01 00 00 00 00 28') },
            },
        },
    };

    assert.equal(
        analyzeAndDiscoverElevator(bytesFromHex('22 01 40 07 00 00 00 6A'), discoveredElevators, mqttClient, options),
        true
    );
    assert.equal(saveCount, 1);
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/elevator/01/status' && call.message === 'ON'));

    assert.equal(
        analyzeAndDiscoverElevator(bytesFromHex('26 01 01 00 00 00 00 28'), discoveredElevators, mqttClient, options),
        true
    );
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/elevator/01/status' && call.message === 'OFF'));
});

test('publishElevatorDiscovery immediately publishes MQTT mode elevator switch and floor sensors', async () => {
    const mqttClient = createMqttStub();
    const discoveredElevators = new Set();
    let saveCount = 0;

    const handled = publishElevatorDiscovery(discoveredElevators, mqttClient, {
        saveState: async () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
        elevator: {
            mode: 'mqtt',
            deviceId: '01',
        },
        initialStatus: 'OFF',
    });

    assert.equal(handled, true);
    assert.equal(saveCount, 2);
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/elevator/01/status' && call.message === 'OFF'));
    assert(findDiscoveryPayload(mqttClient, 'homeassistant/switch/commax_elevator_01_switch/config'));
    assert.equal(
        findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_elevator_01_floor_1/config').state_topic,
        'commax/ev'
    );
    assert.equal(
        findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_elevator_01_floor_1/config').value_template,
        "{{ value_json.ev1_floor | default('-') }}"
    );
    assert.equal(
        findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_elevator_01_floor_2/config').value_template,
        "{{ value_json.ev2_floor | default('-') }}"
    );
});

test('publishElevatorDiscovery skips disabled elevator mode', () => {
    const mqttClient = createMqttStub();
    const discoveredElevators = new Set();

    const handled = publishElevatorDiscovery(discoveredElevators, mqttClient, {
        topics: createTopicBuilder('devcommax'),
        elevator: {
            mode: 'off',
            deviceId: '01',
        },
    });

    assert.equal(handled, false);
    assert.deepEqual(mqttClient.calls, []);
});

test('publishElevatorDiscovery adds floor sensors for already discovered MQTT elevator switches', () => {
    const mqttClient = createMqttStub();
    const discoveredElevators = new Set(['commax_elevator_01']);

    const handled = publishElevatorDiscovery(discoveredElevators, mqttClient, {
        topics: createTopicBuilder('devcommax'),
        elevator: {
            mode: 'mqtt',
            deviceId: '01',
        },
    });

    assert.equal(handled, true);
    assert.equal(mqttClient.calls.some((call) => call.topic === 'homeassistant/switch/commax_elevator_01_switch/config'), false);
    assert(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_elevator_01_floor_1/config'));
    assert(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_elevator_01_floor_2/config'));
});

test('clearElevatorDiscovery clears retained discovery and saved state', () => {
    const mqttClient = createMqttStub();
    const discoveredElevators = new Set(['commax_elevator_01', 'commax_elevator_01_floor_sensors_v1']);
    let saveCount = 0;

    const handled = clearElevatorDiscovery(discoveredElevators, mqttClient, {
        saveState: async () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
        elevator: {
            mode: 'off',
            deviceId: '01',
        },
    });

    assert.equal(handled, true);
    assert.equal(saveCount, 1);
    assert.equal(discoveredElevators.has('commax_elevator_01'), false);
    assert.equal(discoveredElevators.has('commax_elevator_01_floor_sensors_v1'), false);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/switch/commax_elevator_01_switch/config' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_elevator_01_floor_1/config' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_elevator_01_floor_2/config' && call.message === ''));
});

test('parseWallpadTimePacket decodes BCD wallpad date and time', () => {
    const parsed = parseWallpadTimePacket(bytesFromHex('7F 26 04 25 02 19 59 42'));

    assert.deepEqual(parsed, {
        year: 2026,
        month: 4,
        day: 25,
        hour: 2,
        minute: 19,
        second: 59,
        period: '2026-04',
        display: '2026-04-25 02:19',
        iso: '2026-04-25T02:19:59+09:00',
    });
});

test('analyzeAndDiscoverWallpadTime publishes readable text and stores it for monthly metering', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        wallpadTimeDiscovered: true,
        wallpadTimeDiscoveryVersion: 4,
        rawPacketDiscovered: false,
        lastWallpadTime: null,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverWallpadTime(
        bytesFromHex('7F 26 04 25 02 19 59 42'),
        lifeInfoState,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    assert.equal(handled, true);
    assert.equal(lifeInfoState.lastWallpadTime.period, '2026-04');
    assert.equal(saveCount, 1);
    assert.equal(lifeInfoState.wallpadTimeDiscoveryVersion, 5);
    const discoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_wallpad_time/config');

    assert.equal(discoveryPayload.device_class, undefined);
    assert.equal(discoveryPayload.entity_category, 'diagnostic');
    assert.equal(discoveryPayload.enabled_by_default, false);
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/wallpad_time/state' && call.message === '2026-04-25 02:19'));
});

test('analyzeAndDiscoverWallpadTime publishes state only when the displayed minute changes', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        wallpadTimeDiscovered: true,
        wallpadTimeDiscoveryVersion: 5,
        rawPacketDiscovered: false,
        lastWallpadTime: null,
    };
    const options = {
        topics: createTopicBuilder('devcommax'),
    };

    analyzeAndDiscoverWallpadTime(bytesFromHex('7F 26 04 25 02 19 00 E9'), lifeInfoState, mqttClient, options);
    analyzeAndDiscoverWallpadTime(bytesFromHex('7F 26 04 25 02 19 59 42'), lifeInfoState, mqttClient, options);
    analyzeAndDiscoverWallpadTime(bytesFromHex('7F 26 04 25 02 20 00 F0'), lifeInfoState, mqttClient, options);

    const statePublishes = mqttClient.calls.filter((call) => call.topic === 'devcommax/life_info/wallpad_time/state');

    assert.deepEqual(statePublishes.map((call) => call.message), [
        '2026-04-25 02:19',
        '2026-04-25 02:20',
    ]);
});

test('parseLifeInfoPacket exposes raw living information bytes without guessing labels', () => {
    const parsed = parseLifeInfoPacket(bytesFromHex('8F 0A 03 05 40 04 46 2B'));

    assert.deepEqual(parsed, {
        raw: '8F 0A 03 05 40 04 46 2B',
        temperatureCode: 10,
        weatherCode: 3,
        dustCode: 5,
        value1: 40,
        value2: 4,
        value3: 46,
    });
});

test('parseLifeInfoCurrentWeatherPacket decodes confirmed 0x24 current weather frames', () => {
    assert.deepEqual(parseLifeInfoCurrentWeatherPacket(bytesFromHex('24 01 01 20 80 09 00 CF')), {
        deviceId: '01',
        weather: '맑음',
        weatherCode: 32,
        weatherCodeHex: '20',
        humidity: 80,
        temperature: 9,
        raw: '24 01 01 20 80 09 00 CF',
    });

    assert.deepEqual(parseLifeInfoCurrentWeatherPacket(bytesFromHex('24 01 01 28 60 0D 00 BB')), {
        deviceId: '01',
        weather: '산발성 소나기',
        weatherCode: 40,
        weatherCodeHex: '28',
        humidity: 60,
        temperature: 13,
        raw: '24 01 01 28 60 0D 00 BB',
    });

    assert.deepEqual(parseLifeInfoCurrentWeatherPacket(bytesFromHex('24 01 01 1C 65 11 00 B8')), {
        deviceId: '01',
        weather: '대체로 흐림',
        weatherCode: 28,
        weatherCodeHex: '1C',
        humidity: 65,
        temperature: 17,
        raw: '24 01 01 1C 65 11 00 B8',
    });

    assert.equal(parseLifeInfoCurrentWeatherPacket(bytesFromHex('24 02 01 00 30 00 00 57')), null);
    assert.deepEqual(parseLifeInfoTemperaturePacket(bytesFromHex('24 01 01 20 80 09 00 CF')), parseLifeInfoCurrentWeatherPacket(bytesFromHex('24 01 01 20 80 09 00 CF')));
});

test('analyzeAndDiscoverLifeInfoCurrentWeather publishes outdoor weather, humidity, and temperature sensors', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        lifeInfoTemperatureDiscovered: false,
        lifeInfoCurrentWeatherDiscovered: false,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverLifeInfoCurrentWeather(
        bytesFromHex('24 01 01 28 60 0D 00 BB'),
        lifeInfoState,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    await new Promise((resolve) => setImmediate(resolve));

    const temperatureDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_temperature/config');
    const weatherDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_outdoor_weather/config');
    const humidityDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_outdoor_humidity/config');
    const temperatureAttributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/outdoor_temperature/attributes');
    const weatherAttributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/outdoor_weather/attributes');
    const humidityAttributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/outdoor_humidity/attributes');

    assert.equal(handled, true);
    assert.equal(lifeInfoState.lifeInfoTemperatureDiscovered, true);
    assert.equal(lifeInfoState.lifeInfoTemperatureDiscoveryVersion, 3);
    assert.equal(lifeInfoState.lifeInfoCurrentWeatherDiscovered, true);
    assert.equal(lifeInfoState.lifeInfoCurrentWeatherDiscoveryVersion, 1);
    assert.equal(saveCount, 3);
    assert.equal(temperatureDiscoveryPayload.name, '실외 온도');
    assert.equal(temperatureDiscoveryPayload.device_class, 'temperature');
    assert.equal(temperatureDiscoveryPayload.state_topic, 'devcommax/life_info/outdoor_temperature/state');
    assert.equal(weatherDiscoveryPayload.name, '실외 날씨');
    assert.equal(weatherDiscoveryPayload.state_topic, 'devcommax/life_info/outdoor_weather/state');
    assert.equal(humidityDiscoveryPayload.name, '실외 습도');
    assert.equal(humidityDiscoveryPayload.device_class, 'humidity');
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/outdoor_temperature/state' && call.message === '13'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/outdoor_weather/state' && call.message === '산발성 소나기'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/outdoor_humidity/state' && call.message === '60'));
    assert.deepEqual(JSON.parse(temperatureAttributesCall.message), {
        weather: '산발성 소나기',
        weather_code: 40,
        weather_code_hex: '28',
        humidity: 60,
        device_id: '01',
        raw: '24 01 01 28 60 0D 00 BB',
    });
    assert.deepEqual(JSON.parse(weatherAttributesCall.message), {
        weather_code: 40,
        weather_code_hex: '28',
        humidity: 60,
        temperature: 13,
        device_id: '01',
        raw: '24 01 01 28 60 0D 00 BB',
    });
    assert.deepEqual(JSON.parse(humidityAttributesCall.message), {
        weather: '산발성 소나기',
        weather_code: 40,
        weather_code_hex: '28',
        temperature: 13,
        device_id: '01',
        raw: '24 01 01 28 60 0D 00 BB',
    });
});

test('analyzeAndDiscoverLifeInfoTemperature keeps the old function name as a current weather alias', () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {};

    assert.equal(analyzeAndDiscoverLifeInfoTemperature(
        bytesFromHex('24 01 01 28 60 0D 00 BB'),
        lifeInfoState,
        mqttClient,
        { topics: createTopicBuilder('devcommax') }
    ), true);
});

test('parseLifeInfoForecastPacket decodes confirmed 0x25 forecast frames', () => {
    assert.deepEqual(parseLifeInfoForecastPacket(bytesFromHex('25 01 01 00 1D 21 08 6D')), {
        deviceId: '01',
        weather: '흐림',
        weatherCode: 29,
        weatherCodeHex: '1D',
        highTemperature: 21,
        lowTemperature: 8,
        raw: '25 01 01 00 1D 21 08 6D',
    });

    assert.equal(parseLifeInfoForecastPacket(bytesFromHex('24 01 01 28 60 0D 00 BB')), null);
});

test('analyzeAndDiscoverLifeInfoForecast publishes forecast weather and temperature sensors', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        lifeInfoForecastDiscovered: false,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverLifeInfoForecast(
        bytesFromHex('25 01 01 00 1D 21 08 6D'),
        lifeInfoState,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    await new Promise((resolve) => setImmediate(resolve));

    const weatherDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_forecast_weather/config');
    const highDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_forecast_high_temperature/config');
    const lowDiscoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_forecast_low_temperature/config');
    const weatherAttributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/forecast_weather/attributes');

    assert.equal(handled, true);
    assert.equal(lifeInfoState.lifeInfoForecastDiscovered, true);
    assert.equal(lifeInfoState.lifeInfoForecastDiscoveryVersion, 1);
    assert.equal(saveCount, 3);
    assert.equal(weatherDiscoveryPayload.name, '예보 날씨');
    assert.equal(highDiscoveryPayload.name, '예보 최고 온도');
    assert.equal(lowDiscoveryPayload.name, '예보 최저 온도');
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/forecast_weather/state' && call.message === '흐림'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/forecast_high_temperature/state' && call.message === '21'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/forecast_low_temperature/state' && call.message === '8'));
    assert.deepEqual(JSON.parse(weatherAttributesCall.message), {
        weather: '흐림',
        weather_code: 29,
        weather_code_hex: '1D',
        high_temperature: 21,
        low_temperature: 8,
        device_id: '01',
        raw: '25 01 01 00 1D 21 08 6D',
    });
});

test('parseLifeInfoOutdoorPm10Packet decodes confirmed 0x24 outdoor dust frames', () => {
    assert.deepEqual(parseLifeInfoOutdoorPm10Packet(bytesFromHex('24 02 01 00 29 00 00 50')), {
        deviceId: '01',
        pm10: 41,
        raw: '24 02 01 00 29 00 00 50',
    });

    assert.deepEqual(parseLifeInfoOutdoorPm10Packet(bytesFromHex('24 02 01 00 0E 00 00 35')), {
        deviceId: '01',
        pm10: 14,
        raw: '24 02 01 00 0E 00 00 35',
    });

    assert.equal(parseLifeInfoOutdoorPm10Packet(bytesFromHex('24 01 01 20 85 08 00 D3')), null);
});

test('analyzeAndDiscoverLifeInfoOutdoorPm10 publishes an outdoor PM10 sensor with raw attributes', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        lifeInfoOutdoorPm10Discovered: false,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverLifeInfoOutdoorPm10(
        bytesFromHex('24 02 01 00 29 00 00 50'),
        lifeInfoState,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    await new Promise((resolve) => setImmediate(resolve));

    const discoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_outdoor_pm10/config');
    const attributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/outdoor_pm10/attributes');

    assert.equal(handled, true);
    assert.equal(lifeInfoState.lifeInfoOutdoorPm10Discovered, true);
    assert.equal(saveCount, 1);
    assert.equal(discoveryPayload.name, '실외 미세먼지');
    assert.equal(discoveryPayload.device_class, 'pm10');
    assert.equal(discoveryPayload.unit_of_measurement, 'µg/m³');
    assert.equal(discoveryPayload.state_topic, 'devcommax/life_info/outdoor_pm10/state');
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/outdoor_pm10/state' && call.message === '41'));
    assert.deepEqual(JSON.parse(attributesCall.message), {
        device_id: '01',
        raw: '24 02 01 00 29 00 00 50',
    });
});

test('analyzeAndDiscoverLifeInfo removes old raw packet discovery and leaves capture to the packet logger', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        wallpadTimeDiscovered: false,
        rawPacketDiscovered: true,
        lastWallpadTime: null,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverLifeInfo(
        bytesFromHex('8F 0A 03 05 40 04 46 2B'),
        lifeInfoState,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    const deleteCall = mqttClient.calls.find((call) => call.topic === 'homeassistant/sensor/commax_life_info_raw/config');

    assert.equal(handled, true);
    assert.equal(lifeInfoState.rawPacketDiscovered, false);
    assert.equal(saveCount, 1);
    assert.equal(deleteCall.message, '');
    assert.equal(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/raw_packet/state'), false);
});

test('analyzeAndDiscoverLight publishes discovery and state topics once', async () => {
    const mqttClient = createMqttStub();
    const discoveredLights = new Set();
    let saveCount = 0;

    const handled = analyzeAndDiscoverLight(
        [0xB1, 0x01, 0x01, 0x00, 0x00, 0x05, 0x05, 0xBD],
        discoveredLights,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    assert.equal(handled, true);
    assert(discoveredLights.has('commax_light_01'));
    assert.equal(saveCount, 1);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/light/light_01/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/01/state' && call.message === 'ON'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/01/brightness' && call.message === '5'));
});

test('analyzeAndDiscoverLight ignores corrupted and unrealistic light frames', () => {
    const mqttClient = createMqttStub();
    const discoveredLights = new Set();

    const corruptedHandled = analyzeAndDiscoverLight(
        [0xB1, 0x01, 0x04, 0x00, 0x00, 0xD0, 0x96, 0xFF],
        discoveredLights,
        mqttClient,
        { topics: createTopicBuilder('devcommax') }
    );
    const unrealisticHandled = analyzeAndDiscoverLight(
        [0xB1, 0x01, 0x67, 0x00, 0x00, 0x00, 0x00, calculateChecksum([0xB1, 0x01, 0x67, 0x00, 0x00, 0x00, 0x00])],
        discoveredLights,
        mqttClient,
        { topics: createTopicBuilder('devcommax') }
    );

    assert.equal(corruptedHandled, false);
    assert.equal(unrealisticHandled, false);
    assert.equal(discoveredLights.size, 0);
    assert.deepEqual(mqttClient.calls, []);
});

test('clearInvalidLightDiscoveries removes retained bogus light discovery', () => {
    const mqttClient = createMqttStub();
    const discoveredLights = new Set(['commax_light_01', 'commax_light_67']);
    let saveCount = 0;

    const handled = clearInvalidLightDiscoveries(discoveredLights, mqttClient, {
        saveState: async () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
    });

    assert.equal(handled, true);
    assert.equal(saveCount, 1);
    assert.equal(discoveredLights.has('commax_light_01'), true);
    assert.equal(discoveredLights.has('commax_light_67'), false);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/light/light_67/config' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/67/state' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/67/availability' && call.message === 'unavailable'));
});

test('clearInvalidTemperatureDiscoveries removes heating entities above configured count', () => {
    const mqttClient = createMqttStub();
    const discoveredTemps = new Set(['commax_temp_04', 'commax_temp_05']);
    let saveCount = 0;

    assert.equal(clearInvalidTemperatureDiscoveries(discoveredTemps, mqttClient, {
        saveState: () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
        maxDevices: 4,
    }), true);

    assert(discoveredTemps.has('commax_temp_04'));
    assert(!discoveredTemps.has('commax_temp_05'));
    assert.equal(saveCount, 1);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/climate/commax_temp_05/config' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/temp/05/availability' && call.message === 'unavailable'));
});

test('clearInvalidTemperatureDiscoveries clears retained heating discovery even when local state missed it', () => {
    const mqttClient = createMqttStub();
    const discoveredTemps = new Set(['commax_temp_01']);
    let saveCount = 0;

    assert.equal(clearInvalidTemperatureDiscoveries(discoveredTemps, mqttClient, {
        saveState: () => {
            saveCount += 1;
        },
        topics: createTopicBuilder('devcommax'),
        maxDevices: 4,
        cleanupLimit: 8,
    }), true);

    assert.equal(saveCount, 0);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/climate/commax_temp_05/config' && call.message === ''));
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/climate/commax_temp_08/config' && call.message === ''));
    assert(!mqttClient.calls.some((call) => call.topic === 'homeassistant/climate/commax_temp_04/config' && call.message === ''));
});

test('analyzeParkingAreaAndCarNumber filters car number fragments while allowing known formats', () => {
    const topics = createTopicBuilder('devcommax');
    const parkingState = {
        parkingDiscovered: true,
        carNumberDiscovered: true,
        iconDiscoveryVersion: 2,
    };

    const invalidMqttClient = createMqttStub();
    analyzeParkingAreaAndCarNumber(
        [0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xB6, 0x00],
        parkingState,
        invalidMqttClient,
        { topics }
    );

    assert.equal(invalidMqttClient.calls.some((call) => call.topic === 'devcommax/parking/car_number'), false);

    const validMqttClient = createMqttStub();
    analyzeParkingAreaAndCarNumber(
        [0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xB2, 0xB3, 0xB4],
        parkingState,
        validMqttClient,
        { topics }
    );

    assert(validMqttClient.calls.some((call) => call.topic === 'devcommax/parking/car_number' && call.message === '1234'));

    const alphanumericMqttClient = createMqttStub();
    analyzeParkingAreaAndCarNumber(
        [0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0xC1, 0xD2, 0xBA, 0xB1],
        parkingState,
        alphanumericMqttClient,
        { topics }
    );

    assert(alphanumericMqttClient.calls.some((call) => call.topic === 'devcommax/parking/car_number' && call.message === 'AR:1'));

    const paddedShortMqttClient = createMqttStub();
    analyzeParkingAreaAndCarNumber(
        [0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0xC1, 0xB1, 0x80, 0x80],
        parkingState,
        paddedShortMqttClient,
        { topics }
    );

    assert(paddedShortMqttClient.calls.some((call) => call.topic === 'devcommax/parking/car_number' && call.message === 'A1'));
});

test('analyzeParkingAreaAndCarNumber publishes car number from long parking frame', () => {
    const topics = createTopicBuilder('devcommax');
    const parkingState = {
        parkingDiscovered: true,
        carNumberDiscovered: true,
        iconDiscoveryVersion: 2,
    };
    const mqttClient = createMqttStub();

    analyzeParkingAreaAndCarNumber(
        [
            0x2A, 0x00, 0x00, 0xBD, 0xC2, 0xB1, 0xAD, 0xC3,
            0xB5, 0xB4, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
            0xC2, 0xB2, 0xAE, 0xF0, 0xEE, 0xE7, 0x80, 0x80,
            0x80, 0x80, 0x80, 0x80, 0xB4, 0xB2, 0xB9, 0x80,
            0x80, 0xB2, 0xB7, 0xB6, 0x80, 0x80, 0xB5, 0xB4,
            0xB4, 0xB4, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
        ],
        parkingState,
        mqttClient,
        { topics }
    );

    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/parking/area' && call.message === 'B1-C54'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/parking/car_number' && call.message === '5444'));
});

test('analyzeAndDiscoverMetering publishes HA states from a legacy F7 frame', async () => {
    const mqttClient = createMqttStub();
    const discoveredMeters = new Set();
    let saveCount = 0;
    const monthlyMeteringState = {
        period: '2026-04',
        baselines: {
            water_acc_meter: 50,
            electric_acc_meter: 4300,
            warm_acc_meter: 200,
            heat_acc_meter: 5,
            gas_acc_meter: 0,
        },
    };
    const frame = bytesFromHex(
        'F7 30 0F 81 19 00 00 00 06 01 00 00 00 00 01 03 14 04 43 17 00 00 00 02 63 50 81 00 05 73 D7 D2'
    );

    const handled = analyzeAndDiscoverMetering(
        frame,
        discoveredMeters,
        mqttClient,
        {
            monthlyMeteringState,
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    assert.equal(isMeteringPacket(frame), true);
    assert.equal(handled, true);
    assert(discoveredMeters.has('commax_metering'));
    assert(discoveredMeters.has('commax_metering_realtime_precision_v4'));
    assert(discoveredMeters.has('commax_metering_monthly'));
    assert(discoveredMeters.has('commax_metering_monthly_precision_v3'));
    assert(saveCount >= 2);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_electric_meter/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_electric_monthly_meter/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/water_meter/state' && call.message === '0'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/gas_meter/state' && call.message === '0'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/warm_meter/state' && call.message === '0'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/water_acc_meter/state' && call.message === '60.1'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_meter/state' && call.message === '314'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_acc_meter/state' && call.message === '4431.7'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_monthly_meter/state' && call.message === '131.7'));
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_water_meter/config').device_class, 'volume_flow_rate');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_water_meter/config').state_class, 'measurement');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_water_meter/config').suggested_display_precision, 0);
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_gas_meter/config').device_class, 'volume_flow_rate');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_warm_meter/config').device_class, 'volume_flow_rate');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_gas_meter/config').icon, 'mdi:fire');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_heat_meter/config').icon, 'mdi:radiator');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_heat_meter/config').suggested_display_precision, 1);
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_electric_monthly_meter/config').icon, 'mdi:flash');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_electric_monthly_meter/config').suggested_display_precision, 1);
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_heat_monthly_meter/config').suggested_display_precision, 2);
});

test('analyzeAndDiscoverMetering decodes three-byte cumulative BCD values', () => {
    const mqttClient = createMqttStub();
    const frame = bytesFromHex(
        'F7 30 0F 81 19 00 02 01 23 45 00 03 02 34 56 04 56 07 21 98 00 04 03 45 67 12 34 04 56 78 00 00'
    );

    const handled = analyzeAndDiscoverMetering(frame, new Set(), mqttClient, {
        topics: createTopicBuilder('devcommax'),
    });

    assert.equal(handled, true);
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/water_acc_meter/state' && call.message === '1234.5'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/gas_acc_meter/state' && call.message === '2345.6'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_acc_meter/state' && call.message === '7219.8'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/warm_acc_meter/state' && call.message === '3456.7'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/heat_acc_meter/state' && call.message === '456.78'));
});

test('calculateMonthlyMeteringValues resets baseline when the calendar month changes', () => {
    const monthlyMeteringState = {
        period: '2026-03',
        baselines: {
            electric_acc_meter: 7000,
        },
    };
    const values = {
        water_acc_meter: 100,
        electric_acc_meter: 7213.8,
        warm_acc_meter: 200,
        heat_acc_meter: 10,
        gas_acc_meter: 50,
    };

    const result = calculateMonthlyMeteringValues(values, monthlyMeteringState, new Date(2026, 3, 25));

    assert.equal(getMonthlyMeteringPeriod(new Date(2026, 3, 25)), '2026-04');
    assert.equal(result.changed, true);
    assert.equal(monthlyMeteringState.period, '2026-04');
    assert.equal(monthlyMeteringState.baselines.electric_acc_meter, 7213.8);
    assert.equal(result.values.electric_monthly_meter, 0);
});

test('calculateMonthlyMeteringValues returns usage from the saved monthly baseline', () => {
    const monthlyMeteringState = {
        period: '2026-04',
        baselines: {
            water_acc_meter: 100,
            electric_acc_meter: 7000,
            warm_acc_meter: 200,
            heat_acc_meter: 10,
            gas_acc_meter: 50,
        },
    };
    const values = {
        water_acc_meter: 101.3,
        electric_acc_meter: 7213.8,
        warm_acc_meter: 201,
        heat_acc_meter: 12.25,
        gas_acc_meter: 52.5,
    };

    const result = calculateMonthlyMeteringValues(values, monthlyMeteringState, new Date(2026, 3, 25));

    assert.equal(result.changed, false);
    assert.equal(result.values.electric_monthly_meter, 213.8);
    assert.equal(result.values.water_monthly_meter, 1.3);
});

test('calculateMonthlyMeteringValues applies configured usage only for the matching period', () => {
    const monthlyMeteringState = {
        period: '2026-04',
        baselines: {
            electric_acc_meter: 7100,
        },
    };
    const values = {
        water_acc_meter: 100,
        electric_acc_meter: 7213.8,
        warm_acc_meter: 200,
        heat_acc_meter: 10,
        gas_acc_meter: 50,
    };

    const result = calculateMonthlyMeteringValues(
        values,
        monthlyMeteringState,
        new Date(2026, 3, 25),
        {
            period: '2026-04',
            values: {
                electric_acc_meter: 213.8,
            },
        }
    );

    assert.equal(result.changed, true);
    assert.equal(monthlyMeteringState.baselines.electric_acc_meter, 7000);
    assert.deepEqual(monthlyMeteringState.appliedUsageConfig, {
        period: '2026-04',
        values: {
            electric_acc_meter: 213.8,
        },
        ignoredValues: {},
    });
    assert.equal(result.values.electric_monthly_meter, 213.8);
});

test('calculateMonthlyMeteringValues does not reapply configured usage after it was applied', () => {
    const monthlyMeteringState = {
        period: '2026-04',
        baselines: {
            electric_acc_meter: 7100,
        },
    };
    const usageConfig = {
        period: '2026-04',
        values: {
            electric_acc_meter: 213.8,
        },
    };

    const firstResult = calculateMonthlyMeteringValues(
        {
            water_acc_meter: 100,
            electric_acc_meter: 7213.8,
            warm_acc_meter: 200,
            heat_acc_meter: 10,
            gas_acc_meter: 50,
        },
        monthlyMeteringState,
        new Date(2026, 3, 25),
        usageConfig
    );
    const secondResult = calculateMonthlyMeteringValues(
        {
            water_acc_meter: 100,
            electric_acc_meter: 7214.8,
            warm_acc_meter: 200,
            heat_acc_meter: 10,
            gas_acc_meter: 50,
        },
        monthlyMeteringState,
        new Date(2026, 3, 25),
        usageConfig
    );

    assert.equal(firstResult.values.electric_monthly_meter, 213.8);
    assert.equal(secondResult.changed, false);
    assert.equal(monthlyMeteringState.baselines.electric_acc_meter, 7000);
    assert.equal(secondResult.values.electric_monthly_meter, 214.8);
});

test('calculateMonthlyMeteringValues can use the wallpad clock period', () => {
    const monthlyMeteringState = {
        period: '2026-03',
        baselines: {
            electric_acc_meter: 7000,
        },
    };
    const values = {
        water_acc_meter: 100,
        electric_acc_meter: 7213.8,
        warm_acc_meter: 200,
        heat_acc_meter: 10,
        gas_acc_meter: 50,
    };

    const result = calculateMonthlyMeteringValues(values, monthlyMeteringState, {
        year: 2026,
        month: 4,
    });

    assert.equal(getMonthlyMeteringPeriod({ year: 2026, month: 4 }), '2026-04');
    assert.equal(result.changed, true);
    assert.equal(monthlyMeteringState.period, '2026-04');
});

test('applyConfiguredMonthlyUsage ignores stale usage periods', () => {
    const monthlyMeteringState = {
        period: '2026-05',
        baselines: {
            electric_acc_meter: 8000,
        },
    };

    const changed = applyConfiguredMonthlyUsage(monthlyMeteringState, {
        period: '2026-04',
        values: {
            electric_acc_meter: 213.8,
        },
    }, '2026-05', { electric_acc_meter: 8213.8 });

    assert.equal(changed, false);
    assert.equal(monthlyMeteringState.baselines.electric_acc_meter, 8000);
});

test('applyConfiguredMonthlyUsage ignores usage that is larger than the current cumulative value', () => {
    const monthlyMeteringState = {
        period: '2026-04',
        baselines: {
            electric_acc_meter: 7100,
        },
    };

    const changed = applyConfiguredMonthlyUsage(monthlyMeteringState, {
        period: '2026-04',
        values: {
            electric_acc_meter: 9000,
        },
    }, '2026-04', { electric_acc_meter: 7213.8 });

    assert.equal(changed, true);
    assert.equal(monthlyMeteringState.baselines.electric_acc_meter, 7100);
    assert.deepEqual(monthlyMeteringState.appliedUsageConfig, {
        period: '2026-04',
        values: {},
        ignoredValues: {
            electric_acc_meter: 9000,
        },
    });
});

test('analyzeAndDiscoverMetering ignores non-metering frames without publishing', () => {
    const mqttClient = createMqttStub();
    const frame = bytesFromHex('57 00 00 00 00 01 8A');

    const handled = analyzeAndDiscoverMetering(frame, new Set(), mqttClient, {
        topics: createTopicBuilder('devcommax'),
    });

    assert.equal(isMeteringPacket(frame), false);
    assert.equal(handled, false);
    assert.equal(mqttClient.calls.length, 0);
});

test('analyzeAndDiscoverAirQuality ignores short C8 frames without throwing', () => {
    const mqttClient = createMqttStub();
    const handled = analyzeAndDiscoverAirQuality([0xC8, 0x01, 0x00], new Set(), mqttClient, {
        topics: createTopicBuilder('devcommax'),
    });

    assert.equal(handled, false);
    assert.equal(mqttClient.calls.length, 0);
});

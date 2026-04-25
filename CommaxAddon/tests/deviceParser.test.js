const test = require('node:test');
const assert = require('node:assert/strict');

const {
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverLifeInfo,
    analyzeAndDiscoverLifeInfoTemperature,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverWallpadTime,
    analyzeParkingAreaAndCarNumber,
    applyConfiguredMonthlyUsage,
    calculateChecksum,
    calculateMonthlyMeteringValues,
    getMonthlyMeteringPeriod,
    isMeteringPacket,
    parseLifeInfoPacket,
    parseLifeInfoTemperaturePacket,
    parseMasterLightPacket,
    parseTemperaturePacket,
    parseWallpadTimePacket,
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

test('parseMasterLightPacket ignores elevator packets sharing the same header', () => {
    const bytes = [0xA0, 0x01, 0x01, 0x00, 0x28, 0xD7, 0x00];
    bytes.push(calculateChecksum(bytes));

    assert.equal(parseMasterLightPacket(bytes), null);
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

test('parseLifeInfoTemperaturePacket decodes confirmed 0x24 temperature frames', () => {
    assert.deepEqual(parseLifeInfoTemperaturePacket(bytesFromHex('24 01 01 20 80 09 00 CF')), {
        deviceId: '01',
        temperature: 9,
        unknownCode: '80',
        raw: '24 01 01 20 80 09 00 CF',
    });

    assert.deepEqual(parseLifeInfoTemperaturePacket(bytesFromHex('24 01 01 20 85 08 00 D3')), {
        deviceId: '01',
        temperature: 8,
        unknownCode: '85',
        raw: '24 01 01 20 85 08 00 D3',
    });

    assert.equal(parseLifeInfoTemperaturePacket(bytesFromHex('24 02 01 00 30 00 00 57')), null);
});

test('analyzeAndDiscoverLifeInfoTemperature publishes a temperature sensor with raw attributes', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        lifeInfoTemperatureDiscovered: false,
    };
    let saveCount = 0;

    const handled = analyzeAndDiscoverLifeInfoTemperature(
        bytesFromHex('24 01 01 20 85 08 00 D3'),
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

    const discoveryPayload = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_life_info_temperature/config');
    const attributesCall = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/temperature/attributes');

    assert.equal(handled, true);
    assert.equal(lifeInfoState.lifeInfoTemperatureDiscovered, true);
    assert.equal(saveCount, 1);
    assert.equal(discoveryPayload.name, '생활정보 온도');
    assert.equal(discoveryPayload.device_class, 'temperature');
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/temperature/state' && call.message === '8'));
    assert.deepEqual(JSON.parse(attributesCall.message), {
        unknown_code: '85',
        device_id: '01',
        raw: '24 01 01 20 85 08 00 D3',
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

    analyzeAndDiscoverLight(
        [0xB1, 0x01, 0x01, 0x00, 0x00, 0x05, 0x05, 0x00],
        discoveredLights,
        mqttClient,
        {
            saveState: async () => {
                saveCount += 1;
            },
            topics: createTopicBuilder('devcommax'),
        }
    );

    assert(discoveredLights.has('commax_light_01'));
    assert.equal(saveCount, 1);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/light/light_01/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/01/state' && call.message === 'ON'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/light/01/brightness' && call.message === '5'));
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
    assert(discoveredMeters.has('commax_metering_realtime_classes_v3'));
    assert(discoveredMeters.has('commax_metering_monthly'));
    assert(discoveredMeters.has('commax_metering_monthly_icons_v2'));
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
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_gas_meter/config').device_class, 'volume_flow_rate');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_warm_meter/config').device_class, 'volume_flow_rate');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_gas_meter/config').icon, 'mdi:fire');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_heat_meter/config').icon, 'mdi:radiator');
    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_electric_monthly_meter/config').icon, 'mdi:flash');
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

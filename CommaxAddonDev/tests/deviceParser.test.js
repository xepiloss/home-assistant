const test = require('node:test');
const assert = require('node:assert/strict');

const {
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverLifeInfo,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverWallpadTime,
    applyConfiguredMonthlyUsage,
    calculateChecksum,
    calculateMonthlyMeteringValues,
    getMonthlyMeteringPeriod,
    isMeteringPacket,
    parseLifeInfoPacket,
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
        iso: '2026-04-25T02:19:59+09:00',
    });
});

test('analyzeAndDiscoverWallpadTime publishes timestamp and stores it for monthly metering', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        wallpadTimeDiscovered: false,
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
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_wallpad_time/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/wallpad_time/state' && call.message === '2026-04-25T02:19:59+09:00'));
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

test('analyzeAndDiscoverLifeInfo publishes the raw packet as a diagnostic sensor', async () => {
    const mqttClient = createMqttStub();
    const lifeInfoState = {
        wallpadTimeDiscovered: false,
        rawPacketDiscovered: false,
        lastWallpadTime: null,
    };

    const handled = analyzeAndDiscoverLifeInfo(
        bytesFromHex('8F 0A 03 05 40 04 46 2B'),
        lifeInfoState,
        mqttClient,
        {
            topics: createTopicBuilder('devcommax'),
        }
    );

    const attrs = mqttClient.calls.find((call) => call.topic === 'devcommax/life_info/raw_packet/attributes');

    assert.equal(handled, true);
    assert(lifeInfoState.rawPacketDiscovered);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_life_info_raw/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/life_info/raw_packet/state' && call.message === '8F 0A 03 05 40 04 46 2B'));
    assert.deepEqual(JSON.parse(attrs.message), {
        temperature_code: 10,
        weather_code: 3,
        dust_code: 5,
        value_1: 40,
        value_2: 4,
        value_3: 46,
    });
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
    assert(discoveredMeters.has('commax_metering_icons_v2'));
    assert(discoveredMeters.has('commax_metering_monthly'));
    assert(discoveredMeters.has('commax_metering_monthly_icons_v2'));
    assert(saveCount >= 2);
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_electric_meter/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'homeassistant/sensor/commax_electric_monthly_meter/config'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/water_acc_meter/state' && call.message === '60.1'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_meter/state' && call.message === '314'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_acc_meter/state' && call.message === '4431.7'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/smart_metering/electric_monthly_meter/state' && call.message === '131.7'));
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
    assert.equal(result.values.electric_monthly_meter, 213.8);
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

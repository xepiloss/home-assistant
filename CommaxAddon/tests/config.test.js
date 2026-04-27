const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig, parseHexFrame, parseMonthlyMeteringPeriod, readEnvOptions } = require('../src/config');
const { createTopicBuilder } = require('../src/topics');

test('normalizeConfig fills defaults and keeps overrides', () => {
    const config = normalizeConfig({
        mqtt_topic_prefix: 'wallpad',
        mqtt_broker_url: 'broker.local',
        ew11_port: '9900',
    });

    assert.equal(config.mqtt.topicPrefix, 'wallpad');
    assert.equal(config.mqtt.host, 'broker.local');
    assert.equal(config.mqtt.port, 1883);
    assert.equal(config.ew11.port, 9900);
    assert.equal(config.metering.port, 8899);
    assert.equal(config.monthlyMeteringUsageOverrides.period, '');
    assert.equal(config.monthlyMeteringUsageOverrides.values.electric_acc_meter, undefined);
    assert.equal(config.heating.deviceCount, 4);
    assert.equal(config.packetCapture.enabled, false);
    assert.equal(config.packetCapture.path, '/share/commax_unknown_packets.jsonl');
});

test('readEnvOptions maps shell env vars to addon options', () => {
    const options = readEnvOptions({
        MQTT_TOPIC_PREFIX: 'localcommax',
        MQTT_BROKER_URL: '127.0.0.1',
        MQTT_PORT: '1884',
        MQTT_USERNAME: 'tester',
        MQTT_PASSWORD: 'secret',
        EW11_HOST: '192.168.10.20',
        EW11_PORT: '8898',
        EW11_METERING_HOST: '192.168.10.21',
        EW11_METERING_PORT: '8897',
        COMMAX_MONTHLY_METERING_USAGE_PERIOD: '2026-04',
        COMMAX_MONTHLY_ELECTRIC_USAGE: '213.8',
        COMMAX_HEATING_DEVICE_COUNT: '4',
        COMMAX_UNKNOWN_PACKET_CAPTURE_ENABLED: 'true',
        COMMAX_UNKNOWN_PACKET_CAPTURE_PATH: '/share/custom_unknown.jsonl',
        COMMAX_ELEVATOR_MODE: 'rs485',
        COMMAX_ELEVATOR_RS485_CALL_COMMAND: 'A0 01 01 00 08 D7 00 81',
    });

    assert.deepEqual(options, {
        mqtt_topic_prefix: 'localcommax',
        mqtt_broker_url: '127.0.0.1',
        mqtt_port: '1884',
        mqtt_username: 'tester',
        mqtt_password: 'secret',
        ew11_host: '192.168.10.20',
        ew11_port: '8898',
        ew11_metering_host: '192.168.10.21',
        ew11_metering_port: '8897',
        monthly_metering_usage_period: '2026-04',
        monthly_electric_usage: '213.8',
        heating_device_count: '4',
        unknown_packet_capture_enabled: 'true',
        unknown_packet_capture_path: '/share/custom_unknown.jsonl',
        elevator_mode: 'rs485',
        elevator_rs485_call_command: 'A0 01 01 00 08 D7 00 81',
    });
});

test('normalizeConfig parses elevator call mode and custom RS485 frames', () => {
    const config = normalizeConfig({
        elevator_mode: 'rs485',
        elevator_rs485_call_command: 'A001010008D70081',
        elevator_rs485_call_on_frame: '22 01 40 07 00 00 00 6A',
        elevator_rs485_calling_frame: '2601014200010570',
        elevator_rs485_released_frame: '26 01 01 00 00 00 00 28',
    });

    assert.equal(config.elevator.mode, 'rs485');
    assert.equal(config.elevator.callCommand.hex, 'A0 01 01 00 08 D7 00 81');
    assert.deepEqual(config.elevator.frames.callOn.bytes, [0x22, 0x01, 0x40, 0x07, 0x00, 0x00, 0x00, 0x6A]);
    assert.equal(config.elevator.invalid.callCommand, '');
});

test('normalizeConfig keeps elevator defaults when invalid inputs are provided', () => {
    const config = normalizeConfig({
        elevator_mode: 'soap',
        elevator_rs485_call_command: 'A0 01 01 00 08 D7 00 82',
    });

    assert.equal(config.elevator.mode, 'off');
    assert.equal(config.elevator.invalid.mode, 'soap');
    assert.equal(config.elevator.callCommand.hex, '');
    assert.equal(config.elevator.invalid.callCommand, 'A0 01 01 00 08 D7 00 82');
});

test('normalizeConfig accepts disabled elevator mode', () => {
    const config = normalizeConfig({
        elevator_mode: 'off',
    });

    assert.equal(config.elevator.mode, 'off');
    assert.equal(config.elevator.invalid.mode, '');
});

test('normalizeConfig parses heating device count with safe bounds', () => {
    assert.equal(normalizeConfig({ heating_device_count: '8' }).heating.deviceCount, 8);
    assert.equal(normalizeConfig({ heating_device_count: '0' }).heating.deviceCount, 4);
    assert.equal(normalizeConfig({ heating_device_count: 'garbage' }).heating.deviceCount, 4);
    assert.equal(normalizeConfig({ heating_device_count: '17' }).heating.deviceCount, 4);
});

test('parseHexFrame accepts only 8-byte checksum-valid frames', () => {
    assert.deepEqual(parseHexFrame('22 01 40 07 00 00 00 6A').bytes, [0x22, 0x01, 0x40, 0x07, 0x00, 0x00, 0x00, 0x6A]);
    assert.equal(parseHexFrame('22 01 40 07 00 00 00 6B').hex, '');
    assert.equal(parseHexFrame('not hex').hex, '');
});

test('normalizeConfig parses optional monthly metering usage overrides', () => {
    const config = normalizeConfig({
        monthly_metering_usage_period: '2026-04',
        monthly_water_usage: '',
        monthly_electric_usage: '213.8',
        monthly_gas_usage: 12.3,
    });

    assert.equal(config.monthlyMeteringUsageOverrides.period, '2026-04');
    assert.equal(config.monthlyMeteringUsageOverrides.values.water_acc_meter, undefined);
    assert.equal(config.monthlyMeteringUsageOverrides.values.electric_acc_meter, 213.8);
    assert.equal(config.monthlyMeteringUsageOverrides.values.gas_acc_meter, 12.3);
});

test('normalizeConfig ignores invalid monthly metering override inputs', () => {
    const config = normalizeConfig({
        monthly_metering_usage_period: 'garbage',
        monthly_water_usage: '-1',
        monthly_electric_usage: '213.8',
    });

    assert.equal(config.monthlyMeteringUsageOverrides.period, '');
    assert.equal(config.monthlyMeteringUsageOverrides.invalidPeriod, 'garbage');
    assert.equal(config.monthlyMeteringUsageOverrides.values.water_acc_meter, undefined);
    assert.equal(config.monthlyMeteringUsageOverrides.values.electric_acc_meter, 213.8);
});

test('parseMonthlyMeteringPeriod accepts only yyyy-MM calendar months', () => {
    assert.equal(parseMonthlyMeteringPeriod('2026-04'), '2026-04');
    assert.equal(parseMonthlyMeteringPeriod('2026-4'), '');
    assert.equal(parseMonthlyMeteringPeriod('2026-13'), '');
    assert.equal(parseMonthlyMeteringPeriod('abc'), '');
});

test('createTopicBuilder joins mqtt and discovery topics consistently', () => {
    const topics = createTopicBuilder('devcommax');

    assert.equal(topics.path('light', '01', 'state'), 'devcommax/light/01/state');
    assert.equal(topics.availability('fan', '01'), 'devcommax/fan/01/availability');
    assert.equal(topics.discovery('sensor', 'commax_air_quality'), 'homeassistant/sensor/commax_air_quality/config');
});

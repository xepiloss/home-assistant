const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig, readEnvOptions } = require('../src/config');
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
        COMMAX_UNKNOWN_PACKET_CAPTURE_ENABLED: 'true',
        COMMAX_UNKNOWN_PACKET_CAPTURE_PATH: '/share/custom_unknown.jsonl',
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
        unknown_packet_capture_enabled: 'true',
        unknown_packet_capture_path: '/share/custom_unknown.jsonl',
    });
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

test('createTopicBuilder joins mqtt and discovery topics consistently', () => {
    const topics = createTopicBuilder('devcommax');

    assert.equal(topics.path('light', '01', 'state'), 'devcommax/light/01/state');
    assert.equal(topics.availability('fan', '01'), 'devcommax/fan/01/availability');
    assert.equal(topics.discovery('sensor', 'commax_air_quality'), 'homeassistant/sensor/commax_air_quality/config');
});

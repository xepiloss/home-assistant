const test = require('node:test');
const assert = require('node:assert/strict');

const { createDiagnostics, formatMinuteTimestamp } = require('../src/diagnostics');
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

function findDiscoveryPayload(mqttClient, topic) {
    const call = mqttClient.calls.find((item) => item.topic === topic);
    return call ? JSON.parse(call.message) : null;
}

test('formatMinuteTimestamp renders a readable local minute', () => {
    assert.equal(formatMinuteTimestamp(new Date(2026, 3, 25, 9, 21, 15)), '2026-04-25 09:21');
});

test('createDiagnostics publishes diagnostic discovery for MQTT and EW11 status', async () => {
    const mqttClient = createMqttStub();
    const diagnostics = createDiagnostics({
        mqttClient,
        topics: createTopicBuilder('devcommax'),
        includeMetering: true,
    });

    await diagnostics.publishDiscovery();

    const mqttDiscovery = findDiscoveryPayload(mqttClient, 'homeassistant/binary_sensor/commax_mqtt_connection/config');
    const mainDiscovery = findDiscoveryPayload(mqttClient, 'homeassistant/binary_sensor/commax_main_ew11_connection/config');
    const mainLastReceived = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_main_ew11_last_received/config');
    const meteringLastReceived = findDiscoveryPayload(mqttClient, 'homeassistant/sensor/commax_metering_ew11_last_received/config');

    assert.equal(mqttDiscovery.device_class, 'connectivity');
    assert.equal(mqttDiscovery.entity_category, 'diagnostic');
    assert.equal(mqttDiscovery.state_topic, 'devcommax/diagnostics/mqtt/status');
    assert.equal(mainDiscovery.payload_on, 'connected');
    assert.equal(mainDiscovery.payload_off, 'disconnected');
    assert.equal(mainLastReceived.entity_category, 'diagnostic');
    assert.equal(mainLastReceived.enabled_by_default, false);
    assert.equal(meteringLastReceived.enabled_by_default, false);
});

test('createDiagnostics publishes status and throttles last receive to minute changes', async () => {
    const mqttClient = createMqttStub();
    const diagnostics = createDiagnostics({
        mqttClient,
        topics: createTopicBuilder('devcommax'),
        includeMetering: true,
    });

    await diagnostics.setEw11Connected('primary', true);
    await diagnostics.recordEw11Receive('primary', new Date(2026, 3, 25, 9, 21, 15));
    await diagnostics.recordEw11Receive('primary', new Date(2026, 3, 25, 9, 21, 45));
    await diagnostics.recordEw11Receive('primary', new Date(2026, 3, 25, 9, 22, 1));

    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/diagnostics/main_ew11/status' && call.message === 'connected'));
    assert.deepEqual(
        mqttClient.calls
            .filter((call) => call.topic === 'devcommax/diagnostics/main_ew11/last_received')
            .map((call) => call.message),
        ['2026-04-25 09:21', '2026-04-25 09:22']
    );
});

test('createDiagnostics skips metering diagnostics when metering EW11 is not configured', async () => {
    const mqttClient = createMqttStub();
    const diagnostics = createDiagnostics({
        mqttClient,
        topics: createTopicBuilder('devcommax'),
        includeMetering: false,
    });

    await diagnostics.publishDiscovery();
    await diagnostics.setEw11Connected('metering', true);
    await diagnostics.recordEw11Receive('metering', new Date(2026, 3, 25, 9, 21, 15));

    assert.equal(findDiscoveryPayload(mqttClient, 'homeassistant/binary_sensor/commax_metering_ew11_connection/config'), null);
    assert.equal(mqttClient.calls.some((call) => call.topic.includes('metering_ew11')), false);
});

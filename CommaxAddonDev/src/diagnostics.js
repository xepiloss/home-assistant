const WALLPAD_DEVICE = Object.freeze({
    identifiers: ['Commax'],
    name: '월패드',
    manufacturer: 'Commax',
});

const DIAGNOSTIC_TARGETS = Object.freeze({
    primary: {
        id: 'main_ew11',
        name: '메인 EW11',
    },
    metering: {
        id: 'metering_ew11',
        name: '검침 EW11',
    },
});

function cloneDeviceInfo() {
    return {
        ...WALLPAD_DEVICE,
        identifiers: [...WALLPAD_DEVICE.identifiers],
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatMinuteTimestamp(date = new Date()) {
    return [
        `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
        `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    ].join(' ');
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

function createConnectionDiscovery({ name, uniqueId, stateTopic }) {
    return {
        component: 'binary_sensor',
        uniqueId,
        payload: {
            name,
            unique_id: uniqueId,
            state_topic: stateTopic,
            payload_on: 'connected',
            payload_off: 'disconnected',
            device_class: 'connectivity',
            entity_category: 'diagnostic',
            device: cloneDeviceInfo(),
        },
    };
}

function createLastReceivedDiscovery({ name, uniqueId, stateTopic }) {
    return {
        component: 'sensor',
        uniqueId,
        payload: {
            name,
            unique_id: uniqueId,
            state_topic: stateTopic,
            icon: 'mdi:clock-outline',
            entity_category: 'diagnostic',
            enabled_by_default: false,
            device: cloneDeviceInfo(),
        },
    };
}

function createDiagnostics({ mqttClient, topics, includeMetering = false, now = () => new Date() }) {
    const lastPublishedReceiveMinute = new Map();
    const enabledTargets = includeMetering ? ['primary', 'metering'] : ['primary'];

    function mqttConnectionTopic() {
        return topics.path('diagnostics', 'mqtt', 'status');
    }

    function targetStatusTopic(target) {
        return topics.path('diagnostics', DIAGNOSTIC_TARGETS[target].id, 'status');
    }

    function targetLastReceivedTopic(target) {
        return topics.path('diagnostics', DIAGNOSTIC_TARGETS[target].id, 'last_received');
    }

    function isTargetEnabled(target) {
        return enabledTargets.includes(target);
    }

    function buildDiscoveryConfigs() {
        const configs = [
            createConnectionDiscovery({
                name: 'MQTT 연결 상태',
                uniqueId: 'commax_mqtt_connection',
                stateTopic: mqttConnectionTopic(),
            }),
        ];

        enabledTargets.forEach((target) => {
            const targetConfig = DIAGNOSTIC_TARGETS[target];
            configs.push(
                createConnectionDiscovery({
                    name: `${targetConfig.name} 연결 상태`,
                    uniqueId: `commax_${targetConfig.id}_connection`,
                    stateTopic: targetStatusTopic(target),
                }),
                createLastReceivedDiscovery({
                    name: `${targetConfig.name} 마지막 수신 시간`,
                    uniqueId: `commax_${targetConfig.id}_last_received`,
                    stateTopic: targetLastReceivedTopic(target),
                })
            );
        });

        return configs;
    }

    async function publishDiscovery() {
        const configs = buildDiscoveryConfigs();
        await Promise.all(configs.map((config) => publishAsync(
            mqttClient,
            topics.discovery(config.component, config.uniqueId),
            JSON.stringify(config.payload),
            { retain: true }
        )));
    }

    function setMqttConnected(isConnected) {
        return publishAsync(
            mqttClient,
            mqttConnectionTopic(),
            isConnected ? 'connected' : 'disconnected',
            { retain: true, qos: 1 }
        );
    }

    function setEw11Connected(target, isConnected) {
        if (!isTargetEnabled(target)) {
            return Promise.resolve();
        }

        return publishAsync(
            mqttClient,
            targetStatusTopic(target),
            isConnected ? 'connected' : 'disconnected',
            { retain: true, qos: 1 }
        );
    }

    function recordEw11Receive(target, date = now()) {
        if (!isTargetEnabled(target)) {
            return Promise.resolve();
        }

        const timestamp = formatMinuteTimestamp(date);
        if (lastPublishedReceiveMinute.get(target) === timestamp) {
            return Promise.resolve();
        }

        lastPublishedReceiveMinute.set(target, timestamp);
        return publishAsync(
            mqttClient,
            targetLastReceivedTopic(target),
            timestamp,
            { retain: true, qos: 1 }
        );
    }

    async function setAllDisconnected() {
        await Promise.all([
            setMqttConnected(false),
            ...enabledTargets.map((target) => setEw11Connected(target, false)),
        ]);
    }

    return {
        buildDiscoveryConfigs,
        formatMinuteTimestamp,
        mqttConnectionTopic,
        publishDiscovery,
        recordEw11Receive,
        setAllDisconnected,
        setEw11Connected,
        setMqttConnected,
        targetLastReceivedTopic,
        targetStatusTopic,
    };
}

module.exports = {
    createDiagnostics,
    formatMinuteTimestamp,
};

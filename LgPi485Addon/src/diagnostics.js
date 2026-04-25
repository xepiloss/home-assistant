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

function createDiagnostics({ mqttClient, topics, now = () => new Date() }) {
    const lastPublishedReceiveMinute = new Map();

    function mqttConnectionTopic() {
        return topics.path('diagnostics', 'mqtt', 'status');
    }

    function ew11StatusTopic() {
        return topics.path('diagnostics', 'ew11', 'status');
    }

    function ew11LastReceivedTopic() {
        return topics.path('diagnostics', 'ew11', 'last_received');
    }

    function buildDiscoveryConfigs() {
        return [
            createConnectionDiscovery({
                name: 'LG PI485 MQTT 연결 상태',
                uniqueId: 'lg_pi485_mqtt_connection',
                stateTopic: mqttConnectionTopic(),
            }),
            createConnectionDiscovery({
                name: 'LG PI485 EW11 연결 상태',
                uniqueId: 'lg_pi485_ew11_connection',
                stateTopic: ew11StatusTopic(),
            }),
            createLastReceivedDiscovery({
                name: 'LG PI485 EW11 마지막 수신 시간',
                uniqueId: 'lg_pi485_ew11_last_received',
                stateTopic: ew11LastReceivedTopic(),
            }),
        ];
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

    function setEw11Connected(isConnected) {
        return publishAsync(
            mqttClient,
            ew11StatusTopic(),
            isConnected ? 'connected' : 'disconnected',
            { retain: true, qos: 1 }
        );
    }

    function recordEw11Receive(date = now()) {
        const timestamp = formatMinuteTimestamp(date);
        if (lastPublishedReceiveMinute.get('ew11') === timestamp) {
            return Promise.resolve();
        }

        lastPublishedReceiveMinute.set('ew11', timestamp);
        return publishAsync(
            mqttClient,
            ew11LastReceivedTopic(),
            timestamp,
            { retain: true, qos: 1 }
        );
    }

    async function setAllDisconnected() {
        await Promise.all([
            setMqttConnected(false),
            setEw11Connected(false),
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
    };
}

module.exports = {
    createDiagnostics,
    formatMinuteTimestamp,
};

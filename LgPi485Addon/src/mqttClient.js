const mqtt = require('mqtt');
const { log, logError } = require('./utils');

function buildBrokerUrl(host) {
    return /^[a-z]+:\/\//i.test(host) ? host : `mqtt://${host}`;
}

class MqttClient {
    constructor(config, onMessageCallback) {
        this.topicPrefix = config.topicPrefix;
        this.onMessageCallback = onMessageCallback;
        this.connectionStatusTopic = `${this.topicPrefix}/diagnostics/mqtt/status`;
        this.client = mqtt.connect(buildBrokerUrl(config.host), {
            port: config.port,
            clientId: `mqtt_client_${Math.random().toString(16).slice(2, 10)}`,
            username: config.username,
            password: config.password,
            will: {
                topic: this.connectionStatusTopic,
                payload: 'disconnected',
                qos: 1,
                retain: true,
            },
        });

        this.setupListeners();
    }

    publishConnectionStatus(status, callback) {
        this.client.publish(this.connectionStatusTopic, status, { retain: true, qos: 1 }, callback);
    }

    setupListeners() {
        this.client.on('connect', () => {
            const topic = `${this.topicPrefix}/#`;

            log('MQTT 연결되었습니다.');
            this.publishConnectionStatus('connected', (err) => {
                if (err) {
                    logError('MQTT 연결 상태 발행 실패:', err);
                }
            });

            this.client.subscribe(topic, (err) => {
                if (err) {
                    logError(`MQTT 토픽 구독 실패: ${topic}`, err);
                    return;
                }

                log(`MQTT 토픽 구독 : ${topic}`);
            });
        });

        this.client.on('message', (topic, message) => {
            this.onMessageCallback(topic, message);
        });

        this.client.on('error', (err) => {
            logError('MQTT 오류:', err.message);
        });
    }

    publish(topic, message, options = {}, callback) {
        this.client.publish(topic, message, options, callback);
    }

    end(force = false) {
        return new Promise((resolve) => {
            const close = () => this.client.end(force, {}, resolve);

            if (!this.client.connected) {
                close();
                return;
            }

            this.publishConnectionStatus('disconnected', () => close());
        });
    }
}

module.exports = MqttClient;

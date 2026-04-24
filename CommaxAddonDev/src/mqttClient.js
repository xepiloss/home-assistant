const mqtt = require('mqtt');
const { log, logError } = require('./utils');

function buildBrokerUrl(host) {
    return /^[a-z]+:\/\//i.test(host) ? host : `mqtt://${host}`;
}

class MqttClient {
    constructor(config, onMessageCallback) {
        this.topicPrefix = config.topicPrefix;
        this.onMessageCallback = onMessageCallback;
        this.client = mqtt.connect(buildBrokerUrl(config.host), {
            port: config.port,
            clientId: `mqtt_client_${Math.random().toString(16).slice(2, 10)}`,
            username: config.username,
            password: config.password,
        });

        this.setupListeners();
    }

    setupListeners() {
        this.client.on('connect', () => {
            const topic = `${this.topicPrefix}/#`;

            log('MQTT 연결되었습니다.');
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
        this.client.end(force);
    }
}

module.exports = MqttClient;

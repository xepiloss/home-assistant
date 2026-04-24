const MqttClient = require('./mqttClient');
const Ew11Client = require('./ew11Client');
const CommandHandler = require('./commandHandler');
const { log, logError } = require('./utils');
const { loadConfig } = require('./config');
const { createTopicBuilder } = require('./topics');
const {
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMasterLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverOutlet,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverVentilation,
    analyzeParkingAreaAndCarNumber,
} = require('./deviceParser');
const { loadState, saveState } = require('./stateManager');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;

function publishAsync(mqttClient, topic, message, options) {
    return new Promise((resolve, reject) => {
        mqttClient.publish(topic, message, options, (err) => {
            if (err) {
                logError(`Failed to publish to ${topic}:`, err);
                reject(err);
                return;
            }

            resolve();
        });
    });
}

function collectPrimaryAvailabilityTopics(state, topics) {
    const availabilityTopics = [];

    state.discoveredOutlets.forEach((uniqueId) => {
        const deviceId = uniqueId.replace('commax_outlet_', '');
        availabilityTopics.push(
            topics.availability('outlet', deviceId),
            topics.availability('outlet', deviceId, 'standby_mode'),
            topics.availability('outlet', deviceId, 'standby_power'),
            topics.availability('outlet', deviceId, 'current_power')
        );
    });

    state.discoveredLights.forEach((uniqueId) => {
        const deviceId = uniqueId.replace('commax_light_', '');
        availabilityTopics.push(topics.availability('light', deviceId));
    });

    state.discoveredTemps.forEach((uniqueId) => {
        const deviceId = uniqueId.replace('commax_temp_', '');
        availabilityTopics.push(topics.availability('temp', deviceId));
    });

    state.discoveredFans.forEach((uniqueId) => {
        const deviceId = uniqueId.replace('commax_fan_', '');
        availabilityTopics.push(topics.availability('fan', deviceId));
    });

    state.discoveredMasterLights.forEach(() => {
        availabilityTopics.push(topics.availability('master_light'));
    });

    state.discoveredElevators.forEach((uniqueId) => {
        const deviceId = uniqueId.replace('commax_elevator_', '');
        availabilityTopics.push(topics.availability('elevator', deviceId));
    });

    if (state.parkingState.parkingDiscovered) {
        availabilityTopics.push(topics.availability('parking', 'area'));
    }

    if (state.parkingState.carNumberDiscovered) {
        availabilityTopics.push(topics.availability('parking', 'car_number'));
    }

    if (state.discoveredSensors.size > 0) {
        availabilityTopics.push(
            topics.availability('air_quality', 'co2'),
            topics.availability('air_quality', 'pm2_5'),
            topics.availability('air_quality', 'pm10')
        );
    }

    return availabilityTopics;
}

function collectMeteringAvailabilityTopics(state, topics) {
    if (state.discoveredMeters.size === 0) {
        return [];
    }

    return [
        topics.availability('smart_metering', 'water_meter'),
        topics.availability('smart_metering', 'water_acc_meter'),
        topics.availability('smart_metering', 'electric_meter'),
        topics.availability('smart_metering', 'electric_acc_meter'),
        topics.availability('smart_metering', 'warm_meter'),
        topics.availability('smart_metering', 'warm_acc_meter'),
        topics.availability('smart_metering', 'heat_meter'),
        topics.availability('smart_metering', 'heat_acc_meter'),
        topics.availability('smart_metering', 'gas_meter'),
        topics.availability('smart_metering', 'gas_acc_meter'),
        topics.availability('smart_metering', 'water_monthly_meter'),
        topics.availability('smart_metering', 'electric_monthly_meter'),
        topics.availability('smart_metering', 'warm_monthly_meter'),
        topics.availability('smart_metering', 'heat_monthly_meter'),
        topics.availability('smart_metering', 'gas_monthly_meter'),
    ];
}

async function publishAvailabilityTopics(mqttClient, topicsList, status, label) {
    if (!mqttClient || topicsList.length === 0) {
        return;
    }

    log(`${label} 상태를 ${status} 로 설정합니다.`);

    await Promise.all(
        topicsList.map((topic) => publishAsync(mqttClient, topic, status, { retain: true, qos: 1 }))
    );
}

function createAvailabilityController(state, mqttClient, topics) {
    return {
        setAllAvailable: () => publishAvailabilityTopics(
            mqttClient,
            [
                ...collectPrimaryAvailabilityTopics(state, topics),
                ...collectMeteringAvailabilityTopics(state, topics),
            ],
            'available',
            '전체 디바이스'
        ),
        setAllUnavailable: () => publishAvailabilityTopics(
            mqttClient,
            [
                ...collectPrimaryAvailabilityTopics(state, topics),
                ...collectMeteringAvailabilityTopics(state, topics),
            ],
            'unavailable',
            '전체 디바이스'
        ),
        setPrimaryAvailable: () => publishAvailabilityTopics(
            mqttClient,
            collectPrimaryAvailabilityTopics(state, topics),
            'available',
            '제어 디바이스'
        ),
        setPrimaryUnavailable: () => publishAvailabilityTopics(
            mqttClient,
            collectPrimaryAvailabilityTopics(state, topics),
            'unavailable',
            '제어 디바이스'
        ),
        setMeteringAvailable: () => publishAvailabilityTopics(
            mqttClient,
            collectMeteringAvailabilityTopics(state, topics),
            'available',
            '검침 센서'
        ),
        setMeteringUnavailable: () => publishAvailabilityTopics(
            mqttClient,
            collectMeteringAvailabilityTopics(state, topics),
            'unavailable',
            '검침 센서'
        ),
    };
}

function createPacketIntervalMonitor(commandHandler, getSocket) {
    let lastReceiveTime = null;
    let windowStartTime = null;
    let hasChecked = false;
    let intervalTimer = null;
    let intervals = [];

    function flushQueue() {
        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    }

    function recordPacket() {
        const currentTime = Date.now();

        if (!hasChecked && windowStartTime === null) {
            windowStartTime = currentTime;
            log('10초 동안 패킷 수신 간격을 수집합니다.');
        }

        if (!hasChecked && lastReceiveTime !== null) {
            intervals.push(currentTime - lastReceiveTime);
        }

        lastReceiveTime = currentTime;

        if (hasChecked || currentTime - windowStartTime < INTERVAL_WINDOW_MS) {
            return;
        }

        if (intervals.length === 0) {
            log('10초 동안 패킷이 수신되지 않았습니다. EW11 연결 상태를 확인하세요.');
            hasChecked = true;
            windowStartTime = null;
            return;
        }

        const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        log(`10초 패킷 수신 간격 평균: ${averageInterval.toFixed(2)}ms`);

        if (averageInterval >= THRESHOLD_INTERVAL_MS && !intervalTimer) {
            log(`10초 패킷 수신 간격 평균이 ${THRESHOLD_INTERVAL_MS}ms 이상이라 ${COMMAND_DRAIN_INTERVAL_MS}ms 주기 큐 배출을 시작합니다.`);
            intervalTimer = setInterval(flushQueue, COMMAND_DRAIN_INTERVAL_MS);
        }

        hasChecked = true;
        windowStartTime = null;
        intervals = [];
    }

    function stop() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
    }

    return {
        flushQueue,
        recordPacket,
        stop,
    };
}

function createPrimaryPacketHandler({ state, mqttClient, topics, commandHandler, saveCurrentState, packetMonitor, getSocket }) {
    return (bytes) => {
        packetMonitor.recordPacket();

        switch (bytes[0]) {
            case 0xF9:
            case 0xFA:
                analyzeAndDiscoverOutlet(bytes, state.discoveredOutlets, mqttClient, { saveState: saveCurrentState, topics });
                commandHandler.handleAckOrState(bytes);
                break;
            case 0xB0:
            case 0xB1:
                analyzeAndDiscoverLight(bytes, state.discoveredLights, mqttClient, { saveState: saveCurrentState, topics });
                commandHandler.handleAckOrState(bytes);
                break;
            case 0x2A:
            case 0x80:
                analyzeParkingAreaAndCarNumber(bytes, state.parkingState, mqttClient, { saveState: saveCurrentState, topics });
                break;
            case 0x82:
            case 0x84:
                analyzeAndDiscoverTemperature(bytes, state.discoveredTemps, mqttClient, { saveState: saveCurrentState, topics });
                commandHandler.handleAckOrState(bytes);
                break;
            case 0xF6:
            case 0xF8:
                analyzeAndDiscoverVentilation(bytes, state.discoveredFans, mqttClient, { saveState: saveCurrentState, topics });
                commandHandler.handleAckOrState(bytes);
                break;
            case 0xA0:
            case 0xA2:
                analyzeAndDiscoverMasterLight(bytes, state.discoveredMasterLights, mqttClient, { saveState: saveCurrentState, topics });
                commandHandler.handleAckOrState(bytes);
                break;
            case 0xC8:
                analyzeAndDiscoverAirQuality(bytes, state.discoveredSensors, mqttClient, { saveState: saveCurrentState, topics });
                break;
        }

        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    };
}

function createMeteringPacketHandler({ state, mqttClient, topics, saveCurrentState, monthlyUsageConfig }) {
    return (bytes) => {
        analyzeAndDiscoverMetering(bytes, state.discoveredMeters, mqttClient, {
            monthlyMeteringState: state.monthlyMeteringState,
            monthlyUsageConfig,
            saveState: saveCurrentState,
            topics,
        });
    };
}

function installShutdownHandlers({ mqttClient, primaryClient, meteringClient, availabilityController, saveCurrentState, packetMonitor }) {
    let isShuttingDown = false;

    async function runShutdownStep(label, action, errors) {
        try {
            await action();
        } catch (err) {
            errors.push(err);
            logError(`${label} 정리 중 오류:`, err);
        }
    }

    async function shutdown(signal) {
        if (isShuttingDown) {
            return;
        }

        isShuttingDown = true;
        log(`${signal} 수신. 종료 절차를 시작합니다.`);

        const errors = [];

        await runShutdownStep('패킷 모니터', () => packetMonitor.stop(), errors);
        await runShutdownStep('availability publish', () => availabilityController.setAllUnavailable(), errors);
        await runShutdownStep('상태 저장', saveCurrentState, errors);
        await runShutdownStep('MQTT 연결', () => mqttClient.end(), errors);
        await runShutdownStep('메인 EW11 연결', () => primaryClient.destroy(), errors);
        await runShutdownStep('검침 EW11 연결', () => meteringClient?.destroy(), errors);

        log('Connection closed');
        process.exit(errors.length > 0 ? 1 : 0);
    }

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

async function main() {
    log('애드온을 시작합니다.');

    const config = loadConfig();
    const topics = createTopicBuilder(config.mqtt.topicPrefix);
    const state = await loadState();
    const saveCurrentState = () => saveState(state);

    const commandHandler = new CommandHandler({ topicPrefix: config.mqtt.topicPrefix });

    let mqttClient;
    mqttClient = new MqttClient(config.mqtt, (topic, message) => {
        commandHandler.handleMessage(topic, message, mqttClient);
    });

    const availabilityController = createAvailabilityController(state, mqttClient, topics);

    let primaryClient;
    const packetMonitor = createPacketIntervalMonitor(commandHandler, () => primaryClient?.socket);

    primaryClient = new Ew11Client({
        name: '메인 EW11',
        host: config.ew11.host,
        port: config.ew11.port,
        onData: createPrimaryPacketHandler({
            state,
            mqttClient,
            topics,
            commandHandler,
            saveCurrentState,
            packetMonitor,
            getSocket: () => primaryClient?.socket,
        }),
        writeCommand: (command) => commandHandler.safeWrite(command, primaryClient?.socket),
        state,
        mqttClient,
        onAvailable: () => availabilityController.setPrimaryAvailable(),
        onUnavailable: () => availabilityController.setPrimaryUnavailable(),
    });

    let meteringClient = null;

    if (config.metering.host) {
        meteringClient = new Ew11Client({
            name: '검침 EW11',
            host: config.metering.host,
            port: config.metering.port,
            onData: createMeteringPacketHandler({
                state,
                mqttClient,
                topics,
                saveCurrentState,
                monthlyUsageConfig: config.monthlyMeteringUsageOverrides,
            }),
            writeCommand: (command) => commandHandler.safeWrite(command, meteringClient?.socket),
            state,
            mqttClient,
            onAvailable: () => availabilityController.setMeteringAvailable(),
            onUnavailable: () => availabilityController.setMeteringUnavailable(),
        });
    }

    await availabilityController.setAllAvailable();

    installShutdownHandlers({
        mqttClient,
        primaryClient,
        meteringClient,
        availabilityController,
        saveCurrentState,
        packetMonitor,
    });
}

main().catch((err) => {
    logError('Unhandled startup error:', err);
    process.exit(1);
});

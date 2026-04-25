const MqttClient = require('./mqttClient');
const Ew11Client = require('./ew11Client');
const CommandHandler = require('./commandHandler');
const { version: ADDON_VERSION } = require('../package.json');
const { isKnownIgnoredMeteringFrame, isKnownIgnoredPrimaryFrame, isKnownStablePrimaryFrame } = require('./knownPackets');
const { createPacketCapture } = require('./packetCapture');
const { METERING_PACKET_LENGTHS, PRIMARY_PACKET_LENGTHS } = require('./packetFramer');
const { log, logError } = require('./utils');
const { loadConfig } = require('./config');
const { createDiagnostics } = require('./diagnostics');
const { createTopicBuilder } = require('./topics');
const {
    analyzeAndDiscoverAirQuality,
    analyzeAndDiscoverElevator,
    analyzeAndDiscoverLifeInfo,
    analyzeAndDiscoverLifeInfoTemperature,
    analyzeAndDiscoverLight,
    analyzeAndDiscoverMasterLight,
    analyzeAndDiscoverMetering,
    analyzeAndDiscoverOutlet,
    analyzeAndDiscoverTemperature,
    analyzeAndDiscoverVentilation,
    analyzeAndDiscoverWallpadTime,
    analyzeParkingAreaAndCarNumber,
    clearElevatorDiscovery,
    clearElevatorFloorDiscovery,
    publishElevatorDiscovery,
} = require('./deviceParser');
const { loadState, saveState } = require('./stateManager');

const INTERVAL_WINDOW_MS = 10 * 1000;
const THRESHOLD_INTERVAL_MS = 100;
const COMMAND_DRAIN_INTERVAL_MS = 50;
const MONTHLY_USAGE_LABELS = Object.freeze({
    water_acc_meter: '수도',
    electric_acc_meter: '전기',
    warm_acc_meter: '온수',
    heat_acc_meter: '난방',
    gas_acc_meter: '가스',
});

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

function reportAsyncError(label, promise) {
    void promise.catch((err) => {
        logError(`${label} 실패:`, err);
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

    if (state.lifeInfoState?.wallpadTimeDiscovered) {
        availabilityTopics.push(topics.availability('life_info', 'wallpad_time'));
    }

    if (state.lifeInfoState?.lifeInfoTemperatureDiscovered) {
        availabilityTopics.push(topics.availability('life_info', 'temperature'));
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

function formatMonthlyUsageValue(sourceId, value) {
    return `${MONTHLY_USAGE_LABELS[sourceId] || sourceId}=${value}`;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getSystemDateInfo(date = new Date()) {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());

    return {
        dateText: `${year}-${month}-${day}`,
        period: `${year}-${month}`,
    };
}

function logMonthlyMeteringUsageConfig(monthlyUsageConfig, date = new Date()) {
    const configuredValues = Object.entries(monthlyUsageConfig?.values || {})
        .filter(([, value]) => value !== undefined);
    const systemDate = getSystemDateInfo(date);

    if (monthlyUsageConfig?.invalidPeriod) {
        log(`월간 검침 보정 월 무시: 입력값=${monthlyUsageConfig.invalidPeriod}, 허용 형식=YYYY-MM. 보정값은 적용하지 않고 자동 월초 누적 기준값을 사용합니다.`);
        return;
    }

    if (!monthlyUsageConfig?.period || configuredValues.length === 0) {
        log(`월간 검침 보정값 미입력: 시작일=${systemDate.dateText}, 시스템 기준 월=${systemDate.period}. 검침 패킷 수신 시 이번 달 첫 누적 검침값을 월초 누적 기준값으로 자동 사용합니다.`);
        return;
    }

    const valuesText = configuredValues
        .map(([sourceId, value]) => formatMonthlyUsageValue(sourceId, value))
        .join(', ');
    const usagePlan = monthlyUsageConfig.period === systemDate.period
        ? '현재 시스템 기준 월과 일치하므로 검침 패킷 수신 시 보정값을 적용합니다. 월패드 시간이 수신되면 월패드 기준 월로 다시 판단합니다.'
        : '현재 시스템 기준 월과 달라 우선 자동 기준값을 사용합니다. 월패드/시스템 기준 월이 보정 월과 일치할 때만 보정값을 적용합니다.';

    log(`월간 검침 보정값 입력 확인: 시작일=${systemDate.dateText}, 시스템 기준 월=${systemDate.period}, 보정 월=${monthlyUsageConfig.period}, 입력값=${valuesText}. ${usagePlan}`);
}

function logElevatorConfig(elevatorConfig, topicPrefix) {
    const invalidEntries = Object.entries(elevatorConfig?.invalid || {})
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`);

    if (invalidEntries.length > 0) {
        log(`엘리베이터 RS485 설정값 무시: ${invalidEntries.join(', ')}. 유효한 8바이트 checksum 프레임 또는 허용 모드(off/mqtt/rs485)만 사용합니다.`);
    }

    if (elevatorConfig?.mode === 'off') {
        log('엘리베이터 호출 모드: 비활성. Discovery 발행과 MQTT/RS485 호출 처리를 하지 않습니다.');
        return;
    }

    if (elevatorConfig?.mode === 'rs485') {
        log(`엘리베이터 호출 모드: RS485 직접 처리. 호출명령=${elevatorConfig.callCommand.hex || '미설정'}, 호출ON=${elevatorConfig.frames.callOn.hex || '미설정'}, 호출중=${elevatorConfig.frames.calling.hex || '미설정'}, 해제=${elevatorConfig.frames.released.hex || '미설정'}`);
        return;
    }

    log(`엘리베이터 호출 모드: MQTT 전달(SOAP 외부 애드온 처리). ${topicPrefix}/elevator/01/set 토픽은 유지하고 RS485 호출 명령은 보내지 않습니다.`);
}

function createPrimaryPacketHandler({ state, mqttClient, topics, commandHandler, saveCurrentState, packetMonitor, packetCapture, getSocket, elevatorConfig }) {
    return (bytes) => {
        packetMonitor.recordPacket();

        if (analyzeAndDiscoverElevator(bytes, state.discoveredElevators, mqttClient, {
            saveState: saveCurrentState,
            topics,
            elevator: elevatorConfig,
        })) {
            commandHandler.handleAckOrState(bytes);
            const socket = getSocket();
            if (socket) {
                commandHandler.dequeueAndWrite(socket);
            }
            return;
        }

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
            case 0x7F:
                if (!analyzeAndDiscoverWallpadTime(bytes, state.lifeInfoState, mqttClient, { saveState: saveCurrentState, topics })) {
                    packetCapture.record({
                        source: '메인 EW11',
                        kind: 'invalid_wallpad_time_frame',
                        bytes,
                        note: 'Wallpad time frame failed checksum or date validation.',
                    });
                }
                break;
            case 0x24: {
                const handled = analyzeAndDiscoverLifeInfoTemperature(bytes, state.lifeInfoState, mqttClient, { saveState: saveCurrentState, topics });
                packetCapture.record({
                    source: '메인 EW11',
                    kind: handled ? 'life_info_temperature_frame' : 'unhandled_frame',
                    bytes,
                    note: handled
                        ? 'Confirmed life information temperature frame recorded for unmapped bytes such as unknown_code.'
                        : 'Framed packet with a known length, but no parser handled it.',
                });
                break;
            }
            case 0x8F:
                if (analyzeAndDiscoverLifeInfo(bytes, state.lifeInfoState, mqttClient, { saveState: saveCurrentState, topics })) {
                    if (!isKnownStablePrimaryFrame(bytes)) {
                        packetCapture.record({
                            source: '메인 EW11',
                            kind: 'life_info_frame',
                            bytes,
                            note: 'Life information frame recorded for weather, temperature, and dust mapping.',
                        });
                    }
                } else {
                    packetCapture.record({
                        source: '메인 EW11',
                        kind: 'invalid_life_info_frame',
                        bytes,
                        note: 'Life information frame failed checksum validation.',
                    });
                }
                break;
            default:
                if (!isKnownIgnoredPrimaryFrame(bytes)) {
                    packetCapture.record({
                        source: '메인 EW11',
                        kind: 'unhandled_frame',
                        bytes,
                        note: 'Framed packet with a known length, but no parser handled it.',
                    });
                }
                break;
        }

        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    };
}

function createMeteringPacketHandler({ state, mqttClient, topics, saveCurrentState, monthlyUsageConfig, packetCapture }) {
    return (bytes) => {
        const handled = analyzeAndDiscoverMetering(bytes, state.discoveredMeters, mqttClient, {
            monthlyMeteringState: state.monthlyMeteringState,
            monthlyMeteringDate: state.lifeInfoState?.lastWallpadTime || new Date(),
            monthlyUsageConfig,
            saveState: saveCurrentState,
            topics,
        });

        if (!handled && !isKnownIgnoredMeteringFrame(bytes)) {
            packetCapture.record({
                source: '검침 EW11',
                kind: 'unhandled_metering_frame',
                bytes,
                note: 'Metering frame did not match the supported 32-byte usage packet.',
            });
        }
    };
}

function installShutdownHandlers({ mqttClient, primaryClient, meteringClient, availabilityController, diagnostics, saveCurrentState, packetMonitor, packetCapture }) {
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
        await runShutdownStep('알 수 없는 패킷 캡처', () => packetCapture.flush(), errors);
        await runShutdownStep('진단 상태 publish', () => diagnostics.setAllDisconnected(), errors);
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
    log(`Commax Wallpad Dev ${ADDON_VERSION} 애드온을 시작합니다.`);

    const config = loadConfig();
    logMonthlyMeteringUsageConfig(config.monthlyMeteringUsageOverrides);
    logElevatorConfig(config.elevator, config.mqtt.topicPrefix);
    const topics = createTopicBuilder(config.mqtt.topicPrefix);
    const state = await loadState();
    const saveCurrentState = () => saveState(state);
    const packetCapture = createPacketCapture({
        enabled: config.packetCapture.enabled,
        filePath: config.packetCapture.path,
    });

    const commandHandler = new CommandHandler({
        topicPrefix: config.mqtt.topicPrefix,
        elevator: config.elevator,
    });

    let mqttClient;
    mqttClient = new MqttClient(config.mqtt, (topic, message) => {
        commandHandler.handleMessage(topic, message, mqttClient);
    });

    if (config.elevator.mode === 'off') {
        clearElevatorDiscovery(state.discoveredElevators, mqttClient, {
            saveState: saveCurrentState,
            topics,
            elevator: config.elevator,
        });
    } else if (config.elevator.mode === 'mqtt') {
        publishElevatorDiscovery(state.discoveredElevators, mqttClient, {
            saveState: saveCurrentState,
            topics,
            elevator: config.elevator,
            initialStatus: 'OFF',
        });
    } else if (config.elevator.mode === 'rs485') {
        clearElevatorFloorDiscovery(state.discoveredElevators, mqttClient, {
            saveState: saveCurrentState,
            topics,
            elevator: config.elevator,
        });
    }

    const availabilityController = createAvailabilityController(state, mqttClient, topics);
    const diagnostics = createDiagnostics({
        mqttClient,
        topics,
        includeMetering: Boolean(config.metering.host),
    });
    reportAsyncError('진단 discovery 발행', diagnostics.publishDiscovery());

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
            packetCapture,
            getSocket: () => primaryClient?.socket,
            elevatorConfig: config.elevator,
        }),
        writeCommand: (command) => commandHandler.safeWrite(command, primaryClient?.socket),
        onUnknownPacket: (packet) => packetCapture.record(packet),
        onReceive: (receivedAt) => {
            reportAsyncError('메인 EW11 마지막 수신 시간 발행', diagnostics.recordEw11Receive('primary', receivedAt));
        },
        packetLengths: PRIMARY_PACKET_LENGTHS,
        state,
        mqttClient,
        onAvailable: () => Promise.all([
            diagnostics.setEw11Connected('primary', true),
            availabilityController.setPrimaryAvailable(),
        ]),
        onUnavailable: () => Promise.all([
            diagnostics.setEw11Connected('primary', false),
            availabilityController.setPrimaryUnavailable(),
        ]),
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
                packetCapture,
            }),
            writeCommand: (command) => commandHandler.safeWrite(command, meteringClient?.socket),
            onUnknownPacket: (packet) => packetCapture.record(packet),
            onReceive: (receivedAt) => {
                reportAsyncError('검침 EW11 마지막 수신 시간 발행', diagnostics.recordEw11Receive('metering', receivedAt));
            },
            packetLengths: METERING_PACKET_LENGTHS,
            state,
            mqttClient,
            onAvailable: () => Promise.all([
                diagnostics.setEw11Connected('metering', true),
                availabilityController.setMeteringAvailable(),
            ]),
            onUnavailable: () => Promise.all([
                diagnostics.setEw11Connected('metering', false),
                availabilityController.setMeteringUnavailable(),
            ]),
        });
    }

    await availabilityController.setAllAvailable();

    installShutdownHandlers({
        mqttClient,
        primaryClient,
        meteringClient,
        availabilityController,
        diagnostics,
        saveCurrentState,
        packetMonitor,
        packetCapture,
    });
}

main().catch((err) => {
    logError('Unhandled startup error:', err);
    process.exit(1);
});

const MqttClient = require('./mqttClient');
const Ew11Client = require('./ew11Client');
const CommandHandler = require('./commandHandler');
const { version: ADDON_VERSION } = require('../package.json');
const { createPacketCapture } = require('./packetCapture');
const { DEFAULT_PACKET_LENGTHS } = require('./packetFramer');
const { log, logError, formatBytes } = require('./utils');
const { loadConfig } = require('./config');
const { createDiagnostics } = require('./diagnostics');
const { createTopicBuilder } = require('./topics');
const { analyzeAndDiscoverClimate } = require('./deviceParser');
const { loadState, saveState } = require('./stateManager');
const { createStatusMonitor } = require('./statusMonitor');

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

function reportAsyncError(label, promise) {
    void promise.catch((err) => {
        logError(`${label} 실패:`, err);
    });
}

function collectClimateAvailabilityTopics(state, topics) {
    return Array.from(state.discoveredClimateUnits)
        .map((uniqueId) => uniqueId.replace('lg_aircon_', ''))
        .map((deviceId) => topics.availability('climate', deviceId));
}

function createAvailabilityController(state, mqttClient, topics) {
    async function setAll(status) {
        const availabilityTopics = collectClimateAvailabilityTopics(state, topics);
        if (availabilityTopics.length === 0) {
            return;
        }

        await Promise.all(
            availabilityTopics.map((topic) => publishAsync(mqttClient, topic, status, { retain: true, qos: 1 }))
        );
    }

    return {
        setAllAvailable: () => setAll('available'),
        setAllUnavailable: () => setAll('unavailable'),
    };
}

function createPoller({ commandHandler, indoorUnitIds, pollIntervalMs, pollSpacingMs }) {
    let pollTimer = null;

    function pollOnce() {
        indoorUnitIds.forEach((deviceId, index) => {
            setTimeout(() => {
                commandHandler.sendStatusRequest(deviceId);
            }, pollSpacingMs * index);
        });
    }

    function start() {
        if (pollTimer) {
            return;
        }

        pollOnce();
        pollTimer = setInterval(pollOnce, pollIntervalMs);
        log(`LG PI485 상태 폴링 시작: 실내기 ${indoorUnitIds.map((id) => String(id).padStart(2, '0')).join(', ')}, 주기 ${pollIntervalMs}ms`);
    }

    function stop() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    return {
        start,
        stop,
    };
}

function createDrainLoop({ commandHandler, getSocket, intervalMs }) {
    let timer = null;

    function flushQueue() {
        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    }

    function start() {
        if (!timer) {
            timer = setInterval(flushQueue, intervalMs);
        }
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    return { flushQueue, start, stop };
}

function createPacketHandler({ state, mqttClient, topics, commandHandler, saveCurrentState, packetCapture, getSocket, statusMonitor }) {
    return async (bytes) => {
        commandHandler.handleStatusPacket(bytes);

        try {
            const handled = await analyzeAndDiscoverClimate(bytes, state, mqttClient, {
                saveState: saveCurrentState,
                topics,
                supportedHvacModes: commandHandler.supportedHvacModes ? [...commandHandler.supportedHvacModes] : undefined,
                statusMonitor,
            });

            if (!handled) {
                packetCapture.record({
                    source: 'LG PI485 EW11',
                    kind: 'unhandled_frame',
                    bytes,
                    note: 'LG PI485 frame was received but no parser handled it.',
                });
            }
        } catch (err) {
            logError(`LG PI485 패킷 처리 실패: ${formatBytes(bytes)}`, err);
        }

        const socket = getSocket();
        if (socket) {
            commandHandler.dequeueAndWrite(socket);
        }
    };
}

function installShutdownHandlers({ mqttClient, ew11Client, availabilityController, diagnostics, saveCurrentState, poller, drainLoop, packetCapture }) {
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
        await runShutdownStep('상태 폴링', () => poller.stop(), errors);
        await runShutdownStep('큐 배출 루프', () => drainLoop.stop(), errors);
        await runShutdownStep('알 수 없는 패킷 캡처', () => packetCapture.flush(), errors);
        await runShutdownStep('진단 상태 publish', () => diagnostics.setAllDisconnected(), errors);
        await runShutdownStep('availability publish', () => availabilityController.setAllUnavailable(), errors);
        await runShutdownStep('상태 저장', saveCurrentState, errors);
        await runShutdownStep('MQTT 연결', () => mqttClient.end(), errors);
        await runShutdownStep('EW11 연결', () => ew11Client.destroy(), errors);

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
    log(`LG PI485 Air Conditioner ${ADDON_VERSION} 애드온을 시작합니다.`);

    const config = loadConfig();
    const topics = createTopicBuilder(config.mqtt.topicPrefix);
    const state = await loadState();
    const saveCurrentState = () => saveState(state);
    const packetCapture = createPacketCapture({
        enabled: config.packetCapture.enabled,
        filePath: config.packetCapture.path,
    });
    const statusMonitor = createStatusMonitor(config.monitor);

    const commandHandler = new CommandHandler({
        topicPrefix: config.mqtt.topicPrefix,
        supportedHvacModes: config.supportedHvacModes,
        protocolOptions: config.protocol,
        controlEnabled: config.controlEnabled,
        logStatusPolling: config.logStatusPolling,
    });

    let mqttClient;
    mqttClient = new MqttClient(config.mqtt, (topic, message) => {
        commandHandler.handleMessage(topic, message, mqttClient);
    });

    const availabilityController = createAvailabilityController(state, mqttClient, topics);
    const diagnostics = createDiagnostics({ mqttClient, topics });
    reportAsyncError('진단 discovery 발행', diagnostics.publishDiscovery());

    let ew11Client;
    const drainLoop = createDrainLoop({
        commandHandler,
        getSocket: () => ew11Client?.socket,
        intervalMs: config.commandDrainIntervalMs,
    });

    ew11Client = new Ew11Client({
        name: 'LG PI485 EW11',
        host: config.ew11.host,
        port: config.ew11.port,
        onData: createPacketHandler({
            state,
            mqttClient,
            topics,
            commandHandler,
            saveCurrentState,
            packetCapture,
            getSocket: () => ew11Client?.socket,
            statusMonitor,
        }),
        writeCommand: (command) => commandHandler.safeWrite(command, ew11Client?.socket),
        onUnknownPacket: (packet) => packetCapture.record(packet),
        onReceive: (receivedAt) => {
            reportAsyncError('LG PI485 EW11 마지막 수신 시간 발행', diagnostics.recordEw11Receive(receivedAt));
        },
        packetLengths: DEFAULT_PACKET_LENGTHS,
        state,
        mqttClient,
        onAvailable: () => Promise.all([
            diagnostics.setEw11Connected(true),
            availabilityController.setAllAvailable(),
        ]),
        onUnavailable: () => Promise.all([
            diagnostics.setEw11Connected(false),
            availabilityController.setAllUnavailable(),
        ]),
    });

    const poller = createPoller({
        commandHandler,
        indoorUnitIds: config.indoorUnitIds,
        pollIntervalMs: config.pollIntervalMs,
        pollSpacingMs: config.pollSpacingMs,
    });

    drainLoop.start();
    poller.start();
    await availabilityController.setAllAvailable();

    installShutdownHandlers({
        mqttClient,
        ew11Client,
        availabilityController,
        diagnostics,
        saveCurrentState,
        poller,
        drainLoop,
        packetCapture,
    });
}

main().catch((err) => {
    logError('Unhandled startup error:', err);
    process.exit(1);
});

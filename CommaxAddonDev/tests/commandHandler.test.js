const test = require('node:test');
const assert = require('node:assert/strict');

const CommandHandler = require('../src/commandHandler');
const {
    describeCommand,
    describeStateFrame,
    formatCommandLog,
    formatResponseTime,
    formatStateFrameLog,
    readRetryConfig,
    shouldLogMqttCommands,
} = CommandHandler;

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

function clearPendingTimers(handler) {
    for (const entry of handler.commandMetadata.values()) {
        clearTimeout(entry.timeout);
    }
}

test('sendCommand keeps duplicate commands as separate retry entries', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const command = handler.createOutletCommand('01', 0x01, 0x01);

    handler.sendCommand(command);
    handler.sendCommand(command);

    assert.equal(handler.commandMetadata.size, 2);

    clearPendingTimers(handler);
});

test('sendCommand starts retry timer only after the command is written', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const command = handler.createLightPacket('01', 0x01, 0);
    const socket = {
        destroyed: false,
        writable: true,
        writableNeedDrain: false,
        write() {},
    };

    handler.sendCommand(command);

    const [beforeWrite] = handler.commandMetadata.values();
    assert.equal(beforeWrite.timeout, null);
    assert.equal(beforeWrite.sentAt, null);

    handler.dequeueAndWrite(socket);

    const [afterWrite] = handler.commandMetadata.values();
    assert.equal(typeof afterWrite.sentAt, 'number');
    assert(afterWrite.timeout);

    clearPendingTimers(handler);
});

test('handleMessage publishes optimistic outlet state updates', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const mqttClient = createMqttStub();
    const sentCommands = [];

    handler.sendCommand = (command) => {
        sentCommands.push(command);
    };

    handler.handleMessage('devcommax/outlet/01/set', Buffer.from('ON'), mqttClient);

    assert.equal(sentCommands.length, 1);
    assert.equal(sentCommands[0].toString('hex'), handler.createOutletCommand('01', 0x01, 0x01).toString('hex'));
    assert.deepEqual(mqttClient.calls[0], {
        topic: 'devcommax/outlet/01/state',
        message: 'ON',
        options: { retain: true },
    });
});

test('handleMessage encodes temperature setpoint as BCD byte', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const mqttClient = createMqttStub();
    const sentCommands = [];

    handler.sendCommand = (command) => {
        sentCommands.push(command);
    };

    handler.handleMessage('devcommax/temp/01/set_temp', Buffer.from('24'), mqttClient);

    assert.equal(sentCommands.length, 1);
    assert.equal(sentCommands[0].toString('hex'), handler.createTemperatureCommand('01', 0x03, 0x24).toString('hex'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/temp/01/mode' && call.message === 'heat'));
    assert(mqttClient.calls.some((call) => call.topic === 'devcommax/temp/01/target_temp' && call.message === '24'));
});

test('shouldLogMqttCommands accepts common truthy values', () => {
    assert.equal(shouldLogMqttCommands({}), false);
    assert.equal(shouldLogMqttCommands({ COMMAX_LOG_MQTT_COMMANDS: 'false' }), false);
    assert.equal(shouldLogMqttCommands({ COMMAX_LOG_MQTT_COMMANDS: '1' }), true);
    assert.equal(shouldLogMqttCommands({ COMMAX_LOG_MQTT_COMMANDS: 'ON' }), true);
});

test('readRetryConfig uses env overrides and safe defaults', () => {
    assert.deepEqual(readRetryConfig({}), {
        maxRetries: 3,
        retryTimeoutMs: 400,
    });
    assert.deepEqual(readRetryConfig({ COMMAX_MAX_RETRIES: '5', COMMAX_RETRY_TIMEOUT_MS: '900' }), {
        maxRetries: 5,
        retryTimeoutMs: 900,
    });
    assert.deepEqual(readRetryConfig({ COMMAX_MAX_RETRIES: '-1', COMMAX_RETRY_TIMEOUT_MS: 'abc' }), {
        maxRetries: 3,
        retryTimeoutMs: 400,
    });
});

test('formatCommandLog adds device and command descriptions', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });

    assert.equal(describeCommand(handler.createLightPacket('01', 0x03, 4)), '조명 01 밝기 4');
    assert.equal(formatCommandLog(handler.createLightPacket('01', 0x01, 0)), '31 01 01 00 00 00 00 33 (조명 01 전원 ON)');
    assert.equal(formatCommandLog(handler.createOutletCommand('02', 0x01, 0x00)), '7A 02 01 00 00 00 00 7D (대기전력 02 전원 OFF)');
});

test('formatStateFrameLog adds device and state descriptions', () => {
    const lightFrame = [0xB1, 0x01, 0x01, 0x00, 0x00, 0x04, 0x05, 0xBC];
    const lightOffFrame = [0xB1, 0x00, 0x04, 0x00, 0x00, 0x00, 0x05, 0xBA];
    const nonDimmableLightFrame = [0xB1, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0xB4];
    const outletFrame = [0xF9, 0x11, 0x02, 0x10, 0x00, 0x00, 0x07, 0x00];

    assert.equal(describeStateFrame(lightFrame), '조명 01 상태 ON 밝기 4');
    assert.equal(describeStateFrame(lightOffFrame), '조명 04 상태 OFF');
    assert.equal(describeStateFrame(nonDimmableLightFrame), '조명 02 상태 ON');
    assert.equal(formatStateFrameLog(outletFrame), 'F9 11 02 10 00 00 07 00 (대기전력 02 상태 ON AUTO 전력 7W)');
});

test('formatResponseTime reports elapsed milliseconds from actual send', () => {
    assert.equal(formatResponseTime({ sentAt: 1000 }, 1067), '응답 67ms');
    assert.equal(formatResponseTime({ sentAt: null }, 1067), '응답시간 알 수 없음');
});

test('handleMessage logs command topics when enabled', () => {
    const logs = [];
    const handler = new CommandHandler({
        topicPrefix: 'devcommax',
        env: { COMMAX_LOG_MQTT_COMMANDS: 'true' },
        logger: (message) => logs.push(message),
    });
    const mqttClient = createMqttStub();

    handler.sendCommand = () => undefined;

    handler.handleMessage('devcommax/light/01/brightness/set', Buffer.from('4'), mqttClient);

    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[MQTT CMD \+\d+ms\] devcommax\/light\/01\/brightness\/set <= 4$/);
});

test('rapid light state changes keep only the latest queued command', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const mqttClient = createMqttStub();
    const socket = {
        destroyed: false,
        writable: true,
        writableNeedDrain: false,
        writes: [],
        write(command) {
            this.writes.push(command);
        },
    };

    handler.handleMessage('devcommax/light/01/set', Buffer.from('OFF'), mqttClient);
    handler.handleMessage('devcommax/light/01/set', Buffer.from('ON'), mqttClient);

    assert.equal(handler.commandMetadata.size, 1);

    handler.dequeueAndWrite(socket);

    assert.equal(socket.writes.length, 1);
    assert.equal(socket.writes[0].toString('hex'), handler.createLightPacket('01', 0x01, 0).toString('hex'));

    clearPendingTimers(handler);
});

test('brightness command suppresses the following ON while brightness is pending', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const mqttClient = createMqttStub();
    const socket = {
        destroyed: false,
        writable: true,
        writableNeedDrain: false,
        writes: [],
        write(command) {
            this.writes.push(command);
        },
    };

    handler.handleMessage('devcommax/light/01/brightness/set', Buffer.from('4'), mqttClient);
    handler.handleMessage('devcommax/light/01/set', Buffer.from('ON'), mqttClient);

    assert.equal(handler.commandMetadata.size, 1);

    handler.dequeueAndWrite(socket);

    assert.equal(socket.writes.length, 1);
    assert.equal(socket.writes[0].toString('hex'), handler.createLightPacket('01', 0x03, 4).toString('hex'));

    clearPendingTimers(handler);
});

test('rapid outlet state changes keep only the latest queued command', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const mqttClient = createMqttStub();
    const socket = {
        destroyed: false,
        writable: true,
        writableNeedDrain: false,
        writes: [],
        write(command) {
            this.writes.push(command);
        },
    };

    handler.handleMessage('devcommax/outlet/01/set', Buffer.from('OFF'), mqttClient);
    handler.handleMessage('devcommax/outlet/01/set', Buffer.from('ON'), mqttClient);

    assert.equal(handler.commandMetadata.size, 1);

    handler.dequeueAndWrite(socket);

    assert.equal(socket.writes.length, 1);
    assert.equal(socket.writes[0].toString('hex'), handler.createOutletCommand('01', 0x01, 0x01).toString('hex'));

    clearPendingTimers(handler);
});

test('handleAckOrState matches light ACK to the command state', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const turnOn = handler.createLightPacket('01', 0x01, 0);
    const turnOff = handler.createLightPacket('01', 0x00, 0);

    handler.sendCommand(turnOn);
    handler.sendCommand(turnOff);

    handler.handleAckOrState([0xB1, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x00]);

    assert.equal(handler.commandMetadata.size, 1);
    assert.equal([...handler.commandMetadata.values()][0].command.toString('hex'), turnOn.toString('hex'));

    clearPendingTimers(handler);
});

test('safeWrite records sentAt for ACK latency logging', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const command = handler.createLightPacket('01', 0x01, 0);
    const socket = {
        destroyed: false,
        writable: true,
        writableNeedDrain: false,
        write() {},
    };

    handler.sendCommand(command);
    handler.dequeueAndWrite(socket);

    const [entry] = handler.commandMetadata.values();
    assert.equal(typeof entry.sentAt, 'number');

    clearPendingTimers(handler);
});

test('handleAckOrState keeps pending temperature command when target differs', () => {
    const handler = new CommandHandler({ topicPrefix: 'devcommax' });
    const command = handler.createTemperatureCommand('01', 0x03, 0x24);

    handler.sendCommand(command);
    handler.handleAckOrState([0x82, 0x81, 0x01, 0x23, 0x22, 0x00, 0x00, 0x00]);

    assert.equal(handler.commandMetadata.size, 1);

    clearPendingTimers(handler);
});

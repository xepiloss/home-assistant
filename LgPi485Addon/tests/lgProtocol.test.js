const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateChecksum,
} = require('../src/utils');
const {
    createControlPacket,
    createStatusRequest,
    encodeModeByte,
    parseStatusPacket,
} = require('../src/lgProtocol');
const {
    PacketFramer,
} = require('../src/packetFramer');
const {
    normalizeState,
    serializeState,
} = require('../src/stateManager');
const CommandHandler = require('../src/commandHandler');
const {
    diffSummary,
    summarize,
} = require('../src/statusMonitor');
const {
    createDiagnostics,
} = require('../src/diagnostics');
const {
    normalizeConfig,
} = require('../src/config');
const PriorityQueue = require('../src/priorityQueue');

test('checksum matches LG PI485 alternating-bit complement formula', () => {
    const bytes = [0x80, 0x00, 0xA3, 0x00, 0x00, 0x48, 0x09];
    const sum = bytes.reduce((total, byte) => total + byte, 0) & 0xFF;
    const templateFormula = (sum & 0xAA) + 0x55 - (sum & 0x55);

    assert.equal(calculateChecksum(bytes), templateFormula);
});

test('creates status request packet with current desired state bytes', () => {
    const packet = createStatusRequest(0, {
        targetTemperature: 24,
        hvacMode: 'cool',
        fanMode: 'auto',
        swingMode: 'auto',
    });

    assert.deepEqual([...packet.slice(0, 7)], [0x80, 0x00, 0xA3, 0x00, 0x00, 0x48, 0x09]);
    assert.equal(packet[7], calculateChecksum(packet.slice(0, 7)));
});

test('creates turn on control packet', () => {
    const packet = createControlPacket(2, 'turn_on', {
        targetTemperature: 18,
        hvacMode: 'cool',
        fanMode: 'power',
        swingMode: 'auto',
        locked: false,
    });

    assert.deepEqual([...packet.slice(0, 7)], [0x80, 0x00, 0xA3, 0x02, 0x03, 0x68, 0x03]);
    assert.equal(packet[7], calculateChecksum(packet.slice(0, 7)));
});

test('turn on and off controls do not preserve lock bit implicitly', () => {
    const turnOn = createControlPacket(3, 'turn_on', {
        targetTemperature: 27,
        hvacMode: 'fan_only',
        fanMode: 'high',
        swingMode: 'auto',
        locked: true,
    });
    const turnOff = createControlPacket(3, 'turn_off', {
        targetTemperature: 27,
        hvacMode: 'fan_only',
        fanMode: 'high',
        swingMode: 'auto',
        locked: true,
    });

    assert.equal(turnOn[4], 0x03);
    assert.equal(turnOff[4], 0x02);
});

test('does not write a second request while a command is in flight', () => {
    const handler = new CommandHandler({ topicPrefix: 'devlg', logger: () => undefined });
    const writes = [];
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: (command) => writes.push([...command]),
    };

    handler.sendStatusRequest(1);
    handler.sendStatusRequest(2);
    handler.dequeueAndWrite(socket);
    handler.dequeueAndWrite(socket);

    assert.equal(writes.length, 1);

    for (const commandId of handler.commandMetadata.keys()) {
        handler.removeCommand(commandId);
    }
});

test('prioritizes control commands and pauses queued status polling', () => {
    const handler = new CommandHandler({ topicPrefix: 'devlg', logger: () => undefined });
    const writes = [];
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: (command) => writes.push([...command]),
    };

    try {
        handler.sendStatusRequest(3);
        handler.sendControl(3, 'turn_on', {
            hvacMode: 'fan_only',
            fanMode: 'high',
            swingMode: 'fix',
            targetTemperature: 27,
            isOn: true,
        });
        handler.sendStatusRequest(1);
        handler.dequeueAndWrite(socket);

        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].slice(0, 7), [0x80, 0x00, 0xA3, 0x03, 0x03, 0x32, 0x0C]);
    } finally {
        for (const commandId of handler.commandMetadata.keys()) {
            handler.removeCommand(commandId);
        }
    }
});

test('does not log status polling by default', () => {
    const logs = [];
    const handler = new CommandHandler({ topicPrefix: 'devlg', logger: (message) => logs.push(message) });
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: () => undefined,
    };

    try {
        handler.sendStatusRequest(3);
        handler.dequeueAndWrite(socket);
        handler.handleStatusPacket([
            0x10, 0x83, 0xA3, 0x30,
            0x03, 0x00, 0x30, 0x4C,
            0x6F, 0x70, 0x71, 0x28,
            0x00, 0x05, 0x23, 0xD0,
        ]);

        assert.deepEqual(logs, []);
    } finally {
        for (const commandId of handler.commandMetadata.keys()) {
            handler.removeCommand(commandId);
        }
    }
});

test('logs control commands while status polling logs are disabled', () => {
    const logs = [];
    const handler = new CommandHandler({ topicPrefix: 'devlg', logger: (message) => logs.push(message) });
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: () => undefined,
    };

    try {
        handler.sendControl(3, 'turn_on', {
            hvacMode: 'fan_only',
            fanMode: 'high',
            swingMode: 'fix',
            targetTemperature: 27,
            isOn: true,
        });
        handler.dequeueAndWrite(socket);
        handler.handleStatusPacket([
            0x10, 0x83, 0xA3, 0x30,
            0x03, 0x00, 0x30, 0x4C,
            0x6F, 0x70, 0x71, 0x28,
            0x00, 0x05, 0x23, 0xD0,
        ]);

        assert.equal(logs.length, 2);
        assert.match(logs[0], /제어 요청 03/);
        assert.match(logs[1], /03 상태 수신/);
    } finally {
        for (const commandId of handler.commandMetadata.keys()) {
            handler.removeCommand(commandId);
        }
    }
});

test('logs status polling when explicitly enabled', () => {
    const logs = [];
    const handler = new CommandHandler({
        topicPrefix: 'devlg',
        logStatusPolling: true,
        logger: (message) => logs.push(message),
    });
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: () => undefined,
    };

    try {
        handler.sendStatusRequest(3);
        handler.dequeueAndWrite(socket);
        handler.handleStatusPacket([
            0x10, 0x83, 0xA3, 0x30,
            0x03, 0x00, 0x30, 0x4C,
            0x6F, 0x70, 0x71, 0x28,
            0x00, 0x05, 0x23, 0xD0,
        ]);

        assert.equal(logs.length, 2);
        assert.match(logs[0], /상태 요청 03/);
        assert.match(logs[1], /03 상태 수신/);
    } finally {
        for (const commandId of handler.commandMetadata.keys()) {
            handler.removeCommand(commandId);
        }
    }
});

test('priority queue keeps FIFO order for equal priority', () => {
    const queue = new PriorityQueue();

    ['01', '02', '03', '04'].forEach((deviceId) => queue.enqueue(deviceId, 1));

    assert.deepEqual([
        queue.dequeue().value,
        queue.dequeue().value,
        queue.dequeue().value,
        queue.dequeue().value,
    ], ['01', '02', '03', '04']);
});

test('preserves control priority when socket is temporarily unavailable', () => {
    const handler = new CommandHandler({ topicPrefix: 'devlg', logger: () => undefined });
    const writes = [];
    const socket = {
        destroyed: false,
        writableNeedDrain: false,
        write: (command) => writes.push([...command]),
    };

    try {
        handler.sendStatusRequest(1);
        handler.sendControl(3, 'turn_on', {
            hvacMode: 'fan_only',
            fanMode: 'high',
            swingMode: 'fix',
            targetTemperature: 27,
            isOn: true,
        });

        handler.dequeueAndWrite(null);
        handler.dequeueAndWrite(socket);

        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].slice(0, 7), [0x80, 0x00, 0xA3, 0x03, 0x03, 0x32, 0x0C]);
    } finally {
        for (const commandId of handler.commandMetadata.keys()) {
            handler.removeCommand(commandId);
        }
    }
});

test('encodes mode byte from hvac, fan, and swing modes', () => {
    assert.equal(encodeModeByte({ hvacMode: 'dry', fanMode: 'low', swingMode: 'fix' }), 0x11);
    assert.equal(encodeModeByte({ hvacMode: 'heat', fanMode: 'auto', swingMode: 'auto' }), 0x4C);
});

test('parses 16 byte state packet using config template offsets', () => {
    const packet = [
        0x10, 0x03, 0xA3, 0x00,
        0x02, 0x00, 0x48, 0x09,
        0x78, 0x76, 0x75, 0x50,
        0x00, 0x0C, 0x1E, 0xB3,
    ];

    const parsed = parseStatusPacket(packet);

    assert.equal(parsed.deviceId, '02');
    assert.equal(parsed.isOn, true);
    assert.equal(parsed.locked, false);
    assert.equal(parsed.hvacMode, 'cool');
    assert.equal(parsed.fanMode, 'auto');
    assert.equal(parsed.swingMode, 'auto');
    assert.equal(parsed.targetTemperature, 24);
    assert.equal(parsed.currentTemperature, 24);
    assert.equal(parsed.pipeTemperature1, 24.7);
    assert.equal(parsed.pipeTemperature2, 25);
    assert.equal(parsed.zoneActiveLoad, 80);
    assert.equal(parsed.zonePowerState, 0);
    assert.equal(parsed.zoneDesignLoad, 12);
    assert.equal(parsed.oduTotalLoad, 30);
});

test('parses captured LGAP response frame', () => {
    const packet = [
        0x10, 0x83, 0xA3, 0x30,
        0x03, 0x00, 0x30, 0x4C,
        0x6F, 0x70, 0x71, 0x28,
        0x00, 0x05, 0x23, 0xD0,
    ];

    const parsed = parseStatusPacket(packet, { supportedHvacModes: ['off', 'cool', 'fan_only', 'dry', 'auto'] });

    assert.equal(parsed.deviceId, '03');
    assert.equal(parsed.isOn, true);
    assert.equal(parsed.locked, false);
    assert.equal(parsed.hvacMode, 'cool');
    assert.equal(parsed.fanMode, 'high');
    assert.equal(parsed.swingMode, 'fix');
    assert.equal(parsed.targetTemperature, 27);
    assert.equal(parsed.currentTemperature, 27);
    assert.equal(parsed.pipeTemperature1, 26.7);
    assert.equal(parsed.pipeTemperature2, 26.3);
    assert.equal(parsed.zoneActiveLoad, 40);
    assert.equal(parsed.zoneDesignLoad, 5);
    assert.equal(parsed.oduTotalLoad, 35);
});

test('rejects response frames with bad checksum', () => {
    const packet = [
        0x10, 0x02, 0xA0, 0x40,
        0x00, 0x00, 0x10, 0x48,
        0x79, 0x7F, 0x7F, 0x28,
        0x00, 0x18, 0x33, 0x00,
    ];

    assert.equal(parseStatusPacket(packet), null);
});

test('frames split LGAP responses by header and checksum', () => {
    const framer = new PacketFramer();
    const first = Buffer.from([0x10, 0x02, 0xA0, 0x40, 0x00]);
    const second = Buffer.from([0x00, 0x10, 0x48, 0x79, 0x7F, 0x7F, 0x28, 0x00, 0x18, 0x33, 0x61]);

    assert.deepEqual(framer.push(first), { frames: [], dropped: [] });
    assert.deepEqual(framer.push(second), {
        frames: [[
            0x10, 0x02, 0xA0, 0x40,
            0x00, 0x00, 0x10, 0x48,
            0x79, 0x7F, 0x7F, 0x28,
            0x00, 0x18, 0x33, 0x61,
        ]],
        dropped: [],
    });
});

test('does not persist per-process discovery publish markers', () => {
    const state = normalizeState({
        discoveredClimateUnits: ['lg_aircon_01'],
        climateStates: { '01': { hvacMode: 'cool' } },
    });

    state.discoveryPublishedThisRun.add('lg_aircon_01');

    assert.deepEqual(serializeState(state), {
        discoveredClimateUnits: ['lg_aircon_01'],
        climateStates: { '01': { hvacMode: 'cool' } },
    });
    assert.deepEqual([...normalizeState(serializeState(state)).discoveryPublishedThisRun], []);
});

test('summarizes target temperature raw byte changes for monitoring', () => {
    const parsed24 = parseStatusPacket([
        0x10, 0x03, 0xA3, 0x00,
        0x03, 0x00, 0x48, 0x09,
        0x78, 0x76, 0x75, 0x50,
        0x00, 0x0C, 0x1E, 0xB2,
    ]);
    const parsed27 = parseStatusPacket([
        0x10, 0x03, 0xA3, 0x00,
        0x03, 0x00, 0x32, 0x0C,
        0x6F, 0x71, 0x72, 0x28,
        0x00, 0x05, 0x23, 0xCC,
    ]);

    const summary24 = summarize(parsed24);
    const summary27 = summarize(parsed27);

    assert.equal(summary24.targetByte, 0x09);
    assert.equal(summary24.targetLowNibble, 9);
    assert.equal(summary24.decodedTarget, 24);
    assert.equal(summary27.targetByte, 0x0C);
    assert.equal(summary27.targetLowNibble, 12);
    assert.match(diffSummary(summary24, summary27), /targetByte:9->12/);
});

test('keeps EW11 last received diagnostic disabled by default', () => {
    const diagnostics = createDiagnostics({
        mqttClient: { publish: () => undefined },
        topics: {
            path: (...parts) => parts.join('/'),
        },
    });

    const lastReceived = diagnostics.buildDiscoveryConfigs()
        .find((config) => config.uniqueId === 'lg_pi485_ew11_last_received');

    assert.equal(lastReceived.payload.enabled_by_default, false);
});

test('uses responsive but conservative default polling cadence', () => {
    const config = normalizeConfig({});

    assert.equal(config.pollIntervalMs, 2000);
    assert.equal(config.pollSpacingMs, 150);
});

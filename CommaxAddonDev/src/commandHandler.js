const { log, logError } = require('./utils');
const PriorityQueue = require('./priorityQueue');
const { calculateChecksum } = require('./deviceParser');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_TIMEOUT_MS = 400;
const SUPPORTED_TOPIC_ACTIONS = new Set(['set', 'call', 'set_mode', 'set_temp', 'set_speed']);
const DEVICE_ID_PREFIX_PATTERN = /^(outlet_|light_|temp_|elevator_)/;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function shouldLogMqttCommands(env = process.env) {
    return TRUE_VALUES.has(String(env.COMMAX_LOG_MQTT_COMMANDS || '').toLowerCase());
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRetryConfig(env = process.env) {
    return {
        maxRetries: parsePositiveInteger(env.COMMAX_MAX_RETRIES, DEFAULT_MAX_RETRIES),
        retryTimeoutMs: parsePositiveInteger(env.COMMAX_RETRY_TIMEOUT_MS, DEFAULT_RETRY_TIMEOUT_MS),
    };
}

function formatHex(bufferOrBytes) {
    return [...bufferOrBytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
}

function toBuffer(frame) {
    if (!frame) {
        return null;
    }

    if (Buffer.isBuffer(frame)) {
        return Buffer.from(frame);
    }

    if (Array.isArray(frame)) {
        return Buffer.from(frame);
    }

    if (Array.isArray(frame.bytes)) {
        return Buffer.from(frame.bytes);
    }

    return null;
}

function toHexKey(bufferOrBytes) {
    return Buffer.from(bufferOrBytes).toString('hex');
}

function encodeDecimalDigitsToByte(value) {
    return Number.parseInt(String(value), 16);
}

function decodeBcdNumber(bytes) {
    return Number.parseInt(
        bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        10
    );
}

function byteToHex(byte) {
    return byte.toString(16).padStart(2, '0');
}

function formatWithDescription(bytes, description) {
    const hex = formatHex(bytes);
    return description ? `${hex} (${description})` : hex;
}

function describeOutletState(stateByte) {
    const power = (stateByte & 0x01) === 1 ? 'ON' : 'OFF';
    const mode = (stateByte & 0x10) === 0x10 ? 'AUTO' : 'MANUAL';
    return `${power} ${mode}`;
}

function describeFanMode(modeByte) {
    switch (modeByte) {
        case 0x00:
            return 'OFF';
        case 0x01:
        case 0x02:
            return 'AUTO';
        case 0x04:
            return 'ON';
        case 0x07:
            return 'BYPASS';
        default:
            return `모드 ${byteToHex(modeByte)}`;
    }
}

function describeCommand(command) {
    const deviceId = byteToHex(command[1]);

    switch (command[0]) {
        case 0x7A:
            if (command[2] === 0x01) {
                return `대기전력 ${deviceId} 전원 ${command[3] ? 'ON' : 'OFF'}`;
            }
            if (command[2] === 0x02) {
                return `대기전력 ${deviceId} 모드 ${command[3] ? 'AUTO' : 'MANUAL'}`;
            }
            if (command[2] === 0x03) {
                return `대기전력 ${deviceId} 차단값 ${command[4]}W`;
            }
            return `대기전력 ${deviceId} 명령 ${byteToHex(command[2])}`;
        case 0x31:
            if (command[2] === 0x03) {
                return `조명 ${deviceId} 밝기 ${command[6]}`;
            }
            return `조명 ${deviceId} 전원 ${command[2] ? 'ON' : 'OFF'}`;
        case 0x04:
            if (command[2] === 0x03) {
                return `난방 ${deviceId} 목표온도 ${byteToHex(command[3])}`;
            }
            if (command[2] === 0x04) {
                return `난방 ${deviceId} 모드 ${command[3] === 0x00 ? 'OFF' : 'HEAT'}`;
            }
            return `난방 ${deviceId} 명령 ${byteToHex(command[2])}`;
        case 0x78:
            if (command[2] === 0x02) {
                return `환기 ${deviceId} 풍량 ${command[3]}`;
            }
            return `환기 ${deviceId} ${describeFanMode(command[3])}`;
        case 0x22:
            return `일괄소등 전원 ${command[2] ? 'ON' : 'OFF'}`;
        case 0xA0:
            return `엘리베이터 ${deviceId} 호출`;
        default:
            return '';
    }
}

function describeStateFrame(bytes) {
    switch (bytes[0]) {
        case 0xF9:
        case 0xFA:
            return `대기전력 ${byteToHex(bytes[2])} 상태 ${describeOutletState(bytes[1])} 전력 ${decodeBcdNumber([bytes[5], bytes[6]])}W`;
        case 0xB0:
        case 0xB1:
            return bytes[1] !== 0x00 && bytes[6] === 0x05
                ? `조명 ${byteToHex(bytes[2])} 상태 ${bytes[1] ? 'ON' : 'OFF'} 밝기 ${bytes[5]}`
                : `조명 ${byteToHex(bytes[2])} 상태 ${bytes[1] ? 'ON' : 'OFF'}`;
        case 0x82:
        case 0x84:
            return `난방 ${byteToHex(bytes[2])} 상태 ${byteToHex(bytes[1])} 현재 ${byteToHex(bytes[3])} 목표 ${byteToHex(bytes[4])}`;
        case 0xF6:
        case 0xF8:
            return `환기 ${byteToHex(bytes[2])} ${describeFanMode(bytes[1])} 풍량 ${bytes[3]}`;
        case 0xA0:
        case 0xA2:
            return `일괄소등 상태 ${bytes[1] ? 'ON' : 'OFF'}`;
        case 0x26:
            return `엘리베이터 ${byteToHex(bytes[2])} 상태 ${byteToHex(bytes[3])}`;
        default:
            return '';
    }
}

function formatCommandLog(command) {
    return formatWithDescription(command, describeCommand(command));
}

function formatStateFrameLog(bytes) {
    return formatWithDescription(bytes, describeStateFrame(bytes));
}

function formatResponseTime(commandEntry, now = Date.now()) {
    return commandEntry.sentAt ? `응답 ${now - commandEntry.sentAt}ms` : '응답시간 알 수 없음';
}

class CommandHandler {
    constructor({ topicPrefix, env = process.env, logger = log, elevator = {} }) {
        this.topicPrefix = topicPrefix;
        this.priorityQueue = new PriorityQueue();
        this.lastMqttCommandAt = 0;
        this.logMqttCommands = shouldLogMqttCommands(env);
        this.retryConfig = readRetryConfig(env);
        this.logger = logger;
        this.elevator = this.normalizeElevatorConfig(elevator);
        this.commandMetadata = new Map();
        this.deferredCommands = new Map();
        this.nextCommandId = 1;
    }

    normalizeElevatorConfig(elevator = {}) {
        const frames = {
            callOn: toBuffer(elevator.frames?.callOn),
            calling: toBuffer(elevator.frames?.calling),
            released: toBuffer(elevator.frames?.released),
        };

        return {
            mode: ['off', 'rs485'].includes(elevator.mode) ? elevator.mode : 'mqtt',
            deviceId: elevator.deviceId || '01',
            callCommand: toBuffer(elevator.callCommand),
            frames,
            frameKeys: {
                callOn: frames.callOn ? toHexKey(frames.callOn) : '',
                calling: frames.calling ? toHexKey(frames.calling) : '',
                released: frames.released ? toHexKey(frames.released) : '',
            },
        };
    }

    safeWrite(command, socket) {
        if (!socket || socket.destroyed || !socket.writable) {
            log('Socket is not connected. Command not sent.');
            return;
        }

        if (socket.writableNeedDrain) {
            this.priorityQueue.enqueue(command, 1);
            return;
        }

        socket.write(command);
        this.markCommandSent(command, true);
        log(`-> ${formatCommandLog(command)}`);
    }

    createCommandEntry(command, priority, options = {}) {
        return {
            id: this.nextCommandId++,
            command,
            priority,
            retries: 0,
            deviceType: options.deviceType || this.getDeviceTypeFromCommand(command),
            deviceId: options.deviceId || command[1].toString(16).padStart(2, '0'),
            hexKey: command.toString('hex'),
            supersedeKey: options.supersedeKey || null,
            sentAt: null,
            timeout: null,
        };
    }

    sendCommand(command, priority = 1, options = {}) {
        const commandEntry = this.createCommandEntry(command, priority, options);

        if (commandEntry.supersedeKey) {
            const inFlightCommand = this.findInFlightBySupersedeKey(commandEntry.supersedeKey);
            if (inFlightCommand) {
                if (inFlightCommand.hexKey === commandEntry.hexKey) {
                    this.deferredCommands.delete(commandEntry.supersedeKey);
                    return;
                }

                this.deferredCommands.set(commandEntry.supersedeKey, {
                    command,
                    priority,
                    options: { ...options },
                });
                log(`${formatCommandLog(command)} 명령 보류 (${commandEntry.supersedeKey} ACK 대기 중)`);
                return;
            }
        }

        this.enqueueCommandEntry(commandEntry);
    }

    enqueueCommandEntry(commandEntry) {
        if (commandEntry.supersedeKey) {
            this.deferredCommands.delete(commandEntry.supersedeKey);
            this.removePendingBySupersedeKey(commandEntry.supersedeKey);
        }

        this.priorityQueue.enqueue(commandEntry.command, commandEntry.priority);
        this.commandMetadata.set(commandEntry.id, commandEntry);
    }

    startRetryTimer(commandEntry) {
        clearTimeout(commandEntry.timeout);
        commandEntry.timeout = setTimeout(() => {
            this.retryCommand(commandEntry.id);
        }, this.retryConfig.retryTimeoutMs);
    }

    retryCommand(commandId) {
        const commandEntry = this.commandMetadata.get(commandId);
        if (!commandEntry) {
            return;
        }

        if (commandEntry.retries >= this.retryConfig.maxRetries) {
            logError(`${formatCommandLog(commandEntry.command)} 명령 재전송 실패 한도 도달 (${this.retryConfig.maxRetries})`);
            this.removeCommand(commandId);
            return;
        }

        commandEntry.retries += 1;
        log(`${formatCommandLog(commandEntry.command)} 명령 재전송 예약 (${commandEntry.retries}/${this.retryConfig.maxRetries})`);
        this.priorityQueue.enqueue(commandEntry.command, commandEntry.priority);
    }

    removeCommand(commandId) {
        const commandEntry = this.commandMetadata.get(commandId);
        if (!commandEntry) {
            return;
        }

        clearTimeout(commandEntry.timeout);
        this.commandMetadata.delete(commandId);
        this.enqueueDeferredCommand(commandEntry);
    }

    removePendingBySupersedeKey(supersedeKey) {
        const removedHexKeys = new Set();

        for (const [commandId, commandEntry] of this.commandMetadata.entries()) {
            if (commandEntry.supersedeKey !== supersedeKey) {
                continue;
            }

            if (commandEntry.sentAt) {
                continue;
            }

            clearTimeout(commandEntry.timeout);
            removedHexKeys.add(commandEntry.hexKey);
            this.commandMetadata.delete(commandId);
        }

        if (removedHexKeys.size === 0) {
            return;
        }

        this.priorityQueue.removeWhere(({ value }) => removedHexKeys.has(value.toString('hex')));
    }

    findInFlightBySupersedeKey(supersedeKey) {
        for (const commandEntry of this.commandMetadata.values()) {
            if (commandEntry.supersedeKey === supersedeKey && commandEntry.sentAt) {
                return commandEntry;
            }
        }

        return null;
    }

    enqueueDeferredCommand(previousEntry) {
        const { supersedeKey } = previousEntry;
        if (!supersedeKey) {
            return;
        }

        const deferredCommand = this.deferredCommands.get(supersedeKey);
        if (!deferredCommand) {
            return;
        }

        this.deferredCommands.delete(supersedeKey);

        if (deferredCommand.command.toString('hex') === previousEntry.hexKey) {
            return;
        }

        const commandEntry = this.createCommandEntry(
            deferredCommand.command,
            deferredCommand.priority,
            deferredCommand.options
        );
        this.enqueueCommandEntry(commandEntry);
    }

    markCommandSent(command, restartTimer = false) {
        const hexKey = command.toString('hex');
        let fallbackEntry = null;

        for (const commandEntry of this.commandMetadata.values()) {
            if (commandEntry.hexKey !== hexKey) {
                continue;
            }

            if (!fallbackEntry || (commandEntry.sentAt && commandEntry.sentAt < fallbackEntry.sentAt)) {
                fallbackEntry = commandEntry;
            }

            if (!commandEntry.sentAt) {
                commandEntry.sentAt = Date.now();
                if (restartTimer) {
                    this.startRetryTimer(commandEntry);
                }
                return;
            }
        }

        if (fallbackEntry) {
            fallbackEntry.sentAt = Date.now();
            if (restartTimer) {
                this.startRetryTimer(fallbackEntry);
            }
        }
    }

    hasPendingSupersedeKey(supersedeKey) {
        for (const commandEntry of this.commandMetadata.values()) {
            if (commandEntry.supersedeKey === supersedeKey) {
                return true;
            }
        }

        return false;
    }

    findPendingCommand(deviceType, deviceId, bytes) {
        for (const commandEntry of this.commandMetadata.values()) {
            if (
                commandEntry.deviceType === deviceType
                && commandEntry.deviceId === deviceId
                && this.matchesAckOrState(commandEntry, bytes)
            ) {
                return commandEntry;
            }
        }

        return null;
    }

    matchesAckOrState(commandEntry, bytes) {
        const command = commandEntry.command;

        switch (commandEntry.deviceType) {
            case 'outlet':
                return this.matchesOutletAck(command, bytes);
            case 'light':
                return this.matchesLightAck(command, bytes);
            case 'temp':
                return this.matchesTemperatureAck(command, bytes);
            case 'fan':
                return this.matchesFanAck(command, bytes);
            case 'elevator':
                return this.matchesElevatorAck(bytes);
            case 'master_light':
                return bytes[1] === command[2];
            default:
                return true;
        }
    }

    matchesOutletAck(command, bytes) {
        const commandType = command[2];
        const value = command[3];

        switch (commandType) {
            case 0x01:
                return (bytes[1] & 0x01) === (value & 0x01);
            case 0x02:
                return (bytes[1] & 0x10 ? 1 : 0) === (value ? 1 : 0);
            case 0x03:
                return decodeBcdNumber([bytes[5], bytes[6]]) === command[4];
            default:
                return true;
        }
    }

    matchesLightAck(command, bytes) {
        const power = command[2];

        if (power === 0x03) {
            return bytes[1] !== 0x00 && bytes[5] === command[6];
        }

        return bytes[1] === power;
    }

    matchesTemperatureAck(command, bytes) {
        const commandType = command[2];
        const value = command[3];

        if (commandType === 0x03) {
            return bytes[4] === value;
        }

        if (commandType === 0x04) {
            return value === 0x00
                ? bytes[1] === 0x80 || bytes[1] === 0x00
                : bytes[1] === 0x81 || bytes[1] === 0x83;
        }

        return true;
    }

    matchesElevatorAck(bytes) {
        const frameKind = this.getElevatorFrameKind(bytes);
        return frameKind === 'callOn' || frameKind === 'calling';
    }

    matchesFanAck(command, bytes) {
        const commandType = command[2];
        const value = command[3];

        if (commandType === 0x02) {
            return bytes[3] === value;
        }

        if (commandType === 0x01) {
            if (value === 0x02) {
                return bytes[1] === 0x01 || bytes[1] === 0x02;
            }

            return bytes[1] === value;
        }

        return true;
    }

    getDeviceTypeFromCommand(command) {
        switch (command[0]) {
            case 0x7A:
                return 'outlet';
            case 0x31:
                return 'light';
            case 0x04:
                return 'temp';
            case 0x78:
                return 'fan';
            case 0xA0:
                return 'elevator';
            case 0x22:
                return 'master_light';
            default:
                return null;
        }
    }

    handleAckOrState(bytes) {
        const elevatorFrameKind = this.getElevatorFrameKind(bytes);
        const header = bytes[0];
        let deviceType;
        let deviceId;

        if (elevatorFrameKind) {
            deviceType = 'elevator';
            deviceId = this.getElevatorDeviceIdFromFrame(bytes);
        } else switch (header) {
            case 0xF9:
            case 0xFA:
                deviceType = 'outlet';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            case 0xB0:
            case 0xB1:
                deviceType = 'light';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            case 0x82:
            case 0x84:
                deviceType = 'temp';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            case 0xF6:
            case 0xF8:
                deviceType = 'fan';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            case 0x26:
                deviceType = 'elevator';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            case 0xA0:
            case 0xA2:
                deviceType = 'master_light';
                deviceId = bytes[2].toString(16).padStart(2, '0');
                break;
            default:
                return;
        }

        const pendingCommand = this.findPendingCommand(deviceType, deviceId, bytes);
        if (!pendingCommand) {
            return;
        }

        log(`<- ${formatStateFrameLog(bytes)} ACK/STATE 수신 완료 (${formatResponseTime(pendingCommand)})`);
        this.removeCommand(pendingCommand.id);
    }

    getElevatorFrameKind(bytes) {
        const hexKey = toHexKey(bytes);

        if (hexKey === this.elevator.frameKeys.callOn) {
            return 'callOn';
        }

        if (hexKey === this.elevator.frameKeys.calling) {
            return 'calling';
        }

        if (hexKey === this.elevator.frameKeys.released) {
            return 'released';
        }

        return '';
    }

    getElevatorDeviceIdFromFrame(bytes) {
        if (bytes[0] === 0x26 && bytes.length > 2) {
            return byteToHex(bytes[2]);
        }

        if (bytes.length > 1) {
            return byteToHex(bytes[1]);
        }

        return this.elevator.deviceId;
    }

    dequeueAndWrite(socket) {
        if (this.priorityQueue.isEmpty()) {
            return;
        }

        const { value } = this.priorityQueue.dequeue();
        this.safeWrite(value, socket);
    }

    createOutletCommand(deviceId, commandType, value, power = 0) {
        const bytes = [
            0x7A,
            Number.parseInt(deviceId, 16),
            commandType,
            value,
            power,
            0x00,
            0x00,
        ];

        bytes.push(calculateChecksum(bytes));
        return Buffer.from(bytes);
    }

    createLightPacket(deviceId, power, brightness) {
        const bytes = [
            0x31,
            Number.parseInt(deviceId, 16),
            power,
            0x00,
            0x00,
            0x00,
            brightness,
        ];

        bytes.push(calculateChecksum(bytes));
        return Buffer.from(bytes);
    }

    createTemperatureCommand(deviceId, type, value) {
        const bytes = [
            0x04,
            Number.parseInt(deviceId, 16),
            type,
            value,
            0x00,
            0x00,
            0x00,
        ];

        bytes.push(calculateChecksum(bytes));
        return Buffer.from(bytes);
    }

    createVentilationCommand(deviceId, commandType, value) {
        const bytes = [
            0x78,
            Number.parseInt(deviceId, 16),
            commandType,
            value,
            0x00,
            0x00,
            0x00,
        ];

        bytes.push(calculateChecksum(bytes));
        return Buffer.from(bytes);
    }

    createElevatorCallCommand(deviceId) {
        void deviceId;
        return this.elevator.callCommand ? Buffer.from(this.elevator.callCommand) : null;
    }

    createMasterLightCommand(deviceId, state) {
        const bytes = [
            0x22,
            Number.parseInt(deviceId, 16),
            state,
            0x01,
            0x00,
            0x00,
            0x00,
        ];

        bytes.push(calculateChecksum(bytes));
        return Buffer.from(bytes);
    }

    extractDeviceId(segment) {
        return segment ? segment.replace(DEVICE_ID_PREFIX_PATTERN, '') : '';
    }

    handleOutletMessage(topicParts, payload, mqttClient) {
        const deviceId = this.extractDeviceId(topicParts[2]);

        if (topicParts.length === 4) {
            const stateByte = payload === 'ON' ? 0x01 : 0x00;
            this.sendCommand(this.createOutletCommand(deviceId, 0x01, stateByte), 1, {
                supersedeKey: `outlet:${deviceId}:state`,
            });
            return;
        }

        if (topicParts.at(-2) === 'standby_power') {
            const power = Number.parseInt(payload, 10);
            if (Number.isNaN(power) || power < 0 || power > 50) {
                return;
            }

            this.sendCommand(this.createOutletCommand(deviceId, 0x03, 0x00, power), 1, {
                supersedeKey: `outlet:${deviceId}:standby_power`,
            });
            return;
        }

        if (topicParts.at(-2) === 'standby_mode') {
            const modeByte = payload === 'AUTO' ? 0x01 : 0x00;
            this.sendCommand(this.createOutletCommand(deviceId, 0x02, modeByte), 1, {
                supersedeKey: `outlet:${deviceId}:standby_mode`,
            });
        }
    }

    handleLightMessage(topicParts, payload, mqttClient) {
        const deviceId = this.extractDeviceId(topicParts[2]);
        const brightnessKey = `light:${deviceId}:brightness`;

        if (topicParts.at(-2) === 'brightness') {
            this.sendCommand(this.createLightPacket(deviceId, 0x03, Number(payload)), 1, {
                supersedeKey: brightnessKey,
            });
            return;
        }

        if (payload === 'ON' && this.hasPendingSupersedeKey(brightnessKey)) {
            return;
        }

        const power = payload === 'ON' ? 0x01 : 0x00;
        this.sendCommand(this.createLightPacket(deviceId, power, 0), 1, {
            supersedeKey: `light:${deviceId}:state`,
        });
    }

    handleTemperatureMessage(topicParts, payload, mqttClient) {
        const deviceId = this.extractDeviceId(topicParts[2]);
        const action = topicParts.at(-1);

        if (action === 'set_mode') {
            const modeValue = payload === 'off' ? 0x00 : 0x81;
            this.sendCommand(this.createTemperatureCommand(deviceId, 0x04, modeValue), 1, {
                supersedeKey: `temp:${deviceId}:mode`,
            });
            return;
        }

        if (action === 'set_temp') {
            const temperature = Number.parseInt(payload, 10);
            if (Number.isNaN(temperature) || temperature < 16 || temperature > 30) {
                return;
            }

            this.sendCommand(this.createTemperatureCommand(deviceId, 0x03, encodeDecimalDigitsToByte(payload)), 1, {
                supersedeKey: `temp:${deviceId}:target_temp`,
            });
        }
    }

    handleFanMessage(topicParts, payload, mqttClient) {
        const deviceId = this.extractDeviceId(topicParts[2]);
        const action = topicParts.at(-1);

        if (action === 'set') {
            const stateValue = payload === 'ON' ? 0x04 : 0x00;
            this.sendCommand(this.createVentilationCommand(deviceId, 0x01, stateValue), 1, {
                supersedeKey: `fan:${deviceId}:state`,
            });
            return;
        }

        if (action === 'set_mode') {
            const modeValue = payload === 'auto' ? 0x02 : payload === 'bypass' ? 0x07 : 0x04;
            this.sendCommand(this.createVentilationCommand(deviceId, 0x01, modeValue), 1, {
                supersedeKey: `fan:${deviceId}:mode`,
            });
            return;
        }

        if (action !== 'set_speed') {
            return;
        }

        const speed = Number.parseInt(payload, 10);
        if (Number.isNaN(speed) || speed < 0 || speed > 3) {
            logError(`Invalid speed: ${payload}. Must be between 0 and 3`);
            return;
        }

        if (speed === 0) {
            this.sendCommand(this.createVentilationCommand(deviceId, 0x01, 0x00), 1, {
                supersedeKey: `fan:${deviceId}:state`,
            });
            return;
        }

        const speedValue = speed === 1 ? 0x01 : speed === 2 ? 0x02 : 0x03;
        this.sendCommand(this.createVentilationCommand(deviceId, 0x02, speedValue), 1, {
            supersedeKey: `fan:${deviceId}:speed`,
        });
    }

    handleMasterLightMessage(payload, mqttClient) {
        const state = payload === 'ON' ? 0x01 : 0x00;
        this.sendCommand(this.createMasterLightCommand('01', state), 1, {
            supersedeKey: 'master_light:01:state',
        });
    }

    handleElevatorMessage(topicParts, payload) {
        const action = topicParts.at(-1);
        if (!['set', 'call'].includes(action) || payload !== 'ON') {
            return;
        }

        const deviceId = this.extractDeviceId(topicParts[2]) || this.elevator.deviceId;

        if (this.elevator.mode === 'off') {
            log(`엘리베이터 ${deviceId} 호출 비활성 모드: 명령을 처리하지 않습니다.`);
            return;
        }

        if (this.elevator.mode !== 'rs485') {
            log(`엘리베이터 ${deviceId} 호출 MQTT 전달 모드: RS485 명령을 보내지 않습니다.`);
            return;
        }

        const command = this.createElevatorCallCommand(deviceId);
        if (!command) {
            logError(`엘리베이터 ${deviceId} RS485 호출 명령이 설정되지 않았거나 유효하지 않아 명령을 보내지 않습니다.`);
            return;
        }

        this.sendCommand(command, 1, {
            deviceType: 'elevator',
            deviceId,
            supersedeKey: `elevator:${deviceId}:call`,
        });
    }

    handleMessage(topic, message, mqttClient) {
        const topicParts = topic.split('/');
        const payload = message.toString();
        const action = topicParts.at(-1);

        if (!SUPPORTED_TOPIC_ACTIONS.has(action)) {
            return;
        }

        this.logMqttCommand(topic, payload);

        switch (topicParts[1]) {
            case 'outlet':
                this.handleOutletMessage(topicParts, payload, mqttClient);
                break;
            case 'light':
                this.handleLightMessage(topicParts, payload, mqttClient);
                break;
            case 'temp':
                this.handleTemperatureMessage(topicParts, payload, mqttClient);
                break;
            case 'fan':
                this.handleFanMessage(topicParts, payload, mqttClient);
                break;
            case 'elevator':
                this.handleElevatorMessage(topicParts, payload, mqttClient);
                break;
            case 'master_light':
                if (action === 'set') {
                    this.handleMasterLightMessage(payload, mqttClient);
                }
                break;
        }
    }

    logMqttCommand(topic, payload) {
        if (!this.logMqttCommands) {
            return;
        }

        const now = Date.now();
        const delta = this.lastMqttCommandAt === 0 ? 0 : now - this.lastMqttCommandAt;
        this.lastMqttCommandAt = now;
        this.logger(`[MQTT CMD +${delta}ms] ${topic} <= ${payload}`);
    }
}

module.exports = CommandHandler;
module.exports.describeCommand = describeCommand;
module.exports.describeStateFrame = describeStateFrame;
module.exports.formatCommandLog = formatCommandLog;
module.exports.formatResponseTime = formatResponseTime;
module.exports.formatStateFrameLog = formatStateFrameLog;
module.exports.readRetryConfig = readRetryConfig;
module.exports.shouldLogMqttCommands = shouldLogMqttCommands;

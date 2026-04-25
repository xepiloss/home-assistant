const PriorityQueue = require('./priorityQueue');
const {
    BYTE_BY_MODE,
    FAN_BITS_BY_MODE,
    SWING_BITS_BY_MODE,
    createControlPacket,
    createStatusRequest,
    padDeviceId,
    parseStatusPacket,
} = require('./lgProtocol');
const { formatBytes, log, logError } = require('./utils');

function isWriteCommand(command) {
    return Boolean(command?.[4] & 0x02);
}

function formatCommand(command) {
    if (command[0] === 0x80 && command[2] === 0xA3) {
        const deviceId = padDeviceId(command[3]);
        const controlFlags = command[4];
        const isWrite = Boolean(controlFlags & 0x02);
        const powerLabel = (controlFlags & 0x01) ? 'ON' : 'OFF';
        const lockLabel = (controlFlags & 0x04) ? ', lock' : '';

        if (isWrite) {
            return `${formatBytes(command)} (제어 요청 ${deviceId}, ${powerLabel}${lockLabel})`;
        }

        return `${formatBytes(command)} (상태 요청 ${deviceId})`;
    }

    return formatBytes(command);
}

class CommandHandler {
    constructor({
        topicPrefix,
        supportedHvacModes,
        protocolOptions = {},
        controlEnabled = true,
        logStatusPolling = false,
        logger = log,
    }) {
        this.topicPrefix = topicPrefix;
        this.supportedHvacModes = new Set(supportedHvacModes || ['off', 'cool', 'fan_only', 'dry', 'heat', 'auto']);
        this.protocolOptions = protocolOptions;
        this.controlEnabled = controlEnabled;
        this.logStatusPolling = logStatusPolling;
        this.logger = logger;
        this.priorityQueue = new PriorityQueue();
        this.commandMetadata = new Map();
        this.desiredStates = new Map();
        this.retryConfig = {
            maxRetries: 3,
            retryTimeoutMs: 700,
        };
    }

    safeWrite(command, socket) {
        const entry = this.findUnsentEntry(command);
        if (entry) {
            this.safeWriteEntry(entry, socket);
            return;
        }

        if (!socket || socket.destroyed) {
            this.priorityQueue.enqueue(command, 1);
            return;
        }

        if (socket.writableNeedDrain) {
            this.priorityQueue.enqueue(command, 1);
            return;
        }

        socket.write(command);
        this.markCommandSent(command, true);
        if (this.shouldLogCommand(command)) {
            this.logger(`-> ${formatCommand(command)}`);
        }
    }

    safeWriteEntry(entry, socket) {
        if (!this.commandMetadata.has(entry.id)) {
            return;
        }

        if (!socket || socket.destroyed || socket.writableNeedDrain) {
            this.queueEntry(entry);
            return;
        }

        socket.write(entry.command);
        this.markEntrySent(entry, true);
        if (this.shouldLogEntry(entry)) {
            this.logger(`-> ${formatCommand(entry.command)}`);
        }
    }

    createCommandEntry(command, priority, options = {}) {
        const id = `${command.toString('hex')}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        return {
            id,
            command,
            priority,
            retries: 0,
            sentAt: null,
            deviceId: padDeviceId(options.deviceId ?? command[3]),
            type: options.type || 'command',
            timeout: null,
        };
    }

    queueEntry(entry) {
        this.priorityQueue.enqueue(entry, entry.priority);
    }

    shouldLogCommand(command) {
        return isWriteCommand(command) || this.logStatusPolling;
    }

    shouldLogEntry(entry) {
        return entry.type !== 'status_request' || this.logStatusPolling;
    }

    sendCommand(command, priority = 1, options = {}) {
        const entry = this.createCommandEntry(command, priority, options);
        this.commandMetadata.set(entry.id, entry);
        this.queueEntry(entry);
    }

    sendStatusRequest(deviceId, priority = 1) {
        if (this.hasPendingWriteCommand()) {
            return;
        }

        this.sendCommand(createStatusRequest(deviceId, this.getDesiredState(deviceId), this.protocolOptions), priority, {
            deviceId,
            type: 'status_request',
        });
    }

    getDesiredState(deviceId) {
        const key = padDeviceId(deviceId);
        return this.desiredStates.get(key) || {
            hvacMode: 'cool',
            fanMode: 'auto',
            swingMode: 'auto',
            targetTemperature: 24,
            isOn: false,
            locked: false,
        };
    }

    setDesiredState(deviceId, updates) {
        const key = padDeviceId(deviceId);
        const current = this.getDesiredState(key);
        const next = { ...current, ...updates };
        this.desiredStates.set(key, next);
        return next;
    }

    sendControl(deviceId, action, updates = {}) {
        this.dropQueuedStatusRequests(deviceId);
        const next = this.setDesiredState(deviceId, updates);
        const command = createControlPacket(deviceId, action, next, this.protocolOptions);
        this.sendCommand(command, 0, {
            deviceId,
            type: action,
        });
    }

    dropQueuedStatusRequests(deviceId) {
        const key = padDeviceId(deviceId);

        this.priorityQueue.removeWhere((node) => {
            const command = node.value.command || node.value;
            return padDeviceId(command[3]) === key && !isWriteCommand(command);
        });

        for (const [commandId, entry] of this.commandMetadata.entries()) {
            if (entry.deviceId === key && entry.type === 'status_request' && !entry.sentAt) {
                this.commandMetadata.delete(commandId);
            }
        }
    }

    hasInflightCommand() {
        for (const entry of this.commandMetadata.values()) {
            if (entry.sentAt) {
                return true;
            }
        }

        return false;
    }

    hasPendingWriteCommand() {
        for (const entry of this.commandMetadata.values()) {
            if (isWriteCommand(entry.command)) {
                return true;
            }
        }

        return false;
    }

    markCommandSent(command, restartTimer = false) {
        const entry = this.findUnsentEntry(command);
        if (entry) {
            this.markEntrySent(entry, restartTimer);
        }
    }

    findUnsentEntry(command) {
        const hexKey = command.toString('hex');
        for (const entry of this.commandMetadata.values()) {
            if (entry.command.toString('hex') !== hexKey || entry.sentAt) {
                continue;
            }

            return entry;
        }

        return null;
    }

    markEntrySent(entry, restartTimer = false) {
        entry.sentAt = Date.now();
        if (restartTimer) {
            this.startRetryTimer(entry);
        }
    }

    startRetryTimer(entry) {
        clearTimeout(entry.timeout);
        entry.timeout = setTimeout(() => {
            this.retryCommand(entry.id);
        }, this.retryConfig.retryTimeoutMs);
    }

    retryCommand(commandId) {
        const entry = this.commandMetadata.get(commandId);
        if (!entry) {
            return;
        }

        if (entry.retries >= this.retryConfig.maxRetries) {
            logError(`${formatCommand(entry.command)} 명령 재전송 실패 한도 도달 (${this.retryConfig.maxRetries})`);
            this.removeCommand(commandId);
            return;
        }

        entry.retries += 1;
        entry.sentAt = null;
        this.queueEntry(entry);
    }

    removeCommand(commandId) {
        const entry = this.commandMetadata.get(commandId);
        if (!entry) {
            return;
        }

        clearTimeout(entry.timeout);
        this.commandMetadata.delete(commandId);
    }

    handleStatusPacket(bytes) {
        const parsed = parseStatusPacket(bytes, { supportedHvacModes: [...this.supportedHvacModes] });
        if (!parsed) {
            return;
        }

        this.setDesiredState(parsed.deviceId, {
            hvacMode: parsed.hvacMode === 'off' ? this.getDesiredState(parsed.deviceId).hvacMode : parsed.hvacMode,
            fanMode: parsed.fanMode,
            swingMode: parsed.swingMode,
            targetTemperature: parsed.targetTemperature || this.getDesiredState(parsed.deviceId).targetTemperature,
            isOn: parsed.isOn,
            locked: parsed.locked,
        });

        for (const entry of this.commandMetadata.values()) {
            if (entry.deviceId !== parsed.deviceId) {
                continue;
            }

            const responseMs = entry.sentAt ? Date.now() - entry.sentAt : null;
            if (this.shouldLogEntry(entry)) {
                this.logger(`<- ${formatBytes(bytes)} (${parsed.deviceId} 상태 수신${responseMs === null ? '' : `, 응답 ${responseMs}ms`})`);
            }
            this.removeCommand(entry.id);
            return;
        }
    }

    dequeueAndWrite(socket) {
        if (this.priorityQueue.isEmpty()) {
            return;
        }

        if (this.hasInflightCommand()) {
            return;
        }

        const { value } = this.priorityQueue.dequeue();
        if (value.command) {
            this.safeWriteEntry(value, socket);
            return;
        }

        this.safeWrite(value, socket);
    }

    handleMessage(topic, message) {
        const parts = topic.split('/');
        if (parts[0] !== this.topicPrefix || parts[1] !== 'climate') {
            return;
        }

        const deviceId = parts[2];
        const command = parts[3];
        const payload = message.toString().trim();
        const switchPayload = payload.toUpperCase();
        const controlCommands = new Set(['set_mode', 'set_power', 'set_lock', 'set_temp', 'set_fan_mode', 'set_swing_mode']);

        if (!this.controlEnabled && controlCommands.has(command)) {
            this.logger(`LG PI485 제어 비활성화 상태라 MQTT 명령을 무시합니다: ${topic}=${payload}`);
            return;
        }

        if (command === 'set_mode' && !this.supportedHvacModes.has(payload)) {
            logError(`이 애드온 설정에서 비활성화된 LG 에어컨 모드: ${payload}`);
            return;
        }

        if (command === 'set_mode' && BYTE_BY_MODE[payload] === undefined && payload !== 'off') {
            logError(`지원하지 않는 LG 에어컨 모드: ${payload}`);
            return;
        }

        if (command === 'set_mode') {
            if (payload === 'off') {
                this.sendControl(deviceId, 'turn_off', { isOn: false });
                return;
            }

            this.sendControl(deviceId, 'turn_on', {
                hvacMode: payload,
                isOn: true,
            });
            return;
        }

        if (command === 'set_power') {
            if (switchPayload === 'ON') {
                const current = this.getDesiredState(deviceId);
                this.sendControl(deviceId, 'turn_on', { ...current, isOn: true });
                return;
            }

            if (switchPayload === 'OFF') {
                this.sendControl(deviceId, 'turn_off', { isOn: false });
                return;
            }

            logError(`지원하지 않는 LG 에어컨 전원 명령: ${payload}`);
            return;
        }

        if (command === 'set_lock') {
            if (switchPayload === 'ON') {
                this.sendControl(deviceId, 'lock_on', { locked: true });
                return;
            }

            if (switchPayload === 'OFF') {
                this.sendControl(deviceId, 'lock_off', { locked: false });
                return;
            }

            logError(`지원하지 않는 LG 에어컨 잠금 명령: ${payload}`);
            return;
        }

        if (command === 'set_temp') {
            const targetTemperature = Number.parseInt(payload, 10);
            if (!Number.isFinite(targetTemperature) || targetTemperature < 18 || targetTemperature > 30) {
                logError(`지원하지 않는 LG 에어컨 설정 온도: ${payload}`);
                return;
            }

            const current = this.getDesiredState(deviceId);
            this.sendControl(deviceId, current.isOn ? 'turn_on' : 'turn_off', { targetTemperature });
            return;
        }

        if (command === 'set_fan_mode') {
            if (FAN_BITS_BY_MODE[payload] === undefined) {
                logError(`지원하지 않는 LG 에어컨 풍속: ${payload}`);
                return;
            }

            const current = this.getDesiredState(deviceId);
            this.sendControl(deviceId, current.isOn ? 'turn_on' : 'turn_off', { fanMode: payload });
            return;
        }

        if (command === 'set_swing_mode') {
            if (SWING_BITS_BY_MODE[payload] === undefined) {
                logError(`지원하지 않는 LG 에어컨 풍향: ${payload}`);
                return;
            }

            const current = this.getDesiredState(deviceId);
            this.sendControl(deviceId, current.isOn ? 'turn_on' : 'turn_off', { swingMode: payload });
        }
    }
}

module.exports = CommandHandler;
module.exports.formatCommand = formatCommand;

const net = require('net');
const { log, logError } = require('./utils');
const { PacketFramer, formatBytes } = require('./packetFramer');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function shouldLogUnknownPackets(env = process.env) {
    return TRUE_VALUES.has(String(env.LG_PI485_LOG_UNKNOWN_PACKETS || '').toLowerCase());
}

class Ew11Client {
    constructor({
        name,
        host,
        port,
        onData,
        writeCommand,
        state,
        mqttClient,
        onAvailable,
        onUnavailable,
        onMaxRetriesReached,
        onUnknownPacket,
        onReceive,
        packetLengths,
        usePacketFramer = true,
        maxRetryAttempts = 20,
        reconnectDelay = 30000,
        logger = log,
        errorLogger = logError,
    }) {
        this.name = name;
        this.host = host;
        this.port = port;
        this.onDataCallback = onData;
        this.writeCommand = writeCommand;
        this.state = state;
        this.mqttClient = mqttClient;
        this.onAvailable = onAvailable;
        this.onUnavailable = onUnavailable;
        this.onMaxRetriesReached = onMaxRetriesReached || (() => undefined);
        this.onUnknownPacket = onUnknownPacket || (() => undefined);
        this.onReceive = onReceive || (() => undefined);
        this.usePacketFramer = usePacketFramer;
        this.packetFramer = usePacketFramer ? new PacketFramer({ packetLengths }) : null;
        this.logUnknownPackets = shouldLogUnknownPackets();
        this.reconnectDelay = reconnectDelay;
        this.maxRetryAttempts = maxRetryAttempts;
        this.logger = logger;
        this.errorLogger = errorLogger;
        this.retryCount = 0;
        this.connectionTimeout = 30000; // 30 seconds
        this.isConnecting = false;
        this.isDestroyed = false;
        this.lastDataTime = Date.now();
        this.dataTimeout = 20000; // 20 seconds with no data
        this.connectionMonitor = null;
        this.connectionTimer = null;
        this.reconnectTimer = null;
        this.isAvailable = false;
        this.socket = null;
        this.connect();
    }

    connect() {
        if (this.isConnecting || this.isDestroyed) {
            return;
        }

        this.isConnecting = true;

        this.connectionTimer = setTimeout(() => {
            this.errorLogger(`${this.name} connection timeout`);
            this.socket?.destroy();
        }, this.connectionTimeout);

        this.socket = net.connect(this.port, this.host, () => {
            this.socket.setNoDelay(true);
            this.clearConnectionTimer();
            this.clearReconnectTimer();
            this.isConnecting = false;
            this.retryCount = 0;
            this.lastDataTime = Date.now();
            this.startConnectionMonitor();
            this.logger(`${this.name} (${this.host}:${this.port}) 에 연결되었습니다.`);
        });

        this.socket.on('data', (data) => this.handleIncomingData(data));

        this.socket.on('error', (err) => {
            this.errorLogger(`${this.name} connection error:`, err);
            this.socket?.destroy();
        });

        this.socket.on('close', () => {
            this.clearConnectionTimer();
            this.isConnecting = false;
            this.logger(`${this.name} connection closed`);
            void this.stopConnectionMonitor().catch((err) => {
                this.errorLogger(`${this.name} availability shutdown error:`, err);
            });
            this.scheduleReconnect();
        });
    }

    handleIncomingData(data) {
        this.lastDataTime = Date.now();
        this.onReceive(new Date(this.lastDataTime));

        if (!this.usePacketFramer) {
            this.onDataCallback([...Buffer.from(data)]);
            return;
        }

        const { frames, dropped, recovered = [] } = this.packetFramer.push(data);

        if (this.logUnknownPackets) {
            for (const bytes of dropped) {
                this.logger(`<- ${formatBytes(bytes)} (unknown packet skipped)`);
            }
        }

        for (const bytes of dropped) {
            this.onUnknownPacket({
                source: this.name,
                kind: 'dropped_bytes',
                bytes,
                note: 'Packet framer dropped bytes while resyncing to a known header.',
            });
        }

        for (const bytes of recovered) {
            this.logger(`${this.name} 패킷 복원 성공 : ${formatBytes(bytes)}`);
            this.onUnknownPacket({
                source: this.name,
                kind: 'recovered_state_frame',
                bytes,
                note: 'Packet framer recovered a checksum-valid state frame from a misaligned byte stream.',
            });
        }

        for (const bytes of frames) {
            this.onDataCallback(bytes);
        }
    }

    clearConnectionTimer() {
        if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
        }
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    async setAvailability(isAvailable) {
        if (!this.state || !this.mqttClient) {
            return;
        }

        if (isAvailable && !this.isAvailable && this.onAvailable) {
            await this.onAvailable(this.state, this.mqttClient);
            this.isAvailable = true;
            return;
        }

        if (!isAvailable && this.isAvailable && this.onUnavailable) {
            await this.onUnavailable(this.state, this.mqttClient);
            this.isAvailable = false;
        }
    }

    startConnectionMonitor() {
        if (this.connectionMonitor) {
            return;
        }

        this.connectionMonitor = setInterval(() => {
            const now = Date.now();
            if (now - this.lastDataTime > this.dataTimeout) {
                this.logger(`No data received for ${this.dataTimeout}ms from ${this.name}, triggering reconnect`);
                this.socket?.destroy();
            }
        }, 1000);

        void this.setAvailability(true).catch((err) => {
            this.errorLogger(`${this.name} availability startup error:`, err);
        });
    }

    async stopConnectionMonitor() {
        if (this.connectionMonitor) {
            clearInterval(this.connectionMonitor);
            this.connectionMonitor = null;
        }

        await this.setAvailability(false);
    }

    scheduleReconnect() {
        if (this.isDestroyed || this.reconnectTimer) {
            return;
        }

        if (this.retryCount >= this.maxRetryAttempts) {
            this.errorLogger(`${this.name} max retry attempts reached. Stopping reconnection.`);
            this.onMaxRetriesReached({
                name: this.name,
                attempts: this.maxRetryAttempts,
                reconnectDelay: this.reconnectDelay,
            });
            return;
        }

        this.retryCount++;
        this.logger(`${this.name} reconnect scheduled (${this.retryCount}/${this.maxRetryAttempts}) in ${this.reconnectDelay}ms...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelay);
    }

    write(command) {
        if (this.socket && !this.socket.destroyed) {
            this.writeCommand(command);
        } else {
            this.logger('Socket is not connected. Command not sent.');
        }
    }

    destroy() {
        this.isDestroyed = true;
        this.clearConnectionTimer();
        this.clearReconnectTimer();
        if (this.connectionMonitor) {
            clearInterval(this.connectionMonitor);
            this.connectionMonitor = null;
        }
        this.isConnecting = false;
        this.retryCount = this.maxRetryAttempts;
        this.socket?.destroy();
    }
}

module.exports = Ew11Client;
module.exports.shouldLogUnknownPackets = shouldLogUnknownPackets;

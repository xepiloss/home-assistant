const net = require('net');
const { log, logError } = require('./utils');
const { PacketFramer, formatBytes } = require('./packetFramer');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFAULT_OUTBOUND_CONTEXT_WINDOW_MS = 1000;

function shouldLogUnknownPackets(env = process.env) {
    return TRUE_VALUES.has(String(env.COMMAX_LOG_UNKNOWN_PACKETS || '').toLowerCase());
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
        onUnknownPacket,
        onReceive,
        packetLengths,
        usePacketFramer = true,
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
        this.onUnknownPacket = onUnknownPacket || (() => undefined);
        this.onReceive = onReceive || (() => undefined);
        this.usePacketFramer = usePacketFramer;
        this.packetFramer = usePacketFramer ? new PacketFramer({ packetLengths }) : null;
        this.logUnknownPackets = shouldLogUnknownPackets();
        this.reconnectDelay = 30000; // 30 seconds
        this.maxRetryAttempts = 10;
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
        this.lastOutboundCommand = null;
        this.outboundContextWindowMs = DEFAULT_OUTBOUND_CONTEXT_WINDOW_MS;
        this.connect();
    }

    connect() {
        if (this.isConnecting || this.isDestroyed) {
            return;
        }

        this.isConnecting = true;

        this.connectionTimer = setTimeout(() => {
            logError(`${this.name} connection timeout`);
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
            log(`${this.name} (${this.host}:${this.port}) 에 연결되었습니다.`);
        });

        this.socket.on('data', (data) => this.handleIncomingData(data));

        this.socket.on('error', (err) => {
            logError(`${this.name} connection error:`, err);
            this.socket?.destroy();
        });

        this.socket.on('close', () => {
            this.clearConnectionTimer();
            this.isConnecting = false;
            log(`${this.name} connection closed`);
            void this.stopConnectionMonitor().catch((err) => {
                logError(`${this.name} availability shutdown error:`, err);
            });
            this.scheduleReconnect();
        });
    }

    handleIncomingData(data) {
        this.lastDataTime = Date.now();
        this.onReceive(new Date(this.lastDataTime));
        const chunk = Buffer.from(data);

        if (!this.usePacketFramer) {
            this.onDataCallback([...chunk]);
            return;
        }

        const { frames, dropped, recovered = [] } = this.packetFramer.push(chunk);
        const pendingBuffer = this.packetFramer?.buffer || Buffer.alloc(0);
        const trafficContext = this.getTrafficOriginContext(this.lastDataTime);
        const captureContext = {
            ...trafficContext,
            chunk_hex: formatBytes(chunk),
            chunk_length: chunk.length,
            emitted_frames_hex: frames.map((bytes) => formatBytes(bytes)),
            recovered_frames_hex: recovered.map((bytes) => formatBytes(bytes)),
            pending_buffer_hex: pendingBuffer.length > 0 ? formatBytes(pendingBuffer) : '',
            pending_buffer_length: pendingBuffer.length,
        };

        if (this.logUnknownPackets) {
            for (const bytes of dropped) {
                log(`<- ${formatBytes(bytes)} (unknown packet skipped)`);
            }
        }

        dropped.forEach((bytes, index) => {
            this.onUnknownPacket({
                source: this.name,
                kind: 'dropped_bytes',
                bytes,
                note: 'Packet framer dropped bytes while resyncing to a known header.',
                context: {
                    ...captureContext,
                    dropped_index: index + 1,
                    dropped_count: dropped.length,
                    dropped_bytes_hex: dropped.map((item) => formatBytes(item)),
                },
            });
        });

        for (const bytes of recovered) {
            log(`${this.name} 패킷 복원 성공 : ${formatBytes(bytes)}`);
            this.onUnknownPacket({
                source: this.name,
                kind: 'recovered_state_frame',
                bytes,
                note: 'Packet framer recovered a checksum-valid state frame from a misaligned byte stream.',
                context: captureContext,
            });
        }

        for (const bytes of frames) {
            this.onDataCallback(bytes);
        }
    }

    recordOutboundCommand(command, sentAt = Date.now()) {
        const bytes = Buffer.from(command || []);
        if (bytes.length === 0) {
            return;
        }

        this.lastOutboundCommand = {
            hex: formatBytes(bytes),
            length: bytes.length,
            sentAt,
        };
    }

    getTrafficOriginContext(receivedAt = Date.now()) {
        if (!this.lastOutboundCommand) {
            return {
                traffic_origin: 'stock_bus',
                traffic_origin_detail: 'no_recent_addon_command',
            };
        }

        const elapsedMs = receivedAt - this.lastOutboundCommand.sentAt;
        const isRecentOutbound = elapsedMs >= 0 && elapsedMs <= this.outboundContextWindowMs;

        return {
            traffic_origin: isRecentOutbound ? 'addon_command_window' : 'stock_bus',
            traffic_origin_detail: isRecentOutbound
                ? 'received_within_recent_addon_command_window'
                : 'last_addon_command_outside_context_window',
            last_outbound_command_hex: this.lastOutboundCommand.hex,
            last_outbound_command_length: this.lastOutboundCommand.length,
            last_outbound_sent_at: new Date(this.lastOutboundCommand.sentAt).toISOString(),
            last_outbound_elapsed_ms: elapsedMs,
            outbound_context_window_ms: this.outboundContextWindowMs,
        };
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
                log(`No data received for ${this.dataTimeout}ms from ${this.name}, triggering reconnect`);
                this.socket?.destroy();
            }
        }, 1000);

        void this.setAvailability(true).catch((err) => {
            logError(`${this.name} availability startup error:`, err);
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
            logError(`${this.name} max retry attempts reached. Stopping reconnection.`);
            return;
        }

        this.retryCount++;
        log(`${this.name} reconnect scheduled (${this.retryCount}/${this.maxRetryAttempts}) in ${this.reconnectDelay}ms...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelay);
    }

    write(command) {
        if (this.socket && !this.socket.destroyed) {
            this.writeCommand(command);
        } else {
            log('Socket is not connected. Command not sent.');
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

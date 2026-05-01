const net = require('net');
const { log, logError } = require('./utils');
const { PacketFramer, formatBytes } = require('./packetFramer');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFAULT_OUTBOUND_CONTEXT_WINDOW_MS = 1000;

function calculateChecksum(bytes) {
    return [...bytes].reduce((sum, byte) => sum + byte, 0) & 0xFF;
}

function hasValidChecksum(bytes) {
    return bytes.length >= 8 && calculateChecksum(bytes.subarray(0, 7)) === bytes[7];
}

function parseHexBytes(hex) {
    if (!hex) {
        return [];
    }

    return String(hex)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => Number.parseInt(part, 16))
        .filter((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xFF);
}

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

        const preBuffer = Buffer.from(this.packetFramer?.buffer || Buffer.alloc(0));
        const combinedBuffer = preBuffer.length > 0 ? Buffer.concat([preBuffer, chunk]) : chunk;
        const trafficContext = this.getTrafficOriginContext(this.lastDataTime);
        const result = this.packetFramer.push(chunk);
        const frames = [...(result.frames || [])];
        const dropped = result.dropped || [];
        const recovered = [...(result.recovered || [])];
        const droppedDetails = result.droppedDetails || [];
        const recoveredDetails = [...(result.recoveredDetails || [])];
        const corrupted = result.corrupted || [];
        let pendingBuffer = this.packetFramer?.buffer || Buffer.alloc(0);
        const commandRecoveries = typeof this.recoverRecentLightAckTail === 'function'
            ? this.recoverRecentLightAckTail({
                dropped,
                frames,
                pendingBuffer,
                trafficContext,
            })
            : [];

        if (commandRecoveries.length > 0) {
            const maxPendingBytesToConsume = Math.max(
                0,
                ...commandRecoveries.map((recovery) => recovery.consume_pending_bytes || 0)
            );

            for (const recovery of commandRecoveries) {
                frames.push(recovery.bytes);
                recovered.push(recovery.bytes);
                recoveredDetails.push(recovery);
            }

            if (maxPendingBytesToConsume > 0 && this.packetFramer?.buffer) {
                this.packetFramer.buffer = this.packetFramer.buffer.subarray(maxPendingBytesToConsume);
                pendingBuffer = this.packetFramer.buffer;
            }
        }
        const captureContext = {
            ...trafficContext,
            pre_buffer_hex: preBuffer.length > 0 ? formatBytes(preBuffer) : '',
            pre_buffer_length: preBuffer.length,
            chunk_hex: formatBytes(chunk),
            chunk_length: chunk.length,
            combined_buffer_hex: formatBytes(combinedBuffer),
            combined_buffer_length: combinedBuffer.length,
            emitted_frames_hex: frames.map((bytes) => formatBytes(bytes)),
            recovered_frames_hex: recovered.map((bytes) => formatBytes(bytes)),
            corrupted_frame_candidates_hex: corrupted.map((candidate) => formatBytes(candidate.bytes)),
            pending_buffer_hex: pendingBuffer.length > 0 ? formatBytes(pendingBuffer) : '',
            pending_buffer_length: pendingBuffer.length,
        };

        if (this.logUnknownPackets) {
            for (const bytes of dropped) {
                log(`<- ${formatBytes(bytes)} (unknown packet skipped)`);
            }
        }

        dropped.forEach((bytes, index) => {
            const droppedDetail = droppedDetails[index] || {};
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
                    dropped_reason: droppedDetail.reason || '',
                    dropped_next_header_hex: droppedDetail.next_header_hex || '',
                    dropped_recovered_frame_hex: droppedDetail.recovered_frame_hex || '',
                    dropped_recovery_status: droppedDetail.recovery_status || '',
                },
            });
        });

        corrupted.forEach((candidate) => {
            this.onUnknownPacket({
                source: this.name,
                kind: 'corrupted_frame_candidate',
                bytes: candidate.bytes,
                note: 'Packet framer saw a checksum-mismatched known-header frame while resyncing.',
                context: {
                    ...captureContext,
                    corrupted_reason: candidate.reason || '',
                    corrupted_recovered_frame_hex: candidate.recovered_frame_hex || '',
                    corrupted_recovery_status: candidate.recovery_status || '',
                    corrupted_recovered_offset: candidate.recovered_offset,
                },
            });
        });

        recovered.forEach((bytes, index) => {
            const recoveryDetail = recoveredDetails[index] || {};
            const kind = recoveryDetail.is_state_frame ? 'recovered_state_frame' : 'recovered_known_frame';
            log(`${this.name} 패킷 복원 성공 : ${formatBytes(bytes)}`);
            this.onUnknownPacket({
                source: this.name,
                kind,
                bytes,
                note: recoveryDetail.is_state_frame
                    ? 'Packet framer recovered a checksum-valid state frame from a misaligned byte stream.'
                    : 'Packet framer recovered a checksum-valid known frame from a misaligned byte stream.',
                context: {
                    ...captureContext,
                    recovered_reason: recoveryDetail.reason || '',
                    recovered_offset: recoveryDetail.offset,
                    recovered_header_hex: recoveryDetail.header || '',
                    recovered_is_state_frame: Boolean(recoveryDetail.is_state_frame),
                    recovered_source: recoveryDetail.source || '',
                    recovered_tail_hex: recoveryDetail.tail_hex || '',
                    recovered_from_command_hex: recoveryDetail.command_hex || '',
                },
            });
        });

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

    recoverRecentLightAckTail({ dropped = [], frames = [], pendingBuffer = Buffer.alloc(0), trafficContext = {} }) {
        if (trafficContext.traffic_origin !== 'addon_command_window') {
            return [];
        }

        const commandBytes = Buffer.from(parseHexBytes(this.lastOutboundCommand?.hex));
        if (
            commandBytes.length !== 8
            || commandBytes[0] !== 0x31
            || ![0x00, 0x01].includes(commandBytes[2])
            || !hasValidChecksum(commandBytes)
        ) {
            return [];
        }

        const expectedState = commandBytes[2];
        const expectedDevice = commandBytes[1];
        const existingFrameHexes = new Set(frames.map((frame) => formatBytes(frame)));
        const recoveredFrameHexes = new Set();
        const sources = [];

        for (const bytes of dropped) {
            const droppedBuffer = Buffer.from(bytes);
            if (droppedBuffer.length > 0) {
                sources.push({
                    source: 'dropped_bytes',
                    buffer: droppedBuffer,
                    pending_length: 0,
                });
            }

            if (droppedBuffer.length > 0 && pendingBuffer.length > 0) {
                sources.push({
                    source: 'dropped_bytes_with_pending_buffer',
                    buffer: Buffer.concat([droppedBuffer, pendingBuffer]),
                    pending_length: pendingBuffer.length,
                });
            }
        }

        if (pendingBuffer.length > 0) {
            sources.push({
                source: 'pending_buffer',
                buffer: Buffer.from(pendingBuffer),
                pending_length: pendingBuffer.length,
            });
        }

        const recoveries = [];
        const resolvePendingConsumption = ({ buffer, pending_length }, offset, length) => {
            if (!pending_length || offset + length !== buffer.length) {
                return 0;
            }

            const pendingStart = buffer.length - pending_length;
            return offset <= pendingStart ? pending_length : 0;
        };
        const tryRecoverFrame = (frame, detail) => {
            if (
                frame[0] !== 0xB1
                || frame[1] !== expectedState
                || frame[2] !== expectedDevice
                || !hasValidChecksum(frame)
            ) {
                return;
            }

            const frameHex = formatBytes(frame);
            if (existingFrameHexes.has(frameHex) || recoveredFrameHexes.has(frameHex)) {
                return;
            }

            recoveredFrameHexes.add(frameHex);
            recoveries.push({
                bytes: [...frame],
                reason: detail.reason,
                offset: detail.offset,
                header: 'B1',
                is_state_frame: true,
                source: detail.source,
                tail_hex: formatBytes(detail.tail),
                command_hex: this.lastOutboundCommand.hex,
                consume_pending_bytes: detail.consume_pending_bytes,
            });
        };

        for (const item of sources) {
            const { buffer, source } = item;

            for (let offset = 0; offset <= buffer.length - 7; offset += 1) {
                const tail = buffer.subarray(offset, offset + 7);
                const consume_pending_bytes = resolvePendingConsumption(item, offset, tail.length);
                tryRecoverFrame(Buffer.from([0xB1, ...tail]), {
                    reason: 'recent_light_ack_tail_missing_header',
                    offset,
                    source,
                    tail,
                    consume_pending_bytes,
                });

                if (tail[0] !== expectedState) {
                    tryRecoverFrame(Buffer.from([0xB1, expectedState, ...tail.subarray(1)]), {
                        reason: 'recent_light_ack_tail_missing_header_corrupted_state',
                        offset,
                        source,
                        tail,
                        consume_pending_bytes,
                    });
                }
            }

            for (let offset = 0; offset <= buffer.length - 6; offset += 1) {
                const tail = buffer.subarray(offset, offset + 6);
                const consume_pending_bytes = resolvePendingConsumption(item, offset, tail.length);
                tryRecoverFrame(Buffer.from([0xB1, expectedState, ...tail]), {
                    reason: 'recent_light_ack_tail_missing_header_and_state',
                    offset,
                    source,
                    tail,
                    consume_pending_bytes,
                });
            }
        }

        return recoveries;
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

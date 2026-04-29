function resolveMeteringFrameLength(buffer) {
    if (buffer.length < 4) {
        return null;
    }

    switch (buffer[3]) {
        case 0x0F:
        case 0x01:
            return 7;
        case 0x8F:
            return 9;
        case 0x81:
            return 32;
        default:
            return undefined;
    }
}

const COMMON_PACKET_LENGTHS = [
    [0x78, 8], [0xF8, 8], [0x76, 8], [0xF6, 8],
    [0x31, 8], [0xB1, 8], [0x30, 8], [0xB0, 8],
    [0x22, 8], [0xA2, 8], [0x20, 8], [0xA0, 8],
    [0x7A, 8], [0xFA, 8], [0x79, 8], [0xF9, 8],
    [0x04, 8], [0x84, 8], [0x02, 8], [0x82, 8],
    [0x11, 8], [0x91, 8], [0x10, 8], [0x90, 8],
    [0x7F, 8],
    [0x24, 8], [0xA4, 8], [0x25, 8], [0xAA, 8],
    [0x47, 8], [0x48, 8], [0xC8, 8],
    [0x77, 8], [0x26, 8], [0x0F, 8], [0x8F, 8],
    [0x2A, 48],
    [0x80, 10],
];

const PRIMARY_PACKET_LENGTHS = new Map([
    ...COMMON_PACKET_LENGTHS,
    [0xF7, 8],
]);

const METERING_PACKET_LENGTHS = new Map([
    ...COMMON_PACKET_LENGTHS,
    [0xF7, resolveMeteringFrameLength],
]);

const DEFAULT_PACKET_LENGTHS = PRIMARY_PACKET_LENGTHS;

const DEFAULT_MAX_BUFFER_BYTES = 256;

const RECOVERABLE_STATE_HEADERS = new Set([
    0xB0, 0xB1, // light
    0xF9, 0xFA, // outlet
    0x82, 0x84, // thermostat
    0xF6, 0xF8, // ventilation
    0xA0, 0xA2, // master light
    0x26, // elevator
]);

function calculateChecksum(bytes) {
    return [...bytes].reduce((sum, byte) => sum + byte, 0) & 0xFF;
}

function hasValidChecksum(bytes) {
    return bytes.length >= 8 && calculateChecksum(bytes.subarray(0, 7)) === bytes[7];
}

function byteToHex(byte) {
    return byte?.toString(16).padStart(2, '0').toUpperCase();
}

function findNextKnownHeader(buffer, packetLengths) {
    for (let index = 1; index < buffer.length; index += 1) {
        if (packetLengths.has(buffer[index])) {
            return index;
        }
    }

    return -1;
}

function resolveFrameLength(buffer, packetLengths) {
    const frameLength = packetLengths.get(buffer[0]);

    if (typeof frameLength === 'function') {
        return frameLength(buffer);
    }

    return frameLength;
}

function findRecoverableFrame(buffer, packetLengths) {
    let incompleteCandidate = null;

    for (let index = 1; index < buffer.length; index += 1) {
        if (!packetLengths.has(buffer[index])) {
            continue;
        }

        const frameLength = resolveFrameLength(buffer.subarray(index), packetLengths);
        if (frameLength !== 8) {
            continue;
        }

        if (buffer.length - index < frameLength) {
            incompleteCandidate = {
                index,
                needsMoreData: true,
            };
            continue;
        }

        const frame = buffer.subarray(index, index + frameLength);
        if (hasValidChecksum(frame)) {
            return {
                index,
                frame,
                isStateFrame: RECOVERABLE_STATE_HEADERS.has(frame[0]),
                needsMoreData: false,
            };
        }
    }

    return incompleteCandidate;
}

class PacketFramer {
    constructor({ packetLengths = DEFAULT_PACKET_LENGTHS, maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES } = {}) {
        this.packetLengths = packetLengths;
        this.maxBufferBytes = maxBufferBytes;
        this.buffer = Buffer.alloc(0);
    }

    push(chunk) {
        if (!chunk || chunk.length === 0) {
            return { frames: [], dropped: [] };
        }

        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

        const frames = [];
        const dropped = [];
        const recovered = [];
        const droppedDetails = [];
        const corrupted = [];

        const recordDrop = (bytes, reason, details = {}) => {
            const normalizedBytes = Buffer.from(bytes);
            dropped.push(normalizedBytes);
            droppedDetails.push({
                bytes: [...normalizedBytes],
                reason,
                ...details,
            });
        };

        const recordCorrupted = (bytes, reason, details = {}) => {
            const normalizedBytes = Buffer.from(bytes);
            corrupted.push({
                bytes: [...normalizedBytes],
                reason,
                ...details,
            });
        };

        const recordRecoveredFrame = (frame, reason, offset) => {
            const normalizedFrame = Buffer.from(frame);
            const recoveredFrame = {
                bytes: [...normalizedFrame],
                reason,
                offset,
                header: byteToHex(normalizedFrame[0]),
                is_state_frame: RECOVERABLE_STATE_HEADERS.has(normalizedFrame[0]),
            };

            frames.push(recoveredFrame.bytes);
            recovered.push(recoveredFrame);
            this.buffer = this.buffer.subarray(normalizedFrame.length);
        };

        while (this.buffer.length > 0) {
            const frameLength = resolveFrameLength(this.buffer, this.packetLengths);

            if (frameLength === null) {
                break;
            }

            if (!frameLength) {
                const nextHeaderIndex = findNextKnownHeader(this.buffer, this.packetLengths);

                if (nextHeaderIndex === -1) {
                    recordDrop(this.buffer, 'unknown_header_until_buffer_end');
                    this.buffer = Buffer.alloc(0);
                    break;
                }

                recordDrop(this.buffer.subarray(0, nextHeaderIndex), 'unknown_header_before_known_header', {
                    next_header_hex: byteToHex(this.buffer[nextHeaderIndex]),
                    next_header_index: nextHeaderIndex,
                });
                this.buffer = this.buffer.subarray(nextHeaderIndex);
                continue;
            }

            if (this.buffer.length < frameLength) {
                break;
            }

            const frame = this.buffer.subarray(0, frameLength);
            if (
                frameLength === 8
                && !RECOVERABLE_STATE_HEADERS.has(frame[0])
                && !hasValidChecksum(frame)
            ) {
                const recoverable = findRecoverableFrame(this.buffer, this.packetLengths);
                if (recoverable) {
                    recordCorrupted(frame, 'checksum_mismatch_before_resync', {
                        recovered_offset: recoverable.index,
                        recovered_header_hex: recoverable.needsMoreData ? undefined : byteToHex(recoverable.frame[0]),
                        recovered_frame_hex: recoverable.needsMoreData ? undefined : formatBytes(recoverable.frame),
                        recovery_status: recoverable.needsMoreData ? 'waiting_for_more_data' : 'recovered',
                    });

                    if (recoverable.index > 0) {
                        recordDrop(this.buffer.subarray(0, recoverable.index), 'checksum_mismatch_before_recovered_frame', {
                            recovered_offset: recoverable.index,
                            recovered_header_hex: recoverable.needsMoreData ? undefined : byteToHex(recoverable.frame[0]),
                            recovered_frame_hex: recoverable.needsMoreData ? undefined : formatBytes(recoverable.frame),
                            recovery_status: recoverable.needsMoreData ? 'waiting_for_more_data' : 'recovered',
                        });
                        this.buffer = this.buffer.subarray(recoverable.index);
                    }

                    if (recoverable.needsMoreData) {
                        break;
                    }

                    recordRecoveredFrame(recoverable.frame, 'checksum_valid_frame_after_resync', recoverable.index);
                    continue;
                }

                recordCorrupted(frame, 'checksum_mismatch_without_recovery', {
                    recovery_status: 'not_recovered',
                });
            }

            frames.push([...frame]);
            this.buffer = this.buffer.subarray(frameLength);
        }

        if (this.buffer.length > this.maxBufferBytes) {
            recordDrop(this.buffer, 'max_buffer_exceeded', {
                max_buffer_bytes: this.maxBufferBytes,
            });
            this.buffer = Buffer.alloc(0);
        }

        const result = { frames, dropped };
        if (recovered.length > 0) {
            result.recovered = recovered.map((frame) => frame.bytes);
            result.recoveredDetails = recovered;
        }
        if (droppedDetails.length > 0) {
            result.droppedDetails = droppedDetails;
        }
        if (corrupted.length > 0) {
            result.corrupted = corrupted;
        }

        return result;
    }
}

function formatBytes(bytes) {
    return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
}

module.exports = {
    DEFAULT_PACKET_LENGTHS,
    METERING_PACKET_LENGTHS,
    PacketFramer,
    PRIMARY_PACKET_LENGTHS,
    formatBytes,
    resolveMeteringFrameLength,
};

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

const DEFAULT_PACKET_LENGTHS = new Map([
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
    [0xF7, resolveMeteringFrameLength],
]);

const DEFAULT_MAX_BUFFER_BYTES = 256;

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

        while (this.buffer.length > 0) {
            const frameLength = resolveFrameLength(this.buffer, this.packetLengths);

            if (frameLength === null) {
                break;
            }

            if (!frameLength) {
                const nextHeaderIndex = findNextKnownHeader(this.buffer, this.packetLengths);

                if (nextHeaderIndex === -1) {
                    dropped.push(this.buffer);
                    this.buffer = Buffer.alloc(0);
                    break;
                }

                dropped.push(this.buffer.subarray(0, nextHeaderIndex));
                this.buffer = this.buffer.subarray(nextHeaderIndex);
                continue;
            }

            if (this.buffer.length < frameLength) {
                break;
            }

            frames.push([...this.buffer.subarray(0, frameLength)]);
            this.buffer = this.buffer.subarray(frameLength);
        }

        if (this.buffer.length > this.maxBufferBytes) {
            dropped.push(this.buffer);
            this.buffer = Buffer.alloc(0);
        }

        return { frames, dropped };
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
    PacketFramer,
    formatBytes,
    resolveMeteringFrameLength,
};

const { calculateChecksum, formatBytes } = require('./utils');
const { RESPONSE_LENGTH, RESPONSE_PREFIX } = require('./lgProtocol');

const DEFAULT_PACKET_LENGTHS = new Map([
    [0x80, 8],
    [RESPONSE_PREFIX, RESPONSE_LENGTH],
]);

function hasValidChecksum(bytes) {
    if (!bytes || bytes.length < 8) {
        return false;
    }

    return calculateChecksum(bytes.slice(0, bytes.length - 1)) === bytes[bytes.length - 1];
}

class PacketFramer {
    constructor({ packetLengths = DEFAULT_PACKET_LENGTHS, maxBufferBytes = 256 } = {}) {
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
            const frameLength = this.packetLengths.get(this.buffer[0]);

            if (!frameLength) {
                const nextKnownHeaderIndex = [...this.packetLengths.keys()]
                    .map((header) => this.buffer.indexOf(header, 1))
                    .filter((index) => index > 0)
                    .sort((a, b) => a - b)[0];

                if (nextKnownHeaderIndex) {
                    dropped.push([...this.buffer.subarray(0, nextKnownHeaderIndex)]);
                    this.buffer = this.buffer.subarray(nextKnownHeaderIndex);
                    continue;
                }

                if (this.buffer.length > this.maxBufferBytes) {
                    dropped.push([...this.buffer]);
                    this.buffer = Buffer.alloc(0);
                }
                break;
            }

            if (this.buffer.length < frameLength) {
                break;
            }

            const candidate = this.buffer.subarray(0, frameLength);
            if (hasValidChecksum(candidate)) {
                frames.push([...candidate]);
            } else {
                dropped.push([this.buffer[0]]);
                this.buffer = this.buffer.subarray(1);
                continue;
            }

            this.buffer = this.buffer.subarray(frameLength);
        }

        if (this.buffer.length > this.maxBufferBytes) {
            dropped.push([...this.buffer]);
            this.buffer = Buffer.alloc(0);
        }

        return { frames, dropped };
    }
}

module.exports = {
    DEFAULT_PACKET_LENGTHS,
    PacketFramer,
    STATUS_RESPONSE_LENGTH: RESPONSE_LENGTH,
    formatBytes,
    hasValidChecksum,
};

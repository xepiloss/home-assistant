const fs = require('fs').promises;
const path = require('path');
const { formatBytes } = require('./packetFramer');
const { log, logError } = require('./utils');

function createPacketCapture({ enabled = false, filePath = '/share/commax_unknown_packets.jsonl' } = {}) {
    let writeQueue = Promise.resolve();
    let hasLoggedStart = false;

    async function append(record) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    }

    function record({ source, kind, bytes, note }) {
        if (!enabled || !bytes || bytes.length === 0) {
            return;
        }

        if (!hasLoggedStart) {
            log(`알 수 없는 패킷 캡처를 시작합니다: ${filePath}`);
            hasLoggedStart = true;
        }

        const normalizedBytes = [...bytes];
        const entry = {
            timestamp: new Date().toISOString(),
            source,
            kind,
            note,
            length: normalizedBytes.length,
            header: normalizedBytes[0]?.toString(16).padStart(2, '0').toUpperCase(),
            hex: formatBytes(normalizedBytes),
        };

        writeQueue = writeQueue
            .catch(() => undefined)
            .then(() => append(entry))
            .catch((err) => {
                logError(`알 수 없는 패킷 캡처 저장 실패 (${filePath}):`, err);
            });
    }

    async function flush() {
        await writeQueue.catch(() => undefined);
    }

    return {
        enabled,
        flush,
        record,
    };
}

module.exports = {
    createPacketCapture,
};

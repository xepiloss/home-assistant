function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function log(...args) {
    console.log(`${getTimestamp()}`, ...args);
}

function logError(...args) {
    console.error(`${getTimestamp()} ERROR:`, ...args);
}

function formatBytes(bytes) {
    return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
}

function calculateChecksum(bytes) {
    const sum = [...bytes].reduce((acc, byte) => acc + byte, 0);
    return (sum & 0xFF) ^ 0x55;
}

module.exports = {
    calculateChecksum,
    formatBytes,
    getTimestamp,
    log,
    logError,
};

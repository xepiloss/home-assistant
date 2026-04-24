const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createPacketCapture } = require('../src/packetCapture');

test('createPacketCapture writes unknown packet records as json lines', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const capture = createPacketCapture({ enabled: true, filePath: capturePath });

    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x57, 0x00, 0x01],
        note: 'test packet',
    });
    await capture.flush();

    const [line] = (await fs.readFile(capturePath, 'utf8')).trim().split('\n');
    const record = JSON.parse(line);

    assert.equal(record.source, '메인 EW11');
    assert.equal(record.kind, 'unhandled_frame');
    assert.equal(record.length, 3);
    assert.equal(record.header, '57');
    assert.equal(record.hex, '57 00 01');
    assert.equal(record.note, 'test packet');
});

test('createPacketCapture does not write when disabled', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-disabled-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const capture = createPacketCapture({ enabled: false, filePath: capturePath });

    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x57],
    });
    await capture.flush();

    await assert.rejects(() => fs.readFile(capturePath, 'utf8'), { code: 'ENOENT' });
});

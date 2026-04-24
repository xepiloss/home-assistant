const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createPacketCapture } = require('../src/packetCapture');

test('createPacketCapture writes unknown packet records as json lines', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const capture = createPacketCapture({
        enabled: true,
        filePath: capturePath,
        now: () => new Date('2026-04-25T00:00:00.000Z'),
    });

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
    assert.equal(record.first_seen, '2026-04-25T00:00:00.000Z');
    assert.equal(record.last_seen, '2026-04-25T00:00:00.000Z');
    assert.equal(record.count, 1);
    assert.deepEqual(record.seen_at, ['2026-04-25T00:00:00.000Z']);
});

test('createPacketCapture groups duplicate packets and accumulates receive times', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-grouped-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const timestamps = [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:02:00.000Z',
    ];
    const capture = createPacketCapture({
        enabled: true,
        filePath: capturePath,
        now: () => new Date(timestamps.shift()),
    });

    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x57, 0x00, 0x01],
        note: 'first note',
    });
    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x57, 0x00, 0x01],
        note: 'second note',
    });
    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x58, 0x00, 0x01],
        note: 'different packet',
    });
    await capture.flush();

    const lines = (await fs.readFile(capturePath, 'utf8')).trim().split('\n');
    const records = lines.map((line) => JSON.parse(line));
    const groupedRecord = records.find((record) => record.hex === '57 00 01');

    assert.equal(records.length, 2);
    assert.equal(groupedRecord.count, 2);
    assert.equal(groupedRecord.first_seen, '2026-04-25T00:00:00.000Z');
    assert.equal(groupedRecord.last_seen, '2026-04-25T00:01:00.000Z');
    assert.deepEqual(groupedRecord.seen_at, [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
    ]);
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

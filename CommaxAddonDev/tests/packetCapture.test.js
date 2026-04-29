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
    assert.equal(record.repeat_interval_count, 0);
    assert.deepEqual(record.recent_seen_at, ['2026-04-25T00:00:00.000Z']);
    assert.equal(record.seen_at, undefined);
});

test('createPacketCapture groups duplicate packets and summarizes receive intervals', async () => {
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
    assert.equal(groupedRecord.repeat_interval_count, 1);
    assert.equal(groupedRecord.repeat_interval_last_ms, 60000);
    assert.equal(groupedRecord.repeat_interval_min_ms, 60000);
    assert.equal(groupedRecord.repeat_interval_max_ms, 60000);
    assert.equal(groupedRecord.repeat_interval_avg_ms, 60000);
    assert.deepEqual(groupedRecord.recent_seen_at, [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
    ]);
    assert.equal(groupedRecord.seen_at, undefined);
});

test('createPacketCapture keeps only recent receive samples for repeated packets', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-recent-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const timestamps = [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:02:00.000Z',
        '2026-04-25T00:03:00.000Z',
        '2026-04-25T00:04:00.000Z',
        '2026-04-25T00:05:00.000Z',
        '2026-04-25T00:06:00.000Z',
    ];
    const capture = createPacketCapture({
        enabled: true,
        filePath: capturePath,
        now: () => new Date(timestamps.shift()),
    });

    for (let index = 0; index < 7; index += 1) {
        capture.record({
            source: '메인 EW11',
            kind: 'unhandled_frame',
            bytes: [0x57, 0x00, 0x01],
            note: 'repeat packet',
        });
    }
    await capture.flush();

    const [line] = (await fs.readFile(capturePath, 'utf8')).trim().split('\n');
    const record = JSON.parse(line);

    assert.equal(record.count, 7);
    assert.equal(record.first_seen, '2026-04-25T00:00:00.000Z');
    assert.equal(record.last_seen, '2026-04-25T00:06:00.000Z');
    assert.equal(record.repeat_interval_count, 6);
    assert.equal(record.repeat_interval_last_ms, 60000);
    assert.equal(record.repeat_interval_min_ms, 60000);
    assert.equal(record.repeat_interval_max_ms, 60000);
    assert.equal(record.repeat_interval_avg_ms, 60000);
    assert.deepEqual(record.recent_seen_at, [
        '2026-04-25T00:02:00.000Z',
        '2026-04-25T00:03:00.000Z',
        '2026-04-25T00:04:00.000Z',
        '2026-04-25T00:05:00.000Z',
        '2026-04-25T00:06:00.000Z',
    ]);
});

test('createPacketCapture keeps only recent context samples for repeated packets', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-context-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    const timestamps = [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:02:00.000Z',
        '2026-04-25T00:03:00.000Z',
        '2026-04-25T00:04:00.000Z',
        '2026-04-25T00:05:00.000Z',
        '2026-04-25T00:06:00.000Z',
    ];
    const capture = createPacketCapture({
        enabled: true,
        filePath: capturePath,
        now: () => new Date(timestamps.shift()),
    });

    for (let index = 0; index < 7; index += 1) {
        capture.record({
            source: '메인 EW11',
            kind: 'dropped_bytes',
            bytes: [0xAA],
            note: 'repeat packet',
            context: {
                traffic_origin: index % 2 === 0 ? 'stock_bus' : 'addon_command_window',
                chunk_hex: `AA 00 0${index}`,
                dropped_index: index + 1,
            },
        });
    }
    await capture.flush();

    const [line] = (await fs.readFile(capturePath, 'utf8')).trim().split('\n');
    const record = JSON.parse(line);

    assert.equal(record.count, 7);
    assert.equal(record.recent_contexts.length, 5);
    assert.deepEqual(
        record.recent_contexts.map((context) => context.seen_at),
        [
            '2026-04-25T00:02:00.000Z',
            '2026-04-25T00:03:00.000Z',
            '2026-04-25T00:04:00.000Z',
            '2026-04-25T00:05:00.000Z',
            '2026-04-25T00:06:00.000Z',
        ]
    );
    assert.deepEqual(
        record.recent_contexts.map((context) => context.chunk_hex),
        ['AA 00 02', 'AA 00 03', 'AA 00 04', 'AA 00 05', 'AA 00 06']
    );
    assert.equal(record.recent_contexts[1].traffic_origin, 'addon_command_window');
    assert.equal(record.recent_contexts[4].traffic_origin, 'stock_bus');
});

test('createPacketCapture compacts legacy seen_at records when updating', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commax-packet-capture-legacy-'));
    const capturePath = path.join(tempDir, 'unknown.jsonl');
    await fs.writeFile(capturePath, `${JSON.stringify({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        note: 'legacy packet',
        length: 3,
        header: '57',
        hex: '57 00 01',
        first_seen: '2026-04-25T00:00:00.000Z',
        last_seen: '2026-04-25T00:02:00.000Z',
        count: 3,
        seen_at: [
            '2026-04-25T00:00:00.000Z',
            '2026-04-25T00:01:00.000Z',
            '2026-04-25T00:02:00.000Z',
        ],
    })}\n`, 'utf8');

    const capture = createPacketCapture({
        enabled: true,
        filePath: capturePath,
        now: () => new Date('2026-04-25T00:03:00.000Z'),
    });

    capture.record({
        source: '메인 EW11',
        kind: 'unhandled_frame',
        bytes: [0x57, 0x00, 0x01],
        note: 'updated packet',
    });
    await capture.flush();

    const [line] = (await fs.readFile(capturePath, 'utf8')).trim().split('\n');
    const record = JSON.parse(line);

    assert.equal(record.count, 4);
    assert.equal(record.note, 'updated packet');
    assert.equal(record.first_seen, '2026-04-25T00:00:00.000Z');
    assert.equal(record.last_seen, '2026-04-25T00:03:00.000Z');
    assert.equal(record.repeat_interval_count, 3);
    assert.equal(record.repeat_interval_last_ms, 60000);
    assert.equal(record.repeat_interval_min_ms, 60000);
    assert.equal(record.repeat_interval_max_ms, 60000);
    assert.equal(record.repeat_interval_avg_ms, 60000);
    assert.deepEqual(record.recent_seen_at, [
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:02:00.000Z',
        '2026-04-25T00:03:00.000Z',
    ]);
    assert.equal(record.seen_at, undefined);
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

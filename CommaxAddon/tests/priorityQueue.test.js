const test = require('node:test');
const assert = require('node:assert/strict');

const PriorityQueue = require('../src/priorityQueue');

test('PriorityQueue preserves insertion order for equal priorities', () => {
    const queue = new PriorityQueue();

    queue.enqueue('first', 1);
    queue.enqueue('second', 1);
    queue.enqueue('third', 1);

    assert.equal(queue.dequeue().value, 'first');
    assert.equal(queue.dequeue().value, 'second');
    assert.equal(queue.dequeue().value, 'third');
});

test('PriorityQueue still dequeues lower priority values first', () => {
    const queue = new PriorityQueue();

    queue.enqueue('normal', 2);
    queue.enqueue('urgent', 1);
    queue.enqueue('normal-2', 2);

    assert.equal(queue.dequeue().value, 'urgent');
    assert.equal(queue.dequeue().value, 'normal');
    assert.equal(queue.dequeue().value, 'normal-2');
});

test('PriorityQueue removeWhere preserves heap ordering', () => {
    const queue = new PriorityQueue();

    queue.enqueue('first', 1);
    queue.enqueue('drop', 1);
    queue.enqueue('second', 1);
    queue.enqueue('urgent', 0);

    assert.equal(queue.removeWhere(({ value }) => value === 'drop'), 1);
    assert.equal(queue.dequeue().value, 'urgent');
    assert.equal(queue.dequeue().value, 'first');
    assert.equal(queue.dequeue().value, 'second');
});

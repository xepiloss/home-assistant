const test = require('node:test');
const assert = require('node:assert/strict');

const PriorityQueue = require('../src/priorityQueue');

test('PriorityQueue dequeues lower priority values first', () => {
    const queue = new PriorityQueue();

    queue.enqueue('normal', 2);
    queue.enqueue('urgent', 1);
    queue.enqueue('low', 3);

    assert.equal(queue.dequeue().value, 'urgent');
    assert.equal(queue.dequeue().value, 'normal');
    assert.equal(queue.dequeue().value, 'low');
});

test('PriorityQueue preserves FIFO order for equal priority values', () => {
    const queue = new PriorityQueue();

    queue.enqueue('first', 1);
    queue.enqueue('second', 1);
    queue.enqueue('third', 1);

    assert.equal(queue.dequeue().value, 'first');
    assert.equal(queue.dequeue().value, 'second');
    assert.equal(queue.dequeue().value, 'third');
});


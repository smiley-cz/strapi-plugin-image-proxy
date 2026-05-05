'use strict';

/*
 * Minimal FIFO concurrency limiter.
 *
 * createLimit(n) returns a function `limit(fn)` that runs `fn` immediately if
 * fewer than n jobs are currently running, or queues it otherwise. Jobs run in
 * submission order. Errors propagate to the returned promise; the slot is
 * always released regardless of success/failure.
 */
module.exports = function createLimit(max) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('createLimit: max must be a positive integer');
  }

  let active = 0;
  const queue = [];

  const dequeue = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        dequeue();
      });
  };

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      dequeue();
    });
  };
};

const assert = require('assert');

/**
 * Sequential push queue: ordering, spacing, retry/backoff, ETA from measured
 * data, pause/resume/cancel and summaries. Everything runs on an injected
 * clock so there are no sleeps and no flaky timing.
 */
describe('push queue', function () {
  let Q;

  before(async function () {
    Q = await import('../js/push-queue.js');
  });

  /** Deterministic scheduler: virtual time, manual advance. */
  function fakeClock() {
    let time = 0;
    let seq = 0;
    const timers = new Map();
    return {
      now: () => time,
      setTimeout(fn, ms) {
        const id = ++seq;
        timers.set(id, { at: time + Math.max(0, ms || 0), fn });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
      get pending() { return timers.size; },
      /** Runs due timers, advancing virtual time up to `ms`. */
      async advance(ms) {
        const target = time + ms;
        let guard = 0;
        while (guard++ < 1000) {
          let nextId = null;
          let next = null;
          for (const [id, entry] of timers) {
            if (entry.at <= target && (!next || entry.at < next.at)) { next = entry; nextId = id; }
          }
          if (!next) break;
          time = Math.max(time, next.at);
          timers.delete(nextId);
          next.fn();
          await Promise.resolve();
          await Promise.resolve();
        }
        time = target;
        await Promise.resolve();
      },
      async flush() {
        let guard = 0;
        while (timers.size && guard++ < 1000) await this.advance(1000);
        await Promise.resolve();
      },
    };
  }

  /** Uploader whose per-file behaviour is scripted. */
  function scriptedUpload(clock, script = {}) {
    const calls = [];
    const upload = (entry, ctx) => {
      const plan = script[entry.id] || { durationMs: 100, ok: true };
      calls.push({ id: entry.id, at: clock.now(), attempt: ctx.attempt });
      const behaviour = Array.isArray(plan) ? plan[Math.min(ctx.attempt - 1, plan.length - 1)] : plan;
      return new Promise((resolve) => {
        clock.setTimeout(() => {
          if (behaviour.progress !== false && ctx.onProgress) ctx.onProgress(entry.size, entry.size);
          resolve(behaviour.ok === false
            ? { ok: false, retriable: !!behaviour.retriable, error: behaviour.error || 'boom', retryAfterMs: behaviour.retryAfterMs }
            : { ok: true, result: { src: '/file/' + entry.id } });
        }, behaviour.durationMs == null ? 100 : behaviour.durationMs);
      });
    };
    return { upload, calls };
  }

  const items = (n, size = 1000) => Array.from({ length: n }, (_, i) => ({ id: 'f' + (i + 1), name: 'f' + (i + 1) + '.png', size }));

  function makeQueue(clock, upload, options = {}) {
    return Q.createPushQueue({
      upload,
      now: clock.now,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      random: () => 0.5,
      delayMs: 1000,
      jitterRatio: 0.25,
      retryBaseMs: 2000,
      ...options,
    });
  }

  it('uploads strictly one file at a time, in queue order', async function () {
    const clock = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];
    const queue = makeQueue(clock, (entry) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(entry.id);
      return new Promise((resolve) => clock.setTimeout(() => {
        inFlight -= 1;
        resolve({ ok: true });
      }, 100));
    });
    queue.enqueue(items(4));
    const run = queue.start();
    await clock.flush();
    await run;

    assert.strictEqual(maxInFlight, 1, 'never more than one active upload');
    assert.deepStrictEqual(order, ['f1', 'f2', 'f3', 'f4']);
    assert.strictEqual(queue.getState().phase, 'done');
    assert.strictEqual(queue.getState().stats.done, 4);
  });

  it('waits the configured delay (with jitter) between files', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload, { delayMs: 1000, jitterRatio: 0.25, random: () => 0.5 });
    queue.enqueue(items(3));
    const run = queue.start();
    await clock.flush();
    await run;

    // 100ms upload + 1000ms gap (jitter cancels out at random()=0.5).
    assert.deepStrictEqual(calls.map((c) => c.at), [0, 1100, 2200]);
    assert.strictEqual(calls.length, 3);
  });

  it('does not add a trailing delay after the last file', async function () {
    const clock = fakeClock();
    const { upload } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload);
    queue.enqueue(items(2));
    const run = queue.start();
    await clock.flush();
    const state = await run;
    assert.strictEqual(state.finishedAt, 1200, 'two uploads and exactly one gap');
  });

  it('exposes a visible countdown while waiting for the next upload', async function () {
    const clock = fakeClock();
    const { upload } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload, { delayMs: 2000, jitterRatio: 0 });
    queue.enqueue(items(2));
    const run = queue.start();
    await clock.advance(100);   // first upload settles
    await clock.advance(600);   // part-way through the gap
    const state = queue.getState();
    assert.strictEqual(state.phase, 'waiting');
    assert.strictEqual(state.waitReason, 'delay');
    assert.ok(state.waitMsRemaining > 1000 && state.waitMsRemaining <= 1400, String(state.waitMsRemaining));
    await clock.flush();
    await run;
  });

  it('retries transient failures with exponential backoff and jitter', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock, {
      f1: [
        { ok: false, retriable: true, durationMs: 50 },
        { ok: false, retriable: true, durationMs: 50 },
        { ok: true, durationMs: 50 },
      ],
    });
    const queue = makeQueue(clock, upload, { retryBaseMs: 2000, delayMs: 0 });
    queue.enqueue(items(1));
    const run = queue.start();
    await clock.flush();
    await run;

    assert.deepStrictEqual(calls.map((c) => c.attempt), [1, 2, 3]);
    // attempt 1 fails at 50 → wait 2000 → attempt 2 at 2050 → wait 4000 → attempt 3.
    assert.deepStrictEqual(calls.map((c) => c.at), [0, 2050, 6100]);
    assert.strictEqual(queue.getState().stats.done, 1);
    assert.strictEqual(queue.getState().entries[0].attempt, 3);
  });

  it('stops retrying after the bounded attempt count and keeps the file retryable', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock, {
      f1: { ok: false, retriable: true, durationMs: 10, error: 'flaky' },
    });
    const queue = makeQueue(clock, upload, { maxRetries: 2, delayMs: 0 });
    queue.enqueue(items(1));
    const run = queue.start();
    await clock.flush();
    await run;

    assert.strictEqual(calls.length, 3, 'initial attempt plus two retries');
    const entry = queue.getState().entries[0];
    assert.strictEqual(entry.state, 'failed');
    assert.strictEqual(entry.error, 'flaky');
    assert.strictEqual(queue.getState().stats.failed, 1);
  });

  it('never retries a permanent failure', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock, {
      f1: { ok: false, retriable: false, durationMs: 10, error: 'unsupported' },
    });
    const queue = makeQueue(clock, upload, { delayMs: 0 });
    queue.enqueue(items(1));
    const run = queue.start();
    await clock.flush();
    await run;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(queue.getState().entries[0].state, 'failed');
  });

  it('continues with later files after a permanent failure', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock, {
      f2: { ok: false, retriable: false, durationMs: 10 },
    });
    const queue = makeQueue(clock, upload, { delayMs: 500 });
    queue.enqueue(items(3));
    const run = queue.start();
    await clock.flush();
    const state = await run;

    assert.deepStrictEqual(calls.map((c) => c.id), ['f1', 'f2', 'f3']);
    assert.deepStrictEqual(state.entries.map((e) => e.state), ['synced', 'failed', 'synced']);
    assert.deepStrictEqual(
      { done: state.stats.done, failed: state.stats.failed, cancelled: state.stats.cancelled },
      { done: 2, failed: 1, cancelled: 0 },
    );
  });

  it('re-queues only the failed files on retryFailed, leaving synced ones alone', async function () {
    const clock = fakeClock();
    let failNext = true;
    const calls = [];
    const queue = makeQueue(clock, (entry, ctx) => {
      calls.push(entry.id + '#' + ctx.attempt);
      const shouldFail = entry.id === 'f2' && failNext;
      return new Promise((resolve) => clock.setTimeout(() => resolve(
        shouldFail ? { ok: false, retriable: false, error: 'nope' } : { ok: true },
      ), 10));
    }, { delayMs: 0 });
    queue.enqueue(items(3));
    const first = queue.start();
    await clock.flush();
    await first;
    assert.strictEqual(queue.getState().stats.failed, 1);

    failNext = false;
    calls.length = 0;
    const retry = queue.retryFailed();
    await clock.flush();
    const state = await retry;
    assert.deepStrictEqual(calls, ['f2#1'], 'only the failed file is retried');
    assert.strictEqual(state.stats.done, 3);
    assert.strictEqual(state.stats.failed, 0);
  });

  it('pauses after the active request settles and resumes where it stopped', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload, { delayMs: 1000 });
    queue.enqueue(items(3));
    const run = queue.start();

    await clock.advance(50);           // f1 in flight
    queue.pause();
    assert.strictEqual(queue.getState().current.id, 'f1', 'the in-flight upload is not killed');
    await clock.flush();
    await run;

    let state = queue.getState();
    assert.strictEqual(state.phase, 'paused');
    assert.strictEqual(state.stats.done, 1);
    assert.deepStrictEqual(calls.map((c) => c.id), ['f1']);
    assert.deepStrictEqual(state.entries.map((e) => e.state), ['synced', 'queued', 'queued']);

    const resumed = queue.resume();
    await clock.flush();
    state = await resumed;
    assert.strictEqual(state.phase, 'done');
    assert.deepStrictEqual(calls.map((c) => c.id), ['f1', 'f2', 'f3']);
  });

  it('cancel stops new work and preserves the remaining files', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload, { delayMs: 1000 });
    queue.enqueue(items(4));
    const run = queue.start();
    await clock.advance(50);
    queue.cancel();
    await clock.flush();
    const state = await run;

    assert.strictEqual(state.phase, 'cancelled');
    assert.deepStrictEqual(calls.map((c) => c.id), ['f1'], 'no further uploads start');
    assert.deepStrictEqual(state.entries.map((e) => e.state), ['synced', 'cancelled', 'cancelled', 'cancelled']);
    assert.strictEqual(state.stats.cancelled, 3, 'queued work is preserved, not discarded');

    // Cancelled work can be pushed again later.
    const again = queue.retryFailed();
    await clock.flush();
    assert.strictEqual((await again).stats.done, 4);
  });

  it('cancelling during a wait ends the wait immediately', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock);
    const queue = makeQueue(clock, upload, { delayMs: 5000 });
    queue.enqueue(items(3));
    const run = queue.start();
    await clock.advance(150);
    assert.strictEqual(queue.getState().phase, 'waiting');
    queue.cancel();
    await clock.advance(1);
    await run;
    assert.strictEqual(queue.getState().phase, 'cancelled');
    assert.strictEqual(calls.length, 1);
  });

  it('refuses to run while offline and keeps everything staged', async function () {
    const clock = fakeClock();
    const { upload, calls } = scriptedUpload(clock);
    let online = false;
    const queue = makeQueue(clock, upload, { isOnline: () => online });
    queue.enqueue(items(2));
    await queue.start();
    assert.strictEqual(calls.length, 0, 'no request is attempted offline');
    assert.strictEqual(queue.getState().phase, 'paused');
    assert.deepStrictEqual(queue.getState().entries.map((e) => e.state), ['queued', 'queued']);

    online = true;
    const resumed = queue.resume();
    await clock.flush();
    assert.strictEqual((await resumed).stats.done, 2);
  });

  describe('estimates', function () {
    it('reports no estimate before any real measurement exists', async function () {
      const clock = fakeClock();
      const { upload } = scriptedUpload(clock);
      const queue = makeQueue(clock, upload);
      queue.enqueue(items(3));
      assert.strictEqual(queue.getState().etaMs, null, 'estimating… rather than a fake number');
    });

    it('derives the estimate from measured throughput and the configured gaps', async function () {
      const clock = fakeClock();
      // 1000 bytes in 100ms → 10 bytes/ms.
      const { upload } = scriptedUpload(clock, {});
      const queue = makeQueue(clock, upload, { delayMs: 1000, jitterRatio: 0 });
      queue.enqueue(items(3));
      const run = queue.start();
      await clock.advance(100);        // f1 done, now waiting
      const state = queue.getState();
      assert.ok(state.etaMs > 0);
      // 2 files × 1000 bytes ÷ 10 bytes/ms = 200ms transfer + 1 remaining gap.
      assert.strictEqual(state.etaMs, 1200);
      await clock.flush();
      await run;
      assert.strictEqual(queue.getState().etaMs, null, 'no estimate once finished');
    });

    it('uses the in-flight file\'s own rate when it is the last big one', async function () {
      const clock = fakeClock();
      const upload = (entry, ctx) => new Promise((resolve) => {
        // Report progress half-way, then finish much later.
        clock.setTimeout(() => ctx.onProgress(entry.size / 2, entry.size), 100);
        clock.setTimeout(() => resolve({ ok: true }), 400);
      });
      const queue = makeQueue(clock, upload, { delayMs: 0 });
      queue.enqueue([{ id: 'small', name: 'a', size: 100 }, { id: 'big', name: 'b', size: 10000 }]);
      const run = queue.start();
      await clock.advance(400);      // small file done (100 bytes / 400ms)
      await clock.advance(100);      // big file reports 50%
      const state = queue.getState();
      assert.strictEqual(state.current.id, 'big');
      // 5000 bytes remaining at the measured 50 bytes/ms of this very file.
      assert.strictEqual(state.etaMs, 100);
      await clock.flush();
      await run;
    });

    it('falls back to measured per-file duration when sizes are unknown', async function () {
      const clock = fakeClock();
      const { upload } = scriptedUpload(clock, {});
      const queue = makeQueue(clock, upload, { delayMs: 500, jitterRatio: 0 });
      queue.enqueue([{ id: 'f1', name: 'a', size: 0 }, { id: 'f2', name: 'b', size: 0 }, { id: 'f3', name: 'c', size: 0 }]);
      const run = queue.start();
      await clock.advance(100);
      const state = queue.getState();
      // 2 files × 100ms measured + 1 gap of 500ms.
      assert.strictEqual(state.etaMs, 700);
      await clock.flush();
      await run;
    });

    it('rounds estimates so the display does not flicker', function () {
      assert.strictEqual(Q.roundEtaMs(null), null);
      assert.strictEqual(Q.roundEtaMs(400), 1000);
      assert.strictEqual(Q.roundEtaMs(7400), 7000);
      assert.strictEqual(Q.roundEtaMs(7600), 8000);
      assert.strictEqual(Q.roundEtaMs(48000), 50000);
      assert.strictEqual(Q.roundEtaMs(200000), 195000);
      assert.strictEqual(Q.roundEtaMs(1000000), 1020000);
    });
  });

  describe('failure classification', function () {
    it('treats network errors, 429, 408 and 5xx as transient', function () {
      assert.deepStrictEqual(Q.classifyFailure({ networkError: true }), { retriable: true, code: 'network' });
      assert.strictEqual(Q.classifyFailure({ status: 429 }).retriable, true);
      assert.strictEqual(Q.classifyFailure({ status: 408 }).retriable, true);
      assert.strictEqual(Q.classifyFailure({ status: 502 }).retriable, true);
      assert.strictEqual(Q.classifyFailure({ status: 503 }).code, 'server');
    });

    it('treats client errors as permanent', function () {
      assert.strictEqual(Q.classifyFailure({ status: 400 }).retriable, false);
      assert.strictEqual(Q.classifyFailure({ status: 401 }).retriable, false);
      assert.strictEqual(Q.classifyFailure({ status: 413 }).retriable, false);
      assert.strictEqual(Q.classifyFailure({ status: 200 }).retriable, false);
    });

    it('parses Retry-After in seconds and as a date, within a sane cap', async function () {
      assert.strictEqual(Q.parseRetryAfter('5'), 5000);
      assert.strictEqual(Q.parseRetryAfter(' 2 '), 2000);
      assert.strictEqual(Q.parseRetryAfter(''), null);
      assert.strictEqual(Q.parseRetryAfter('not-a-date'), null);
      const future = new Date(Date.now() + 3000).toUTCString();
      const ms = Q.parseRetryAfter(future);
      assert.ok(ms > 1000 && ms <= 4000, String(ms));

      const clock = fakeClock();
      const queue = makeQueue(clock, () => Promise.resolve({ ok: true }));
      assert.strictEqual(queue._backoffMs(1, 5000), 5000, 'server hint wins');
      assert.strictEqual(queue._backoffMs(1, 10 * 60 * 1000), 60000, 'but is capped');
    });

    it('honours Retry-After when scheduling the retry', async function () {
      const clock = fakeClock();
      const { upload, calls } = scriptedUpload(clock, {
        f1: [
          { ok: false, retriable: true, durationMs: 10, retryAfterMs: 7000 },
          { ok: true, durationMs: 10 },
        ],
      });
      const queue = makeQueue(clock, upload, { retryBaseMs: 1000, delayMs: 0 });
      queue.enqueue(items(1));
      const run = queue.start();
      await clock.flush();
      await run;
      assert.deepStrictEqual(calls.map((c) => c.at), [0, 7010]);
    });
  });

  it('summarises the batch honestly', async function () {
    const clock = fakeClock();
    const { upload } = scriptedUpload(clock, {
      f2: { ok: false, retriable: false, durationMs: 10 },
    });
    const queue = makeQueue(clock, upload, { delayMs: 0 });
    queue.enqueue(items(4));
    const run = queue.start();
    await clock.advance(120);
    queue.cancel();
    await clock.flush();
    const state = await run;
    const { done, failed, cancelled, total } = state.stats;
    assert.strictEqual(total, 4);
    assert.strictEqual(done + failed + cancelled, 4, 'every file is accounted for');
    assert.ok(failed >= 1);
  });
});

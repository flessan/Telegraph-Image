/**
 * Sequential push queue.
 *
 * The workspace uploads one staged file at a time, on purpose: bursts of
 * parallel requests are the main cause of rate limiting and transient
 * failures, and a single active request is far easier to reason about.
 *
 * This module is a pure state machine. Everything that touches the outside
 * world — the uploader, the clock, timers and randomness — is injected, so the
 * queue can be unit tested deterministically with a fake clock and so the DOM
 * layer stays a thin renderer of `getState()`.
 *
 * Per-entry states: queued → uploading → (synced | retrying → uploading | failed | cancelled)
 * Queue phases:     idle | uploading | waiting | retrying | paused | done | cancelled
 */

export const ENTRY = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  RETRYING: 'retrying',
  SYNCED: 'synced',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const PHASE = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  WAITING: 'waiting',
  RETRYING: 'retrying',
  PAUSED: 'paused',
  DONE: 'done',
  CANCELLED: 'cancelled',
};

export const DEFAULTS = {
  // Calm, not slow: a short gap between files spreads a batch out without
  // making normal use frustrating.
  delayMs: 1200,
  jitterRatio: 0.25,
  maxRetries: 3,
  retryBaseMs: 2000,
  retryMaxMs: 30000,
  // A server-provided Retry-After is respected, but never beyond this.
  retryAfterCapMs: 60000,
  // Weight of the newest sample in the throughput/duration averages.
  smoothing: 0.4,
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

export function createPushQueue(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const upload = options.upload;
  if (typeof upload !== 'function') throw new Error('createPushQueue requires an upload function');

  const now = options.now || (() => Date.now());
  const timer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clear = options.clearTimeout || ((handle) => clearTimeout(handle));
  const random = options.random || Math.random;
  const onChange = options.onChange || (() => {});
  const isOnline = options.isOnline || (() => true);

  /** @type {Array<object>} insertion-ordered queue entries */
  let entries = [];
  let phase = PHASE.IDLE;
  let currentId = null;
  let pendingTimer = null;
  let waitUntil = 0;
  let waitReason = null;      // 'delay' | 'retry'
  let pauseRequested = false;
  let cancelRequested = false;
  let runPromise = null;
  // `running` is the authoritative flag: an entirely synchronous loop (for
  // example when offline) finishes before `runPromise` is even assigned.
  let running = false;
  let resumeSleep = null;     // resolves the current sleep early
  let startedAt = 0;
  let finishedAt = 0;

  // Measured history — the ETA never uses invented constants.
  let avgBytesPerMs = 0;
  let avgDurationMs = 0;
  let samples = 0;

  const notify = () => { onChange(getState()); };

  const findEntry = (id) => entries.find((entry) => entry.id === id);

  function makeEntry(item) {
    return {
      id: item.id,
      name: item.name,
      size: Number(item.size) || 0,
      state: ENTRY.QUEUED,
      attempt: 0,
      progress: 0,
      loaded: 0,
      error: null,
      errorCode: null,
      startedAt: 0,
      durationMs: 0,
      retryAt: 0,
      order: entries.length,
    };
  }

  /** Adds items to the back of the queue; known ids are re-queued in place. */
  function enqueue(items) {
    for (const item of items || []) {
      if (!item || !item.id) continue;
      const existing = findEntry(item.id);
      if (existing) {
        if (existing.state === ENTRY.SYNCED || existing.state === ENTRY.UPLOADING) continue;
        existing.state = ENTRY.QUEUED;
        existing.attempt = 0;
        existing.error = null;
        existing.errorCode = null;
        existing.progress = 0;
        existing.loaded = 0;
      } else {
        entries.push(makeEntry(item));
      }
    }
    notify();
    return getState();
  }

  function sleep(ms, reason) {
    waitUntil = now() + ms;
    waitReason = reason;
    phase = reason === 'retry' ? PHASE.RETRYING : PHASE.WAITING;
    notify();
    return new Promise((resolve) => {
      const finish = () => {
        pendingTimer = null;
        resumeSleep = null;
        waitUntil = 0;
        waitReason = null;
        resolve();
      };
      resumeSleep = () => {
        if (pendingTimer) clear(pendingTimer);
        finish();
      };
      pendingTimer = timer(finish, ms);
    });
  }

  /** Inter-file delay with a little jitter so batches are not perfectly periodic. */
  function nextDelayMs() {
    const base = Math.max(0, config.delayMs);
    if (!base) return 0;
    const jitter = base * clampNumber(config.jitterRatio, 0, 1);
    return Math.round(base - jitter / 2 + random() * jitter);
  }

  /** Exponential backoff with jitter, honoring a sane Retry-After. */
  function backoffMs(attempt, retryAfterMs) {
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.round(clampNumber(retryAfterMs, 0, config.retryAfterCapMs));
    }
    const exponential = config.retryBaseMs * Math.pow(2, Math.max(0, attempt - 1));
    const capped = Math.min(exponential, config.retryMaxMs);
    const jitter = capped * 0.25;
    return Math.round(capped - jitter / 2 + random() * jitter);
  }

  function recordSample(entry, durationMs) {
    const alpha = clampNumber(config.smoothing, 0.05, 1);
    if (durationMs > 0) {
      avgDurationMs = samples ? avgDurationMs * (1 - alpha) + durationMs * alpha : durationMs;
      if (entry.size > 0) {
        const bpms = entry.size / durationMs;
        avgBytesPerMs = samples && avgBytesPerMs ? avgBytesPerMs * (1 - alpha) + bpms * alpha : bpms;
      }
    }
    samples += 1;
  }

  function nextQueued() {
    return entries.find((entry) => entry.state === ENTRY.QUEUED);
  }

  async function runOne(entry) {
    entry.state = ENTRY.UPLOADING;
    entry.attempt += 1;
    entry.progress = 0;
    entry.loaded = 0;
    entry.error = null;
    entry.startedAt = now();
    currentId = entry.id;
    phase = PHASE.UPLOADING;
    notify();

    let result;
    try {
      result = await upload(entry, {
        attempt: entry.attempt,
        onProgress: (loaded, total) => {
          if (entry.state !== ENTRY.UPLOADING) return;
          const size = total || entry.size || 0;
          entry.loaded = Math.min(loaded, size || loaded);
          entry.progress = size ? clampNumber(entry.loaded / size, 0, 1) : 0;
          notify();
        },
      });
    } catch (error) {
      result = { ok: false, retriable: true, error: error && error.message };
    }

    const duration = Math.max(0, now() - entry.startedAt);
    currentId = null;

    if (result && result.ok) {
      entry.state = ENTRY.SYNCED;
      entry.progress = 1;
      entry.loaded = entry.size;
      entry.durationMs = duration;
      entry.error = null;
      recordSample(entry, duration);
      notify();
      return 'synced';
    }

    entry.error = (result && result.error) || null;
    entry.errorCode = (result && result.code) || null;
    entry.durationMs = duration;

    const retriable = !!(result && result.retriable);
    const canRetry = retriable && entry.attempt <= config.maxRetries && !cancelRequested;
    if (!canRetry) {
      entry.state = ENTRY.FAILED;
      entry.progress = 0;
      notify();
      return 'failed';
    }

    entry.state = ENTRY.RETRYING;
    const wait = backoffMs(entry.attempt, result && result.retryAfterMs);
    entry.retryAt = now() + wait;
    notify();
    await sleep(wait, 'retry');
    if (cancelRequested) {
      entry.state = ENTRY.FAILED;
      notify();
      return 'failed';
    }
    entry.state = ENTRY.QUEUED;
    notify();
    return 'retry';
  }

  async function loop() {
    startedAt = startedAt || now();
    while (true) {
      if (cancelRequested) break;
      if (pauseRequested) {
        phase = PHASE.PAUSED;
        notify();
        break;
      }
      if (!isOnline()) {
        // Offline is a clean stop, not a failure: staged files stay intact.
        phase = PHASE.PAUSED;
        pauseRequested = true;
        notify();
        break;
      }
      const entry = nextQueued();
      if (!entry) break;

      const outcome = await runOne(entry);
      if (cancelRequested) break;
      if (outcome === 'retry') continue;      // already waited out the backoff

      if (pauseRequested) {
        phase = PHASE.PAUSED;
        notify();
        break;
      }
      // Only pause between files, and only when there is another file to do.
      if (nextQueued()) {
        await sleep(nextDelayMs(), 'delay');
        if (cancelRequested || pauseRequested) {
          phase = cancelRequested ? PHASE.CANCELLED : PHASE.PAUSED;
          notify();
          break;
        }
      }
    }

    if (cancelRequested) {
      for (const entry of entries) {
        if (entry.state === ENTRY.QUEUED || entry.state === ENTRY.RETRYING) entry.state = ENTRY.CANCELLED;
      }
      phase = PHASE.CANCELLED;
      finishedAt = now();
    } else if (!nextQueued() && !pauseRequested) {
      phase = PHASE.DONE;
      finishedAt = now();
    }
    running = false;
    runPromise = null;
    notify();
    return getState();
  }

  /** Starts (or restarts) processing. Safe to call while already running. */
  function start() {
    if (running) return runPromise;
    if (!nextQueued()) {
      phase = entries.length ? PHASE.DONE : PHASE.IDLE;
      notify();
      return Promise.resolve(getState());
    }
    cancelRequested = false;
    pauseRequested = false;
    startedAt = now();
    finishedAt = 0;
    running = true;
    const pending = loop();
    // If the loop already settled synchronously, do not hold on to it.
    runPromise = running ? pending : null;
    return pending;
  }

  /**
   * Pause after the in-flight request settles. The active upload is allowed to
   * finish so no work and no server-side effect is thrown away.
   */
  function pause() {
    if (phase === PHASE.DONE || phase === PHASE.CANCELLED) return getState();
    pauseRequested = true;
    // A pending inter-file or backoff sleep ends immediately; the loop then
    // parks in the paused state instead of starting the next file.
    if (resumeSleep) resumeSleep();
    if (!running) {
      phase = PHASE.PAUSED;
      notify();
    }
    return getState();
  }

  function resume() {
    if (phase === PHASE.CANCELLED) return getState();
    pauseRequested = false;
    return start();
  }

  /** Stops starting new work; queued files stay staged locally. */
  function cancel() {
    cancelRequested = true;
    pauseRequested = false;
    if (resumeSleep) resumeSleep();
    if (!running) {
      for (const entry of entries) {
        if (entry.state === ENTRY.QUEUED || entry.state === ENTRY.RETRYING) entry.state = ENTRY.CANCELLED;
      }
      phase = PHASE.CANCELLED;
      finishedAt = now();
      notify();
    }
    return getState();
  }

  /** Puts failed/cancelled entries back into the same sequential queue. */
  function retryFailed(ids) {
    const wanted = ids && ids.length ? new Set(ids) : null;
    let requeued = 0;
    for (const entry of entries) {
      if (wanted && !wanted.has(entry.id)) continue;
      if (entry.state !== ENTRY.FAILED && entry.state !== ENTRY.CANCELLED) continue;
      entry.state = ENTRY.QUEUED;
      entry.attempt = 0;
      entry.error = null;
      entry.errorCode = null;
      entry.progress = 0;
      requeued += 1;
    }
    // Also picks up anything freshly enqueued by the caller (for example a
    // file that failed in an earlier, already dismissed batch).
    if (!requeued && !nextQueued()) return Promise.resolve(getState());
    cancelRequested = false;
    return start();
  }

  /** Drops finished entries so a later push starts from a clean surface. */
  function reset() {
    if (running) return getState();
    entries = [];
    phase = PHASE.IDLE;
    currentId = null;
    waitUntil = 0;
    waitReason = null;
    pauseRequested = false;
    cancelRequested = false;
    startedAt = 0;
    finishedAt = 0;
    notify();
    return getState();
  }

  function stats() {
    let done = 0; let failed = 0; let cancelled = 0; let remaining = 0;
    let bytesTotal = 0; let bytesDone = 0; let bytesRemaining = 0;
    for (const entry of entries) {
      bytesTotal += entry.size;
      if (entry.state === ENTRY.SYNCED) { done += 1; bytesDone += entry.size; continue; }
      if (entry.state === ENTRY.FAILED) { failed += 1; continue; }
      if (entry.state === ENTRY.CANCELLED) { cancelled += 1; continue; }
      remaining += 1;
      if (entry.state === ENTRY.UPLOADING) {
        bytesDone += entry.size * entry.progress;
        bytesRemaining += entry.size * (1 - entry.progress);
      } else {
        bytesRemaining += entry.size;
      }
    }
    return {
      total: entries.length,
      done,
      failed,
      cancelled,
      remaining,
      processed: done + failed + cancelled,
      bytesTotal,
      bytesDone,
      bytesRemaining,
    };
  }

  /**
   * Estimated milliseconds remaining, or null while there is no real data yet.
   * Uses measured throughput when file sizes are known, otherwise measured
   * per-file durations, and always adds the inter-file delays still to come.
   */
  function estimateMs() {
    if (phase === PHASE.DONE || phase === PHASE.CANCELLED || phase === PHASE.IDLE) return null;
    const s = stats();
    if (!s.remaining) return 0;
    if (!samples && !currentId) return null;

    const gaps = Math.max(0, s.remaining - 1) * Math.max(0, config.delayMs);
    const current = currentId ? findEntry(currentId) : null;

    // Enough throughput data and real sizes: estimate from bytes.
    if (avgBytesPerMs > 0 && s.bytesRemaining > 0) {
      let bytesRemaining = s.bytesRemaining;
      let transferMs = bytesRemaining / avgBytesPerMs;
      // For the current file prefer its own measured rate once it is underway.
      if (current && current.progress > 0.05 && current.size > 0) {
        const elapsed = Math.max(1, now() - current.startedAt);
        const rate = (current.size * current.progress) / elapsed;
        if (rate > 0) {
          const currentRemaining = current.size * (1 - current.progress);
          transferMs = (bytesRemaining - currentRemaining) / avgBytesPerMs + currentRemaining / rate;
        }
      }
      return Math.max(0, Math.round(transferMs + gaps));
    }

    if (!samples) return null;
    // No usable byte information: fall back to measured per-file duration.
    const perFile = avgDurationMs || 0;
    if (!perFile) return null;
    const currentShare = current ? perFile * (1 - current.progress) : 0;
    const others = Math.max(0, s.remaining - (current ? 1 : 0)) * perFile;
    return Math.max(0, Math.round(currentShare + others + gaps));
  }

  function getState() {
    const s = stats();
    const current = currentId ? findEntry(currentId) : null;
    const waitingEntry = entries.find((entry) => entry.state === ENTRY.RETRYING) || null;
    return {
      phase,
      entries: entries.map((entry) => ({ ...entry })),
      current: current ? { ...current } : null,
      retrying: waitingEntry ? { ...waitingEntry } : null,
      stats: s,
      waitMsRemaining: waitUntil ? Math.max(0, waitUntil - now()) : 0,
      waitReason,
      etaMs: estimateMs(),
      hasMeasurements: samples > 0,
      startedAt,
      finishedAt,
      active: running,
      config: { delayMs: config.delayMs, maxRetries: config.maxRetries },
    };
  }

  return {
    enqueue, start, pause, resume, cancel, retryFailed, reset, getState,
    // exposed for tests and for the UI's countdown ticker
    _backoffMs: backoffMs,
    _nextDelayMs: nextDelayMs,
  };
}

/**
 * Classifies an upload response into the queue's retry policy.
 * Network errors, 408/425/429 and 5xx are transient; everything else is a
 * permanent failure that must not be hammered.
 */
export function classifyFailure({ status, networkError } = {}) {
  if (networkError) return { retriable: true, code: 'network' };
  if (status === 429) return { retriable: true, code: 'rate-limited' };
  if (status === 408 || status === 425) return { retriable: true, code: 'timeout' };
  if (status >= 500 && status < 600) return { retriable: true, code: 'server' };
  return { retriable: false, code: status ? 'http-' + status : 'unknown' };
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null || value === '') return null;
  const seconds = Number(String(value).trim());
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
  const date = Date.parse(String(value));
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

/** Rounds an ETA to a value that does not flicker between renders. */
export function roundEtaMs(ms) {
  if (ms == null) return null;
  const seconds = ms / 1000;
  if (seconds <= 1) return 1000;
  if (seconds < 20) return Math.round(seconds) * 1000;
  if (seconds < 120) return Math.round(seconds / 5) * 5000;
  if (seconds < 600) return Math.round(seconds / 15) * 15000;
  return Math.round(seconds / 60) * 60000;
}

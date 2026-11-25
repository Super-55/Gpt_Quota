import { readAccountRateLimits, abortAccountReads } from './account.mjs';
import { DEFAULT_QUOTA_REFRESH_SECONDS } from '../shared/settings.mjs';

export const QUOTA_REFRESH_INTERVAL_MS = DEFAULT_QUOTA_REFRESH_SECONDS * 1000;

function checkInterval(intervalMs) {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new RangeError('额度刷新间隔必须为正整数毫秒。');
}

const readFailure = () => ({ ok: false, error: '账户额度读取失败；保留最近可用的额度数据。' });

/**
 * Account reads run independently from local-log scans. Missed interval ticks are
 * coalesced into the current read, never queued up for later account requests.
 * refresh() is a no-op while stopped or disabled. A stopped generation can still
 * resolve for its caller, but cannot update either application window.
 */
export function createQuotaMonitor({
  read = readAccountRateLimits,
  onResult = () => {},
  intervalMs = QUOTA_REFRESH_INTERVAL_MS,
  enabled = () => true,
} = {}) {
  checkInterval(intervalMs);
  if (typeof read !== 'function' || typeof onResult !== 'function' || typeof enabled !== 'function') {
    throw new TypeError('额度监控回调必须为函数。');
  }
  let running = false;
  let generation = 0;
  let timer = null;
  let active = null;

  const isEnabled = () => {
    try { return Boolean(enabled()); } catch { return false; }
  };

  function refresh() {
    if (!running || !isEnabled()) return Promise.resolve(null);
    if (active) return active.promise;
    const request = { generation, promise: null };
    // Defer read to a microtask so synchronous readers also share the same
    // in-flight promise, and synchronous exceptions enter the failure path.
    request.promise = Promise.resolve().then(async () => {
      // stop() may run in the same turn as start(), before the reader begins.
      if (!running || request.generation !== generation || !isEnabled()) return null;
      let result;
      try {
        result = await read();
        if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') result = readFailure();
      } catch {
        // Child-process or RPC errors can contain private diagnostics. Return a
        // stable, safe failure instead of exposing the original exception.
        result = readFailure();
      }
      if (running && request.generation === generation && isEnabled()) await onResult(result);
      return result;
    }).finally(() => {
      if (active === request) active = null;
    });
    active = request;
    return request.promise;
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
      // A consumer failing to apply a result must not stop future polling or
      // create an unhandled rejection in the scheduled callback.
      void refresh().catch(() => {});
    }, intervalMs);
    timer.unref?.();
  }

  function setIntervalMs(next) {
    checkInterval(next);
    if (next === intervalMs) return;
    intervalMs = next;
    if (running) schedule();
  }

  function start() {
    if (running) return active?.promise ?? Promise.resolve(null);
    running = true;
    const currentGeneration = ++generation;
    schedule();
    // A restart waits for an outstanding injected reader to settle, preserving
    // the no-overlap guarantee even when that reader has no cancellation API.
    if (active) return active.promise.catch(() => null).then(() =>
      running && generation === currentGeneration ? refresh() : null);
    return refresh();
  }

  function stop() {
    running = false;
    generation += 1;
    clearInterval(timer);
    timer = null;
    if (read === readAccountRateLimits) abortAccountReads();
  }

  return { start, stop, refresh, setIntervalMs };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaMonitor, QUOTA_REFRESH_INTERVAL_MS } from '../electron/quota-monitor.mjs';

const success = { ok: true, rateLimits: [{ id: 'codex', used: 40, windowMinutes: 10080 }], updatedAt: '2026-10-24T00:00:00Z' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('default account polling reads immediately and then every five seconds', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const received = [];
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => { reads++; return success; }, onResult: result => received.push(result) });
  context.after(() => monitor.stop());
  assert.equal(QUOTA_REFRESH_INTERVAL_MS, 5000);
  assert.equal(await monitor.start(), success);
  assert.equal(reads, 1);
  context.mock.timers.tick(4999); await flush();
  assert.equal(reads, 1);
  context.mock.timers.tick(1); await flush();
  assert.equal(reads, 2);
  context.mock.timers.tick(5000); await flush();
  assert.equal(reads, 3);
  assert.deepEqual(received, [success, success, success]);
});

test('refresh and interval ticks merge into an in-flight read without a backlog', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let reads = 0;
  const pending = deferred();
  const monitor = createQuotaMonitor({ read: () => { reads++; return reads === 1 ? pending.promise : success; } });
  context.after(() => monitor.stop());
  const first = monitor.start();
  await flush();
  assert.equal(monitor.refresh(), first);
  assert.equal(monitor.start(), first);
  context.mock.timers.tick(15000); await flush();
  assert.equal(reads, 1);
  pending.resolve(success);
  assert.equal(await first, success);
  await flush();
  assert.equal(reads, 1);
  context.mock.timers.tick(5000); await flush();
  assert.equal(reads, 2);
});

test('changing the quota interval reschedules the timer without interrupting an active read', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const pending = deferred();
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => ++reads === 1 ? pending.promise : success });
  context.after(() => monitor.stop());
  const first = monitor.start();
  await flush();
  context.mock.timers.tick(3000);
  monitor.setIntervalMs(10000);
  assert.equal(monitor.refresh(), first);
  pending.resolve(success);
  await first;
  for (const interval of [10000, 30000, 60000, 5000]) {
    monitor.setIntervalMs(interval);
    const before = reads;
    context.mock.timers.tick(interval - 1); await flush();
    assert.equal(reads, before);
    context.mock.timers.tick(1); await flush();
    assert.equal(reads, before + 1);
  }
});

test('disabled monitor skips immediate, scheduled, and manual requests, then recovers', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let enabled = false, reads = 0;
  const monitor = createQuotaMonitor({ enabled: () => enabled, read: () => { reads++; return success; } });
  context.after(() => monitor.stop());
  assert.equal(await monitor.start(), null);
  assert.equal(await monitor.refresh(), null);
  context.mock.timers.tick(10000); await flush();
  assert.equal(reads, 0);
  enabled = true;
  context.mock.timers.tick(5000); await flush();
  assert.equal(reads, 1);
});

test('stop clears scheduled reads and suppresses a late result', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const pending = deferred(), received = [];
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => { reads++; return pending.promise; }, onResult: result => received.push(result) });
  const request = monitor.start();
  await flush();
  monitor.stop();
  pending.resolve(success);
  assert.equal(await request, success);
  context.mock.timers.tick(20000); await flush();
  assert.equal(await monitor.refresh(), null);
  assert.equal(reads, 1);
  assert.deepEqual(received, []);
});

test('stopping before immediate microtask prevents even the initial read', async () => {
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => { reads++; return success; } });
  const request = monitor.start();
  monitor.stop();
  assert.equal(await request, null);
  assert.equal(reads, 0);
});

test('read exceptions are safe failures, and the next scheduled read recovers', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const received = [];
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => {
    reads++;
    if (reads === 1) throw new Error('private token or process diagnostics');
    return success;
  }, onResult: result => received.push(result) });
  context.after(() => monitor.stop());
  const failed = await monitor.start();
  assert.equal(failed.ok, false);
  assert.equal(typeof failed.error, 'string');
  assert.equal('rateLimits' in failed, false);
  assert.equal(JSON.stringify(failed).includes('private token'), false);
  context.mock.timers.tick(5000); await flush();
  assert.equal(reads, 2);
  assert.deepEqual(received, [failed, success]);
});

test('explicit account failures pass through without fabricating quotas', async () => {
  const failed = { ok: false, error: '账户额度接口不可用或尚未登录。' };
  const monitor = createQuotaMonitor({ read: () => Promise.resolve(failed) });
  try { assert.equal(await monitor.start(), failed); } finally { monitor.stop(); }
});

test('restart waits for the stopped read, suppresses its result, then reads immediately', async () => {
  const pending = deferred(), received = [];
  let reads = 0;
  const monitor = createQuotaMonitor({ read: () => ++reads === 1 ? pending.promise : success, onResult: result => received.push(result) });
  try {
    const first = monitor.start(); await flush();
    monitor.stop();
    const restarted = monitor.start(); await flush();
    assert.equal(reads, 1);
    pending.resolve(success);
    await Promise.all([first, restarted]);
    assert.equal(reads, 2);
    assert.deepEqual(received, [success]);
  } finally { monitor.stop(); }
});

test('switching to disabled before a read settles suppresses its notification', async () => {
  const pending = deferred(), received = [];
  let enabled = true;
  const monitor = createQuotaMonitor({ read: () => pending.promise, enabled: () => enabled, onResult: result => received.push(result) });
  try {
    const request = monitor.start(); await flush();
    enabled = false;
    pending.resolve(success);
    await request;
    assert.deepEqual(received, []);
  } finally { monitor.stop(); }
});

test('invalid scheduling configuration is rejected', () => {
  for (const intervalMs of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createQuotaMonitor({ intervalMs }), RangeError);
  assert.throws(() => createQuotaMonitor({ read: null }), TypeError);
});

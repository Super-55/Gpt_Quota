import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../electron/store.mjs';
import { Collector } from '../electron/collector.mjs';
import { aggregateDashboard, emptyTokens, selectQuotaWindow } from '../electron/analytics.mjs';
import { createDemo } from '../electron/demo.mjs';

const now = new Date(2026, 9, 24, 15, 30);
const timestamp = new Date(2026, 9, 24, 10).toISOString();
const record = (type, payload) => JSON.stringify({ type, payload, timestamp });
const meta = record('session_meta', { id: 'shared-session', cwd: 'E:/project' });
const context = model => record('turn_context', model === undefined ? { cwd: 'E:/project' } : { model, cwd: 'E:/project' });
const token = (input, cached, output) => record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } });
const sumTokens = rows => rows.reduce((total, row) => { for (const key of Object.keys(total)) total[key] += row[key]; return total; }, emptyTokens());
async function fixture(t, lines) {
  const directory = await mkdtemp(join(tmpdir(), 'quota-model-test-'));
  const sessionsDir = join(directory, 'sessions'); await mkdir(sessionsDir);
  const path = join(sessionsDir, 'sample.jsonl'); await writeFile(path, lines.join('\n') + '\n');
  const store = new Store(join(directory, 'cache.sqlite'));
  const collector = new Collector({ sessionsDir, store });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { sessionsDir, path, store, collector };
}

test('model switches attribute only new cumulative deltas, preserve unknown turns and survive incremental scans', async t => {
  const { collector, path } = await fixture(t, [meta, token(10, 2, 2), context('model-a'), token(100, 20, 20), context('model-b'), token(100, 20, 20), token(150, 30, 30), context(), token(200, 40, 40)]);
  const first = aggregateDashboard(await collector.scan(), { now });
  assert.equal(first.summary.lifetime.total, 240);
  assert.equal(first.models.find(row => row.name === 'model-a').lifetime.total, 108);
  assert.equal(first.models.find(row => row.name === 'model-b').lifetime.total, 60);
  assert.equal(first.models.find(row => row.name === '未知模型').lifetime.total, 72);
  assert.ok(first.models.every(row => row.sessions.lifetime === 1));
  assert.deepEqual(aggregateDashboard(await collector.scan(), { now }).models, first.models);
  await appendFile(path, context('model-a') + '\n' + token(250, 50, 50) + '\n');
  const next = aggregateDashboard(await collector.scan(), { now });
  assert.equal(next.models.find(row => row.name === 'model-a').lifetime.total, 168);
  assert.equal(next.models.find(row => row.name === 'model-b').lifetime.total, 60);
  assert.equal(next.models.find(row => row.name === '未知模型').lifetime.total, 72);
  assert.deepEqual(sumTokens(next.models.map(row => row.lifetime)), next.summary.lifetime);
});

test('all model periods reconcile every token category and count each model/session once', () => {
  const makeEvent = (dayOffset, amount, model, sessionId = 'shared') => {
    const date = new Date(now); date.setDate(date.getDate() + dayOffset); date.setHours(10, 0, 0, 0);
    return { kind: 'tokens', model, sessionId, timestamp: date.toISOString(), tokens: { input: amount * 4, cached: amount, uncached: amount * 3, output: amount, total: amount * 5 } };
  };
  const events = [makeEvent(-7, 30, 'model-a'), makeEvent(-6, 20, 'model-a'), makeEvent(0, 10, 'model-b'), makeEvent(0, 5, 'model-b'), makeEvent(0, 7, undefined, 'other'), makeEvent(1, 100, 'future-model')];
  const dashboard = aggregateDashboard({ events }, { now });
  for (const period of ['today', 'recent7', 'lifetime']) assert.deepEqual(sumTokens(dashboard.models.map(row => row[period])), dashboard.summary[period]);
  assert.deepEqual(dashboard.models.find(row => row.name === 'model-a').sessions, { today: 0, recent7: 1, lifetime: 1 });
  assert.deepEqual(dashboard.models.find(row => row.name === 'model-b').sessions, { today: 1, recent7: 1, lifetime: 1 });
  assert.equal(dashboard.models.find(row => row.name === '未知模型').today.total, 35);
  assert.ok(!dashboard.models.some(row => row.name === 'future-model'));
  assert.deepEqual(aggregateDashboard({}, { now }).models, []);
});

test('version 2 cached events are rescanned for model attribution even without file changes', async t => {
  const { collector, sessionsDir, path, store } = await fixture(t, [meta, context('recorded-model'), token(100, 20, 10)]);
  await collector.scan();
  const cached = store.getFile(path); cached.state.version = 2; delete cached.state.model;
  for (const event of cached.state.events) delete event.model;
  store.setFile(path, cached);
  const scan = await new Collector({ sessionsDir, store }).scan();
  assert.equal(store.getFile(path).state.version, 3);
  assert.equal(scan.events.find(event => event.kind === 'tokens').model, 'recorded-model');
  assert.equal(aggregateDashboard(scan, { now }).models[0].lifetime.total, 110);
});

test('five-hour quota selects exactly 300 minutes from current Codex buckets', () => {
  const updatedAt = now.toISOString(), resetsAt = now.getTime() / 1000 + 7200;
  const bucket = (windowMinutes, used, extra = {}) => ({ id: 'codex', bucket: 'primary', windowMinutes, used, updatedAt, resetsAt, ...extra });
  const rates = [bucket(10080, 11, { bucket: 'secondary' }), bucket(300, 24)];
  const quota = selectQuotaWindow(rates, 300, now, 'live');
  assert.equal(quota.remaining, 76); assert.equal(quota.windowMinutes, 300); assert.equal(quota.source, 'live');
  assert.equal(quota.timeProgress, 60); assert.equal(quota.resetsAt, resetsAt);
  assert.equal(selectQuotaWindow([rates[0]], 300, now), null);
  assert.equal(selectQuotaWindow([bucket(300, 5, { updatedAt: new Date(now.getTime() - 60000).toISOString() }), bucket(10080, 11)], 300, now), null);
  assert.equal(selectQuotaWindow([bucket(300, 5, { id: 'other' }), rates[0]], 300, now), null);
  assert.equal(selectQuotaWindow(rates, NaN, now), null);
  assert.equal(selectQuotaWindow(rates, 300, new Date(resetsAt * 1000)).stale, true);
  assert.equal(aggregateDashboard({ rateLimits: rates }, { now }).quota5h.remaining, 76);
  assert.equal(aggregateDashboard({ rateLimits: rates }, { now, quota5h: null }).quota5h, null);
  assert.deepEqual(aggregateDashboard({}, { now, quota5h: quota }).quota5h, quota);
});

test('demo model breakdown reconciles exactly and exposes distinct five-hour quota', () => {
  const dashboard = createDemo(undefined, now);
  for (const period of ['today', 'recent7', 'lifetime']) assert.deepEqual(sumTokens(dashboard.models.map(row => row[period])), dashboard.summary[period]);
  assert.equal(dashboard.quota5h.windowMinutes, 300);
  assert.equal(dashboard.quota5h.source, 'demo');
  assert.equal(dashboard.quota.windowMinutes, 10080);
  assert.notEqual(dashboard.quota5h.remaining, dashboard.quota.remaining);
});

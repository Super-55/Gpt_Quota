import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../electron/store.mjs';
import { Collector } from '../electron/collector.mjs';
import { aggregateDashboard, dateKey, selectQuota } from '../electron/analytics.mjs';
import { normalizeRateLimits, readAccountRateLimits, abortAccountReads } from '../electron/account.mjs';
import { readCcSwitchHistory } from '../electron/cc-switch-history.mjs';

const stamp = hour => `2026-10-23T${String(hour).padStart(2, '0')}:00:00+08:00`;
const row = (type, payload, timestamp = stamp(10)) => JSON.stringify({ type, payload, timestamp });
const meta = (id = 'session-a', extras = {}) => row('session_meta', { id, cwd: 'E:/code/quota', ...extras });
const token = (input, cached, output, timestamp = stamp(10), extras = {}) => row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 20, total_tokens: input + output } }, ...extras }, timestamp);
const call = (id, name = 'exec_command', cmd = 'Get-Content C:/Users/test/.codex/skills/design/SKILL.md') => row('response_item', { type: 'function_call', call_id: id, name, arguments: JSON.stringify({ cmd }) });
async function fixture(t, lines = []) {
  const directory = await mkdtemp(join(tmpdir(), 'quota-data-test-'));
  const store = new Store(join(directory, 'cache.sqlite'));
  const sessionsDir = join(directory, 'sessions'); await mkdir(sessionsDir);
  const path = join(sessionsDir, 'test.jsonl'); await writeFile(path, lines.join('\n') + (lines.length ? '\n' : ''));
  const collector = new Collector({ sessionsDir, store });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, sessionsDir, path, store, collector };
}
const aggregate = scan => aggregateDashboard(scan, { now: new Date('2026-10-23T15:30:00+08:00') });

test('cumulative snapshots are idempotent; cache and reasoning are not double counted', async t => {
  const { collector, path } = await fixture(t, [meta(), token(100, 40, 20), token(100, 40, 20), token(150, 60, 30)]);
  const first = aggregate(await collector.scan());
  assert.deepEqual(first.summary.lifetime, { input: 150, cached: 60, uncached: 90, output: 30, total: 180 });
  assert.deepEqual(aggregate(await collector.scan()).summary, first.summary);
  await appendFile(path, token(200, 80, 40, stamp(12)) + '\n');
  const next = aggregate(await collector.scan()); assert.equal(next.summary.today.total, 240);
  assert.equal(next.days.at(-1).date, '2026-10-23'); assert.equal(next.days.at(-1).observed, true);
});

test('restores compressed and archived history without counting alternate rollout copies', async t => {
  const { collector, store, directory, sessionsDir } = await fixture(t);
  const archive = join(directory, 'archived_sessions');
  await mkdir(archive);
  const oldDay = '2026-08-15T10:00:00+08:00';
  const rollout = 'rollout-2026-08-15T10-00-00-00000000-0000-4000-8000-000000000001.jsonl';
  const compressedArchive = join(archive, `${rollout}.zst`);
  const log = [meta('historical'), token(100, 40, 20, oldDay)].join('\n');
  await writeFile(compressedArchive, zstdCompressSync(log));
  await writeFile(join(archive, 'separate.jsonl'), `${meta('archived')}\n${token(35, 10, 5, oldDay)}\n`);
  await writeFile(join(sessionsDir, 'another.jsonl.zst'), zstdCompressSync(`${meta('compressed')}\n${token(53, 20, 7, oldDay)}\n`));
  const first = await collector.scan();
  assert.equal(aggregate(first).days.find(day => day.date === dateKey(oldDay)).total, 220);
  assert.deepEqual(first.coverage, { files: 4, compressed: 2, archived: 2 });
  assert.equal(store.getFile(compressedArchive).carry, '');
  assert.deepEqual(aggregate(await collector.scan()).summary, aggregate(first).summary);

  await writeFile(join(sessionsDir, rollout), `${log}\n${token(125, 45, 25, oldDay)}\n`);
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 250);

  await rm(join(sessionsDir, rollout));
  await writeFile(compressedArchive, Buffer.from('not a zstd frame'));
  const damaged = await collector.scan();
  assert.equal(aggregate(damaged).summary.lifetime.total, 220);
  assert.ok(damaged.diagnostics.some(message => message.includes('压缩日志无法解码')));

  await writeFile(compressedArchive, zstdCompressSync(`${log}\n${token(155, 55, 25, oldDay)}`));
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 280);
});

test('CC Switch Codex rollups fill only missing heatmap dates and never add to native totals', async t => {
  const { directory, collector, path } = await fixture(t);
  const databasePath = join(directory, 'cc-switch.db');
  assert.deepEqual(readCcSwitchHistory(databasePath), { days: [] });
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE usage_daily_rollups (date TEXT, app_type TEXT, provider_id TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER, input_token_semantics INTEGER);
    INSERT INTO usage_daily_rollups VALUES
    ('2026-08-15', 'codex', '_codex_session', 10, 5, 40, 2, 2),
    ('2026-08-15', 'codex', '_codex_session', 25, 5, 20, 1, 1),
    ('2026-08-15', 'dsh', '_dsh_session', 500, 5, 30, 0, 2),
    ('2026-08-15', 'codex', 'proxy', 400, 5, 30, 0, 2),
    ('2026-08-16', 'codex', '_codex_session', 600, 5, 30, 0, 2),
    ('2026-10-23', 'codex', '_codex_session', 700, 5, 40, 0, 2);`);
  db.close();
  await writeFile(path, `${meta()}\n${token(50, 30, 5, '2026-08-16T12:00:00+08:00')}\n`);
  const history = readCcSwitchHistory(databasePath, new Date('2026-10-23T15:30:00+08:00'));
  const result = aggregate({ ...await collector.scan(), historicalDays: history.days });
  assert.deepEqual(result.heatmapDays.find(day => day.date === '2026-08-15'), {
    date: '2026-08-15', input: 77, cached: 60, uncached: 17, output: 10, total: 87,
    observed: true, source: 'cc-switch'
  });
  assert.equal(result.heatmapDays.find(day => day.date === '2026-08-16').total, 55);
  assert.equal(result.heatmapDays.at(-1).total, 0);
  assert.equal(result.days.find(day => day.date === '2026-08-15').total, 0);
  assert.equal(result.summary.lifetime.total, 55);
});

test('partial UTF-8 JSON line is reread, never persisted, and malformed complete line warns', async t => {
  const { collector, store, path } = await fixture(t, [meta(), token(100, 20, 10)]);
  const extra = row('response_item', { type: 'message', content: '私密正文不能存入缓存' });
  const bytes = Buffer.from(extra + '\n' + token(120, 30, 15) + '\n');
  await appendFile(path, bytes.subarray(0, 90));
  const first = await collector.scan(); assert.equal(aggregate(first).summary.lifetime.total, 110);
  const cache = store.getFile(path); assert.equal(cache.carry, ''); assert.ok(!JSON.stringify(cache).includes('私密正文'));
  await appendFile(path, bytes.subarray(90)); await appendFile(path, '{broken}\n');
  const next = await collector.scan(); assert.equal(aggregate(next).summary.lifetime.total, 135);
  assert.ok(next.diagnostics.some(text => text.includes('JSON')));
});

test('truncation and replacement rebuild file index without retaining old consumption', async t => {
  const { collector, path } = await fixture(t, [meta(), token(9000, 1000, 500)]);
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 9500);
  await writeFile(path, [meta('new'), token(10, 4, 2)].join('\n') + '\n');
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 12);
});

test('counter reset starts another segment, explicit forks baseline inherited counts', async t => {
  const { collector, path } = await fixture(t, [meta(), token(100, 20, 10), token(10, 4, 2)]);
  const scan = await collector.scan(); assert.equal(aggregate(scan).summary.lifetime.total, 122);
  assert.ok(scan.diagnostics.some(text => text.includes('重置')));
  await writeFile(path, [meta('fork', { forked_from_id: 'parent' }), token(1000, 200, 100), token(1030, 210, 105)].join('\n') + '\n');
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 35);
});

test('tool call IDs deduplicate per session; skill documents require read evidence', async t => {
  const { collector, path } = await fixture(t, [meta(), call('a'), call('a'), call('b', 'send_message', 'Please use cat to read /skills/fake/SKILL.md'), call('c', 'exec_command', 'echo /skills/fake/SKILL.md')]);
  const dashboard = aggregate(await collector.scan());
  assert.equal(dashboard.tools.find(item => item.name === 'exec_command').count, 2);
  assert.equal(dashboard.tools.find(item => item.name === 'send_message').count, 1);
  assert.equal(dashboard.skills.length, 1); assert.equal(dashboard.skills[0].name, 'design'); assert.equal(dashboard.skills[0].count, 1);
  assert.equal(dashboard.sessions[0].toolCalls, 3);
  await appendFile(path, row('response_item', { type: 'custom_tool_call', call_id: 'd', name: 'apply_patch', input: '*** patch ***' }) + '\n');
  assert.equal(aggregate(await collector.scan()).tools.find(item => item.name === 'apply_patch').count, 1);
});

test('today, rolling seven days, Monday week and observed baseline use local natural dates', () => {
  const now = new Date(2026, 9, 23, 15, 30); // Friday, local system timezone.
  const events = [[23, 10], [22, 20], [19, 30], [18, 40], [16, 50]].map(([day, amount]) => ({ kind: 'tokens', sessionId: 's', timestamp: new Date(2026, 9, day, 10).toISOString(), tokens: { input: amount, output: 0, cached: 0, uncached: amount, total: amount } }));
  const dashboard = aggregateDashboard({ events }, { now });
  assert.equal(dashboard.summary.today.total, 10); assert.equal(dashboard.summary.week.total, 60); assert.equal(dashboard.summary.recent7.total, 100); assert.equal(dashboard.summary.lifetime.total, 150);
  assert.equal(dashboard.days.length, 182); assert.equal(dashboard.days.at(-1).date, dateKey(now)); assert.equal(dashboard.baselineDays, 4);
  assert.equal(dashboard.hourly.at(-1).average, 35);
  assert.equal(dashboard.days.find(day => day.date === '2026-10-20').observed, false);
});

test('quota respects real window length, null unknown, timestamp freshness and camelCase', () => {
  assert.deepEqual(normalizeRateLimits({ primary: { used_percent: null, window_minutes: 10080 } }), []);
  const now = new Date('2026-10-23T10:00:00Z');
  const updatedAt = now.toISOString(); const reset = now.getTime() / 1000 + 3600;
  const buckets = normalizeRateLimits({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: reset }, secondary: { usedPercent: 3, windowDurationMins: 300, resetsAt: reset } } }, updatedAt);
  const quota = selectQuota(buckets, now); assert.equal(quota.remaining, 88); assert.equal(quota.windowMinutes, 10080); assert.equal(quota.stale, false);
  assert.equal(selectQuota(buckets, new Date(now.getTime() + 700000)).stale, true);
  assert.equal(selectQuota([], now), null);
  assert.equal(selectQuota([{ id: 'x', bucket: 'primary', used: 500, windowMinutes: 300, resetsAt: null, updatedAt }], now).timeProgress, null);
});

test('cache stores settings and normalized aggregates without message or tool output bodies', async t => {
  const { collector, store, path, directory } = await fixture(t, [meta(), row('response_item', { type: 'message', content: 'TOP_SECRET_TEST_BODY' }), row('response_item', { type: 'function_call_output', output: 'TOP_SECRET_TEST_OUTPUT' }), token(50, 10, 5)]);
  await collector.scan(); const cached = JSON.stringify(store.getFile(path));
  assert.ok(!cached.includes('TOP_SECRET')); store.saveSettings({ dailyGoal: 100 }); assert.equal(store.getSettings().dailyGoal, 100);
  assert.ok(!(await readFile(join(directory, 'cache.sqlite'))).includes(Buffer.from('TOP_SECRET')));
});

test('missing source fails clearly so caller can retain previous dashboard', async t => {
  const { store, directory } = await fixture(t);
  await assert.rejects(new Collector({ sessionsDir: join(directory, 'missing'), store }).scan(), /无法读取/);
});

test('account startup failure returns safe error and abort API is callable', async () => {
  const result = await readAccountRateLimits({ command: 'quota-no-such-command-12345', timeoutMs: 2000 });
  assert.equal(result.ok, false); assert.ok(result.error); abortAccountReads();
});

test('same-inode longer overwrite with unchanged header rebuilds prior consumed tail', async t => {
  const longMeta = meta('same', { padding: 'x'.repeat(500) });
  const { collector, path } = await fixture(t, [longMeta, token(100, 20, 10)]);
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 110);
  await writeFile(path, [longMeta, token(200000, 40000, 10)].join('\n') + '\n');
  assert.equal(aggregate(await collector.scan()).summary.lifetime.total, 200010);
});

test('zero-delta token snapshots establish middle-day observation without adding usage', async t => {
  const { collector } = await fixture(t, [meta(), token(100, 20, 10, '2026-10-20T10:00:00+08:00'), token(100, 20, 10, '2026-10-21T10:00:00+08:00'), token(100, 20, 10, '2026-10-22T10:00:00+08:00')]);
  const dashboard = aggregate(await collector.scan());
  assert.equal(dashboard.days.find(day => day.date === '2026-10-21').observed, true);
  assert.equal(dashboard.days.find(day => day.date === '2026-10-21').total, 0);
  assert.equal(dashboard.baselineDays, 3);
});

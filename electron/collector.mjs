import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname, resolve, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { normalizeRateLimits } from './account.mjs';

function freshState(path) {
  return { version: 3, session: { id: path, cwd: '', project: '未识别项目', lastActive: '', firstActive: '' }, model: '', events: [], rateLimits: [], previous: null, forked: false, lines: 0, warnings: {}, observedDates: {}, head: '', headLength: 0, tail: '', tailLength: 0, mtime: 0 };
}
function warn(state, key) { state.warnings[key] = (state.warnings[key] || 0) + 1; }
const finiteCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function normalizeProject(cwd) { return cwd ? normalize(cwd).replace(/[\\/]+$/, '') : ''; }

function readSkillPaths(name, input) {
  if (!/(?:exec|command|read_file|read_text_file|read_multiple_files|read_resource)$/i.test(name)) return [];
  let text = typeof input === 'string' ? input : JSON.stringify(input);
  if (!/(?:Get-Content|\bcat\b|\btype\s|\bsed\b|\bhead\b|read_file|read_text_file|readFile|read_multiple_files)/i.test(`${name} ${text}`)) return [];
  // This is conservative evidence of a document read, not evidence of successful skill execution.
  text = text.replace(/\\\\/g, '/').replace(/\\/g, '/');
  const paths = text.match(/(?:[A-Za-z]:\/|\/|[.~]?\/?)[^\s"'`<>|;{}()]*\/SKILL\.md\b/gi) || [];
  return [...new Set(paths)].map(path => {
    const clean = path.replace(/^.*?(?=[A-Za-z]:\/)/, '');
    const parts = clean.split('/');
    return { name: parts.at(-2), source: /\/\.system\//i.test(clean) ? 'system' : /\/plugins\//i.test(clean) ? 'plugin' : /\/agents\//i.test(clean) ? 'agents' : 'local' };
  }).filter(item => item.name);
}

export function parseRecord(record, state, filePath) {
  state.lines += 1;
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object') return;
  const timestamp = record.timestamp || payload.timestamp;
  if (record.type === 'session_meta') {
    state.session.id = payload.id || payload.session_id || state.session.id;
    if (typeof payload.cwd === 'string') state.session.cwd = normalizeProject(payload.cwd);
    state.forked = Boolean(payload.forked_from_id || payload.parent_thread_id);
  }
  if (record.type === 'turn_context') {
    if (typeof payload.cwd === 'string') state.session.cwd = normalizeProject(payload.cwd);
    // Attribute only subsequent counter increments. A context without a model cannot
    // safely inherit the preceding turn's model or the session's final model.
    state.model = typeof payload.model === 'string' ? payload.model.trim() : '';
  }
  state.session.project = state.session.cwd ? basename(state.session.cwd.replace(/\\/g, '/')) || state.session.cwd : '未识别项目';
  if (!validTime(timestamp)) { warn(state, 'invalidTime'); return; }
  const date = new Date(timestamp);
  const observedKey = [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
  state.observedDates ||= {}; state.observedDates[observedKey] ||= timestamp;
  if (!state.session.firstActive || timestamp < state.session.firstActive) state.session.firstActive = timestamp;
  if (!state.session.lastActive || timestamp > state.session.lastActive) state.session.lastActive = timestamp;
  const base = { sessionId: state.session.id, timestamp, cwd: state.session.cwd, project: state.session.project };
  if (record.type === 'event_msg' && payload.type === 'token_count') {
    const rates = normalizeRateLimits(payload.rate_limits || payload.rateLimits, timestamp);
    for (const item of rates) {
      const key = `${item.id}:${item.bucket}`;
      const old = state.rateLimits.findIndex(rate => `${rate.id}:${rate.bucket}` === key);
      if (old < 0) state.rateLimits.push(item);
      else if (item.updatedAt >= state.rateLimits[old].updatedAt) state.rateLimits[old] = item;
    }
    const usage = payload.info?.total_token_usage;
    if (!usage) { if (payload.info?.last_token_usage) warn(state, 'lastOnly'); return; }
    const input = usage.input_tokens;
    const output = usage.output_tokens;
    let cached = usage.cached_input_tokens ?? 0;
    if (![input, output, cached].every(finiteCount)) { warn(state, 'invalidCount'); return; }
    if (cached > input) { cached = input; warn(state, 'cachedOverflow'); }
    const current = { input: Math.trunc(input), cached: Math.trunc(cached), output: Math.trunc(output) };
    if (finiteCount(usage.total_tokens) && usage.total_tokens !== current.input + current.output) warn(state, 'totalMismatch');
    const previous = state.previous;
    let delta;
    if (!previous) {
      if (state.forked) { state.previous = current; warn(state, 'forkBaseline'); return; }
      delta = current;
    } else if (Object.keys(current).some(key => current[key] < previous[key])) {
      // A cumulative counter reset begins another segment. No negative consumption is emitted.
      warn(state, 'counterReset'); delta = current;
    } else delta = Object.fromEntries(Object.keys(current).map(key => [key, current[key] - previous[key]]));
    state.previous = current;
    if (delta.cached > delta.input) { delta.cached = delta.input; warn(state, 'cachedDeltaOverflow'); }
    const tokens = { ...delta, uncached: delta.input - delta.cached, total: delta.input + delta.output };
    if (tokens.total > 0) state.events.push({ ...base, kind: 'tokens', model: state.model || '未知模型', tokens });
  }
  if (record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload.type)) {
    const name = typeof payload.name === 'string' ? payload.name : 'unknown';
    const callId = typeof payload.call_id === 'string' ? payload.call_id : `${filePath}:${state.lines}`;
    state.events.push({ ...base, kind: 'tool', name, callId });
    let input = payload.arguments ?? payload.input ?? '';
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch {} }
    for (const skill of readSkillPaths(name, input)) state.events.push({ ...base, kind: 'skill', ...skill, callId });
  }
}

const warningLabels = {
  invalidJson: '无法解析的完整 JSON 行', invalidTime: '时间戳无效的记录', invalidCount: 'Token 计数无效的记录', cachedOverflow: '缓存输入超过总输入，已限制', cachedDeltaOverflow: '缓存增量超过输入增量，已限制', counterReset: '累计计数重置，已开启新计数段', lastOnly: '仅有单轮计数，未猜测合并', forkBaseline: '分叉会话首次计数仅作基线', totalMismatch: 'total_tokens 与输入加输出不一致', longLine: '超长未完成行已跳过', unreadable: '无法读取的日志文件'
};

function parseChunk(chunk, carry, state, path) {
  const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
  let start = 0;
  for (let index = data.indexOf(10); index !== -1; index = data.indexOf(10, start)) {
    const line = data.subarray(start, index).toString('utf8').replace(/^\uFEFF/, '').trim();
    start = index + 1;
    if (!line) continue;
    try { parseRecord(JSON.parse(line), state, path); } catch { warn(state, 'invalidJson'); }
  }
  return data.subarray(start);
}

async function readCompressed(handle, size, state, path) {
  let carry = Buffer.alloc(0);
  await pipeline(handle.createReadStream({ autoClose: false, end: size - 1 }), createZstdDecompress(), async source => {
    for await (const chunk of source) {
      carry = parseChunk(chunk, carry, state, path);
      if (carry.length > 16 * 1024 * 1024) throw new Error('超长压缩日志记录');
    }
  });
  // Archived streams are complete files, so a final JSON record needs no trailing LF.
  if (carry.length) parseChunk(Buffer.from('\n'), carry, state, path);
}

export class Collector {
  constructor({ sessionsDir, store }) { this.sessionsDir = resolve(sessionsDir); this.store = store; this.scanning = null; }
  scan() { if (this.scanning) return this.scanning; this.scanning = this.performScan().finally(() => { this.scanning = null; }); return this.scanning; }
  async performScan() {
    const files = new Map();
    const diagnostics = [];
    const walk = async (directory, archived, root = false) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if (root && error.code === 'ENOENT') return false;
        diagnostics.push('部分会话目录无法读取，统计覆盖可能不完整。');
        return false;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path, archived);
        else if (entry.isFile() && /\.jsonl(?:\.zst)?$/i.test(entry.name)) {
          const compressed = /\.zst$/i.test(entry.name);
          const logicalName = entry.name.replace(/\.zst$/i, '');
          // A rollout keeps its name when archived or compressed. Distinct resume
          // segments have distinct names even when they share a thread ID.
          const key = /^rollout-.+-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.jsonl$/i.test(logicalName)
            ? logicalName.toLowerCase() : join(directory, logicalName);
          if (!files.has(key)) files.set(key, []);
          files.get(key).push({ path, compressed, archived });
        }
      }
      return true;
    };
    const active = await walk(this.sessionsDir, false, true);
    const archived = basename(this.sessionsDir).toLowerCase() === 'sessions'
      && await walk(join(dirname(this.sessionsDir), 'archived_sessions'), true, true);
    if (!active && !archived) throw new Error('无法读取会话目录，请检查路径及访问权限。');
    const states = [];
    for (const [, candidates] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      candidates.sort((a, b) => Number(a.compressed) - Number(b.compressed) || Number(a.archived) - Number(b.archived) || a.path.localeCompare(b.path));
      let selected, fallback;
      for (const candidate of candidates) {
        try { selected = { ...candidate, state: await this.readFile(candidate) }; break; }
        catch {
          diagnostics.push(candidate.compressed ? '部分压缩日志无法解码，已保留可用统计。' : '部分会话日志无法读取；已保留可用统计。');
          const cached = this.store.getFile(candidate.path);
          if (!fallback && cached) fallback = { ...candidate, state: cached.state };
        }
      }
      if (selected || fallback) states.push(selected || fallback);
    }
    const warnings = {};
    for (const {state} of states) for (const [key, count] of Object.entries(state.warnings)) warnings[key] = (warnings[key] || 0) + count;
    for (const [key, count] of Object.entries(warnings)) diagnostics.push(`${warningLabels[key] || key}：${count}`);
    const compressed = states.filter(state => state.compressed).length;
    const archiveCount = states.filter(state => state.archived).length;
    if (compressed || archiveCount) diagnostics.push(`历史日志已纳入统计：压缩 ${compressed} 个，归档 ${archiveCount} 个（可重叠）。`);
    if (states.length) diagnostics.push('本地累计按现有日志覆盖；首次累计计数按首次事件归日，未声明的分叉继承可能影响统计。');
    return { observedDates: states.flatMap(({state}) => Object.values(state.observedDates || {})), events: states.flatMap(({state}) => state.events), sessions: states.map(({state}) => state.session), rateLimits: states.flatMap(({state}) => state.rateLimits), diagnostics: [...new Set(diagnostics)], coverage: { files: states.length, compressed, archived: archiveCount } };
  }

  async readFile({path, compressed}) {
      let handle;
      try {
        const info = await stat(path);
        handle = await open(path, 'r');
        const signature = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
        let cached = this.store.getFile(path);
        let state = cached?.state || freshState(path);
        let changedHead = false;
        if (cached && state.headLength) {
          const head = Buffer.alloc(Math.min(state.headLength, info.size));
          await handle.read(head, 0, head.length, 0);
          changedHead = createHash('sha256').update(head).digest('hex') !== state.head;
        }
        if (cached && state.tailLength && info.size >= cached.offset) {
          const tail = Buffer.alloc(state.tailLength);
          const { bytesRead } = await handle.read(tail, 0, tail.length, cached.offset - tail.length);
          changedHead ||= bytesRead !== tail.length || createHash('sha256').update(tail).digest('hex') !== state.tail;
        }
        if (compressed) {
          if (cached && state.version === 3 && signature === cached.signature && info.size === cached.offset && state.mtime === info.mtimeMs && !changedHead) return state;
          state = freshState(path);
          await readCompressed(handle, info.size, state, path);
          cached = { offset: info.size, carry: '', signature, state };
        } else if (!cached || state.version !== 3 || signature !== cached.signature || info.size < cached.offset || changedHead || (info.size === cached.offset && state.mtime !== info.mtimeMs)) {
          cached = { offset: 0, carry: '', signature, state: freshState(path) }; state = cached.state;
        }
        if (info.size > cached.offset) {
          let offset = cached.offset;
          let carry = Buffer.from(cached.carry, 'base64');
          while (offset < info.size) {
            const chunk = Buffer.alloc(Math.min(1024 * 1024, info.size - offset));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
            if (!bytesRead) break;
            offset += bytesRead;
            carry = parseChunk(chunk.subarray(0, bytesRead), carry, state, path);
            if (carry.length > 16 * 1024 * 1024) { carry = Buffer.alloc(0); warn(state, 'longLine'); }
          }
          // Persist only the last complete-line offset. Never write private partial JSON to SQLite.
          cached.offset = offset - carry.length; cached.carry = '';
        }
        const head = Buffer.alloc(Math.min(256, info.size));
        await handle.read(head, 0, head.length, 0);
        state.head = createHash('sha256').update(head).digest('hex'); state.headLength = head.length; state.mtime = info.mtimeMs;
        const tail = Buffer.alloc(Math.min(1024, cached.offset));
        await handle.read(tail, 0, tail.length, cached.offset - tail.length);
        state.tail = createHash('sha256').update(tail).digest('hex'); state.tailLength = tail.length;
        cached.state = state; cached.signature = signature;
        this.store.setFile(path, cached);
        return state;
      }
      finally { await handle?.close(); }
  }
}




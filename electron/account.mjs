import { spawn } from 'node:child_process';

const activeReads = new Set();
export function abortAccountReads() { for (const abort of [...activeReads]) abort(); }

const finite = value => typeof value === 'number' && Number.isFinite(value);
export function normalizeRateLimits(raw, observedAt = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object') return [];
  const result = [];
  const containers = [];
  if (raw.rateLimitsByLimitId && typeof raw.rateLimitsByLimitId === 'object') {
    for (const [id, value] of Object.entries(raw.rateLimitsByLimitId)) containers.push([id, value]);
  }
  if (raw.rateLimits) containers.push([raw.rateLimits.limitId || raw.rateLimits.limit_id || 'codex', raw.rateLimits]);
  if (raw.rate_limits) containers.push([raw.rate_limits.limitId || raw.rate_limits.limit_id || 'codex', raw.rate_limits]);
  if (raw.primary || raw.secondary) containers.push([raw.limitId || raw.limit_id || 'codex', raw]);
  for (const [id, container] of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const bucket of ['primary', 'secondary']) {
      const item = container[bucket];
      if (!item) continue;
      const used = item.used_percent ?? item.usedPercent;
      const windowMinutes = item.window_minutes ?? item.windowDurationMins;
      let resetsAt = item.resets_at ?? item.resetsAt ?? null;
      if (!finite(used) || !finite(windowMinutes) || windowMinutes <= 0) continue;
      if (!finite(resetsAt) || resetsAt <= 0) resetsAt = null;
      result.push({ id, bucket, used: Math.min(100, Math.max(0, used)), windowMinutes, resetsAt, updatedAt: observedAt });
    }
  }
  return result;
}

export function readAccountRateLimits({ command = 'codex', timeoutMs = 15000 } = {}) {
  // Only start a private app-server and issue initialization plus one read-only method.
  // Never invoke login, a model turn, a shell command, or open auth files.
  return new Promise(resolve => {
    let child;
    let ended = false;
    let buffer = '';
    let timer;
    const finish = result => {
      if (ended) return;
      ended = true; activeReads.delete(abort);
      clearTimeout(timer);
      child?.stdin?.end();
      child?.kill();
      resolve(result);
    };
    const abort = () => finish({ ok: false, error: '账户读取已取消。' });
    activeReads.add(abort);
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
      child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch { finish({ ok: false, error: '无法启动 Codex app-server；正在使用本地额度快照。' }); return; }
    timer = setTimeout(() => finish({ ok: false, error: '账户额度读取超时；正在使用本地额度快照。' }), timeoutMs);
    child.once('error', () => finish({ ok: false, error: '未找到可用的 Codex 命令；正在使用本地额度快照。' }));
    child.once('exit', () => finish({ ok: false, error: 'Codex 账户接口已退出；正在使用本地额度快照。' }));
    child.stderr.on('data', () => {}); // Diagnostics can contain private data. Do not persist or return them.
    child.stdin.on('error', () => finish({ ok: false, error: 'Codex 账户接口连接失败。' }));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 2 * 1024 * 1024) { finish({ ok: false, error: '账户接口返回异常。' }); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        if (response.id === 1) {
          if (response.error) { finish({ ok: false, error: 'Codex 账户初始化不可用。' }); return; }
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (response.id === 2) {
          if (response.error) { finish({ ok: false, error: '账户额度接口不可用或尚未登录。' }); return; }
          const updatedAt = new Date().toISOString();
          const rateLimits = normalizeRateLimits(response.result, updatedAt);
          finish(rateLimits.length ? { ok: true, rateLimits, updatedAt } : { ok: false, error: '账户未返回有效额度窗口。' });
          return;
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'quota_glass', version: '1.0.0' }, capabilities: {} } });
  });
}


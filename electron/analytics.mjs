import { basename, normalize } from 'node:path';
import { DEFAULT_SETTINGS } from './defaults.mjs';

export const emptyTokens = () => ({ input: 0, cached: 0, uncached: 0, output: 0, total: 0 });
const add = (target, tokens) => { for (const key of ['input', 'cached', 'uncached', 'output', 'total']) target[key] += tokens[key] || 0; return target; };
export function dateKey(value) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function midnight(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function shiftDay(value, amount) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
const validDate = value => Boolean(value) && Number.isFinite(new Date(value).getTime());
function newest(a, b) { return !a || new Date(b) > new Date(a) ? b : a; }

function latestQuotaBuckets(rateLimits) {
  const latest = new Map();
  for (const item of rateLimits) {
    if (!Number.isFinite(item.used) || !Number.isFinite(item.windowMinutes) || item.windowMinutes <= 0 || !validDate(item.updatedAt)) continue;
    const key = `${item.id}:${item.bucket}`;
    if (!latest.has(key) || new Date(item.updatedAt) > new Date(latest.get(key).updatedAt)) latest.set(key, item);
  }
  let buckets = [...latest.values()];
  if (buckets.some(item => item.id === 'codex')) buckets = buckets.filter(item => item.id === 'codex');
  return buckets;
}

function quotaFromBucket(item, now, source) {
  if (!item) return null;
  const nowMs = new Date(now).getTime();
  const used = Math.max(0, Math.min(100, item.used));
  const resetsAt = Number.isFinite(item.resetsAt) && item.resetsAt > 0 ? item.resetsAt : null;
  const stale = nowMs - new Date(item.updatedAt).getTime() > 10 * 60 * 1000 || (resetsAt !== null && resetsAt * 1000 <= nowMs);
  const start = resetsAt === null ? null : resetsAt * 1000 - item.windowMinutes * 60000;
  const timeProgress = start === null ? null : Math.max(0, Math.min(100, (nowMs - start) / (item.windowMinutes * 60000) * 100));
  return { remaining: 100 - used, used, windowMinutes: item.windowMinutes, resetsAt, updatedAt: item.updatedAt, source, stale, timeProgress };
}

export function selectQuota(rateLimits = [], now = new Date(), source = 'snapshot') {
  const buckets = latestQuotaBuckets(rateLimits);
  buckets.sort((a, b) => Number(b.windowMinutes === 10080) - Number(a.windowMinutes === 10080) || b.windowMinutes - a.windowMinutes || new Date(b.updatedAt) - new Date(a.updatedAt));
  return quotaFromBucket(buckets[0], now, source);
}

export function selectQuotaWindow(rateLimits = [], windowMinutes, now = new Date(), source = 'snapshot') {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return null;
  const buckets = latestQuotaBuckets(rateLimits).filter(item => item.windowMinutes === windowMinutes);
  buckets.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return quotaFromBucket(buckets[0], now, source);
}

export function aggregateDashboard(scan = {}, { settings = {}, now = new Date(), source = 'local', quota, quota5h } = {}) {
  now = new Date(now);
  settings = { ...DEFAULT_SETTINGS, ...settings };
  const today = midnight(now);
  const recentStart = shiftDay(today, -6);
  const weekStart = shiftDay(today, -(today.getDay() + 6) % 7);
  const firstHeatDay = shiftDay(today, -181);
  const baselineStart = shiftDay(today, -7);
  const summary = { today: emptyTokens(), week: emptyTokens(), recent7: emptyTokens(), lifetime: emptyTokens() };
  const daysMap = new Map();
  const sessionsMap = new Map();
  const projectsMap = new Map();
  const toolsMap = new Map();
  const skillsMap = new Map();
  const modelsMap = new Map();
  const todayHours = Array(24).fill(0);
  const historicalHours = new Map();
  let since = null;
  const markDate = timestamp => {
    if (!validDate(timestamp) || new Date(timestamp) > now) return;
    const key = dateKey(timestamp);
    if (!daysMap.has(key)) daysMap.set(key, { date: key, observed: true, ...emptyTokens() });
    if (!since || new Date(timestamp) < new Date(since)) since = timestamp;
  };
  for (const timestamp of scan.observedDates || []) markDate(timestamp);
  const sessionFor = (id, info = {}) => {
    if (!sessionsMap.has(id)) sessionsMap.set(id, { id, project: info.project || '未识别项目', cwd: info.cwd || '', lastActive: '', tokens: emptyTokens(), todayTokens: 0, toolCalls: 0 });
    return sessionsMap.get(id);
  };
  for (const meta of scan.sessions || []) {
    const session = sessionFor(meta.id, meta);
    if (meta.cwd) { session.cwd = meta.cwd; session.project = meta.project || basename(meta.cwd.replace(/\\/g, '/')); }
    if (validDate(meta.lastActive) && new Date(meta.lastActive) <= now) session.lastActive = newest(session.lastActive, meta.lastActive);
    markDate(meta.firstActive); markDate(meta.lastActive);
  }
  const toolIds = new Set(); const skillIds = new Set();
  const rankEvent = (map, event) => {
    if (!map.has(event.name)) map.set(event.name, { name: event.name, count: 0, sessionSet: new Set(), lastActive: '', ...(event.source ? { source: event.source } : {}) });
    const row = map.get(event.name); row.count++; row.sessionSet.add(event.sessionId); row.lastActive = newest(row.lastActive, event.timestamp);
  };
  for (const event of scan.events || []) {
    if (!validDate(event.timestamp)) continue;
    const time = new Date(event.timestamp);
    if (time > now) continue;
    const session = sessionFor(event.sessionId, event);
    if (!session.cwd && event.cwd) { session.cwd = event.cwd; session.project = event.project; }
    session.lastActive = newest(session.lastActive, event.timestamp);
    markDate(event.timestamp);
    if (event.kind === 'tokens') {
      const modelName = typeof event.model === 'string' && event.model.trim() ? event.model.trim() : '未知模型';
      if (!modelsMap.has(modelName)) modelsMap.set(modelName, { name: modelName, today: emptyTokens(), recent7: emptyTokens(), lifetime: emptyTokens(), sessionSets: { today: new Set(), recent7: new Set(), lifetime: new Set() }, lastActive: '' });
      const model = modelsMap.get(modelName);
      add(model.lifetime, event.tokens); model.sessionSets.lifetime.add(event.sessionId); model.lastActive = newest(model.lastActive, event.timestamp);
      if (time >= today) { add(model.today, event.tokens); model.sessionSets.today.add(event.sessionId); }
      if (time >= recentStart) { add(model.recent7, event.tokens); model.sessionSets.recent7.add(event.sessionId); }
      add(summary.lifetime, event.tokens); add(session.tokens, event.tokens);
      add(daysMap.get(dateKey(time)), event.tokens);
      if (time >= today) { add(summary.today, event.tokens); session.todayTokens += event.tokens.total; todayHours[time.getHours()] += event.tokens.total; }
      if (time >= recentStart) add(summary.recent7, event.tokens);
      if (time >= weekStart) add(summary.week, event.tokens);
      if (time >= baselineStart && time < today) {
        const key = dateKey(time); if (!historicalHours.has(key)) historicalHours.set(key, Array(24).fill(0)); historicalHours.get(key)[time.getHours()] += event.tokens.total;
      }
    } else if (event.kind === 'tool') {
      const key = `${event.sessionId}:${event.callId}`;
      if (!toolIds.has(key)) { toolIds.add(key); rankEvent(toolsMap, event); if (time >= today) session.toolCalls++; }
    } else if (event.kind === 'skill') {
      const key = `${event.sessionId}:${event.callId}:${event.name}`;
      if (!skillIds.has(key)) { skillIds.add(key); rankEvent(skillsMap, event); }
    }
  }
  const days = [];
  for (let index = 0; index < 182; index++) {
    const key = dateKey(shiftDay(firstHeatDay, index));
    days.push(daysMap.get(key) || { date: key, observed: false, ...emptyTokens() });
  }
  const historicalByDate = new Map((scan.historicalDays || []).map(day => [day.date, day]));
  const heatmapDays = days.map(day => day.total === 0 && day.date < dateKey(today)
    ? historicalByDate.get(day.date) || day : day);
  // Only days with actual source evidence are valid baseline observations. Missing days stay unknown.
  const baselineKeys = [...daysMap.keys()].filter(key => key >= dateKey(baselineStart) && key < dateKey(today));
  let todayRunning = 0; let averageRunning = 0;
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    todayRunning += todayHours[hour];
    averageRunning += baselineKeys.length ? baselineKeys.reduce((sum, key) => sum + (historicalHours.get(key)?.[hour] || 0), 0) / baselineKeys.length : 0;
    return { hour, today: hour > now.getHours() ? null : todayRunning, average: averageRunning };
  });
  for (const session of sessionsMap.values()) {
    let path = session.cwd ? normalize(session.cwd).replace(/[\\/]+$/, '') : '';
    // Windows paths are case insensitive; retain a readable original path in the row.
    const key = /^[A-Za-z]:[\\/]/.test(path) ? path.toLowerCase() : path;
    if (!projectsMap.has(key)) projectsMap.set(key, { name: session.project || '未识别项目', path, tokens: emptyTokens(), sessions: 0, lastActive: '' });
    const project = projectsMap.get(key); add(project.tokens, session.tokens); project.sessions++; project.lastActive = newest(project.lastActive, session.lastActive);
  }
  const rank = map => [...map.values()].map(({ sessionSet, ...row }) => ({ ...row, sessions: sessionSet.size })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    source, updatedAt: now.toISOString(), coverage: { since, files: scan.coverage?.files || 0, sessions: sessionsMap.size, label: '本机现有会话日志；未记录日期表示未知' },
    diagnostics: [...(scan.diagnostics || [])], quota: quota === undefined ? selectQuota(scan.rateLimits, now) : quota,
    quota5h: quota5h === undefined ? selectQuotaWindow(scan.rateLimits, 300, now) : quota5h,
    summary, days, heatmapDays, hourly, baselineDays: baselineKeys.length,
    sessions: [...sessionsMap.values()].sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0)),
    projects: [...projectsMap.values()].sort((a, b) => b.tokens.total - a.tokens.total), skills: rank(skillsMap), tools: rank(toolsMap),
    models: [...modelsMap.values()].map(({ sessionSets, ...row }) => ({ ...row, sessions: Object.fromEntries(Object.entries(sessionSets).map(([period, ids]) => [period, ids.size])) })).sort((a, b) => b.lifetime.total - a.lifetime.total || a.name.localeCompare(b.name)), settings
  };
}





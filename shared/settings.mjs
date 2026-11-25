// Browser-safe settings contract shared by the renderer adapter and desktop.
export const QUOTA_REFRESH_PRESETS = Object.freeze([5, 10, 30, 60]);
export const DEFAULT_QUOTA_REFRESH_SECONDS = QUOTA_REFRESH_PRESETS[0];
export const formatQuotaInterval = seconds => seconds === 60 ? '1 分钟' : `${seconds} 秒`;
const keys = new Set(['source', 'sessionsDir', 'theme', 'opacity', 'backgroundEffect', 'refreshSeconds', 'quotaRefreshSeconds', 'dailyGoal', 'weeklyGoal', 'alwaysOnTop', 'renewalDate']);
export function validateSettings(value, previous) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效');
  if (Object.keys(value).some(key => !keys.has(key))) throw new Error('包含未知设置');
  const next = { backgroundEffect: 'transparent', quotaRefreshSeconds: DEFAULT_QUOTA_REFRESH_SECONDS, ...previous, ...value };
  for (const [key, options] of Object.entries({ source: ['local', 'demo'], theme: ['rose', 'graphite'], backgroundEffect: ['transparent', 'frosted'], refreshSeconds: [30, 60, 300], quotaRefreshSeconds: QUOTA_REFRESH_PRESETS })) {
    if (!options.includes(next[key])) throw new Error('设置选项无效');
  }
  for (const key of ['dailyGoal', 'weeklyGoal']) {
    if (!Number.isSafeInteger(next[key]) || next[key] <= 0 || next[key] > 1e15) throw new Error('目标需要是大于零的整数');
  }
  if (!Number.isFinite(next.opacity) || next.opacity < 10 || next.opacity > 100) throw new Error('不透明度需为 10–100');
  if (typeof next.sessionsDir !== 'string' || next.sessionsDir.includes('\0') ||
      (!(next.sessionsDir === '' && next.source === 'demo') && !/^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(next.sessionsDir))) {
    throw new Error('请选择有效的绝对目录');
  }
  if (typeof next.alwaysOnTop !== 'boolean') throw new Error('置顶选项无效');
  if (typeof next.renewalDate !== 'string') throw new Error('日期格式无效');
  if (next.renewalDate !== '') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(next.renewalDate);
    if (!match) throw new Error('日期格式无效');
    const [, year, month, day] = match;
    const test = new Date(0);
    test.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (test.getUTCFullYear() !== Number(year) || test.getUTCMonth() !== Number(month) - 1 || test.getUTCDate() !== Number(day)) throw new Error('日期无效');
  }
  return next;
}
export function createSerialQueue() {
  let tail = Promise.resolve();
  return operation => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  };
}

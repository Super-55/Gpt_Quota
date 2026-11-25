import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dateKey } from './analytics.mjs';

export function readCcSwitchHistory(databasePath, now = new Date()) {
  let db;
  try {
    if (!lstatSync(databasePath).isFile()) return { days: [] };
    db = new DatabaseSync(databasePath, { readOnly: true });
    const since = new Date(now);
    since.setDate(since.getDate() - 181);
    const rows = db.prepare(`
      SELECT date, SUM(input_tokens + CASE input_token_semantics
        WHEN 2 THEN cache_read_tokens + cache_creation_tokens
        WHEN 0 THEN cache_creation_tokens ELSE 0 END) AS input,
        SUM(cache_read_tokens) AS cached, SUM(output_tokens) AS output
      FROM usage_daily_rollups
      WHERE app_type = 'codex' AND provider_id = '_codex_session'
        AND input_token_semantics IN (0, 1, 2) AND date >= ? AND date < ?
      GROUP BY date
    `).all(dateKey(since), dateKey(now));
    return { days: rows.filter(({ date, input, cached, output }) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && [input, cached, output, input + output].every(value => Number.isSafeInteger(value) && value >= 0)
        && cached <= input && input + output > 0
    ).map(({ date, input, cached, output }) => ({ date, input, cached, output, uncached: input - cached, total: input + output,
      observed: true, source: 'cc-switch' })) };
  } catch (error) {
    return error.code === 'ENOENT' ? { days: [] } : { days: [], warning: '暂时无法读取 CC Switch 的历史汇总。' };
  } finally { db?.close(); }
}

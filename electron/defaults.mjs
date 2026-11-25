import os from 'node:os';
import path from 'node:path';
import { DEFAULT_QUOTA_REFRESH_SECONDS, validateSettings as validateSharedSettings } from '../shared/settings.mjs';
export const DEFAULT_SETTINGS = {
  source: 'local', sessionsDir: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
  theme: 'rose', opacity: 46, backgroundEffect: 'transparent', refreshSeconds: 60, dailyGoal: 300_000_000, weeklyGoal: 3_000_000_000,
  quotaRefreshSeconds: DEFAULT_QUOTA_REFRESH_SECONDS, alwaysOnTop: false, renewalDate: ''
};
export function validateSettings(value, previous = DEFAULT_SETTINGS) {
  const next = validateSharedSettings(value, previous);
  if (next.sessionsDir) next.sessionsDir = path.normalize(next.sessionsDir);
  return next;
}

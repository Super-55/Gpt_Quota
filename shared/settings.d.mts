import type { Settings } from '../src/types';
export const QUOTA_REFRESH_PRESETS: readonly Settings['quotaRefreshSeconds'][];
export const DEFAULT_QUOTA_REFRESH_SECONDS: 5;
export function formatQuotaInterval(seconds: Settings['quotaRefreshSeconds']): string;
export function validateSettings(value: unknown, previous: Settings): Settings;
export function createSerialQueue(): <T>(operation: () => T | Promise<T>) => Promise<T>;

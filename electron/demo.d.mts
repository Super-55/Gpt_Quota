import type { Dashboard, Settings } from '../src/types';
export const demoSettings: Settings;
export function createDemo(settings?: Partial<Settings>, now?: Date): Dashboard;

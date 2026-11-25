export type Tokens = { input: number; cached: number; uncached: number; output: number; total: number };
export type Settings = { source: 'local' | 'demo'; sessionsDir: string; theme: 'rose' | 'graphite'; backgroundEffect: 'transparent' | 'frosted'; opacity: number; refreshSeconds: number; quotaRefreshSeconds: 5 | 10 | 30 | 60; dailyGoal: number; weeklyGoal: number; alwaysOnTop: boolean; renewalDate: string };
export type UsageDay = Tokens & { date: string; observed: boolean; source?: 'cc-switch' };
export type Session = { id: string; project: string; cwd: string; lastActive: string; tokens: Tokens; todayTokens: number; toolCalls: number };
export type Rank = { name: string; count: number; sessions: number; lastActive: string; source?: string };
export type Project = { name: string; path: string; tokens: Tokens; sessions: number; lastActive: string };
export type ModelUsage = { name: string; today: Tokens; recent7: Tokens; lifetime: Tokens; sessions: { today: number; recent7: number; lifetime: number }; lastActive: string };
export type Quota = { remaining: number; used: number; windowMinutes: number; resetsAt: number | null; updatedAt: string; source: 'live' | 'snapshot' | 'demo'; stale: boolean; timeProgress: number | null };
export type Dashboard = { source: 'local' | 'demo'; updatedAt: string; coverage: { since: string | null; files: number; sessions: number; label: string }; diagnostics: string[]; quota: Quota | null; quota5h: Quota | null; summary: { today: Tokens; week: Tokens; recent7: Tokens; lifetime: Tokens }; days: UsageDay[]; heatmapDays?: UsageDay[]; hourly: { hour: number; today: number | null; average: number }[]; baselineDays: number; sessions: Session[]; projects: Project[]; models: ModelUsage[]; skills: Rank[]; tools: Rank[]; settings: Settings };
export type WindowGesture = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface QuotaAPI {
  getDashboard(): Promise<Dashboard>;
  refresh(): Promise<Dashboard>;
  saveSettings(settings: Partial<Settings>): Promise<Dashboard>;
  chooseDirectory(): Promise<string | null>;
  openCompact(): Promise<void>;
  openMain(): Promise<void>;
  hideCompact(): Promise<void>;
  beginWindowGesture?(kind:WindowGesture): Promise<void>;
  updateWindowGesture?(): Promise<void>;
  endWindowGesture?(): Promise<void>;
  controlWindow?(action:'minimize'|'expand'|'close'): Promise<void>;
  onDashboardUpdated?(callback:(data:Dashboard)=>void): ()=>void;
  exportData(): Promise<boolean>;
  refreshAccount(): Promise<Dashboard>;
}
declare global { interface Window { quota?: QuotaAPI } }

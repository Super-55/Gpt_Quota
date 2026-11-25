import { createDemo, demoSettings } from '../electron/demo.mjs';
import type { Settings, QuotaAPI } from './types';
import { validateSettings } from '../shared/settings.mjs';
function readSettings(): Settings {
  try { if(localStorage.getItem('quota-glass-material-version')!=='2'){const previous=JSON.parse(localStorage.getItem('quota-settings')||'{}');previous.opacity=Math.min(previous.opacity??46,46);localStorage.setItem('quota-settings',JSON.stringify(previous));localStorage.setItem('quota-glass-material-version','2');} return validateSettings({...JSON.parse(localStorage.getItem('quota-settings') || '{}'),source:'demo'},demoSettings); }
  catch { return {...demoSettings}; }
}
const browser: QuotaAPI = {
  async getDashboard() { return createDemo(readSettings()); },
  async refresh() { return createDemo(readSettings()); },
  async saveSettings(patch) {
    if (patch.source === 'local') throw new Error('本机日志需要桌面应用，请运行 Quota Glass 桌面版。');
    const settings=validateSettings({...patch,source:'demo'},readSettings());
    localStorage.setItem('quota-settings',JSON.stringify(settings)); return createDemo(settings);
  },
  async chooseDirectory() { throw new Error('目录选择需要桌面版。'); },
  async openCompact() { window.open(`${location.pathname}?compact=1`, 'quota-compact', 'width=440,height=680'); },
  async openMain() { if(location.search.includes('compact')) window.open(location.pathname, 'quota-main'); },
  async hideCompact() { window.close(); },
  async exportData() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(createDemo(readSettings()),null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='quota-glass-demo.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  },
  async refreshAccount() { throw new Error('演示模式不连接真实账户。'); }
};
export const api: QuotaAPI = window.quota || browser;

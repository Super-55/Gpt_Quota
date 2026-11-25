import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Quota, Settings } from '../types';
import { formatQuotaInterval } from '../../shared/settings.mjs';
import { Meter } from './Charts';

export function QuotaWindow({ quota, source, refreshSeconds }: { quota: Quota | null; source: Settings['source']; refreshSeconds: Settings['quotaRefreshSeconds'] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const reset = quota?.resetsAt ? quota.resetsAt * 1000 : null;
  const seconds = reset === null ? null : Math.max(0, Math.ceil((reset - now) / 1000));
  const expired = seconds === 0;
  const stale = quota && (quota.stale || expired || now - new Date(quota.updatedAt).getTime() > 600000);
  const countdown = seconds === null ? '重置时间未知' : expired ? '等待额度更新' : `${Math.floor(seconds / 3600)}小时 ${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}分 ${String(seconds % 60).padStart(2, '0')}秒后重置`;
  return <div className="quota-window" data-testid="quota-five-hour" data-stale={Boolean(stale)}>
    <div className="quota-window-value"><div><strong>{quota ? `${Math.round(quota.remaining)}%` : '—'}</strong><span>{stale ? '最近记录剩余' : '剩余额度'}</span></div><span>{quota ? `已用 ${Math.round(quota.used)}%` : '尚未读取'}</span></div>
    <Meter value={quota?.remaining ?? NaN} label="5 小时剩余额度"/>
    <div className="quota-reset"><Clock3 size={15}/><div><strong data-testid="quota-countdown">{countdown}</strong><time dateTime={reset ? new Date(reset).toISOString() : undefined}>{reset ? new Date(reset).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '账户未提供 5 小时重置时间'}</time></div></div>
    <p className={`quota-window-note ${stale ? 'stale' : ''}`}>{!quota ? '尚无 5 小时额度数据' : stale ? '历史记录，等待最新额度' : quota.source === 'demo' ? '演示额度' : `${quota.source === 'live' ? '账户读取' : '日志快照'} · ${new Date(quota.updatedAt).toLocaleTimeString('zh-CN', {hour12:false})}`}{source === 'local' ? ` · 每 ${formatQuotaInterval(refreshSeconds)}自动更新` : ''}</p>
  </div>;
}

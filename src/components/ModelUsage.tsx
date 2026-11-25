import { useState } from 'react';
import { ChevronRight, Cpu, Layers } from 'lucide-react';
import type { Dashboard, ModelUsage as ModelRow, Tokens } from '../types';
import { format, Meter } from './Charts';

type Period = 'today' | 'recent7' | 'lifetime';
const periods: {id: Period; label: string}[] = [{id:'today',label:'今日'},{id:'recent7',label:'近 7 天'},{id:'lifetime',label:'本地累计'}];
export function ModelUsage({ data, onDetail }: { data: Dashboard; onDetail: (model: ModelRow, tokens: Tokens, period: string, sessions: number) => void }) {
  const [period, setPeriod] = useState<Period>('recent7');
  const rows = [...data.models].filter(row => row[period].total > 0).sort((a,b) => b[period].total - a[period].total || a.name.localeCompare(b.name));
  const total = data.summary[period];
  const known = rows.filter(row => row.name !== '未知模型').reduce((sum,row) => sum + row[period].total, 0);
  return <section className="panel models-panel" data-testid="page-models">
    <header className="panel-head"><h2><Cpu size={17}/>模型用量</h2><div className="model-periods" role="group" aria-label="模型用量时间范围">{periods.map(item => <button key={item.id} aria-pressed={period === item.id} className={period === item.id ? 'active' : ''} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div></header>
    <div className="model-summary"><div><span>{periods.find(item => item.id === period)?.label} Token</span><strong title={total.total.toLocaleString()}>{format(total.total)}</strong></div><div><span>有用量的模型</span><strong>{rows.length}<small> 个</small></strong></div><div><span>模型已识别</span><strong>{total.total ? `${(known / total.total * 100).toFixed(1)}%` : '—'}</strong></div></div>
    <p className="model-hint">根据每个回合的模型记录归属；缺失的记录计入“未知模型”。缓存包含在输入中，总量 = 输入 + 输出。</p>
    {rows.length ? <div className="model-table-scroll"><table className="model-table"><thead><tr><th>模型 / 用量占比</th><th>总 Token</th><th>未缓存输入</th><th>缓存输入</th><th>输出</th><th>会话</th><th><span className="sr-only">详情</span></th></tr></thead><tbody>{rows.map(row => {
      const tokens = row[period], share = total.total ? tokens.total / total.total * 100 : 0;
      return <tr key={row.name}><td><button className="model-name" onClick={() => onDetail(row, tokens, periods.find(item => item.id === period)!.label, row.sessions[period])}><Cpu size={15}/><span title={row.name}>{row.name}</span><small>{share.toFixed(1)}%</small></button><Meter value={share} label={`${row.name}用量占比`}/></td><td title={tokens.total.toLocaleString()}><b>{format(tokens.total)}</b></td><td title={tokens.uncached.toLocaleString()}>{format(tokens.uncached)}</td><td title={tokens.cached.toLocaleString()}>{format(tokens.cached)}</td><td title={tokens.output.toLocaleString()}>{format(tokens.output)}</td><td>{row.sessions[period]}</td><td><button className="model-details" aria-label={`查看 ${row.name} 详情`} onClick={() => onDetail(row, tokens, periods.find(item => item.id === period)!.label, row.sessions[period])}><ChevronRight size={15}/></button></td></tr>;
    })}</tbody></table></div> : <div className="empty"><Layers size={26}/><p>此时间范围还没有模型用量记录</p><small>有 Token 的记录会按模型展示在这里</small></div>}
    <p className="model-hint">会话内切换模型会分别计入对应模型，会话数不可跨模型相加。统计范围为本机已读取日志。</p>
  </section>;
}

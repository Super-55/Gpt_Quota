import { useId } from 'react';
import type { UsageDay, Quota } from '../types';
export const format = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : Math.round(n).toLocaleString();
export const localDate = (value: string | number | null) => value ? new Date(typeof value==='number'?value*1000:value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '暂无记录';
export function Meter({value,label}:{value:number;label:string}) {
 const known=Number.isFinite(value),fill=known?Math.min(100,Math.max(0,value)):0;
 return <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known?fill:undefined}><span className="meter-fill" data-active={fill>0} style={{width:`${fill}%`}} /></div>;
}
export function Ring({quota}:{quota:Quota|null}) {
 const id=`ring-${useId().replace(/:/g,'')}`,value=quota&&Number.isFinite(quota.remaining)?Math.min(100,Math.max(0,quota.remaining)):null;
 return <div className="ring"><svg viewBox="0 0 140 140" aria-hidden="true"><defs><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="140" height="140"><circle cx="70" cy="70" r="57" fill="none" stroke="white" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${value??0} 100`}/></mask><linearGradient id={`${id}-tone`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f4bfd8"/><stop offset="1" stopColor="#dc96b8"/></linearGradient></defs><circle cx="70" cy="70" r="57" className="ring-track"/>{value!==null&&value>0&&<><circle cx="70" cy="70" r="57" className="ring-value" style={{stroke:`url(#${id}-tone)`}} pathLength="100" strokeDasharray={`${value} 100`} /><g mask={`url(#${id})`} className="ring-motion"><circle cx="70" cy="70" r="57" pathLength="100" className="ring-beam glow"/><circle cx="70" cy="70" r="57" pathLength="100" className="ring-beam feather" transform="rotate(10.8 70 70)"/><circle cx="70" cy="70" r="57" pathLength="100" className="ring-beam core" transform="rotate(21.6 70 70)"/></g></>}</svg><div><strong>{value===null?'—':`${Math.round(value)}%`}</strong><span>{quota?`${quota.windowMinutes===10080?'7 天':`${quota.windowMinutes/60} 小时`}额度剩余`:'额度未知'}</span></div></div>;
}
export function LineChart({values,compare,labels,description}:{values:(number|null)[];compare?:number[];labels:string[];description:string}) {
 const id=`line-${useId().replace(/:/g,'')}`;
 const valid=(v:number|null):v is number=>v!==null&&Number.isFinite(v);
 const width=600,height=170,pad=14,maximum=Math.max(1,...values.filter(valid),...(compare||[]).filter(valid));
 const point=(v:number,i:number)=>[pad+i*(width-pad*2)/Math.max(1,values.length-1),height-pad-v/maximum*(height-pad*2)];
 const segments=(data:(number|null)[])=>{
  const runs:{d:string;points:{v:number;i:number}[]}[]=[];let run:typeof runs[number]|null=null;
  data.forEach((v,i)=>{if(!valid(v)){run=null;return;}const [x,y]=point(v,i);if(!run){run={d:'',points:[]};runs.push(run);}run.d+=`${run.points.length?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `;run.points.push({v,i});});
  return runs;
 };
 const layers=[...(compare?[{runs:segments(compare),secondary:true}]:[]),{runs:segments(values),secondary:false}];
 return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}><line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} className="chart-base"/>{layers.map((layer,s)=><g key={s} className={layer.secondary?'chart-series compare-series':'chart-series primary-series'}>{layer.runs.map((run,r)=>{
  const maskId=`${id}-${s}-${r}`,hasLine=run.points.length>1;
  return <g key={r}>{hasLine?<><path d={run.d} className={layer.secondary?'chart-compare':'chart-line'}/><defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}><path d={run.d} fill="none" stroke="white" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/></mask></defs><g mask={`url(#${maskId})`} className="chart-motion"><path d={run.d} pathLength="100" className="chart-beam glow"/><path d={run.d} pathLength="100" className="chart-beam core"/></g></>:<circle cx={point(run.points[0].v,run.points[0].i)[0]} cy={point(run.points[0].v,run.points[0].i)[1]} r="4" className="chart-single-halo"/>}{run.points.map(({v,i})=>(!layer.secondary||!hasLine)&&<circle key={i} cx={point(v,i)[0]} cy={point(v,i)[1]} r={values.length<=7?3.5:2} className="chart-dot"><title>{labels[i] || `${i}:00`}：{v.toLocaleString()} Token{layer.secondary?'（历史均值）':''}</title></circle>)}</g>;
 })}</g>)}</svg><div className="chart-labels">{labels.map((label,i)=><span key={i}>{label}</span>)}</div></div>;
}
export function Heatmap({days,onDay}:{days:UsageDay[];onDay:(day:UsageDay)=>void}) {
 const first=days[0],offset=first?(new Date(`${first.date}T12:00:00`).getDay()+6)%7:0;
 const cells:(UsageDay|null)[]=[...Array(offset).fill(null),...days];while(cells.length%7)cells.push(null);
 const maximum=Math.max(1,...days.map(d=>d.total)),cols=cells.length/7;
 const recovered=days.filter(day=>day.source==='cc-switch').length;
 const months=cells.filter((_,i)=>i%7===0).map((_,i)=>{const d=cells.slice(i*7,i*7+7).find(Boolean);return d?Number(d.date.slice(5,7)):null;});
 return <div className="heatmap"><div className="heat-months" style={{gridTemplateColumns:`repeat(${cols},1fr)`}}>{months.map((m,i)=><span key={i}>{m!==null&&(i===0||m!==months[i-1])?`${m}月`:''}</span>)}</div><div className="heat-body"><div className="heat-weekdays">{['一','二','三','四','五','六','日'].map(d=><span key={d}>{d}</span>)}</div><div className="heat-grid" style={{gridTemplateColumns:`repeat(${cols},1fr)`}}>{cells.map((day,i)=>{const level=!day?.total?0:Math.min(4,Math.max(1,Math.ceil(Math.sqrt(day.total/maximum)*4)));return day?<button key={i} className={`heat-cell level-${level} ${!day.observed?'unknown':''}`} title={`${day.date} · ${day.observed?`${day.total.toLocaleString()} Token${day.source==='cc-switch'?' · CC Switch 补录':''}`:'无日志覆盖'}`} aria-label={`${day.date} ${day.observed?format(day.total):'无日志覆盖'}`} onClick={()=>onDay(day)}/>:<span className="heat-cell blank" key={i}/>;})}</div></div><div className="heat-footer"><span>{days.filter(d=>d.observed&&d.total>0).length} 个活跃日{recovered>0&&` · 补录 ${recovered} 天`}</span><div>少 {[0,1,2,3,4].map(i=><i key={i} className={`level-${i}`}/>)} 多 <span className="unknown-key"/> 未知</div></div></div>;
}

import { DEFAULT_QUOTA_REFRESH_SECONDS } from '../shared/settings.mjs';
export const demoSettings = { source: 'demo', sessionsDir: '', theme: 'rose', backgroundEffect: 'transparent', opacity: 46, refreshSeconds: 60, quotaRefreshSeconds: DEFAULT_QUOTA_REFRESH_SECONDS, dailyGoal: 300e6, weeklyGoal: 3e9, alwaysOnTop: false, renewalDate: '' };
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const tokens = total => { const output = Math.round(total*.006), input=total-output, cached=Math.round(input*.963); return {input,cached,uncached:input-cached,output,total}; };
const sum = rows => rows.reduce((a,d)=>Object.fromEntries(Object.keys(a).map(key=>[key,a[key]+d[key]])),{input:0,cached:0,uncached:0,output:0,total:0});
// Largest-remainder allocation keeps every displayed breakdown additive.
function allocate(total, weights) {
  const weightSum=weights.reduce((a,b)=>a+b,0);
  const exact=weights.map(weight=>total*weight/weightSum), values=exact.map(Math.floor);
  let rest=total-values.reduce((a,b)=>a+b,0);
  const order=exact.map((value,index)=>({index,fraction:value-values[index]})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  for(let i=0;i<rest;i++)values[order[i%order.length].index]++;
  return values;
}
function allocateTokens(total, weights) {
  const parts=Object.fromEntries(['uncached','cached','output'].map(key=>[key,allocate(total[key],weights)]));
  return weights.map((_,index)=>{const uncached=parts.uncached[index],cached=parts.cached[index],output=parts.output[index],input=uncached+cached;return{uncached,cached,output,input,total:input+output};});
}
export function createDemo(settings = demoSettings, now = new Date()) {
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-181);
  const weekValues=[201e6,143e6,146e6,264e6,183e6,297e6,1566e6];
  const days=Array.from({length:182},(_,i)=>{ const d=new Date(start);d.setDate(d.getDate()+i); const n=i>=175?weekValues[i-175]:((i*7919)%19===0?0:Math.round((16+(Math.sin(i*1.91)+1)*26+(i%17===0?110:0))*1e6));return {...tokens(n),date:dateKey(d),observed:true}; });
  const today=days.at(-1), monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const lifetime=sum(days), recent7=sum(days.slice(-7)), week=sum(days.filter(d=>d.date>=dateKey(monday)));
  const names=['quota-glass','design-system','workspace-tools','personal-notes']; const weights=[.43,.29,.18,.1];
  const sessionWeights=weights.flatMap(weight=>[weight/3,weight/3,weight/3]);
  const parts=Object.fromEntries(['uncached','cached','output'].map(key=>[key,allocate(lifetime[key],sessionWeights)]));
  const todayParts=allocate(today.total,sessionWeights);
  const sessions=names.flatMap((name,i)=>Array.from({length:3},(_,j)=>{
    const k=i*3+j,uncached=parts.uncached[k],cached=parts.cached[k],output=parts.output[k],input=uncached+cached;
    return {id:`demo-${i}-${j}`,project:name,cwd:`D:/Projects/${name}`,lastActive:new Date(now.getTime()-(i*3+j)*17*60000).toISOString(),tokens:{uncached,cached,output,input,total:input+output},todayTokens:todayParts[k],toolCalls:210-i*30-j*7};
  }));
  const projects=names.map((name,i)=>({name,path:`D:/Projects/${name}`,tokens:sum(sessions.filter(s=>s.project===name).map(s=>s.tokens)),sessions:3,lastActive:sessions[i*3].lastActive}));
  const rank=(names,counts,source)=>names.map((name,i)=>({name,count:counts[i],sessions:Math.max(1,12-i),lastActive:new Date(now.getTime()-(i+1)*19*60000).toISOString(),source}));
  const hour=now.getHours()+now.getMinutes()/60+now.getSeconds()/3600;
  const hourly=Array.from({length:24},(_,i)=>({hour:i,today:i>now.getHours()?null:Math.round(today.total*(hour===0?1:Math.min(1,(i+1)/hour))**1.7),average:Math.round(130e6*((i+1)/24)**1.4)}));
  const summary={today:tokens(today.total),week,recent7,lifetime};
  const modelNames=['gpt-6.1-sol','gpt-6-astra','未知模型'],modelWeights=[.55,.3,.15];
  const modelParts=Object.fromEntries(['today','recent7','lifetime'].map(period=>[period,allocateTokens(summary[period],modelWeights)]));
  const models=modelNames.map((name,index)=>({name,today:modelParts.today[index],recent7:modelParts.recent7[index],lifetime:modelParts.lifetime[index],sessions:{today:12-index*3,recent7:12-index*2,lifetime:12-index},lastActive:new Date(now.getTime()-index*19*60000).toISOString()}));
  return {source:'demo',updatedAt:now.toISOString(),coverage:{since:days[0].date,files:36,sessions:sessions.length,label:'演示数据 · 不代表账户真实用量'},diagnostics:[],quota:{remaining:89,used:11,windowMinutes:10080,resetsAt:Math.floor(now.getTime()/1000)+5*86400+3600,updatedAt:now.toISOString(),source:'demo',stale:false,timeProgress:28},quota5h:{remaining:76,used:24,windowMinutes:300,resetsAt:Math.floor(now.getTime()/1000)+2*3600+15*60,updatedAt:now.toISOString(),source:'demo',stale:false,timeProgress:55},summary,days,hourly,baselineDays:7,sessions,projects,models,skills:rank(['frontend-design','find-skills','openai-docs','skill-creator','imagegen','web-design-guidelines'],[304,282,266,217,202,185],'示例加载记录'),tools:rank(['exec_command','apply_patch','write_stdin','web.run','view_image','wait'],[50382,3819,4324,2785,1891,2618],'示例工具调用').sort((a,b)=>b.count-a.count),settings:{...demoSettings,...settings}};
}

import { _electron as electron } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';
const root=process.cwd(),work=path.join(root,'.cache',`quota-live-${Date.now()}`),sessions=path.join(work,'sessions');await mkdir(sessions,{recursive:true});
const timestamp=new Date().toISOString();await writeFile(path.join(sessions,'fixture.jsonl'),JSON.stringify({timestamp,type:'session_meta',payload:{id:'quota-live-fixture',cwd:'E:/demo/quota'}})+'\n');
const store=new Store(path.join(work,'quota.sqlite'));store.saveSettings({...DEFAULT_SETTINGS,source:'local',sessionsDir:sessions});store.close();
const app=await electron.launch({args:[root],env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_TEST_DISABLE_ACCOUNT_POLL:'0'},timeout:30000});
try{
 const page=await app.firstWindow();await page.getByTestId('app-ready').waitFor();
 await page.evaluate(()=>{window.__quotaEvents=[];window.quota.onDashboardUpdated(d=>{if(d.quota?.source==='live')window.__quotaEvents.push(d.quota.updatedAt);});});
 const ready=app.waitForEvent('window');await page.evaluate(()=>window.quota.openCompact());const compact=await ready;await compact.getByTestId('app-ready').waitFor();
 await compact.evaluate(()=>{window.__quotaEvents=[];window.quota.onDashboardUpdated(d=>{if(d.quota?.source==='live')window.__quotaEvents.push(d.quota.updatedAt);});});
 await page.waitForFunction(()=>new Set(window.__quotaEvents).size>=2,null,{timeout:30000});
 const mainEvents=await page.evaluate(()=>[...new Set(window.__quotaEvents)]),compactEvents=await compact.evaluate(()=>[...new Set(window.__quotaEvents)]);
 assert.ok(compactEvents.length>=1);assert.equal(mainEvents.at(-1),compactEvents.at(-1));
 const mainData=await page.evaluate(()=>window.quota.getDashboard()),compactData=await compact.evaluate(()=>window.quota.getDashboard());
 assert.deepEqual(mainData.quota5h,compactData.quota5h);
 if(mainData.quota5h){assert.equal(mainData.quota5h.windowMinutes,300);assert.equal(mainData.quota5h.source,'live');}
 const elapsed=Date.parse(mainEvents[1])-Date.parse(mainEvents[0]);assert.ok(elapsed>1000&&elapsed<14000);
 const report={passed:true,at:new Date().toISOString(),defaultIntervalMs:5000,fiveHourWindowAvailable:Boolean(mainData.quota5h),observedResultSpacingMs:elapsed,mainUpdates:mainEvents.length,compactUpdates:compactEvents.length,checks:['automatic live account polling without button click','fixed five-second scheduler','both windows receive the same quota update','5h result synchronized and exact window if provided','read-only endpoint, no model turns'],note:'Result spacing includes backend response latency; timestamps only, no identity or quota values persisted.'};
 await writeFile('artifacts/quota-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await app.close();}

import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';

const root=process.cwd(), work=path.join(root,'.cache',`smoke-${Date.now()}`), artifacts=path.join(root,'artifacts');
await mkdir(work,{recursive:true});await mkdir(artifacts,{recursive:true});
const store=new Store(path.join(work,'quota.sqlite'));
store.saveSettings({...DEFAULT_SETTINGS,source:'demo'});store.close();
const errors=[];
let app=await electron.launch({args:[root],env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_DEV_URL:'',QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
let report={};
try {
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.getByTestId('app-ready').waitFor();
  const data=await page.evaluate(()=>window.quota.getDashboard());
  assert.equal(data.source,'demo');assert.equal(data.summary.today.total,1566e6);
  await page.screenshot({path:path.join(artifacts,'main-trends.png'),fullPage:true});
  for(const label of ['今日任务','项目排行','Skill','模型用量','用量趋势']) {
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.getByTestId({'今日任务':'page-tasks','项目排行':'page-projects','Skill':'page-skills','模型用量':'page-models','用量趋势':'page-trends'}[label]).waitFor();
    if(label==='模型用量'){
      assert.deepEqual(await page.getByRole('navigation',{name:'统计视图'}).getByRole('button').allTextContents(),['今日任务','用量趋势','项目排行','Skill','模型用量']);
      for(const period of ['今日','近 7 天','本地累计'])await page.getByRole('group',{name:'模型用量时间范围'}).getByRole('button',{name:period,exact:true}).click();
      await page.locator('.model-name').first().click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
      await page.screenshot({path:path.join(artifacts,'main-models.png'),fullPage:true});
    }
    if(label==='Skill')await page.screenshot({path:path.join(artifacts,'main-skills.png'),fullPage:true});
  }
  assert.equal(await page.getByText('Token 小目标',{exact:true}).count(),0);
  assert.equal(data.quota5h.windowMinutes,300);
  const countdown=await page.getByTestId('quota-countdown').innerText();await page.waitForTimeout(1100);assert.notEqual(await page.getByTestId('quota-countdown').innerText(),countdown);
  const settingsButton=page.getByRole('button',{name:/设置/}).first();await settingsButton.click();
  await page.waitForTimeout(150);await page.screenshot({path:path.join(artifacts,'settings.png'),fullPage:true});
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();assert.equal(await page.getByLabel('每日目标（Token）').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  const compactReady=app.waitForEvent('window');
  await page.evaluate(()=>window.quota.openCompact());
  await compactReady;
  const compact=app.windows().find(w=>w!==page);assert.ok(compact);
  compact.on('pageerror',e=>errors.push(e.message));await compact.waitForSelector('button');await compact.waitForTimeout(400);
  await compact.screenshot({path:path.join(artifacts,'compact.png'),fullPage:true});
  await compact.getByTestId('app-ready').waitFor();assert.equal(await compact.getByTestId('quota-five-hour').count(),1);assert.equal(await compact.getByText('Token 小目标',{exact:true}).count(),0);
  await compact.evaluate(()=>window.quota.hideCompact());
  const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.getTitle().includes('紧凑')&&!w.isVisible()));assert.ok(hidden);
  await page.evaluate(()=>window.quota.saveSettings({theme:'graphite',dailyGoal:123456789}));
  const changed=await page.evaluate(()=>window.quota.getDashboard());assert.equal(changed.settings.theme,'graphite');assert.equal(changed.settings.dailyGoal,123456789);
  for(const theme of ['rose','graphite']) {
    await page.evaluate(theme=>window.quota.saveSettings({theme,opacity:60}),theme);
    await page.waitForFunction(theme=>document.querySelector('.app')?.classList.contains('theme-'+theme)&&getComputedStyle(document.querySelector('.app')).backgroundColor.includes('0.6'),theme);
    const low=await page.locator('.app').first().evaluate(el=>getComputedStyle(el).backgroundColor);
    await page.evaluate(()=>window.quota.saveSettings({opacity:100}));
    await page.waitForFunction(()=>!getComputedStyle(document.querySelector('.app')).backgroundColor.includes('0.6'));
    const high=await page.locator('.app').first().evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(low,high);
  }
  const rejected=await page.evaluate(async()=>{try{await window.quota.saveSettings({dailyGoal:-1});return false;}catch{return true;}});assert.equal(rejected,true);
  const fixtureDir=path.join(work,'sessions');await mkdir(fixtureDir);
  const timestamp=new Date().toISOString();
  const fixture=[{timestamp,type:'session_meta',payload:{id:'smoke-session',cwd:'E:/demo/fixture'}},{timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,cached_input_tokens:800,output_tokens:100,total_tokens:1100}}}},{timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,cached_input_tokens:800,output_tokens:100,total_tokens:1100}}}}];
  await writeFile(path.join(fixtureDir,'fixture.jsonl'),fixture.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const local=await page.evaluate(dir=>window.quota.saveSettings({source:'local',sessionsDir:dir}),fixtureDir);
  assert.equal(local.source,'local');assert.equal(local.summary.lifetime.total,1100);assert.equal(local.summary.lifetime.uncached,200);assert.equal(local.quota5h,null);assert.equal(local.models[0].name,'未知模型');
  await page.getByTestId('quota-five-hour').getByText('—',{exact:true}).waitFor();
  await page.getByRole('button',{name:'模型用量',exact:true}).click();await page.getByTestId('page-models').waitFor();await page.getByRole('group',{name:'模型用量时间范围'}).getByRole('button',{name:'本地累计',exact:true}).click();assert.equal(await page.locator('.model-name').first().innerText().then(s=>s.includes('未知模型')),true);
  await page.getByRole('button',{name:'用量趋势',exact:true}).click();
  const repeated=await page.evaluate(()=>window.quota.refresh());assert.equal(repeated.summary.lifetime.total,1100);
  await page.reload();await page.getByTestId('app-ready').waitFor();
  await page.screenshot({path:path.join(artifacts,'local-fixture.png'),fullPage:true});
  const output=path.join(work,'export.json');
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},output);
  assert.equal(await page.evaluate(()=>window.quota.exportData()),true);
  assert.equal(JSON.parse(await readFile(output,'utf8')).summary.lifetime.total,1100);
  await page.evaluate(()=>window.quota.saveSettings({refreshSeconds:30}));
  fixture[1].payload.info.total_token_usage={input_tokens:3000,cached_input_tokens:2400,output_tokens:300,total_tokens:3300};
  await appendFile(path.join(fixtureDir,'fixture.jsonl'),JSON.stringify(fixture[1])+'\n');
  await page.waitForFunction(()=>document.querySelector('.summary-grid')?.textContent.includes('3.3K'),null,{timeout:40000});
  await page.evaluate(()=>window.quota.openCompact());
  await compact.waitForFunction(()=>document.querySelector('.mini-total')?.textContent.includes('3.3K'),null,{timeout:10000});
  assert.ok(fixtureDir.startsWith(work+path.sep));
  await rename(fixtureDir,fixtureDir+'-unavailable');
  const retained=await page.evaluate(()=>window.quota.refresh());
  assert.equal(retained.summary.lifetime.total,3300);assert.ok(retained.diagnostics.some(d=>d.includes('保留上次')));
  await rename(fixtureDir+'-unavailable',fixtureDir);
  await app.close();
  app=await electron.launch({args:[root],env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_DEV_URL:'',QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
  const restarted=await app.firstWindow();await restarted.getByTestId('app-ready').waitFor();
  const persisted=await restarted.evaluate(()=>window.quota.getDashboard());
  assert.equal(persisted.settings.theme,'graphite');assert.equal(persisted.settings.dailyGoal,123456789);assert.equal(persisted.summary.lifetime.total,3300);
  const concurrent=await restarted.evaluate(async()=>{await Promise.all([window.quota.saveSettings({dailyGoal:999}),window.quota.saveSettings({weeklyGoal:9999})]);return window.quota.getDashboard();});
  assert.equal(concurrent.settings.dailyGoal,999);assert.equal(concurrent.settings.weeklyGoal,9999);
  assert.deepEqual(errors,[]);
  report={passed:true,checks:['desktop startup','demo source','five tabs including models immediately after Skill','model period filters and details','5h quota countdown and both windows','no goal controls','missing 5h quota stays unknown','unknown model retained','settings modal escape','compact window show/hide','restart persistence','concurrent settings merged','rose and graphite surface opacity changes computed background','automatic append update in both windows','directory failure preserves totals','clean quit and restart','invalid settings rejected','local fixture exact tokens','repeat refresh deduplication','JSON export','no renderer errors'],screenshots:['main-trends.png','main-models.png','main-skills.png','settings.png','compact.png','local-fixture.png'],at:new Date().toISOString()};
  console.log(JSON.stringify(report,null,2));
} catch(error){report={passed:false,error:error.message,rendererErrors:errors,at:new Date().toISOString()};throw error;}
finally{await writeFile(path.join(artifacts,'smoke-report.json'),JSON.stringify(report,null,2));await app.close();}

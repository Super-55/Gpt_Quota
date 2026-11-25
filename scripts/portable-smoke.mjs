import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';
const root=process.cwd(),work=path.join(root,'.cache',`portable-check-${Date.now()}`);
await mkdir(work,{recursive:true});
const db=new Store(path.join(work,'quota.sqlite'));db.saveSettings({...DEFAULT_SETTINGS,source:'demo'});db.close();
const port=19327,inspectPort=19328;
const launcher=spawn(path.join(root,'release','QuotaGlass-0.4.1-Windows.exe'),[`--remote-debugging-port=${port}`,`--inspect=${inspectPort}`],{cwd:root,env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_DEV_URL:'',QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},windowsHide:true,stdio:'ignore'});
let browser;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let connected=false;
  for(let i=0;i<90;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok){connected=true;break;}}catch{}if(launcher.exitCode!==null)throw new Error(`Launcher exited: ${launcher.exitCode}`);await pause(500);}
  assert.ok(connected,'portable Chromium debugging endpoint');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=browser.contexts()[0].pages()[0];await page.getByTestId('app-ready').waitFor();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const data=await page.evaluate(()=>window.quota.getDashboard());assert.equal(data.source,'demo');assert.equal(data.summary.today.total,1566e6);
  assert.equal(data.quota5h.windowMinutes,300);
  await page.getByRole('button',{name:'模型用量',exact:true}).click();await page.getByTestId('page-models').waitFor();await page.screenshot({path:path.join(root,'artifacts','portable-models.png'),fullPage:true});
  await page.getByRole('button',{name:'Skill',exact:true}).click();await page.getByTestId('page-skills').waitFor();
  await page.screenshot({path:path.join(root,'artifacts','portable-skills.png'),fullPage:true});
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);
  const endpoints=await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json();
  const ws=new WebSocket(endpoints[0].webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.quit()"}}));
  await pause(300);ws.close();
  for(let i=0;i<100&&launcher.exitCode===null;i++)await pause(200);
  assert.notEqual(launcher.exitCode,null,'portable launcher exits after app.quit');
  const report={passed:true,at:new Date().toISOString(),executable:'release/QuotaGlass-0.4.1-Windows.exe',checks:['single executable extracts and starts','isolated settings directory','preload and statistics loaded','5h quota data','model usage page','Skill page','settings Escape','no renderer errors','normal app quit and launcher exit'],automation:'Chromium CDP with explicit test-only debugging ports; launcher wrapper does not forward Playwright automatic inspection discovery'};
  await writeFile(path.join(root,'artifacts','portable-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  await browser?.close().catch(()=>{});
  if(launcher.exitCode===null)await new Promise(resolve=>{const p=spawn('taskkill',['/PID',String(launcher.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.once('exit',resolve);p.once('error',resolve);});
}

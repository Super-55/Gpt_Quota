import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';
const root=process.cwd(),work=path.join(root,'.cache',`package-smoke-${Date.now()}`);
await mkdir(work,{recursive:true});await mkdir(path.join(root,'artifacts'),{recursive:true});
const db=new Store(path.join(work,'quota.sqlite'));db.saveSettings({...DEFAULT_SETTINGS,source:'demo'});db.close();
const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGE_EXE || path.join(root,'release','win-unpacked','Quota Glass.exe'),args:[],env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_DEV_URL:'',QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
const errors=[];
try{
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByTestId('app-ready').waitFor();
  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
  const data=await page.evaluate(()=>window.quota.getDashboard());assert.equal(data.source,'demo');assert.equal(data.summary.today.total,1566e6);
  await page.getByRole('button',{name:'Skill',exact:true}).click();await page.getByTestId('page-skills').waitFor();
  await page.screenshot({path:path.join(root,'artifacts','packaged-skills.png'),fullPage:true});
  // A browser-only window has no preload and must use the same compiled demo adapter.
  await app.evaluate(async({BrowserWindow,app})=>{const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadFile(app.getAppPath()+'/dist/index.html');});
  const browser=app.windows().find(w=>w!==page);assert.ok(browser);await browser.getByTestId('app-ready').waitFor();
  assert.equal(await browser.evaluate(()=>typeof window.quota),'undefined');
  assert.ok((await browser.locator('.source-badge').innerText()).includes('演示'));
  await browser.getByRole('button',{name:'设置',exact:true}).click();await browser.getByRole('dialog',{name:'设置',exact:true}).waitFor();await browser.keyboard.press('Escape');assert.equal(await browser.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);
  const report={passed:true,at:new Date().toISOString(),checks:['packaged executable startup','shared modules included','sandboxed preload bridge','compiled browser fallback','browser settings modal','packaged Skill content','no renderer errors']};
  await writeFile(path.join(root,'artifacts',process.env.QUOTA_PACKAGE_EXE?'portable-smoke-report.json':'package-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await app.close();}

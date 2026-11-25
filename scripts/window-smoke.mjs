import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';

const root=process.cwd(), work=path.join(root,'.cache',`window-test-${Date.now()}`), output=path.join(root,'artifacts','window-v4');
await mkdir(work,{recursive:true});await mkdir(output,{recursive:true});
const store=new Store(path.join(work,'quota.sqlite'));store.saveSettings({...DEFAULT_SETTINGS,source:'demo'});store.close();
const app=await electron.launch({...(process.env.QUOTA_WINDOW_EXE?{executablePath:process.env.QUOTA_WINDOW_EXE,args:[]}:{args:[root]}),env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
let pointer, originalPoint;
const report={passed:false,checks:[],gestures:[]};
try {
  const page=await app.firstWindow();await page.getByTestId('app-ready').waitFor();
  const cursor=await app.evaluate(({screen})=>screen.getCursorScreenPoint());
  originalPoint=await app.evaluate(({screen},cursor)=>screen.dipToScreenPoint(cursor),cursor);
  pointer=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','native-pointer.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:pointer.stdout}),messages=[],waiters=[];
  lines.on('line',line=>{const next=waiters.shift();if(next)next(line);else messages.push(line);});
  const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise(resolve=>waiters.push(resolve));
  assert.equal(await Promise.race([next(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('native pointer helper timeout')),15000))]),'ready');
  async function drag(start,end,steps=12){pointer.stdin.write(JSON.stringify({start,end,steps})+'\n');assert.equal(await next(),'done');}
  async function bounds(compact=false){return app.evaluate(({BrowserWindow},compact)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('compact=1')===compact).getBounds(),compact);}
  async function prepare(compact=false){await app.evaluate(({BrowserWindow,screen},compact)=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('compact=1')===compact),area=screen.getPrimaryDisplay().workArea;win.setBounds({x:area.x+110,y:area.y+80,width:compact?410:860,height:compact?590:620});win.setAlwaysOnTop(true);win.show();win.focus();},compact);await page.waitForTimeout(130);}
  async function resize(target,direction,delta,compact=false,steps=12){
    await prepare(compact);const before=await bounds(compact);
    const handle=await target.getByTestId(`resize-${direction}`).boundingBox();assert.ok(handle);
    const points=await app.evaluate(({screen},{bounds,handle,delta})=>{
      const start={x:bounds.x+handle.x+handle.width/2,y:bounds.y+handle.y+handle.height/2};
      return {start:screen.dipToScreenPoint(start),end:screen.dipToScreenPoint({x:start.x+delta.x,y:start.y+delta.y})};
    },{bounds:before,handle,delta});
    await drag(points.start,points.end,steps);const after=await bounds(compact);report.gestures.push({compact,direction,delta,before,after});
    if(direction.includes('e'))assert.ok(after.width>before.width+10,`${direction} must increase width`);
    if(direction.includes('w'))assert.ok(after.x<before.x-10&&after.width>before.width+10,`${direction} must move west edge`);
    if(direction.includes('s'))assert.ok(after.height>before.height+10,`${direction} must increase height`);
    if(direction.includes('n'))assert.ok(after.y<before.y-10&&after.height>before.height+10,`${direction} must move north edge`);
  }
  for(const direction of ['e','w','s','n','se','ne','nw','sw'])await resize(page,direction,{x:direction.includes('e')?44:direction.includes('w')?-44:0,y:direction.includes('s')?30:direction.includes('n')?-30:0});
  report.checks.push('actual Windows mouse drags resize all eight edges/corners at monitor DPI');
  // Consecutive short drags catch pointer-capture and cancelled-frame cleanup bugs.
  for(let index=0;index<3;index++)await resize(page,'se',{x:28,y:22},false,1);
  report.checks.push('three consecutive short pointer gestures remain responsive');
  const ready=app.waitForEvent('window');await page.evaluate(()=>window.quota.openCompact());const compact=await ready;await compact.getByTestId('app-ready').waitFor();
  await resize(compact,'se',{x:50,y:40},true);
  await compact.getByRole('button',{name:'置顶紧凑面板',exact:true}).click();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('compact=1')).isAlwaysOnTop()),true);
  await compact.getByRole('button',{name:'取消置顶',exact:true}).click();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('compact=1')).isAlwaysOnTop()),false);
  report.checks.push('compact resizes with native pointer and direct pin toggles actual native always-on-top');
  await compact.getByRole('button',{name:'置顶紧凑面板',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.quota.getDashboard())).settings.alwaysOnTop,true);
  await compact.getByRole('button',{name:'设置',exact:true}).click();
  await compact.getByLabel('背景效果',{exact:true}).selectOption('frosted');
  await compact.getByLabel('背景透明度',{exact:true}).focus();
  for(let step=0;step<11;step++)await compact.getByLabel('背景透明度',{exact:true}).press('ArrowRight');
  await compact.getByRole('button',{name:'保存设置',exact:true}).click();
  await compact.waitForFunction(()=>document.querySelector('.app').classList.contains('effect-frosted'));
  const settings=(await page.evaluate(()=>window.quota.getDashboard())).settings;
  assert.equal(settings.backgroundEffect,'frosted');assert.equal(settings.opacity,35);
  await page.waitForFunction(()=>document.querySelector('.app').classList.contains('effect-frosted'));
  await compact.screenshot({path:path.join(output,'compact-frosted.png')});
  report.checks.push('settings controls change native background effect and background transparency in both windows');
  await page.evaluate(()=>window.quota.saveSettings({backgroundEffect:'transparent',opacity:46}));
  await compact.waitForFunction(()=>document.querySelector('.app').classList.contains('effect-transparent'));
  await compact.screenshot({path:path.join(output,'compact-transparent.png')});
  const scroll=await compact.evaluate(()=>({document:document.documentElement.scrollHeight,viewport:innerHeight,app:document.querySelector('.app').scrollHeight,client:document.querySelector('.app').clientHeight}));
  assert.equal(scroll.document,scroll.viewport);assert.ok(scroll.app>scroll.client);report.scroll=scroll;
  report.checks.push('overflow scrolls within the glass frame instead of the document');
  await compact.evaluate(()=>window.quota.hideCompact());await page.bringToFront();await prepare();
  // Retain the familiar native title drag after adding resize hit targets.
  const before=await bounds();const header=await page.locator('.brand').first().boundingBox();
  const points=await app.evaluate(({screen},{before,header})=>{const p={x:before.x+header.x+header.width/2,y:before.y+header.y+header.height/2};return {start:screen.dipToScreenPoint(p),end:screen.dipToScreenPoint({x:p.x+45,y:p.y+25})};},{before,header});
  await drag(points.start,points.end);const moved=await bounds();assert.ok(moved.x>before.x+20&&moved.y>before.y+10);report.checks.push('native title-bar drag still moves the window');
  // Return the pointer to its original location without clicking user windows.
  report.passed=true;report.at=new Date().toISOString();report.executable=process.env.QUOTA_WINDOW_EXE||'source';console.log(JSON.stringify(report,null,2));
}catch(error){report.error=error.message;throw error;}
finally{
  if(pointer&&pointer.exitCode===null){
    if(originalPoint)pointer.stdin.write(JSON.stringify({action:'restore',point:originalPoint})+'\n');
    pointer.stdin.write(JSON.stringify({action:'quit'})+'\n');pointer.stdin.end();
    await Promise.race([new Promise(resolve=>pointer.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
    if(pointer.exitCode===null)pointer.kill();
  }
  await writeFile(path.join(output,'window-report.json'),JSON.stringify(report,null,2));await app.close();
}

import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';

const root=process.cwd(),out=path.join(root,'artifacts','corners-v041'),work=path.join(root,'.cache',`corners-${Date.now()}`);
await mkdir(out,{recursive:true});await mkdir(work,{recursive:true});
const store=new Store(path.join(work,'quota.sqlite'));store.saveSettings({...DEFAULT_SETTINGS,source:'demo',backgroundEffect:'frosted'});store.close();
const app=await electron.launch({...(process.env.QUOTA_CORNERS_EXE?{executablePath:process.env.QUOTA_CORNERS_EXE,args:[]}:{args:[root]}),env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
const report={passed:false,cases:[],executable:process.env.QUOTA_CORNERS_EXE||'source'};
try {
  let page=await app.firstWindow();await page.getByTestId('app-ready').waitFor();
  const ready=app.waitForEvent('window');await page.evaluate(()=>window.quota.openCompact());let compact=await ready;await compact.getByTestId('app-ready').waitFor();
  await app.evaluate(async({BrowserWindow,screen})=>{
    const area=screen.getPrimaryDisplay().workArea;
    globalThis.cornerBackdrop=new BrowserWindow({...area,frame:false,show:false,skipTaskbar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await globalThis.cornerBackdrop.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;height:100vh;background:#00e865"><div style="position:absolute;left:0;right:0;top:140px;height:120px;background:repeating-conic-gradient(#f0f0f0 0% 25%,#101010 0% 50%) 0 0 / 12px 12px"></div></body>'));
    globalThis.cornerBackdrop.setAlwaysOnTop(true);globalThis.cornerBackdrop.show();globalThis.cornerBackdrop.moveTop();
  });
  async function changeEffect(effect){
    const previous=(await page.evaluate(()=>window.quota.getDashboard())).settings.backgroundEffect;
    if(previous===effect){await page.evaluate(effect=>window.quota.saveSettings({backgroundEffect:effect}),effect);return;}
    const mainClosed=page.waitForEvent('close'),compactClosed=compact.waitForEvent('close');
    await page.evaluate(effect=>window.quota.saveSettings({backgroundEffect:effect}),effect);
    await Promise.all([mainClosed,compactClosed]);
    page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('compact=1'));
    compact=app.windows().find(p=>p.url().includes('compact=1'));
    assert.ok(page&&compact);
  }
  for(const effect of ['frosted','transparent','frosted']) {
    await changeEffect(effect);
    for(const small of [false,true]) for(const isCompact of [false,true]) {
      const label=`${isCompact?'compact':'main'}-${effect}-${small?'small':'normal'}`;
      const result=await app.evaluate(async({BrowserWindow,screen,desktopCapturer},{isCompact,small,label,out})=>{
        const windows=BrowserWindow.getAllWindows().filter(w=>w!==globalThis.cornerBackdrop);
        for(const win of windows){win.setAlwaysOnTop(false);win.hide();}
        const win=windows.find(w=>w.webContents.getURL().includes('compact=1')===isCompact),area=screen.getPrimaryDisplay().workArea;
        win.setBounds({x:area.x+64,y:area.y+48,width:isCompact?(small?360:440):(small?760:980),height:isCompact?(small?460:700):(small?540:740)});
        const bounds=win.getBounds(),display=screen.getDisplayMatching(bounds),pause=ms=>new Promise(r=>setTimeout(r,ms));
        globalThis.cornerBackdrop.setAlwaysOnTop(true);globalThis.cornerBackdrop.show();globalThis.cornerBackdrop.moveTop();await pause(140);
        async function capture(){
          const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
          const source=sources.find(s=>s.display_id===String(display.id))||sources[0],scale=source.thumbnail.getSize().width/display.size.width;
          return {image:source.thumbnail.crop({x:Math.round((bounds.x-display.bounds.x)*scale),y:Math.round((bounds.y-display.bounds.y)*scale),width:Math.round(bounds.width*scale),height:Math.round(bounds.height*scale)}),scale};
        }
        const baseline=await capture();win.setAlwaysOnTop(true);win.show();win.moveTop();win.focus();
        for(let attempt=0;attempt<100;attempt++){if(await win.webContents.executeJavaScript("Boolean(document.querySelector('.app'))"))break;await pause(50);}
        await pause(300);const actual=await capture();
        const fs=process.getBuiltinModule('fs');fs.writeFileSync(out+'/'+label+'.png',actual.image.toPNG());
        const size=actual.image.getSize(),a=actual.image.toBitmap(),b=baseline.image.toBitmap();
        const pixel=(bitmap,x,y)=>[...bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)];
        const cornerDelta=[],cornerShadeError=[],cornerSamples=[];
        for(const [right,bottom]of [[false,false],[true,false],[false,true],[true,true]]){
          let maximum=0,shadeError=0;
          for(let y=0;y<=1;y++)for(let x=0;x<=1;x++){
            const px=right?size.width-1-x:x,py=bottom?size.height-1-y:y;
            const own=pixel(a,px,py),back=pixel(b,px,py);maximum=Math.max(maximum,...own.map((v,i)=>Math.abs(v-back[i])));const shade=own[1]/Math.max(1,back[1]);shadeError=Math.max(shadeError,...own.map((v,i)=>Math.abs(v-back[i]*shade)));if(x===0&&y===0)cornerSamples.push({own,back});
          }
          cornerDelta.push(maximum);cornerShadeError.push(shadeError);
        }
        const samples=[],baselineSamples=[];
        for(let y=Math.round(110*actual.scale);y<Math.round(190*actual.scale);y++)for(let x=Math.round(9*actual.scale);x<Math.round(16*actual.scale);x++){const rgb=pixel(a,x,y);samples.push(rgb.reduce((n,v)=>n+v,0)/3);baselineSamples.push(pixel(b,x,y).reduce((n,v)=>n+v,0)/3);}
        const mean=samples.reduce((n,v)=>n+v,0)/samples.length,sd=Math.sqrt(samples.reduce((n,v)=>n+(v-mean)**2,0)/samples.length);
        const baselineMean=baselineSamples.reduce((n,v)=>n+v,0)/baselineSamples.length,baselineSd=Math.sqrt(baselineSamples.reduce((n,v)=>n+(v-baselineMean)**2,0)/baselineSamples.length);
        const radius=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.app')).borderRadius");
        win.setAlwaysOnTop(false);win.hide();return {label,bounds,scale:actual.scale,cornerDelta,cornerShadeError,cornerSamples,interiorTextureSd:sd,baselineTextureSd:baselineSd,cssRadius:radius};
      },{isCompact,small,label,out});
      report.cases.push(result);
      assert.ok(result.cornerShadeError.every(error=>error<=10),`${label}: outside rounded corners must retain the backdrop hue through the system shadow ${result.cornerShadeError}`);
      assert.equal(result.cssRadius,'8px');assert.ok(result.baselineTextureSd>60,'checker backdrop must be visible in baseline');
      if(effect==='frosted')assert.ok(result.interiorTextureSd<10,`${label}: native blur survives shape: ${result.interiorTextureSd}`);
      else assert.ok(result.interiorTextureSd>20,`${label}: native alpha survives shape: ${result.interiorTextureSd}`);
    }
  }
  await app.evaluate(()=>globalThis.cornerBackdrop.hide());
  // Native material hosts change on mode switch; preserve the user's view and hidden pin state.
  await page.evaluate(()=>window.quota.openMain());await page.getByTestId('app-ready').waitFor();
  await page.getByRole('button',{name:'模型用量',exact:true}).click();
  await page.locator('.app').evaluate(el=>{el.scrollTop=180;});
  await compact.evaluate(()=>window.quota.openCompact());await compact.getByTestId('app-ready').waitFor();
  await compact.locator('.app').evaluate(el=>{el.scrollTop=220;});
  await compact.evaluate(()=>window.quota.saveSettings({alwaysOnTop:true}));
  await compact.evaluate(()=>window.quota.hideCompact());
  const state=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:')).map(w=>({compact:w.webContents.getURL().includes('compact=1'),bounds:w.getBounds(),visible:w.isVisible(),pinned:w.isAlwaysOnTop()})));
  await changeEffect('transparent');await page.getByTestId('app-ready').waitFor();
  assert.equal(await page.getByRole('button',{name:'模型用量',exact:true}).getAttribute('aria-pressed'),'true');
  assert.ok(await page.locator('.app').evaluate(el=>el.scrollTop)>=100);
  const restored=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:')).map(w=>({compact:w.webContents.getURL().includes('compact=1'),bounds:w.getBounds(),visible:w.isVisible(),pinned:w.isAlwaysOnTop()})));
  for(const before of state){const after=restored.find(w=>w.compact===before.compact);assert.equal(after.visible,before.visible);assert.equal(after.pinned,before.pinned);for(const key of ['x','y','width','height'])assert.ok(Math.abs(after.bounds[key]-before.bounds[key])<=3);}
  await compact.evaluate(()=>window.quota.openCompact());await compact.getByTestId('app-ready').waitFor();
  assert.ok(await compact.locator('.app').evaluate(el=>el.scrollTop)>=150);
  report.handoff={passed:true,checks:['both background directions','bounds and visibility preserved','hidden compact remains hidden and pinned','model tab and both scroll positions restored']};
  report.passed=true;report.at=new Date().toISOString();console.log(JSON.stringify(report,null,2));
}catch(error){report.error=error.message;throw error;}
finally{await writeFile(path.join(out,process.env.QUOTA_CORNERS_EXE?'packaged-report.json':'source-report.json'),JSON.stringify(report,null,2));await app.close();}

import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { Store } from '../electron/store.mjs';
import { DEFAULT_SETTINGS } from '../electron/defaults.mjs';
const root=process.cwd(),work=path.join(root,'.cache',`glass-${Date.now()}`);await mkdir(work,{recursive:true});await mkdir('artifacts',{recursive:true});
const store=new Store(path.join(work,'quota.sqlite'));store.saveSettings({...DEFAULT_SETTINGS,source:'demo'});store.close();
const app=await electron.launch({...(process.env.QUOTA_GLASS_EXE?{executablePath:process.env.QUOTA_GLASS_EXE,args:[]}:{args:[root]}),env:{...process.env,QUOTA_TEST_USER_DATA:work,QUOTA_TEST_DISABLE_ACCOUNT_POLL:'1'},timeout:30000});
const errors=[],report={passed:false,checks:[],compositor:[],animation:{}};
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByTestId('app-ready').waitFor();await page.emulateMedia({reducedMotion:'no-preference'});
 const before=await page.locator('.chart-beam.core').first().evaluate(el=>getComputedStyle(el).strokeDashoffset);await page.waitForTimeout(350);const after=await page.locator('.chart-beam.core').first().evaluate(el=>getComputedStyle(el).strokeDashoffset);assert.notEqual(before,after);report.animation.lineDash={before,after};
 const meterBefore=await page.locator('.meter > span').first().evaluate(el=>getComputedStyle(el,'::after').transform);await page.waitForTimeout(350);const meterAfter=await page.locator('.meter > span').first().evaluate(el=>getComputedStyle(el,'::after').transform);assert.notEqual(meterBefore,meterAfter);report.animation.meter={before:meterBefore,after:meterAfter};
 async function compositor(compact,expanded=false){return app.evaluate(async({BrowserWindow,desktopCapturer,screen},args)=>{
   const {root,compact,expanded}=args,win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('compact=1')===compact&&!w.webContents.getURL().startsWith('data:'));
   const display=screen.getDisplayMatching(win.getBounds()),area=display.workArea;
   if(!expanded)win.setBounds({x:area.x+20,y:area.y+20,width:compact?440:940,height:Math.min(compact?680:700,area.height-30)});win.show();
   const bounds=win.getBounds();
   const backdrop=new BrowserWindow({x:bounds.x-4,y:bounds.y-4,width:bounds.width+8,height:bounds.height+8,frame:false,show:false,skipTaskbar:true,backgroundColor:'#ef1731',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   await backdrop.loadURL('data:text/html,<body style="margin:0;background:%23ef1731;height:100vh"></body>');backdrop.showInactive();win.setAlwaysOnTop(true);win.show();win.focus();
   const pause=ms=>new Promise(r=>setTimeout(r,ms));await pause(650);
   const fs=process.getBuiltinModule('fs');const captures=[];
   for(const [name,color] of [['red','#ef1731'],['blue','#146bee']]){
     backdrop.setBackgroundColor(color);await backdrop.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(color)}`);await pause(500);
     const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
     const source=sources.find(s=>s.display_id===String(display.id))||sources[0];const size=source.thumbnail.getSize(),scale=size.width/display.size.width;
     const cropped=source.thumbnail.crop({x:Math.round((bounds.x-display.bounds.x)*scale),y:Math.round((bounds.y-display.bounds.y)*scale),width:Math.round(bounds.width*scale),height:Math.round(bounds.height*scale)});
     const imagePath=root+`/artifacts/glass-${compact?'compact':expanded?'main-expanded':'main'}-${name}.png`;fs.writeFileSync(imagePath,cropped.toPNG());
     const px=Math.round(8*scale),py=Math.round(180*scale),bitmap=cropped.toBitmap(),imageSize=cropped.getSize(),offset=(py*imageSize.width+px)*4;
     const panelRect=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('.panel').getBoundingClientRect();return {x:r.x+20,y:r.y+60}})()");const panelOffset=(Math.round(panelRect.y*scale)*imageSize.width+Math.round(panelRect.x*scale))*4;captures.push({name,panelPixel:[...bitmap.subarray(panelOffset,panelOffset+4)],pixel:[...bitmap.subarray(offset,offset+4)],imagePath});
   }
   backdrop.destroy();win.setAlwaysOnTop(false);return {compact,expanded,background:win.getBackgroundColor(),captures};
 },{root,compact,expanded});}
 report.compositor.push(await compositor(false));
 await page.evaluate(()=>window.quota.controlWindow('expand'));report.compositor.push(await compositor(false,true));await page.evaluate(()=>window.quota.controlWindow('expand'));report.compositor.push(await compositor(false));
 const compactReady=app.waitForEvent('window');await page.evaluate(()=>window.quota.openCompact());const compact=await compactReady;await compact.getByTestId('app-ready').waitFor();
 report.compositor.push(await compositor(true));
 for(const result of report.compositor){const [a,b]=result.captures;const delta=a.pixel.slice(0,3).reduce((n,value,i)=>n+Math.abs(value-b.pixel[i]),0);result.pixelDelta=delta;assert.ok(delta>50,`native compositor must show background change: ${delta}`);const panelDelta=a.panelPixel.slice(0,3).reduce((n,value,i)=>n+Math.abs(value-b.panelPixel[i]),0);result.panelDelta=panelDelta;assert.ok(panelDelta>50,`panel must transmit external background: ${panelDelta}`);}
 await page.emulateMedia({reducedMotion:'reduce'});const reduced=await page.locator('.chart-beam.core').first().evaluate(el=>getComputedStyle(el).animationName);assert.equal(reduced,'none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 assert.deepEqual(errors,[]);report.passed=true;report.at=new Date().toISOString();report.executable=process.env.QUOTA_GLASS_EXE||'source';report.checks=['main native red/blue background transmission','compact native red/blue background transmission','transparent window survives expand and restore','line light band advances','progress light band advances','reduced motion disables flow','no renderer errors'];console.log(JSON.stringify(report,null,2));
}finally{await writeFile('artifacts/glass-smoke-report.json',JSON.stringify(report,null,2));await app.close();}

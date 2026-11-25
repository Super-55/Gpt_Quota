import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen, nativeTheme } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Collector } from './collector.mjs';
import { aggregateDashboard, selectQuota, selectQuotaWindow } from './analytics.mjs';
import { abortAccountReads } from './account.mjs';
import { DEFAULT_SETTINGS, validateSettings } from './defaults.mjs';
import { createDemo } from './demo.mjs';
import { createSerialQueue } from '../shared/settings.mjs';
import { createQuotaMonitor } from './quota-monitor.mjs';
import { createWindowGestures } from './window-gestures.mjs';
import { roundedWindowShape } from './window-shape.mjs';
import { readCcSwitchHistory } from './cc-switch-history.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const queueSettingsSave=createSerialQueue();
let mainWindow,compactWindow,tray,store,collector,settings,lastScan,dashboard,refreshPromise,timer,quitting=false,liveQuota=null,quotaMonitor,quotaError='',backgroundWarning='';
const expandedBounds=new Map();
const roundedBounds=new WeakMap();
const windowMaterials=new WeakMap(),ownedWindows=new Set();
let materialTimer,materialQueue=Promise.resolve();
const windowGestures=createWindowGestures({getCursorPoint:()=>screen.getCursorScreenPoint(),getWorkArea:bounds=>screen.getDisplayMatching(bounds).workArea,onBegin:win=>expandedBounds.delete(win.id)});
if(process.env.QUOTA_TEST_USER_DATA && path.isAbsolute(process.env.QUOTA_TEST_USER_DATA)) app.setPath('userData',process.env.QUOTA_TEST_USER_DATA);
const lock=app.requestSingleInstanceLock();
if(!lock) app.quit();
app.on('second-instance',()=>showMain());
function iconImage(size=32) {
  const branded=nativeImage.createFromPath(path.join(directory,'../assets/QuotaGlass.png'));
  if(!branded.isEmpty())return branded.resize({width:size,height:size});
  const buffer=Buffer.alloc(32*32*4);size=32;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const d=Math.hypot(x-15.5,y-15.5),a=(d>9&&d<14)||((x>14&&x<19)&&(y>17&&y<29));const i=(y*size+x)*4;
    buffer[i]=245;buffer[i+1]=164;buffer[i+2]=204;buffer[i+3]=a?255:0;
  }
  return nativeImage.createFromBitmap(buffer,{width:size,height:size});
}
function validateBackgroundEffect(effect) {
  if(effect==='frosted'&&(process.platform!=='win32'||Number(os.release().split('.')[2]||0)<22621))throw new Error('系统毛玻璃需要 Windows 11 22H2 或更新版本');
}
function updateWindowCorners(win,force=false) {
  if(process.platform!=='win32'||!win||win.isDestroyed())return;
  if(windowMaterials.get(win)==='frosted')return;
  const [width,height]=win.getSize(),scale=screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const key=`${width}:${height}:${scale}`;
  if(!force&&roundedBounds.get(win)===key)return;
  win.setShape(roundedWindowShape(width,height));roundedBounds.set(win,key);
}
function applyBackgroundEffect(win,effect=settings.backgroundEffect) {
  if(!win||win.isDestroyed())return;
  if(windowMaterials.get(win)!==effect)return;
  validateBackgroundEffect(effect);
  if(process.platform==='win32'){
    win.setBackgroundMaterial(effect==='frosted'?'acrylic':'none');
    // Electron 39 resets the WebContents background to opaque white for 'none'.
    // Restore alpha explicitly so switching back retains real desktop transparency.
    win.setBackgroundColor('#00000000');
    updateWindowCorners(win,true);
  }
}
function createWindow(compact=false,restore) {
  const area=screen.getPrimaryDisplay().workArea;
  const width=Math.min(compact?440:1180,Math.max(1,area.width-24)),height=Math.min(compact?720:880,Math.max(1,area.height-24));
  const win=new BrowserWindow({width,height,minWidth:Math.min(compact?360:760,width),minHeight:Math.min(compact?460:540,height),x:area.x+Math.floor((area.width-width)/2),y:area.y+Math.floor((area.height-height)/2),
    ...(restore?.bounds||{}),title:compact?'Quota Glass · 紧凑面板':'Quota Glass',backgroundColor:'#00000000',transparent:settings.backgroundEffect!=='frosted',frame:false,resizable:false,roundedCorners:true,hasShadow:true,autoHideMenuBar:true,show:false,icon:iconImage(256),
    webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  windowMaterials.set(win,settings.backgroundEffect);ownedWindows.add(win);
  if(compact)win.setAlwaysOnTop(settings.alwaysOnTop);
  applyBackgroundEffect(win);
  win.on('resize',()=>updateWindowCorners(win));
  win.on('move',()=>updateWindowCorners(win));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.on('page-title-updated',event=>event.preventDefault());
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.once('ready-to-show',()=>{
    if(restore?.ready){restore.ready(win);return;}
    win.show();
    if(compact)win.setAlwaysOnTop(settings.alwaysOnTop);
  });
  for(const event of ['blur','hide','minimize'])win.on(event,()=>windowGestures.end(win));
  win.on('closed',()=>{windowGestures.end(win);expandedBounds.delete(win.id);ownedWindows.delete(win);});
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  const dev=process.env.QUOTA_DEV_URL;
  const query={...(compact?{compact:'1'}:{}),...(restore?.view?{tab:restore.view.tab||'用量趋势',scroll:String(restore.view.scroll||0)}:{})};
  if(dev && /^http:\/\/127\.0\.0\.1:\d+$/.test(dev)) win.loadURL(`${dev}/?${new URLSearchParams(query)}`);
  else win.loadFile(path.join(directory,'../dist/index.html'),{query});
  return win;
}
function requestMaterialUpdate(){
  clearTimeout(materialTimer);materialTimer=setTimeout(()=>{materialQueue=materialQueue.catch(()=>{}).then(async()=>{
    for(const compact of [false,true]){
      const old=compact?compactWindow:mainWindow;
      if(quitting||!old||old.isDestroyed()||windowMaterials.get(old)===settings.backgroundEffect)continue;
      const view=await old.webContents.executeJavaScript("({tab:document.querySelector('.navigation button.active')?.textContent,scroll:document.querySelector('.app')?.scrollTop||0})").catch(()=>({}));
      if(quitting||old.isDestroyed())continue;
      await new Promise(resolve=>{
        const next=createWindow(compact,{bounds:old.getBounds(),view,ready:win=>{
          if(quitting||windowMaterials.get(win)!==settings.backgroundEffect||old.isDestroyed()){win.destroy();resolve();if(!quitting)requestMaterialUpdate();return;}
          win.setBounds(old.getBounds());
          if(compact)win.setAlwaysOnTop(settings.alwaysOnTop);
          if(expandedBounds.has(old.id))expandedBounds.set(win.id,expandedBounds.get(old.id));
          if(compact)compactWindow=win;else mainWindow=win;
          if(old.isVisible()){win.showInactive();if(old.isFocused())win.focus();}
          old.destroy();resolve();
        }});
        next.once('closed',resolve);
        next.webContents.once('did-fail-load',()=>{if(!next.isDestroyed())next.destroy();resolve();});
      });
    }
  }).catch(error=>console.error('背景窗口切换失败',error.message));},120);
}
function showMain(){ if(!mainWindow || mainWindow.isDestroyed())mainWindow=createWindow(); else {mainWindow.show();mainWindow.focus();} }
function showCompact(){
  if(!compactWindow || compactWindow.isDestroyed())compactWindow=createWindow(true);
  else {compactWindow.show();compactWindow.focus();}
  compactWindow.setAlwaysOnTop(settings.alwaysOnTop);
}
function configureTimer(){clearInterval(timer);timer=setInterval(()=>refresh().catch(()=>{}),settings.refreshSeconds*1000);timer.unref();}
function publishDashboard(){for(const win of ownedWindows)if(!win.isDestroyed())win.webContents.send('dashboard:updated',dashboard);}
function buildDashboard(){
  const result=settings.source==='demo'?createDemo(settings):aggregateDashboard(lastScan || {events:[],sessions:[],rateLimits:[],diagnostics:[],coverage:{}},{settings,source:'local',...(liveQuota?{quota:selectQuota(liveQuota,new Date(),'live'),quota5h:selectQuotaWindow(liveQuota,300,new Date(),'live')}:{})});
  if(quotaError&&settings.source==='local')result.diagnostics.push(quotaError);
  if(backgroundWarning)result.diagnostics.push(backgroundWarning);
  return result;
}
async function refresh(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    if(settings.source==='local'){
      if(!collector || collector.sessionsDir!==settings.sessionsDir)collector=new Collector({sessionsDir:settings.sessionsDir,store});
      try { lastScan=await collector.scan(); }
      catch {
        if(dashboard?.source==='local') {
          dashboard={...dashboard,settings,diagnostics:[...new Set([...dashboard.diagnostics,'读取目录失败，保留上次统计。请检查设置中的 sessions 目录。'])]};
          return dashboard;
        }
        lastScan={events:[],sessions:[],rateLimits:[],diagnostics:['暂未读取到本地日志。请在设置选择有效的 sessions 目录，或切换演示模式。'],coverage:{}};
      }
      // The global CC Switch database may cover a different user-selected dataset.
      const standardDir=path.join(os.homedir(),'.codex','sessions');
      if(!path.relative(standardDir,collector.sessionsDir)) {
        const history=readCcSwitchHistory(path.join(os.homedir(),'.cc-switch','cc-switch.db'));
        lastScan.historicalDays=history.days;
        if(history.warning)lastScan.diagnostics.push(history.warning);
      }
    }
    dashboard=buildDashboard();publishDashboard();return dashboard;
  })();
  try{return await refreshPromise;}finally{refreshPromise=null;}
}
function bindIPC(){
  const handle=(channel,fn)=>ipcMain.handle(channel,async(event,...args)=>{
    if(![...ownedWindows].some(win=>!win.isDestroyed()&&win.webContents===event.sender))throw new Error('未知窗口');
    try{return await fn(...args);}catch(error){console.error(`[${channel}]`,error.message);throw new Error(error.message || '操作失败');}
  });
  handle('dashboard:get',()=>dashboard || refresh());
  handle('data:refresh',()=>refresh());
  handle('settings:save',patch=>queueSettingsSave(async()=>{
    if(refreshPromise)await refreshPromise;
    const old=settings;const next=validateSettings(patch,settings);
    validateBackgroundEffect(next.backgroundEffect);
    for(const win of [mainWindow,compactWindow])applyBackgroundEffect(win,next.backgroundEffect);
    store.saveSettings(next);settings=next;
    quotaMonitor?.setIntervalMs(settings.quotaRefreshSeconds * 1000);
    if(old.sessionsDir!==settings.sessionsDir){collector=null;lastScan=null;liveQuota=null;}
    compactWindow?.setAlwaysOnTop(settings.alwaysOnTop);configureTimer();const result=await refresh();
    if(old.backgroundEffect!==settings.backgroundEffect)requestMaterialUpdate();
    if(settings.source==='local'&&old.source!=='local')void quotaMonitor?.refresh().catch(()=>{});return result;
  }));
  handle('directory:choose',async()=>{const result=await dialog.showOpenDialog({title:'选择 Codex sessions 目录',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  handle('window:compact',()=>showCompact());
  handle('window:main',()=>showMain());
  handle('window:hideCompact',()=>compactWindow?.hide());
  ipcMain.handle('window:control',(event,action)=>{
    const win=[...ownedWindows].find(w=>!w.isDestroyed()&&w.webContents===event.sender);
    if(!win||!['minimize','expand','close'].includes(action))throw new Error('窗口操作无效');
    windowGestures.end(win);
    if(action==='minimize')win.minimize();
    else if(action==='close')win.close();
    else if(expandedBounds.has(win.id)){win.setBounds(expandedBounds.get(win.id));expandedBounds.delete(win.id);}
    else {expandedBounds.set(win.id,win.getBounds());win.setBounds(screen.getDisplayMatching(win.getBounds()).workArea);}
  });
  for(const [action,operation] of Object.entries({begin:(win,kind)=>windowGestures.begin(win,kind),update:win=>windowGestures.update(win),end:win=>windowGestures.end(win)}))ipcMain.handle(`window:gesture:${action}`,(event,...args)=>{
    const win=[...ownedWindows].find(w=>!w.isDestroyed()&&w.webContents===event.sender);
    if(!win)throw new Error('未知窗口');
    return operation(win,...args);
  });
  handle('data:export',async()=>{
    const result=await dialog.showSaveDialog({title:'导出统计',defaultPath:`quota-glass-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled||!result.filePath)return false;
    // Export summaries only: do not export file cache, event records or conversation content.
    await writeFile(result.filePath,JSON.stringify(dashboard || await refresh(),null,2),'utf8');return true;
  });
  handle('account:refresh',async()=>{
    if(settings.source==='demo')throw new Error('演示模式不连接真实账户');
    const result=await quotaMonitor.refresh();
    if(!result?.ok)throw new Error(result?.error || '账户额度暂不可用，可查看本地历史快照');
    return dashboard;
  });
}
app.on('before-quit',event=>{
  if(quitting)return;
  event.preventDefault();quitting=true;clearTimeout(materialTimer);clearInterval(timer);quotaMonitor?.stop();abortAccountReads();
  Promise.resolve(refreshPromise).catch(()=>{}).finally(()=>{store?.close();app.quit();});
});
app.on('window-all-closed',()=>{});
if(lock)app.whenReady().then(async()=>{
  app.setAppUserModelId('local.quota.glass');
  nativeTheme.themeSource='dark';
  screen.on('display-metrics-changed',()=>{for(const win of [mainWindow,compactWindow])updateWindowCorners(win,true);});
  store=new Store(path.join(app.getPath('userData'),'quota.sqlite'));
  try{settings=validateSettings(store.getSettings() || {},DEFAULT_SETTINGS);}catch{settings={...DEFAULT_SETTINGS};}
  try{validateBackgroundEffect(settings.backgroundEffect);}catch{settings.backgroundEffect='transparent';store.saveSettings(settings);backgroundWarning='当前系统不支持原生毛玻璃，已使用通透玻璃。';}
  if(store.getMetadata('glass-material-version')!==2){settings.opacity=Math.min(settings.opacity,46);store.saveSettings(settings);store.setMetadata('glass-material-version',2);}
  bindIPC();tray=new Tray(iconImage());tray.setToolTip('Quota Glass · Codex 用量');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开主窗口',click:showMain},{label:'紧凑面板',click:showCompact},{type:'separator'},{label:'退出 Quota Glass',click:()=>app.quit()}]));
  tray.on('click',()=>compactWindow?.isVisible()?compactWindow.hide():showCompact());
  quotaMonitor=createQuotaMonitor({intervalMs:settings.quotaRefreshSeconds * 1000,enabled:()=>!quitting&&settings.source==='local'&&process.env.QUOTA_TEST_DISABLE_ACCOUNT_POLL!=='1',onResult:result=>{
    if(result.ok){liveQuota=result.rateLimits;quotaError='';}
    else quotaError='账户额度自动读取失败，已保留最近结果。';
    const previous=dashboard||buildDashboard();
    dashboard={...previous,quota:liveQuota?selectQuota(liveQuota,new Date(),'live'):previous.quota,quota5h:liveQuota?selectQuotaWindow(liveQuota,300,new Date(),'live'):previous.quota5h,diagnostics:[...previous.diagnostics.filter(note=>!note.startsWith('账户额度自动读取失败')),...(quotaError?[quotaError]:[])]};publishDashboard();
  }});
  showMain();configureTimer();await refresh();void quotaMonitor.start().catch(()=>{});
}).catch(error=>{console.error(error);dialog.showErrorBox('Quota Glass 启动失败',error.message);app.quit();});

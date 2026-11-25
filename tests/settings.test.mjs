import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,createSerialQueue} from '../shared/settings.mjs';
import {DEFAULT_SETTINGS,validateSettings as desktopValidate} from '../electron/defaults.mjs';
import {createDemo,demoSettings} from '../electron/demo.mjs';

test('shared settings contract rejects invalid values and impossible dates',()=>{
  for(const patch of [{dailyGoal:0},{weeklyGoal:1.5},{refreshSeconds:1},{opacity:NaN},{backgroundEffect:'css-blur'},{alwaysOnTop:'yes'},{theme:'blue'},{renewalDate:'2026-02-30'},{renewalDate:'2025-02-29'},{sessionsDir:'relative'},{unknown:1}]) {
    assert.throws(()=>validateSettings(patch,demoSettings));
    assert.throws(()=>desktopValidate(patch,DEFAULT_SETTINGS));
  }
  assert.equal(validateSettings({renewalDate:'2024-02-29'},demoSettings).renewalDate,'2024-02-29');
  assert.equal(validateSettings({dailyGoal:17},demoSettings).dailyGoal,17);
  assert.throws(()=>validateSettings({source:'local',sessionsDir:''},demoSettings));
});

test('background effect migrates old settings and persists validated native options',()=>{
  const old={...demoSettings};delete old.backgroundEffect;
  assert.equal(validateSettings({},old).backgroundEffect,'transparent');
  assert.equal(validateSettings({backgroundEffect:'frosted'},old).backgroundEffect,'frosted');
  assert.equal(desktopValidate({backgroundEffect:'frosted'},DEFAULT_SETTINGS).backgroundEffect,'frosted');
  assert.equal(DEFAULT_SETTINGS.backgroundEffect,'transparent');
});

test('quota interval migrates from old preferences and accepts only the four presets', () => {
  const old = {...demoSettings}; delete old.quotaRefreshSeconds;
  assert.equal(validateSettings({}, old).quotaRefreshSeconds, 5);
  for (const seconds of [5, 10, 30, 60]) assert.equal(desktopValidate({quotaRefreshSeconds: seconds}).quotaRefreshSeconds, seconds);
  for (const seconds of [0, 15, 300, '10']) assert.throws(() => desktopValidate({quotaRefreshSeconds: seconds}));
});

test('serialized settings saves merge against the latest committed value',async()=>{
  const queue=createSerialQueue();let settings={...demoSettings};let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const save=(patch,wait=Promise.resolve())=>queue(async()=>{await wait;settings=validateSettings(patch,settings);return settings;});
  const first=save({theme:'graphite'},gate);
  const second=save({dailyGoal:123});
  release();await Promise.all([first,second]);
  assert.equal(settings.theme,'graphite');assert.equal(settings.dailyGoal,123);
  await assert.rejects(save({dailyGoal:0}));
  await save({weeklyGoal:456});assert.equal(settings.weeklyGoal,456);
});

test('demo future hours remain unknown and latest point reconciles to today',()=>{
  for(const clock of ['00:00:00','07:01:00','12:59:59','23:59:59']) {
    const now=new Date(`2026-10-24T${clock}`),data=createDemo(demoSettings,now);
    for(const point of data.hourly) {
      if(point.hour>now.getHours())assert.equal(point.today,null);
      else assert.equal(typeof point.today,'number');
    }
    assert.equal(data.hourly[now.getHours()].today,data.summary.today.total);
    const known=data.hourly.filter(d=>d.today!==null).map(d=>d.today);
    assert.deepEqual(known,[...known].sort((a,b)=>a-b));
  }
});

test('demo category, session and project allocations reconcile exactly',()=>{
  const data=createDemo(demoSettings,new Date('2026-10-24T17:20:00'));
  for(const key of ['input','cached','uncached','output','total']) {
    assert.equal(data.days.reduce((a,d)=>a+d[key],0),data.summary.lifetime[key]);
    assert.equal(data.sessions.reduce((a,s)=>a+s.tokens[key],0),data.summary.lifetime[key]);
    assert.equal(data.projects.reduce((a,p)=>a+p.tokens[key],0),data.summary.lifetime[key]);
    for(const p of data.projects)assert.equal(data.sessions.filter(s=>s.cwd===p.path).reduce((a,s)=>a+s.tokens[key],0),p.tokens[key]);
  }
  assert.equal(data.sessions.reduce((a,s)=>a+s.todayTokens,0),data.summary.today.total);
  for(const item of [...data.days,...data.sessions.map(s=>s.tokens),...Object.values(data.summary)]) {
    assert.equal(item.input,item.cached+item.uncached);assert.equal(item.total,item.input+item.output);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { gestureBounds, createWindowGestures } from '../electron/window-gestures.mjs';

const area={x:-1920,y:30,width:1920,height:1080};
const start={x:-1700,y:100,width:1000,height:800};
const minimum={width:760,height:540};

test('all eight resize directions preserve their opposite edges and minimum size',()=>{
  for(const kind of ['n','s','e','w','ne','nw','se','sw']){
    for(const delta of [{x:-100000,y:-100000},{x:100000,y:100000}]){
      const next=gestureBounds(kind,start,delta,minimum,area);
      assert.ok(next.width>=minimum.width,`${kind}: width`);
      assert.ok(next.height>=minimum.height,`${kind}: height`);
      assert.ok(next.x>=area.x&&next.y>=area.y,`${kind}: top/left work area`);
      assert.ok(next.x+next.width<=area.x+area.width&&next.y+next.height<=area.y+area.height,`${kind}: bottom/right work area`);
      if(kind.includes('w'))assert.equal(next.x+next.width,start.x+start.width);
      if(kind.includes('n'))assert.equal(next.y+next.height,start.y+start.height);
      if(kind.includes('e'))assert.equal(next.x,start.x);
      if(kind.includes('s'))assert.equal(next.y,start.y);
      if(!/[ew]/.test(kind)){assert.equal(next.x,start.x);assert.equal(next.width,start.width);}
      if(!/[ns]/.test(kind)){assert.equal(next.y,start.y);assert.equal(next.height,start.height);}
    }
  }
});

test('negative monitor coordinates and fractional DIP deltas stay in DIP',()=>{
  assert.deepEqual(gestureBounds('se',start,{x:101.4,y:33.7},minimum,area),{...start,width:1101,height:834});
  const small={x:0,y:0,width:640,height:400};
  assert.deepEqual(gestureBounds('se',{x:0,y:0,width:640,height:400},{x:-500,y:-500},minimum,small),small);
  assert.throws(()=>gestureBounds('invalid',start,{x:0,y:0},minimum,area));
});

test('moving across monitors keeps a reachable title region',()=>{
  const left=gestureBounds('move',start,{x:-99999,y:-99999},minimum,area);
  assert.equal(left.x+left.width,area.x+96);assert.equal(left.y,area.y);
  const right=gestureBounds('move',start,{x:99999,y:99999},minimum,area);
  assert.equal(right.x,area.x+area.width-96);assert.equal(right.y,area.y+area.height-40);
});

test('gesture controller reads the native cursor and clears on explicit end or hidden window',()=>{
  let cursor={x:-1200,y:400},visible=true,bounds={...start},began=0;
  const win={id:4,isDestroyed:()=>false,isVisible:()=>visible,getBounds:()=>bounds,getMinimumSize:()=>[760,540],setBounds:value=>{bounds=value;}};
  const controller=createWindowGestures({getCursorPoint:()=>cursor,getWorkArea:()=>area,onBegin:()=>began++});
  assert.equal(controller.update(win),false);
  assert.equal(controller.begin(win,'se'),true);assert.equal(began,1);
  cursor={x:-1100,y:450};assert.equal(controller.update(win),true);
  assert.deepEqual(bounds,{...start,width:1100,height:850});
  assert.equal(controller.end(win),true);assert.equal(controller.end(win),false);
  assert.equal(controller.update(win),false);
  controller.begin(win,'w');visible=false;assert.equal(controller.update(win),false);
  visible=true;assert.equal(controller.update(win),false);
  assert.throws(()=>controller.begin(win,'not-an-edge'));
});

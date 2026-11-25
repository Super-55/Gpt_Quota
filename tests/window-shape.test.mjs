import test from 'node:test';
import assert from 'node:assert/strict';
import { roundedWindowShape, WINDOW_RADIUS } from '../electron/window-shape.mjs';

test('native rounded region covers the body and leaves only symmetric corner cutouts', () => {
  for (const [width,height] of [[440,720],[760,540],[1536,912],[8,6],[1,1],[44,44]]) {
    const rects=roundedWindowShape(width,height),radius=Math.min(WINDOW_RADIUS,Math.floor(width/2),Math.floor(height/2));
    const inside=(x,y)=>rects.some(rect=>x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height);
    for (const rect of rects) assert.ok(rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&rect.x+rect.width<=width&&rect.y+rect.height<=height);
    for(let y=0;y<height;y++) {
      assert.ok(inside(Math.floor(width/2),y),'no missing scanlines');
      for(let x=0;x<Math.min(radius+1,width);x++) {
        assert.equal(inside(x,y),inside(width-1-x,y),'horizontal symmetry');
        assert.equal(inside(x,y),inside(x,height-1-y),'vertical symmetry');
      }
    }
    if(radius>2){assert.equal(inside(0,0),false);assert.equal(inside(radius,radius),true);assert.equal(inside(0,Math.floor(height/2)),true);}
  }
});

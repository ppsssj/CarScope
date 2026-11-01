import test from 'node:test';
import assert from 'node:assert/strict';
import {componentDistance} from '../inspection-camera.mjs';
test('component sphere fits visible horizontal and vertical frustum with side or bottom panels',()=>{
  const size=[0.24,0.222,0.18],radius=Math.hypot(...size)/2;
  for(const [w,h,p] of [[1600,1000,{side:398,bottom:0}],[1024,600,{side:398,bottom:0}],[420,860,{side:0,bottom:396}],[860,420,{side:360,bottom:0}]]) {
    const d=componentDistance(size,35,w,h,p),angle=Math.asin(radius/d),tan=Math.tan(35*Math.PI/360);
    const verticalPixelRadius=Math.tan(angle)/tan*h/2;
    assert.ok(verticalPixelRadius<(h-p.bottom)/2);
    assert.ok(verticalPixelRadius<(w-p.side)/2);
  }
});
test('larger components and narrower usable views step back without changing geometry',()=>{
  const size=[0.24,0.222,0.18],copy=[...size];
  const wide=componentDistance(size,35,1600,1000,{side:398,bottom:0});
  const portrait=componentDistance(size,35,420,860,{side:0,bottom:396});
  assert.ok(portrait>wide);
  assert.ok(componentDistance(size.map(v=>v*2),35,420,860,{side:0,bottom:396})>portrait);
  assert.deepEqual(size,copy);
});

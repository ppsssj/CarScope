import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CameraSession} from '../public/camera.mjs';
function stream(){const listeners={};const track={stops:0,stop(){this.stops++;},addEventListener(type,fn){listeners[type]=fn;}};return {listeners,track,getTracks:()=>[track]};}
test('mute immediately disconnects the stream once; late events cannot stop a new session',async()=>{
  const first=stream(),second=stream(),queue=[first,second];let ended=0;
  const video={play:async()=>{}};const session=new CameraSession(video,{getUserMedia:async()=>queue.shift()},()=>ended++);
  await session.start();first.listeners.mute();assert.equal(video.srcObject,null);assert.equal(first.track.stops,1);assert.equal(ended,1);
  await session.start();first.listeners.ended();assert.equal(video.srcObject,second);assert.equal(ended,1);session.stop();
});
test('overlapping permission completions and delayed play cannot revive old session',async()=>{
  const a=stream(),b=stream();let releaseFirst,releasePlay;
  const video={play:()=>new Promise(resolve=>releasePlay=resolve)};
  let requests=0;
  const session=new CameraSession(video,{getUserMedia:()=>++requests===1?new Promise(resolve=>releaseFirst=resolve):Promise.resolve(b)});
  const old=session.start(),next=session.start();await Promise.resolve();releaseFirst(a);
  assert.equal(await old,false);assert.equal(a.track.stops,1);session.stop();releasePlay();
  assert.equal(await next,false);assert.equal(video.srcObject,null);assert.equal(b.track.stops,1);
});

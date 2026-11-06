import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskLinks} from '../public/inspection-tasks.mjs';
import {getChecklistProfile} from '../public/checklist-profiles.mjs';
import {ANSWERS} from '../public/checklist-result.mjs';
import {STATUSES} from '../public/inspection-result.mjs';
import {taskCopy,questionCopy,ANSWER_COPY,CHECKLIST_OUTCOME,WASHER_OUTCOME} from '../public/inspection-copy.mjs';
import {MOBILE_MODULES} from '../public-modules.mjs';

const ids=taskLinks().map(t=>t.id).filter(id=>id!=='washer-fluid');
const JARGON=/session|sync|digest|proof|binding|native|authority|endpoint|payload|schema|세션|토큰/i;
test('every part has its own short words, and each question has its own wording',()=>{
  assert.equal(ids.length,16);
  for(const id of ids){const task=getChecklistProfile(id),copy=taskCopy(task);
    assert.ok(copy.lead&&copy.points.length>=2&&copy.follow,id);
    for(const check of task.checks){const q=questionCopy(task,check);assert.notEqual(q.title,check.label,check.id);assert.match(q.title,/\?$/,check.id);assert.ok(q.tip,check.id);}
    assert.doesNotMatch(JSON.stringify(copy),JARGON,id);
  }
});
test('the short safety points keep the conditions of the full consent text',()=>{
  const words=id=>taskCopy(getChecklistProfile(id)).points.join(' ');
  assert.match(words('coolant-reservoir'),/P·주차 브레이크/);assert.match(words('coolant-reservoir'),/전원/);assert.match(words('coolant-reservoir'),/충전 중/);assert.match(words('coolant-reservoir'),/고정/);assert.match(words('coolant-reservoir'),/식은/);assert.match(words('coolant-reservoir'),/열지 마세요/);
  assert.match(words('wiper.front.left'),/자동 와이퍼/);assert.match(words('wiper.front.left'),/작동시키지 마세요/);
  assert.match(words('light-low-beam-left-0'),/조명/);assert.match(words('light-low-beam-left-0'),/식은/);assert.match(words('light-low-beam-left-0'),/켜서 시험/);
  assert.match(words('brake-fluid'),/고전압/);assert.match(words('brake-fluid'),/보충/);
  assert.match(words('ev-charge.port'),/단자/);assert.equal(taskCopy(getChecklistProfile('ev-charge.port')).extraAck,'지금 충전 중이 아니에요');
  assert.match(words('tire.front-left'),/도로 위/);
});
test('friendly words cover exactly the stored values, which do not change',()=>{
  assert.deepEqual(Object.keys(ANSWER_COPY).sort(),Object.keys(ANSWERS).sort());
  assert.deepEqual(ANSWERS,{FOUND:'이상 징후 발견',NOT_FOUND:'발견하지 못함',UNABLE:'확인할 수 없음'});
  assert.deepEqual(Object.keys(WASHER_OUTCOME).sort(),[...STATUSES].sort());
  assert.deepEqual(Object.keys(CHECKLIST_OUTCOME).sort(),['NO_FINDINGS_REPORTED','REVIEW_NEEDED','UNABLE']);
  assert.match(ANSWER_COPY.NOT_FOUND.label,/보이는/,'keeps the limit of what was seen');
});
test('the new module is served to the page',()=>{assert.ok(MOBILE_MODULES.includes('inspection-copy.mjs'));});
test('an answer can be changed from the review, which it returns to, and only there',()=>{
  const task=getChecklistProfile('tire.front-left'),ctx={now:()=>Date.parse('2026-11-04T01:02:03.000Z'),newId:()=>'11111111-1111-4111-8111-111111111111'},{reduce,initial}=task.flow;
  let s=reduce(reduce(initial(task.id),{type:'SAFETY',value:true}),{type:'START',camera:false},ctx);
  assert.equal(reduce(s,{type:'EDIT',index:0}),s,'not while answering');
  for(const [index,check]of task.checks.entries()){s=reduce(s,{type:'ANSWER',checkId:check.id,answer:'NOT_FOUND'});s=reduce(s,{type:'NEXT',index});}
  assert.equal(s.step,'review');
  for(const index of [-1,3,1.5,'0'])assert.equal(reduce(s,{type:'EDIT',index}),s,String(index));
  const editing=reduce(s,{type:'EDIT',index:1});assert.equal(editing.step,'check');assert.equal(editing.index,1);
  const changed=reduce(editing,{type:'ANSWER',checkId:'debris',answer:'FOUND'});
  const back=reduce(changed,{type:'NEXT',index:1});assert.equal(back.step,'review');assert.equal(back.editing,false);assert.equal(back.record.responses.debris,'FOUND');
  const left=reduce(editing,{type:'BACK'});assert.equal(left.step,'review');
  const done=reduce(back,{type:'CONFIRM'},ctx);assert.equal(done.step,'done');assert.equal(reduce(done,{type:'EDIT',index:0}),done,'a confirmed record stays final');
  assert.deepEqual(task.result.validate(done.record),[]);assert.equal(done.record.status,'REVIEW_NEEDED');assert.ok(!Object.hasOwn(done.record,'editing'));
});

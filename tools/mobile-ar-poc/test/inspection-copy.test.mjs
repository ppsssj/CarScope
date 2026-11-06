import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskLinks} from '../public/inspection-tasks.mjs';
import {getChecklistProfile} from '../public/checklist-profiles.mjs';
import {ANSWERS} from '../public/checklist-result.mjs';
import {STATUSES} from '../public/inspection-result.mjs';
import {taskCopy,questionCopy,ANSWER_COPY,CHECKLIST_OUTCOME,WASHER_OUTCOME,CANNOT_CONFIRM_NOTE} from '../public/inspection-copy.mjs';
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
// [part, field of the full text, what the full text requires, how the always-visible words say it].
// A row fails if the full text no longer says it, or if the visible words stopped saying it.
const visible=task=>{const copy=taskCopy(task);return [...copy.points,copy.limit,copy.stop??'',copy.extraAck??''].join(' ');};
const BONNET='coolant-reservoir';
const COMPARISON=[
  ['tire.front-left','safetyText',/주차 상태/,/주차하고/],['tire.front-left','safetyText',/움직이지 않고/,/움직이지 마세요/],
  ['tire.front-left','safetyHelp',/도로 위/,/도로 위/],['tire.front-left','safetyHelp',/분해/,/분해하지 마세요/],
  ['tire.front-left','limitations',/마모 깊이·공기압·손상 심각도/,/마모 깊이, 공기압, 손상 정도/],
  ['ev-charge.port','safetyText',/주차 상태/,/주차하고/],['ev-charge.port','extraSafety',/충전 중이 아님/,/충전 중이 아니에요/],
  ['ev-charge.port','safetyHelp',/강제로 탈착|강제로 열/,/억지로 열거나 빼지/],['ev-charge.port','safetyHelp',/단자 내부를 만지/,/단자 안을 만지/],['ev-charge.port','safetyHelp',/금속 도구·액체/,/금속·액체/],['ev-charge.port','safetyHelp',/분해·수리/,/분해·수리하지/],
  ['ev-charge.port','limitations',/충전 가능 판정·고전압 진단/,/충전 가능 여부나 고전압 상태/],
  ['ev-charge.port','stopAdvice',/파손·변색·이상 발열/,/파손·변색·이상 발열/],['ev-charge.port','stopAdvice',/충전 상태가 바뀌면/,/충전 상태가 바뀌면/],['ev-charge.port','stopAdvice',/제조사 서비스/,/제조사 서비스/],['ev-charge.port','stopAdvice',/열을 손으로 확인하지/,/열을 손으로 확인하지/],
  ['brake-fluid','safetyText',/평탄하고 안전한 곳/,/평탄하고 안전한 곳/],['brake-fluid','safetyText',/전원 꺼짐/,/전원을 꺼/],['brake-fluid','safetyText',/보닛이 안전하게 지지/,/보닛을 단단히 고정/],['brake-fluid','safetyText',/뜨겁거나 움직이는 부품/,/뜨겁거나 움직이는 부품/],
  ['brake-fluid','safetyHelp',/캡 개방·직접 보충·분해/,/캡을 열거나 직접 보충하거나 분해/],['brake-fluid','safetyHelp',/고전압 케이블·전장품·팬/,/고전압 케이블, 전장품, 팬/],['brake-fluid','safetyHelp',/사용설명서/,/설명서에 따라/],
  ['brake-fluid','limitations',/액면 수치·수분 함량·액체 종류·제동 성능/,/액면 수치나 수분, 액체 종류, 제동 성능/],
  ['brake-fluid','stopAdvice',/액면 이상·누출 의심·손상/,/액면 이상·누출 의심·손상/],['brake-fluid','stopAdvice',/관찰 환경이 불안/,/주변 상황이 바뀌면/],['brake-fluid','stopAdvice',/제조사 서비스/,/제조사 서비스/],
  [BONNET,'safetyText',/P·주차브레이크/,/P·주차 브레이크/],[BONNET,'safetyText',/전원 꺼짐/,/전원을 끄고/],[BONNET,'safetyText',/충전 중이 아님/,/충전 중이 아닌지/],[BONNET,'safetyText',/보닛 지지/,/보닛을 단단히 고정/],[BONNET,'safetyText',/완전히 식었/,/완전히 식은/],[BONNET,'safetyText',/캡·덮개를 열지/,/캡·덮개를 열지/],[BONNET,'safetyText',/만지거나/,/만지거나/],
  [BONNET,'safetyHelp',/팬은 전원 OFF 후에도 움직일 수/,/팬은 전원을 꺼도 움직일 수/],[BONNET,'safetyHelp',/뜨거운 부품·고전압 케이블·단자·배선/,/뜨거운 부품, 고전압 케이블, 단자, 배선/],[BONNET,'safetyHelp',/화기·흡연·스파크·금속 도구/,/화기·흡연·스파크·금속 도구/],
  [BONNET,'limitations',/수치 측정·정상·고장·주행 가능 판정/,/수치를 재거나.*정상·고장·주행 가능 여부/],
  [BONNET,'stopAdvice',/누액·손상·그을림·부풀음/,/누액·손상·그을림·부풀음/],[BONNET,'stopAdvice',/관찰 환경 변화/,/주변 상황이 바뀌면/],[BONNET,'stopAdvice',/제조사 서비스/,/제조사 서비스/],
  ['wiper.front.left','safetyText',/P·주차브레이크/,/P·주차 브레이크/],['wiper.front.left','safetyText',/자동 와이퍼 꺼짐/,/자동 와이퍼를 꺼/],['wiper.front.left','safetyText',/완전히 정지한/,/.*/],['wiper.front.left','safetyText',/만지거나 들어 올리거나 작동시키지/,/만지거나 들어 올리거나 작동시키지/],['wiper.front.left','safetyHelp',/차량을 움직이거나 전원을 켜서 시험/,/차를 움직이거나 전원을 켜서 시험/],['wiper.front.left','stopAdvice',/제조사 서비스/,/제조사 서비스/],
  ['light-low-beam-left-0','safetyText',/P·주차브레이크/,/P·주차 브레이크/],['light-low-beam-left-0','safetyText',/조명 소등/,/조명을 끄고/],['light-low-beam-left-0','safetyText',/램프가 식었/,/램프가 식은/],['light-low-beam-left-0','safetyText',/점등·광축 시험이나 접촉·분해/,/켜서 시험하거나 광축을 보거나 만지거나 분해/],['light-low-beam-left-0','stopAdvice',/제조사 서비스/,/제조사 서비스/],
];
test('the words always on screen keep the conditions and prohibitions of safetyText, limitations and stopAdvice',()=>{
  for(const [id,field,full,short]of COMPARISON){const task=getChecklistProfile(id);
    assert.match(task[field],full,`${id} ${field} no longer says ${full}`);
    assert.match(visible(task),short,`${id}: the visible words dropped ${full} from ${field}`);}
  assert.match(taskCopy(getChecklistProfile('wiper.front.left')).lead,/완전히 멈춘/);
  for(const id of ids){const task=getChecklistProfile(id);if(task.supportsObservationStop)assert.ok(taskCopy(task).stop,`${id} has a stop rule on screen`);
    assert.ok(task.safetyText&&task.limitations&&task.safetyHelp,id);}
});
test('the note before starting is about the safety conditions, not about items the person could not check',()=>{
  assert.equal(CANNOT_CONFIRM_NOTE,'위 안전 조건을 지킬 수 없다면 점검을 시작하지 마세요.');
  assert.doesNotMatch(CANNOT_CONFIRM_NOTE,/확인할 수 없/,'"확인하기 어려워요" is a valid answer during the inspection');
});
test('each question keeps the part-specific prohibition of its full help',()=>{
  const q=(id,index)=>questionCopy(getChecklistProfile(id),getChecklistProfile(id).checks[index]);
  for(const [id,index,full,short]of [
    ['tire.front-left',0,/분해/,/분해/],['tire.front-left',1,/빼지 마세요/,/빼지 마세요/],
    ['ev-charge.port',0,/강제로 열거나/,/억지로 열거나/],['ev-charge.port',1,/금속 도구를 넣거나 액체로/,/금속을 넣거나 액체/],['ev-charge.port',2,/손으로 온도/,/손으로 온도/],
    ['brake-fluid',0,/캡을 열거나 덮개를 분리/,/캡을 열거나 덮개를 분리/],['brake-fluid',1,/닦거나/,/닦지/],['brake-fluid',2,/캡을 돌려/,/캡을 돌리/],
    ['battery-12v',1,/냄새를 맡거나/,/냄새를 맡거나/],['battery-12v',1,/즉시 접근을 중단/,/바로 물러나/],['battery-12v',2,/단자 덮개를 열거나/,/단자 덮개를 열거나/],
    ['fuse-box',0,/덮개를 열거나 눌러/,/덮개를 열거나 눌러/],['fuse-box',1,/물을 붓지/,/물을 붓지/],['fuse-box',2,/손으로 온도/,/손으로 온도/],
    ['wiper.front.left',0,/분리/,/분리/],['wiper.front.left',1,/작동시켜/,/작동시키지/],['wiper.front.left',2,/흔들어/,/흔들거나/],
    ['light-low-beam-left-0',1,/청소·탈거/,/청소하거나 떼어/],['light-low-beam-left-0',2,/캡·렌즈를 열거나 건조/,/렌즈를 열거나 말리/],
  ]){const task=getChecklistProfile(id);assert.match(task.checks[index].help,full,`${id} ${index} help`);assert.match(q(id,index).tip,short,`${id} ${index} tip`);}
});
test('the vehicle receipt words separate receiving from approving or judging safety',async()=>{
  const {SYNC_TEXT}=await import('../../inspection-sync-poc/public/mobile-sync.mjs');
  assert.match(SYNC_TEXT.ACCEPTED,/차량 앱이 결과를 받아/);assert.match(SYNC_TEXT.ACCEPTED,/차량 소유자의 승인이나 차량 안전 판정을 뜻하지 않아요/);
  assert.doesNotMatch(SYNC_TEXT.SENT,/저장|받았|확인했/);
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

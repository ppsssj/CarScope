// Runs in CI without a GLB. Registry and comparison rules are normal tests. The defects a pure test can see are `todo`:
// they fail on purpose until fixed, are reported as todo and do not fail the run. Removing `todo` is part of the fix.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PART_UX_ISSUES,issueById} from './part-ux-known-issues.mjs';
import {ALL_PARTS,VIEWPORTS,VEHICLE_BOX,classifyIssue,compareBaseline,framesInsideVehicle,insideVehicleBox,internalWords,withinBand} from './part-ux-metrics.mjs';
import {STATES as S,EVENTS as E,initialState,transition} from '../inspection-flow.mjs';
import {stateLegendHtml} from '../inspection-state-view.mjs';
import {createTireInspection} from '../tire-inspection.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {INSPECTION_LAYOUT} from '../../ioniq5-asset/inspection-components.mjs';
import {SERVICE_EVIDENCE} from '../../ioniq5-asset/service-components.mjs';

test('the baseline covers 19 parts on the four agreed screens',()=>{
  assert.equal(ALL_PARTS.length,19);
  assert.equal(new Set(ALL_PARTS).size,19);
  for(const target of MOBILE_TARGETS)assert.ok(ALL_PARTS.includes(target.partId),target.partId);
  assert.deepEqual(VIEWPORTS.map(v=>`${v.width}x${v.height}`),['1600x1000','1224x880','1024x600','420x860']);
});

test('every known issue is identifiable, owned by a later PR and honest about how it is checked',()=>{
  assert.equal(new Set(PART_UX_ISSUES.map(x=>x.id)).size,PART_UX_ISSUES.length);
  assert.equal(PART_UX_ISSUES.filter(x=>x.severity==='P0').length,4);
  assert.equal(PART_UX_ISSUES.filter(x=>x.severity==='P1').length,14);
  assert.equal(PART_UX_ISSUES.filter(x=>x.severity==='P2').length,9);
  for(const x of PART_UX_ISSUES){
    assert.match(x.id,/^P[012]-\d+$/);
    assert.ok(x.id.startsWith(x.severity),x.id);
    assert.match(x.fixIn,/^P10-[1-7]$/,x.id);
    assert.ok(['BROWSER','NODE','VISUAL','NEEDS_P10'].includes(x.measure),x.id);
    assert.ok(['OPEN','FIXED'].includes(x.status),x.id);
  }
});

test('an open issue blocks nothing, a silent fix and a regression both block',()=>{
  const open={status:'OPEN'},fixed={status:'FIXED'};
  assert.deepEqual(classifyIssue(open,{met:false}),{outcome:'KNOWN_ISSUE',blocking:false});
  assert.deepEqual(classifyIssue(open,{met:true}),{outcome:'FIXED_UNDECLARED',blocking:true});
  assert.deepEqual(classifyIssue(fixed,{met:true}),{outcome:'FIXED',blocking:false});
  assert.deepEqual(classifyIssue(fixed,{met:false}),{outcome:'REGRESSION',blocking:true});
  for(const status of [open,fixed])for(const none of [null,undefined,{met:null}])assert.deepEqual(classifyIssue(status,none),{outcome:'NOT_MEASURED',blocking:false});
});

test('the baseline comparison reports real drift, tolerates noise and sees added or missing values',()=>{
  const base={camera:{distance:2.45,state:'TIRE_PREVIEW'},list:[1,2]};
  assert.deepEqual(compareBaseline(base,{camera:{distance:2.455,state:'TIRE_PREVIEW'},list:[1,2]}),[]);
  assert.deepEqual(compareBaseline(base,{camera:{distance:2.6,state:'TIRE_PREVIEW'},list:[1,2]}).map(x=>x.path),['camera.distance']);
  assert.deepEqual(compareBaseline(base,{camera:{distance:2.45,state:'OTHER'},list:[1,2]}).map(x=>x.path),['camera.state']);
  assert.deepEqual(compareBaseline(base,{camera:{distance:2.45,state:'TIRE_PREVIEW'},list:[1,2,3]}).map(x=>x.path),['list.2']);
  assert.deepEqual(compareBaseline(base,{camera:{state:'TIRE_PREVIEW'},list:[1,2]}).map(x=>x.path),['camera.distance']);
  assert.deepEqual(compareBaseline({a:null},{a:null}),[]);
  assert.equal(compareBaseline({a:null},{a:1}).length,1);
});

test('helpers count camera frames inside the vehicle, bands and internal words',()=>{
  assert.equal(insideVehicleBox([0,1,0]),true);
  for(const outside of [[VEHICLE_BOX.max[0],1,0],[0,0.1,0],[0,1,1]])assert.equal(insideVehicleBox(outside),false);
  assert.equal(framesInsideVehicle([[0,1,0],[5,5,5],[1,1,0.5]]),2);
  assert.equal(withinBand(15,[15,30]),true);
  assert.equal(withinBand(31,[15,30]),false);
  assert.deepEqual(internalWords('ESTIMATED_GEOMETRY · 정적, USER_REPORTED ESTIMATED_GEOMETRY'),['ESTIMATED_GEOMETRY','USER_REPORTED']);
  assert.deepEqual(internalWords('추정 모델'),[]);
});

// ---- Known issues a pure test can see. Each one fails today by design. ---------------------------------------------
const fromList=()=>{
  let s=transition(initialState(),{type:E.START});
  s=transition(s,{type:E.SELECT_AREA,id:'hood'});
  return transition(s,{type:E.HOOD_OPENED});
};

test('P0-3: Back from a result opened in the part list returns to that list',{todo:'P0-3 open until P10-3'},()=>{
  const list=fromList();
  assert.equal(list.name,S.COMPONENT_SELECTION);
  const result=transition(list,{type:E.OPEN_RESULT,id:'lcw-coolant-reservoir'});
  assert.equal(result.name,S.PART_RESULT);
  assert.equal(transition(result,{type:E.BACK}).name,S.COMPONENT_SELECTION);
});

test('P1-7: the state legend speaks for all 17 result parts',{todo:'P1-7 open until P10-4'},()=>{
  const html=stateLegendHtml(createTireInspection('baseline'));
  assert.doesNotMatch(html,/타이어 4개/);
  assert.match(html,/17/);
});

test('P2-9: the 12V battery cites one manual page',{todo:'P2-9 open until P10-7'},()=>{
  assert.equal(INSPECTION_LAYOUT.find(p=>p.id==='battery-12v').page,SERVICE_EVIDENCE.find(p=>p.id==='battery-12v').page);
});

// ---- Today's behavior for those three, so an accidental change is caught before the fix arrives. ---------------------
test('baseline: Back from a hood result closes the hood and heads for the summary',()=>{
  const back=transition(transition(fromList(),{type:E.OPEN_RESULT,id:'lcw-coolant-reservoir'}),{type:E.BACK});
  assert.equal(back.name,S.HOOD_CLOSING);
  assert.equal(back.afterClose,S.INSPECTION_SUMMARY);
  assert.equal(issueById('P0-3').status,'OPEN','declare the fix in the registry and remove this test together');
});

test('baseline: the legend still counts the four tires',()=>{
  assert.match(stateLegendHtml(createTireInspection('baseline')),/타이어 4개/);
  assert.equal(issueById('P1-7').status,'OPEN','declare the fix in the registry and remove this test together');
});

test('baseline: the two 12V page references still differ',()=>{
  assert.equal(INSPECTION_LAYOUT.find(p=>p.id==='battery-12v').page,'9-20');
  assert.equal(SERVICE_EVIDENCE.find(p=>p.id==='battery-12v').page,'9-19');
  assert.equal(issueById('P2-9').status,'OPEN','declare the fix in the registry and remove this test together');
});

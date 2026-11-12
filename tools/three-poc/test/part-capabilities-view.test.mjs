// P11 (PR #121): the vehicle shows, for every part, what the phone can do with it, from the phone's own capability table.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INSPECTION_PARTS} from '../inspection-parts.mjs';
import {partMethodsHtml,aiTagHtml,vehiclePartCapabilities,partActionHtml} from '../inspection-results-view.mjs';
import {createTireInspection} from '../tire-inspection.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {partCapabilities,partMethodSummary,PLAN,AI_STATE} from '../../mobile-ar-poc/public/part-capabilities.mjs';
import {testAuthority} from './result-fixtures.mjs';

const AI_PARTS=['washer-fluid-cap','coolant-reservoir','brake-fluid-reservoir','fuse-box','battery-12v','lcw-coolant-reservoir'];

test('every one of the 19 parts reads the same capability as the phone, and the vehicle never claims it is available',()=>{
  for(const p of INSPECTION_PARTS){
    const mine=vehiclePartCapabilities(p.id),phone=partCapabilities(p.id,{taskId:p.taskId});
    assert.deepEqual(mine,phone,p.id);
    assert.notEqual(mine.ai,AI_STATE.AVAILABLE,p.id);
    const html=partMethodsHtml(p.id);
    assert.ok(html.includes(partMethodSummary(phone)),p.id);
    assert.match(html,new RegExp(`data-ai-plan="${phone.partPlan}"`));
    assert.doesNotMatch(html,/사용할 수 있어요\.$|EXPERIMENTAL|UNSUPPORTED|ROBOFLOW|OPENAI/,p.id);
  }
});

test('only the six bonnet parts with an EXPERIMENTAL AI method get the list tag; the 11 DRAFT parts and the 2 informational parts get none',()=>{
  for(const p of INSPECTION_PARTS){
    const tag=aiTagHtml(p.id);
    if(AI_PARTS.includes(p.id))assert.match(tag,/AI 실험/,p.id);else assert.equal(tag,'',p.id);
  }
  assert.equal(INSPECTION_PARTS.filter(p=>aiTagHtml(p.id)).length,6);
});

test('the wording separates detection, a marked region, no AI, and an informational part',()=>{
  assert.match(partMethodsHtml('washer-fluid-cap'),/AI 위치 찾기와 외관 분석\(실험\)/);
  assert.match(partMethodsHtml('battery-12v'),/사진에서 부품을 직접 지정한 뒤 AI 외관 분석\(실험\)/);
  assert.doesNotMatch(partMethodsHtml('battery-12v'),/위치 찾기/,'a part with no detector never reads as found automatically');
  // P13-G: the eleven exterior parts have a DRAFT analysis: named with its stage and where it runs, never as available here.
  for(const id of ['tire.front-left','wiper.front.right','light-low-beam-left-0','ev-charge.port']){assert.match(partMethodsHtml(id),/AI 외관 분석\(시험 단계\)은 승인된 실험 서비스에서만/,id);assert.doesNotMatch(partMethodsHtml(id),/위치 찾기|지원하지 않습니다/,id);}
  for(const id of ['ev-battery.pack','ev-charge.flap'])assert.match(partMethodsHtml(id),/따로 점검 기록이 없는 부품/,id);
  assert.equal(vehiclePartCapabilities('ev-charge.flap').partPlan,PLAN.INFO_ONLY);
});

test('the part panel names its methods while nothing is running, beside the existing phone request',()=>{
  const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter});c.startSession('local');
  const local=createTireInspection('local');
  for(const p of INSPECTION_PARTS.filter(x=>x.taskId)){
    const html=partActionHtml(local,c.snapshot,p.id);
    assert.match(html,/data-action="request-mobile"/,p.id);
    assert.ok(html.includes(partMethodsHtml(p.id)),p.id);
  }
  c.dispose();
});

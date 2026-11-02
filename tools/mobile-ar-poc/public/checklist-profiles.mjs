// Only implemented profiles are registered. SDK readings are intentionally absent.
import {TIRE_TASKS,CHARGE_TASK,isTireTask} from './inspection-tasks.mjs';
import {TIRE_CHECKS,TIRE_ANSWERS,tireResult} from './tire-result.mjs';
import {tireFlow} from './tire-flow.mjs';
import {CHARGE_CHECKS,CHARGE_ANSWERS,chargeResult} from './charge-result.mjs';
import {createChecklistFlow} from './checklist-flow.mjs';

const tireProfile = {
  checks:TIRE_CHECKS,answers:TIRE_ANSWERS,result:tireResult,flow:tireFlow,hook:'__tireInspection',answerId:'tire-answers',
  description:'타이어는 도로와 맞닿아 차량을 받치고 움직임을 전달합니다. 선택한 바퀴의 보이는 부분만 직접 살펴보세요.',
  limitations:'카메라는 수동 위치 지정과 안내를 위한 보조 도구입니다. 객체 인식·공간 추적·마모 깊이·공기압·손상 심각도를 측정하지 않습니다.',
  safetyText:'안전한 곳에 정차해 주차 상태를 확인했고, 차량을 움직이지 않고 점검하겠습니다.',
  safetyHelp:'도로 위에서 점검하거나 타이어를 분해하지 마세요. 닿기 어렵거나 확신할 수 없는 부분은 ‘확인할 수 없음’을 고르세요.',
  locateHelp:'선택한 바퀴가 맞는지 확인하세요. 카메라 없이도 모든 항목에 응답할 수 있습니다.',
  followup:'발견한 징후나 확인하지 못한 부분은 제조사 서비스 또는 정비 전문가에게 확인하세요. 이 화면은 점검·정비·주행 가능 판정이 아닙니다.',
  restartHelp:'새 점검은 새 기록입니다. 다른 타이어 응답을 대신 완료하지 않습니다.',
  drawGuide(ctx,r,d) { ctx.strokeStyle='#ffe16a';ctx.lineWidth=3*d;ctx.setLineDash([8*d,6*d]);ctx.beginPath();ctx.ellipse(r.x+r.width/2,r.y+r.height/2,r.width*.28,r.height*.36,0,0,Math.PI*2);ctx.stroke(); },
};
export const chargeProfile = Object.freeze({
  ...CHARGE_TASK,checks:CHARGE_CHECKS,answers:CHARGE_ANSWERS,result:chargeResult,hook:'__chargeInspection',answerId:'inspection-answers',
  flow:createChecklistFlow({matchesTask:id=>id===CHARGE_TASK.id,checks:CHARGE_CHECKS,result:chargeResult,requiresNotCharging:true,stopOnFinding:true}),
  requiresNotCharging:true,
  description:'충전구는 충전 케이블을 차량에 연결하는 곳입니다. 이 점검은 충전구와 덮개의 외부에서 보이는 모습만 기록합니다.',
  limitations:'카메라는 사용자가 위치를 직접 지정하는 2D 보조 안내입니다. 충전구 자동 인식·공간 추적·안전 또는 충전 가능 판정·고전압 진단은 하지 않습니다.',
  safetyText:'안전한 곳에 정차해 주차 상태를 확인했고, 차량을 움직이지 않고 점검하겠습니다.',
  extraSafety:'충전 중이 아님을 직접 확인했습니다. 충전 중이거나 확인할 수 없다면 시작하지 않겠습니다.',
  safetyHelp:'케이블·커넥터를 강제로 탈착하거나 덮개를 강제로 열지 마세요. 단자 내부를 만지거나 손가락·금속 도구·액체로 청소하지 마세요. 분해·수리하지 마세요.',
  stopAdvice:'파손·변색·이상 발열 징후가 의심되거나 충전 상태가 바뀌면 접근과 관찰을 중단하고 제조사 서비스에 문의하세요. 열을 손으로 확인하지 마세요. 이미 본 내용만 기록하고 나머지는 직접 ‘확인할 수 없음’을 선택할 수 있습니다.',
  locateHelp:'실제 차량 사용설명서로 충전구 위치를 먼저 확인하세요. 덮개가 닫혀 있거나 위치가 불확실하면 강제로 열지 말고 보이지 않는 항목은 확인할 수 없음으로 기록하세요.',
  followup:'이 기록은 USER_REPORTED 외관 보고입니다. 차량 안전·충전 가능·고전압 시스템 정상 여부를 인증하지 않습니다. 파손·변색·이상 발열 징후나 확인하지 못한 부분은 더 접근하지 말고 제조사 서비스에 문의하세요.',
  restartHelp:'새 점검은 새 기록입니다. 주차 상태와 충전 중이 아님을 다시 확인해야 합니다.',
  drawGuide(ctx,r,d,{index,step}) {
    ctx.strokeStyle='#ffe16a';ctx.lineWidth=3*d;ctx.setLineDash([8*d,6*d]);
    ctx.strokeRect(r.x+r.width*.18,r.y+r.height*.2,r.width*.64,r.height*.6);
    ctx.fillStyle='#ffe16a';ctx.font=`bold ${13*d}px system-ui`;
    const text=step==='locate'?'충전구와 덮개 · 수동 안내':['덮개와 주변 외관','외부에서 보이는 오염','접근 없이 변형·변색 관찰'][index];
    ctx.fillText(text,r.x+r.width*.2,r.y+r.height*.16,r.width*.6);
  },
});
export function getChecklistProfile(id) {
  if(id===CHARGE_TASK.id)return chargeProfile;
  if(isTireTask(id))return Object.freeze({...tireProfile,...TIRE_TASKS.find(t=>t.id===id)});
  throw Error('Unknown checklist profile');
}

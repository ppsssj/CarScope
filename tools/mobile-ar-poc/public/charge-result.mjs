import {CHARGE_TASK} from './inspection-tasks.mjs';
import {createChecklistResult,ANSWERS,aggregateStatus} from './checklist-result.mjs';
export const CHARGE_CHECKS = Object.freeze([
  {id:'flapDamage',label:'덮개와 주변 외관의 손상',help:'덮개와 주변의 보이는 외관만 살펴보세요. 파손이 의심되면 접근과 관찰을 중단하고 제조사 서비스에 문의하세요. 덮개를 강제로 열거나 닫지 마세요.'},
  {id:'debris',label:'외부에서 보이는 이물질·오염',help:'외부에서 보이는 범위만 확인하세요. 단자 안에 손가락·금속 도구를 넣거나 액체로 청소하지 마세요. 식별이 어렵거나 더 접근해야 한다면 확인할 수 없음을 고르세요.'},
  {id:'visibleDamage',label:'접근 없이 보이는 변형·변색',help:'더 접근하거나 만지지 않고 보이는 부분만 기록하세요. 변형·변색·이상 발열 징후가 의심되면 관찰을 중단하고 제조사 서비스에 문의하세요. 손으로 온도를 확인하지 마세요.'},
].map(Object.freeze));
export const CHARGE_ANSWERS = ANSWERS;
export const chargeStatus = aggregateStatus;
export const chargeResult = createChecklistResult({matchesTask:id=>id===CHARGE_TASK.id,checks:CHARGE_CHECKS});
export const {start:startChargeResult,answer:answerCharge,noteAids:noteChargeAids,complete:completeChargeResult,validate:validateChargeResult} = chargeResult;

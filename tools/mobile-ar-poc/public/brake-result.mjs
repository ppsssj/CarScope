import {BRAKE_TASK} from './inspection-tasks.mjs';
import {createChecklistResult,ANSWERS,aggregateStatus} from './checklist-result.mjs';
export const BRAKE_CHECKS = Object.freeze([
  {id:'levelMarking',label:'외부에서 보이는 액면과 MIN·MAX 표시',help:'리저버 옆면의 MIN·MAX 표시와 액면을 외부에서 함께 식별할 수 있을 때만 비교하세요. 표시 범위를 벗어난 액면이 보이면 이상 징후 발견을 고르세요. 가려짐·불투명·어두움·위치 불확실로 읽을 수 없으면 확인할 수 없음을 고르세요. 캡을 열거나 덮개를 분리하지 마세요.'},
  {id:'leakTrace',label:'리저버 주변의 누출 의심 흔적',help:'접근하거나 만지지 않고 보이는 리저버 주변의 젖음·흐른 자국만 기록하세요. 액체의 종류나 누출 원인을 단정하지 마세요. 주변이 가려지거나 식별이 어려우면 확인할 수 없음을 고르세요. 닦거나 직접 보충하지 마세요.'},
  {id:'exteriorDamage',label:'리저버와 캡의 보이는 외관 상태',help:'보이는 범위의 균열·변형·손상 흔적만 확인하세요. 캡을 돌려 체결 상태를 시험하거나 부품을 만지거나 분해하지 마세요. 보이지 않는 부분은 확인할 수 없음을 고르세요.'},
].map(Object.freeze));
export const BRAKE_ANSWERS = ANSWERS;
export const brakeStatus = aggregateStatus;
export const brakeResult = createChecklistResult({matchesTask:id=>id===BRAKE_TASK.id,checks:BRAKE_CHECKS});
export const {start:startBrakeResult,answer:answerBrake,noteAids:noteBrakeAids,complete:completeBrakeResult,validate:validateBrakeResult} = brakeResult;

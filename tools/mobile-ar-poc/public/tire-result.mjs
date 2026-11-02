import {isTireTask} from './inspection-tasks.mjs';
import {createChecklistResult,ANSWERS,aggregateStatus} from './checklist-result.mjs';
export const TIRE_CHECKS=Object.freeze([
  {id:'damage',label:'갈라짐이나 손상',help:'타이어 옆면과 보이는 바닥 면에서 갈라짐, 찢어짐, 불룩한 부분처럼 눈에 띄는 모습을 살펴보세요. 손으로 만지거나 분해하지 마세요.'},
  {id:'debris',label:'눈에 띄는 이물질',help:'못이나 돌처럼 박혀 보이는 물체가 있는지 보이는 부분만 살펴보세요. 박힌 물체를 빼지 마세요.'},
  {id:'wear',label:'고르지 않게 닳은 모습',help:'보이는 타이어 바닥 면이 한쪽만 더 닳아 보이는지 살펴보세요. 이 화면은 홈 깊이를 재거나 교체 시기를 판정하지 않습니다.'},
].map(Object.freeze));
export const TIRE_ANSWERS=ANSWERS;
export const tireStatus=aggregateStatus;
export const tireResult=createChecklistResult({matchesTask:isTireTask,checks:TIRE_CHECKS});
export const {start:startTireResult,answer:answerTire,noteAids:noteTireAids,complete:completeTireResult,validate:validateTireResult}=tireResult;

// Internal task hints, never authorization or a vehicle/SDK identity.
import {parseHandoff} from './handoff.mjs';
import {EXTRA_TASKS,isExtraTask} from './extra-tasks.mjs';
export const TIRE_TASKS=Object.freeze([
  {id:'tire.front-left',label:'앞 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 왼편 바퀴입니다.'},
  {id:'tire.front-right',label:'앞 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 오른편 바퀴입니다.'},
  {id:'tire.rear-left',label:'뒤 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 왼편 바퀴입니다.'},
  {id:'tire.rear-right',label:'뒤 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 오른편 바퀴입니다.'},
].map(Object.freeze));
export const CHARGE_TASK=Object.freeze({id:'ev-charge.port',label:'EV 충전구',position:'참조 IONIQ 5 모델에서는 차량 우측 후방입니다. 현재 차량과 모델의 일치는 확인되지 않았습니다. 실제 차량의 충전구 위치와 주의사항은 해당 사용설명서를 확인하세요.'});
export const BRAKE_TASK=Object.freeze({id:'brake-fluid',label:'브레이크액',position:'보닛 내부의 브레이크액 리저버(저장통)를 확인합니다. 실제 차량 사용설명서의 모터룸 배치도와 리저버 표기를 먼저 대조하세요. 차종·연식·운전석 방향에 따라 위치가 다르며 이 화면은 현재 차량의 위치를 확인하지 못합니다.'});
export const WASHER_TASK=Object.freeze({id:'washer-fluid',label:'워셔액',position:'차량 사용설명서의 보닛 내부 배치도에서 워셔액 주입구를 찾고, 실제 캡의 앞유리·분사 모양 표시를 대조하세요. 캡 색상만으로 구별하지 마세요. 차종별 정확한 위치는 이 화면에서 확인하지 못합니다.'});
export const inspectionTask=id=>[WASHER_TASK,...TIRE_TASKS,CHARGE_TASK,BRAKE_TASK,...EXTRA_TASKS].find(task=>task.id===id);
export const isChecklistTask=id=>isTireTask(id)||id===CHARGE_TASK.id||id===BRAKE_TASK.id||isExtraTask(id);
export const isTireTask=id=>TIRE_TASKS.some(t=>t.id===id);
export const taskLabel=id=>inspectionTask(id)?.label??null;
// Separate local task-only link. QR v1 remains exactly washer-fluid; QR v2 remains a token invite.
export function parseInspectionHandoff(hash){const legacy=parseHandoff(hash);if(legacy.valid)return legacy;
  if(typeof hash!=='string'||!hash.startsWith('#'))return legacy;
  const p=new URLSearchParams(hash.slice(1));
  return [...p].length===1&&p.getAll('task').length===1&&isChecklistTask(p.get('task'))
    ?{valid:true,source:'local-task',task:p.get('task')}:legacy;
}
export function taskLinks(){return [WASHER_TASK,...TIRE_TASKS,CHARGE_TASK,BRAKE_TASK,...EXTRA_TASKS].map(({id,label})=>({id,label,href:id==='washer-fluid'?'#v=1&task=washer-fluid':`#task=${id}`}));}

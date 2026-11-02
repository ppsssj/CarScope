// Internal task hints, never authorization or a vehicle/SDK identity.
import {parseHandoff} from './handoff.mjs';
export const TIRE_TASKS=Object.freeze([
  {id:'tire.front-left',label:'앞 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 왼편 바퀴입니다.'},
  {id:'tire.front-right',label:'앞 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 오른편 바퀴입니다.'},
  {id:'tire.rear-left',label:'뒤 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 왼편 바퀴입니다.'},
  {id:'tire.rear-right',label:'뒤 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 오른편 바퀴입니다.'},
].map(Object.freeze));
export const CHARGE_TASK=Object.freeze({id:'ev-charge.port',label:'EV 충전구',position:'참조 IONIQ 5 모델에서는 차량 우측 후방입니다. 현재 차량과 모델의 일치는 확인되지 않았습니다. 실제 차량의 충전구 위치와 주의사항은 해당 사용설명서를 확인하세요.'});
export const isChecklistTask=id=>isTireTask(id)||id===CHARGE_TASK.id;
export const isTireTask=id=>TIRE_TASKS.some(t=>t.id===id);
export const taskLabel=id=>(id===CHARGE_TASK.id?CHARGE_TASK.label:TIRE_TASKS.find(t=>t.id===id)?.label)??(id==='washer-fluid'?'워셔액':null);
// Separate local task-only link. QR v1 remains exactly washer-fluid; QR v2 remains a token invite.
export function parseInspectionHandoff(hash){const legacy=parseHandoff(hash);if(legacy.valid)return legacy;
  if(typeof hash!=='string'||!hash.startsWith('#'))return legacy;
  const p=new URLSearchParams(hash.slice(1));
  return [...p].length===1&&p.getAll('task').length===1&&isChecklistTask(p.get('task'))
    ?{valid:true,source:'local-task',task:p.get('task')}:legacy;
}
export function taskLinks(){return [['washer-fluid','워셔액'],...[...TIRE_TASKS,CHARGE_TASK].map(t=>[t.id,t.label])].map(([id,label])=>({id,label,href:id==='washer-fluid'?'#v=1&task=washer-fluid':`#task=${id}`}));}

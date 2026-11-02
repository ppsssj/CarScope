// Internal task hints, never authorization or a vehicle/SDK identity.
import {parseHandoff} from './handoff.mjs';
export const TIRE_TASKS=Object.freeze([
  {id:'tire.front-left',label:'앞 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 왼편 바퀴입니다.'},
  {id:'tire.front-right',label:'앞 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 앞쪽 오른편 바퀴입니다.'},
  {id:'tire.rear-left',label:'뒤 왼쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 왼편 바퀴입니다.'},
  {id:'tire.rear-right',label:'뒤 오른쪽 타이어',position:'차량에 앉아 앞을 보는 기준으로 뒤쪽 오른편 바퀴입니다.'},
].map(Object.freeze));
export const isTireTask=id=>TIRE_TASKS.some(t=>t.id===id);
export const taskLabel=id=>TIRE_TASKS.find(t=>t.id===id)?.label??(id==='washer-fluid'?'워셔액':null);
// Separate local task-only link. QR v1 remains exactly washer-fluid; QR v2 remains a token invite.
export function parseInspectionHandoff(hash){const legacy=parseHandoff(hash);if(legacy.valid)return legacy;
  if(typeof hash!=='string'||!hash.startsWith('#'))return legacy;
  const p=new URLSearchParams(hash.slice(1));
  return [...p].length===1&&p.getAll('task').length===1&&isTireTask(p.get('task'))
    ?{valid:true,source:'local-task',task:p.get('task')}:legacy;
}
export function taskLinks(){return [['washer-fluid','워셔액'],...TIRE_TASKS.map(t=>[t.id,t.label])].map(([id,label])=>({id,label,href:id==='washer-fluid'?'#v=1&task=washer-fluid':`#task=${id}`}));}

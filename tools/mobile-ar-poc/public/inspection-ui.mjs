// Shared DOM presentation primitive; no storage, task policy, transport or HTML interpolation.
import {extendLocationGuide} from './part-guide.mjs';
export function renderSummary(dl,rows){dl.replaceChildren(...rows.flatMap(([key,value,cls,edit])=>{const dt=document.createElement('dt'),dd=document.createElement('dd'),text=document.createElement('span');dt.textContent=key;text.textContent=value;if(cls)text.className=cls;dd.append(text);
  if(edit){const b=document.createElement('button');b.type='button';b.className='edit';b.textContent='수정';b.setAttribute('aria-label',`${key} 수정`);b.onclick=edit;dd.append(b);}return [dt,dd];}));}
export function actionGate(now=()=>performance.now()){let until=-Infinity;return (action,ms=350)=>{const t=now();if(t<until)return false;const changed=action();if(changed)until=t+ms;return changed;};}
export function renderOutcome(box,title,tone){box.className=`outcome tone-${tone}`;box.textContent=title;}

// The four wheels around a car seen from above, front on top. No task switching.
export function wheelMap(taskId){
  const map=document.createElement('div');map.className='wheel-map';map.setAttribute('aria-label','차량에 앉아 앞을 보는 기준');
  for(const [id,label]of [['front-left','앞 왼쪽'],['front-right','앞 오른쪽'],['rear-left','뒤 왼쪽'],['rear-right','뒤 오른쪽']]){
    const cell=document.createElement('span');cell.textContent=label;if(taskId===`tire.${id}`){cell.setAttribute('aria-current','location');cell.textContent+=' · 점검 대상';}map.append(cell);
  }
  return map;
}
// One tap away during locate/check, including the camera-free path. It sits below the camera so the camera stays on screen.
export function mountLocationGuide(task, after) {
  const guide=document.createElement('details');guide.className='part-location card';guide.setAttribute('aria-label',`${task.label} 위치 안내`);
  const title=document.createElement('summary'),position=document.createElement('p');
  title.textContent=`어디에 있나요? · ${task.label}`;position.textContent=task.position;guide.append(title,position);
  if(task.id.startsWith('tire.')){
    const caption=document.createElement('p');caption.className='fine';caption.textContent='위쪽이 차량 앞입니다. 차량을 마주 보고 선 방향과 좌우가 다를 수 있습니다.';guide.append(wheelMap(task.id),caption);
  }
  extendLocationGuide(task.id,guide);
  after.after(guide);
}
// P12-E: only a host that enabled the experiment marks the page and serves these files, and only a QR inspection passes a detector.
export function offerPartDetection(options){if(document.body.dataset.partDetection!=='enabled'||!options.detector)return;
  import('./part-detection-ui.mjs').then(({mountPartDetection})=>mountPartDetection(options)).catch(()=>{/* The picture guide and the inspection are untouched. */});}

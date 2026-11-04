// Shared DOM presentation primitive; no storage, task policy, transport or HTML interpolation.
export function renderSummary(dl,rows){dl.replaceChildren(...rows.flatMap(([key,value,cls])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;if(cls)dd.className=cls;return [dt,dd];}));}
export function actionGate(now=()=>performance.now()){let until=-Infinity;return (action,ms=350)=>{const t=now();if(t<until)return false;const changed=action();if(changed)until=t+ms;return changed;};}

// Always visible during locate/check, including the camera-free path. No task switching.
export function mountLocationGuide(task, before) {
  const guide=document.createElement('aside');guide.className='part-location card';guide.setAttribute('aria-label',`${task.label} 위치 안내`);
  const title=document.createElement('strong'),position=document.createElement('p');
  title.textContent=`찾을 부품: ${task.label}`;position.textContent=task.position;guide.append(title,position);
  if(task.id.startsWith('tire.')){
    const map=document.createElement('div');map.className='wheel-map';map.setAttribute('aria-label','차량에 앉아 앞을 보는 기준');
    for(const [id,label]of [['front-left','앞 왼쪽'],['front-right','앞 오른쪽'],['rear-left','뒤 왼쪽'],['rear-right','뒤 오른쪽']]){
      const cell=document.createElement('span');cell.textContent=label;if(task.id===`tire.${id}`){cell.setAttribute('aria-current','location');cell.textContent+=' · 점검 대상';}map.append(cell);
    }
    const caption=document.createElement('p');caption.className='fine';caption.textContent='위쪽이 차량 앞입니다. 차량을 마주 보고 선 방향과 좌우가 다를 수 있습니다.';guide.append(map,caption);
  }
  before.before(guide);
}

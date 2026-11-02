// Shared DOM presentation primitive; no storage, task policy, transport or HTML interpolation.
export function renderSummary(dl,rows){dl.replaceChildren(...rows.flatMap(([key,value,cls])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;if(cls)dd.className=cls;return [dt,dd];}));}
export function actionGate(now=()=>performance.now()){let until=-Infinity;return (action,ms=350)=>{const t=now();if(t<until)return false;const changed=action();if(changed)until=t+ms;return changed;};}

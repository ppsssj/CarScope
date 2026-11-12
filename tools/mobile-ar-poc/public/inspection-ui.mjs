// Shared DOM presentation primitive; no storage, task policy, transport or HTML interpolation.
import {extendLocationGuide} from './part-guide.mjs';
import {AI_STATE,METHOD_LABELS,aiNote,partCapabilities,partIdForTask} from './part-capabilities.mjs';
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
// P11 (PR #121): every part shows the same "점검 방법" card, built from part-capabilities.mjs. The manual checklist is always offered;
// the AI row says, in plain words, whether this part has an AI method and whether this server and this QR connection offer it.
// It never offers a button that cannot work: the AI entry is placed in the card only when the state is AVAILABLE.
export function mountInspectionMethods(taskId,before,host,{checks=[],scope=null}={}){
  const cap=partCapabilities(partIdForTask(taskId),{taskId,host}),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const card=el('section','inspection-methods card');card.id='inspection-methods';card.setAttribute('aria-labelledby','inspection-methods-title');
  card.dataset.aiState=cap.ai;card.dataset.plan=cap.offered;
  const title=el('h2',null,'점검 방법');title.id='inspection-methods-title';
  const manual=el('div','method');manual.dataset.method='manual';
  manual.append(el('p','method-title',METHOD_LABELS.manual),el('p','fine','질문에 직접 보고 답해요. 안전 조건을 확인한 뒤 ‘카메라로 점검 시작’ 또는 ‘카메라 없이 점검하기’로 시작해요. AI가 없어도 점검과 결과 전송은 그대로 할 수 있어요.'));
  if(checks.length){const list=el('p','fine',`살펴볼 것: ${checks.join(' · ')}`);list.id='inspection-methods-checks';manual.append(list);}
  if(scope){const line=el('p','fine',scope);line.id='inspection-methods-scope';manual.append(line);}
  const aiRow=el('div','method');aiRow.dataset.method='ai';
  const note=el('p','fine',aiNote(cap));note.id='inspection-methods-ai-note';
  const slot=el('span');slot.hidden=true; // the AI entry button is placed before this
  if(cap.ai===AI_STATE.AVAILABLE){aiRow.append(slot,note,el('p','fine','참고용이에요. 결과는 직접 확인해 주세요. 점검 답변을 대신 정하지 않아요.'));card.append(title,aiRow,manual);}
  else{aiRow.append(note);card.append(title,manual,aiRow);}
  // Where the AI entry always was: after the start controls, so the first screen keeps the safety check and the start buttons.
  const anchor=before??document.getElementById('step-intro')?.lastElementChild;
  if(anchor)anchor.before(card);else document.getElementById('step-intro')?.append(card);
  const unavailable=()=>{card.dataset.aiState='LOAD_FAILED';slot.remove();for(const n of aiRow.querySelectorAll('p:not(#inspection-methods-ai-note)'))n.remove();note.textContent='지금은 AI 외관 분석을 쓸 수 없어요. 직접 점검은 그대로 할 수 있어요.';};
  return {cap,card,slot,unavailable};
}
// P12-E: only a host that enabled the experiment marks the page and serves these files, and only a QR inspection passes a detector.
// P13-A: the state analysis joins only where the host also marked the page for it and the detector can analyse.
export function offerPartDetection(options){
  const body=document.body.dataset,detector=options.detector??null;
  const host={connected:Boolean(detector),detection:body.partDetection==='enabled',analysis:body.partAnalysis==='enabled'&&typeof detector?.analyze==='function'};
  const methods=mountInspectionMethods(options.taskId,options.introBefore,host,{checks:options.checks,scope:options.scope});
  if(methods.cap.ai!==AI_STATE.AVAILABLE)return methods;
  Promise.all([import('./part-detection-ui.mjs'),host.analysis?import('./part-analysis-ui.mjs').catch(()=>null):null]).then(([{mountPartDetection},analysisUi])=>{
    const {checks,scope,...detection}=options;
    const mounted=mountPartDetection({...detection,introBefore:methods.slot,
      // P13-D: a part without a detector is offered only through the analysis, which says whether it may be analysed.
      detectionEnabled:host.detection,analysisOffered:Boolean(analysisUi?.analysisOfferedForTask(options.taskId)),
      analysis:analysisUi?context=>analysisUi.createPartAnalysis({...context,analyzer:detector,serviceId:body.partAnalysisService}):null});
    if(!mounted)methods.unavailable();
  }).catch(()=>methods.unavailable()); // the picture guide and the inspection are untouched
  return methods;
}

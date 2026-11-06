import {taskLinks} from './inspection-tasks.mjs';
import {getChecklistProfile} from './checklist-profiles.mjs';
import {InspectionCamera} from './inspection-camera.mjs';
import {renderSummary,renderOutcome,actionGate,mountLocationGuide,wheelMap} from './inspection-ui.mjs';
import {taskCopy,questionCopy,ANSWER_COPY,CHECKLIST_OUTCOME,REPORT_NOTE,SAFETY_ACK,CANNOT_CONFIRM_NOTE,iconElement} from './inspection-copy.mjs';

// Long enough to see the choice land, short enough to feel like one action.
const ADVANCE_MS=320;

export function prepareChecklistPage(taskId,{locked=false}={}){const task=getChecklistProfile(taskId),copy=taskCopy(task);
  document.title=`CarScope · ${task.label} 점검`;document.body.dataset.checklist='true';if(task.hook==='__tireInspection')document.body.dataset.tire='true';document.body.dataset.step='intro';
  document.body.innerHTML=`<header class="bar"><div class="bar-row"><p class="brand">CarScope <span>${task.label}</span></p><div class="bar-actions"><button id="cancel" class="ghost" hidden>그만하기</button></div></div><ol id="progress" aria-label="진행 단계"><li data-n="1">준비</li><li data-n="2">위치 찾기</li><li data-n="3">육안 점검</li><li data-n="4">결과</li></ol></header>
  <main><p id="handoff-status" class="pill" role="status"></p><div id="cancel-confirm" class="card warn" role="alertdialog" aria-labelledby="cancel-title" hidden><p id="cancel-title"><strong>점검을 그만할까요?</strong> 확정하지 않은 답변은 지워져요.</p><div class="row"><button id="cancel-no">계속 점검</button><button id="cancel-yes" class="danger">그만하기</button></div></div>
  <section id="step-intro" class="step"><div class="hero"><span id="hero-icon" class="hero-icon"></span><div><h1>${task.label} 점검</h1><p class="lead">${copy.lead}</p></div></div><div id="hero-visual"></div>
  <p class="safety-title">시작 전에 확인해 주세요</p><ul class="safety-points">${copy.points.map(point=>`<li>${point}</li>`).join('')}</ul><p id="safety-limit" class="fine">${CANNOT_CONFIRM_NOTE} ${copy.limit}</p>
  <label class="safety"><input id="safety" type="checkbox"><span>${SAFETY_ACK}</span></label>${task.requiresNotCharging?`<label class="safety"><input id="not-charging" type="checkbox"><span>${copy.extraAck}</span></label>`:''}
  <button id="manual-start" class="link-button">카메라 없이 점검하기</button>
  <details class="help"><summary>자세한 안내</summary><p>${task.position}</p><p>${task.description}</p><p>${task.limitations}</p><p>${task.safetyText}</p>${task.requiresNotCharging?`<p>${task.extraSafety}</p>`:''}<p>${task.safetyHelp}</p></details>
  ${locked?'':`<details><summary>다른 부품 점검하기</summary><nav class="task-links" aria-label="점검 선택">${taskLinks().map(t=>`<a href="${t.href}">${t.label}</a>`).join('')}</nav></details>`}</section>
  <section id="step-locate" class="step"><h2 tabindex="-1">${task.label}을 비춰 주세요</h2><p>찾으면 화면을 탭해 표시해 주세요.</p></section>
  <section id="camera" class="step"><h2 class="visually-hidden">${task.label} 카메라 안내</h2><div id="stage"><video id="video" autoplay muted playsinline aria-label="스마트폰 카메라 영상"></video><canvas id="overlay" aria-label="${task.label} 안내와 직접 지정한 위치"></canvas><p id="placeholder">카메라가 꺼져 있어요.</p></div><p id="status" role="status" aria-live="polite"></p><div class="row"><button id="start">카메라 켜기</button><button id="stop" disabled>카메라 끄기</button><button id="clear-mark" disabled>표시 지우기</button></div><details><summary>카메라 안내</summary><p>점선은 안내 그림이며 부품을 감지한 결과가 아닙니다. 화면을 탭해 위치를 직접 지정할 수 있습니다. 표시는 3D에 고정되지 않습니다. 휴대폰을 움직이면 다시 지정하세요.</p></details></section>
  ${task.supportsObservationStop?`<aside id="inspection-safety" class="card warn" hidden><p id="observation-stopped" role="status" hidden>관찰을 중단했어요. 더 가까이 가지 마세요. 본 내용만 답하고, 나머지는 ‘확인하기 어려워요’를 골라 주세요.</p><p id="stop-rule">${copy.stop}</p><details><summary>자세히 보기</summary><p>${task.stopAdvice}</p></details><button id="safety-stop">더 보지 않고 본 내용만 기록</button></aside>`:''}<div id="locate-actions" class="step"><details><summary>찾기 어렵다면</summary><p>${task.locateHelp}</p></details><button id="locate-manual" class="link-button">카메라 없이 계속하기</button></div>
  <section id="step-check" class="step"><p id="question-count"></p><h2 id="question-title" tabindex="-1"></h2><p id="question-tip"></p><fieldset id="${task.answerId}" class="inspection-answers"><legend class="visually-hidden">직접 본 내용을 선택하세요</legend></fieldset><details><summary>자세히 보기</summary><p id="question-help"></p><p>‘보이는 곳엔 없어요’는 보이는 범위의 사용자 보고이며 정상·안전 판정이 아닙니다.</p></details></section>
  <section id="step-review" class="step"><h2 tabindex="-1">답변을 확인해 주세요</h2><dl id="confirm-summary" class="summary"></dl><p class="fine">확정한 뒤에는 바꿀 수 없어요. ${REPORT_NOTE}</p></section>
  <section id="step-done" class="step"><h2 id="done-title" tabindex="-1">점검을 마쳤어요</h2><p id="done-outcome"></p><dl id="done-summary" class="summary"></dl><p id="done-follow" class="fine"></p><p id="done-sync" class="card muted">이 휴대폰에만 기록됐어요. 차량으로 보내거나 점검 이력에 저장하지 않았어요.</p><details><summary>자세한 안내</summary><p>${task.followup}</p><p>${task.restartHelp}</p></details><details id="debug-area" class="debug"><summary>개발자 정보</summary><pre id="result-json"></pre></details></section></main>
  <footer class="actions"><button id="back" class="secondary">이전</button><button id="primary" class="primary">카메라로 점검 시작</button></footer>`;
  document.getElementById('hero-icon').append(iconElement(copy.icon));if(task.id.startsWith('tire.'))document.getElementById('hero-visual').append(wheelMap(task.id));
}
export function startChecklistPage({handoff,onComplete=()=>{},onRestart=()=>{}}){const $=id=>document.getElementById(id),task=getChecklistProfile(handoff.task),copy=taskCopy(task);let state=task.flow.initial(task.id),restartAfter=0,advance=null,pointerAnswer=false;
  mountLocationGuide(task,$('camera'));
  const run=actionGate(),canCamera=()=>state.mode==='camera'&&['locate','check'].includes(state.step);
  const camera=new InspectionCamera({video:$('video'),overlay:$('overlay'),stage:$('stage'),start:$('start'),stop:$('stop'),clear:$('clear-mark'),placeholder:$('placeholder'),canRun:canCamera,targetLabel:task.label,
    drawGuide:(ctx,r,d)=>task.drawGuide(ctx,r,d,{index:state.index,step:state.step}),
    onStatus:s=>{$('status').textContent=s;},onAids:a=>dispatch({type:'NOTE_AIDS',...a,attemptId:state.record?.inspectionId})});
  const answerText=value=>ANSWER_COPY[value]?.label??'미응답';
  const rows=edit=>task.checks.map((c,index)=>[c.label,answerText(state.record.responses[c.id]),`tone-${ANSWER_COPY[state.record.responses[c.id]]?.tone??'unable'}`,edit?()=>run(()=>dispatch({type:'EDIT',index})):undefined]);
  const cancelAdvance=()=>{clearTimeout(advance);advance=null;};
  function render(){document.body.dataset.ready='true';document.body.dataset.step=state.step;document.body.dataset.mode=state.mode??'';document.body.dataset.question=String(state.index);const progress={intro:1,locate:2,check:3,review:4,done:4}[state.step];
    for(const li of $('progress').children){const n=Number(li.dataset.n);li.className=n<progress||state.step==='done'?'done':n===progress?'current':'';if(n===progress)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}
    $('cancel').hidden=['intro','done'].includes(state.step);$('cancel-confirm').hidden=true;$('safety').checked=state.safe;const ready=state.safe&&(!task.requiresNotCharging||state.notCharging);$('manual-start').disabled=!ready;if(task.requiresNotCharging){$('not-charging').checked=state.notCharging;}if(task.supportsObservationStop){$('inspection-safety').hidden=['intro','done','review'].includes(state.step);$('observation-stopped').hidden=!state.observationStopped;$('safety-stop').hidden=!['locate','check'].includes(state.step)||state.observationStopped;placeStopRule();}
    const labels={intro:'카메라로 점검 시작',locate:'다음',check:state.editing?'수정 완료':state.index===task.checks.length-1?'답변 확인':'다음',review:'이 답변으로 확정',done:'새 점검 시작'};$('primary').textContent=labels[state.step];
    $('primary').disabled=state.step==='intro'?!ready:state.step==='check'?!Object.hasOwn(task.answers,state.record.responses[task.checks[state.index].id]):state.step==='done'?Date.now()<restartAfter:false;
    if(state.step==='check'){const c=task.checks[state.index],attemptId=state.record.inspectionId,q=questionCopy(task,c);$('question-count').textContent=`${state.index+1} / ${task.checks.length}`;$('question-title').textContent=q.title;$('question-tip').textContent=q.tip;$('question-help').textContent=c.help;
      const field=$(task.answerId),question=`${attemptId}:${c.id}`;
      // Keep the active radio mounted while answering; camera aid updates must not steal keyboard focus.
      if(field.dataset.question!==question){field.dataset.question=question;field.replaceChildren();const legend=document.createElement('legend');legend.className='visually-hidden';legend.textContent='직접 본 내용을 선택하세요';field.append(legend);
        for(const answer of Object.keys(task.answers)){const l=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name=c.id;input.value=answer;l.dataset.tone=ANSWER_COPY[answer].tone;
          // Arrow keys change a radio while still choosing, so only a pointer choice moves on by itself.
          l.onpointerdown=()=>{pointerAnswer=true;};input.onkeydown=()=>{pointerAnswer=false;};
          input.onchange=()=>{const byPointer=pointerAnswer;pointerAnswer=false;dispatch({type:'ANSWER',checkId:c.id,answer,attemptId});scheduleAdvance(byPointer,answer);};span.textContent=ANSWER_COPY[answer].label;l.append(input,span);field.append(l);}}
      for(const input of field.querySelectorAll('input')){input.checked=state.record.responses[c.id]===input.value;input.closest('label').classList.toggle('selected',input.checked);}}
    if(state.step==='review')renderSummary($('confirm-summary'),rows(true));if(state.step==='done'){if(task.result.validate(state.record).length)throw Error('Invalid completed checklist result');renderSummary($('done-summary'),rows(false));const outcome=CHECKLIST_OUTCOME[state.record.status];renderOutcome($('done-outcome'),outcome.title,outcome.tone);$('done-follow').textContent=`${copy.follow} ${REPORT_NOTE}`;$('result-json').textContent=JSON.stringify(state.record,null,2);}
  }
  // Below the answers while answering, so a small phone still shows the question. Once stopped it comes first.
  function placeStopRule(){const aside=$('inspection-safety'),answers=$(task.answerId);
    if(state.step!=='check'){if(aside.previousElementSibling!==$('locate-actions'))$('locate-actions').after(aside);return;}
    if(state.observationStopped){if(aside.nextElementSibling!==$('question-count'))$('question-count').before(aside);}
    else if(aside.previousElementSibling!==answers)answers.after(aside);}
  // A finding that asks the person to stop looking stays on screen: that message must be read before moving on.
  function scheduleAdvance(byPointer,answer){cancelAdvance();if(!byPointer||state.step!=='check')return;if(answer==='FOUND'&&task.supportsObservationStop)return;const index=state.index;advance=setTimeout(()=>{advance=null;dispatch({type:'NEXT',index});},ADVANCE_MS);}
  function dispatch(event){const prev=state,next=task.flow.reduce(state,event);if(next===prev)return false;state=next;const changed=prev.step!==state.step||prev.index!==state.index;
    if(changed){camera.clearMark();cancelAdvance();}if(!canCamera())camera.stop();if(prev.step!=='done'&&state.step==='done'){restartAfter=Date.now()+1000;setTimeout(render,1020);}render();
    if(changed){scrollTo(0,0);document.querySelector(`#step-${state.step} h2`)?.focus({preventScroll:true});}
    if(prev.step!=='done'&&state.step==='done')onComplete(state.record);if(prev.step==='done'&&state.step==='intro')onRestart();return true;}
  if(task.requiresNotCharging)$('not-charging').onchange=e=>dispatch({type:'NOT_CHARGING',value:e.target.checked});
  if(task.supportsObservationStop){$('safety-stop').onclick=()=>dispatch({type:'STOP_OBSERVATION'});}
  $('safety').onchange=e=>dispatch({type:'SAFETY',value:e.target.checked});$('primary').onclick=()=>run(()=>{switch(state.step){case'intro':{const changed=dispatch({type:'START',camera:true});if(changed)void camera.start();return changed;}case'locate':return dispatch({type:'TO_CHECK'});case'check':return dispatch({type:'NEXT',index:state.index});case'review':return dispatch({type:'CONFIRM'});case'done':return Date.now()>=restartAfter&&dispatch({type:'RESTART'});}});
  $('manual-start').onclick=()=>run(()=>dispatch({type:'START',camera:false}));$('locate-manual').onclick=()=>run(()=>dispatch({type:'TO_CHECK',manual:true}));$('back').onclick=()=>run(()=>dispatch({type:'BACK'}));
  $('cancel').onclick=()=>{cancelAdvance();camera.stop('확인하는 동안 카메라를 껐어요.');$('cancel-confirm').hidden=false;$('cancel-no').focus();};$('cancel-no').onclick=()=>{$('cancel-confirm').hidden=true;$('cancel').focus();};$('cancel-yes').onclick=()=>dispatch({type:'CANCEL'});
  $('handoff-status').textContent=handoff.source==='qr-sync'?'':'이 휴대폰에만 기록돼요';addEventListener('hashchange',()=>location.reload());
  render();window.__checklistInspection={get state(){return state;},get mark(){return camera.mark;}};window[task.hook]=window.__checklistInspection;return {get state(){return state;}};
}

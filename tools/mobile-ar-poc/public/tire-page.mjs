import {TIRE_TASKS,taskLinks} from './inspection-tasks.mjs';
import {TIRE_CHECKS,TIRE_ANSWERS,validateTireResult} from './tire-result.mjs';
import {initialTireState,reduceTire} from './tire-flow.mjs';
import {InspectionCamera} from './inspection-camera.mjs';
import {renderSummary,actionGate} from './inspection-ui.mjs';
export function prepareTirePage(taskId,{locked=false}={}){const task=TIRE_TASKS.find(t=>t.id===taskId);if(!task)throw Error('Unknown tire task');
  document.title=`CarScope · ${task.label} 점검`;document.body.dataset.tire='true';document.body.dataset.step='intro';
  document.body.innerHTML=`<header class="bar"><div class="bar-row"><p class="brand">CarScope <span>${task.label}</span></p><button id="cancel" class="ghost" hidden>점검 취소</button></div><ol id="progress" aria-label="진행 단계"><li data-n="1">준비</li><li data-n="2">위치 찾기</li><li data-n="3">육안 점검</li><li data-n="4">결과</li></ol></header>
  <main><p id="handoff-status" class="pill" role="status"></p><div id="cancel-confirm" class="card warn" role="alertdialog" aria-labelledby="cancel-title" hidden><p id="cancel-title">점검을 취소할까요? 확정하지 않은 응답은 지워집니다.</p><div class="row"><button id="cancel-no">계속 점검</button><button id="cancel-yes" class="danger">점검 취소</button></div></div>
  <section id="step-intro" class="step"><h1>${task.label} 점검</h1><p>${task.position}</p><p>타이어는 도로와 맞닿아 차량을 받치고 움직임을 전달합니다. 선택한 바퀴의 보이는 부분만 직접 살펴보세요.</p>
  <p class="notice">카메라는 수동 위치 지정과 안내를 위한 보조 도구입니다. 객체 인식·공간 추적·마모 깊이·공기압·손상 심각도를 측정하지 않습니다.</p>
  <label class="safety"><input id="safety" type="checkbox"> 안전한 곳에 정차해 주차 상태를 확인했고, 차량을 움직이지 않고 점검하겠습니다.</label><p class="fine">도로 위에서 점검하거나 타이어를 분해하지 마세요. 닿기 어렵거나 확신할 수 없는 부분은 ‘확인할 수 없음’을 고르세요.</p><button id="manual-start" class="link-button">카메라 없이 점검하기</button>
  ${locked?'':`<details><summary>다른 부품 점검 선택</summary><nav class="task-links" aria-label="점검 선택">${taskLinks().map(t=>`<a href="${t.href}">${t.label}</a>`).join('')}</nav></details>`}</section>
  <section id="camera" class="step"><h2 class="visually-hidden">타이어 카메라 안내</h2><div id="stage"><video id="video" autoplay muted playsinline aria-label="스마트폰 카메라 영상"></video><canvas id="overlay" aria-label="수동 타이어 안내와 직접 지정한 2D 위치"></canvas><p id="placeholder">카메라가 꺼져 있습니다.</p></div><p id="status" role="status" aria-live="polite"></p><div class="row"><button id="start">카메라 시작</button><button id="stop" disabled>카메라 중지</button><button id="clear-mark" disabled>위치 지정 해제</button></div><p class="fine">점선은 안내 그림이며 타이어를 감지한 결과가 아닙니다. 화면을 탭해 위치를 직접 지정할 수 있습니다. 표시는 3D에 고정되지 않습니다. 휴대폰을 움직이면 다시 지정하세요.</p></section>
  <section id="step-locate" class="step"><h2 tabindex="-1">${task.label}을 비춰 주세요</h2><p>선택한 바퀴가 맞는지 확인하세요. 카메라 없이도 모든 항목에 응답할 수 있습니다.</p><button id="locate-manual" class="link-button">카메라 없이 다음 단계로</button></section>
  <section id="step-check" class="step"><p id="question-count" class="pill"></p><h2 id="question-title" tabindex="-1"></h2><p id="question-help"></p><fieldset id="tire-answers"><legend>직접 본 내용을 선택하세요</legend></fieldset><p class="fine">‘발견하지 못함’은 보이는 범위의 사용자 보고이며 정상·안전 판정이 아닙니다.</p></section>
  <section id="step-review" class="step"><h2 tabindex="-1">응답을 확인하고 확정하세요</h2><dl id="confirm-summary" class="summary"></dl><p>수정하려면 뒤로 가세요. 확정은 응답 기록의 완료이며 차량의 안전·주행 가능 여부를 판정하지 않습니다.</p></section>
  <section id="step-done" class="step"><h2 tabindex="-1">사용자 점검 기록 확정</h2><dl id="done-summary" class="summary"></dl><p id="done-follow" class="card"></p><p id="done-sync" class="card muted">이 휴대폰 화면에서만 확정했습니다. 차량에 전송하거나 점검 이력에 저장하지 않았습니다.</p><details><summary>결과 데이터 보기</summary><pre id="result-json"></pre></details><p class="fine">새 점검은 새 기록입니다. 다른 타이어 응답을 대신 완료하지 않습니다.</p></section></main>
  <footer class="actions"><button id="back" class="secondary">뒤로</button><button id="primary" class="primary">카메라로 점검 시작</button></footer>`;
}
export function startTireInspectionPage({handoff,onComplete=()=>{},onRestart=()=>{}}){const $=id=>document.getElementById(id),task=TIRE_TASKS.find(t=>t.id===handoff.task);let state=initialTireState(task.id),restartAfter=0;
  const run=actionGate(),canCamera=()=>state.mode==='camera'&&['locate','check'].includes(state.step);
  const camera=new InspectionCamera({video:$('video'),overlay:$('overlay'),stage:$('stage'),start:$('start'),stop:$('stop'),clear:$('clear-mark'),placeholder:$('placeholder'),canRun:canCamera,targetLabel:task.label,
    drawGuide:(ctx,r,d)=>{ctx.strokeStyle='#ffe16a';ctx.lineWidth=3*d;ctx.setLineDash([8*d,6*d]);ctx.beginPath();ctx.ellipse(r.x+r.width/2,r.y+r.height/2,r.width*.28,r.height*.36,0,0,Math.PI*2);ctx.stroke();},
    onStatus:s=>{$('status').textContent=s;},onAids:a=>dispatch({type:'NOTE_AIDS',...a,attemptId:state.record?.inspectionId})});
  const rows=()=>[['점검 부품',task.label],...TIRE_CHECKS.map(c=>[c.label,TIRE_ANSWERS[state.record.responses[c.id]]??'미응답']),['확인 근거','USER_REPORTED · 사용자 보고']];
  function render(){document.body.dataset.step=state.step;document.body.dataset.mode=state.mode??'';document.body.dataset.question=String(state.index);const progress={intro:1,locate:2,check:3,review:4,done:4}[state.step];
    for(const li of $('progress').children){const n=Number(li.dataset.n);li.className=n<progress||state.step==='done'?'done':n===progress?'current':'';if(n===progress)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}
    $('cancel').hidden=['intro','done'].includes(state.step);$('cancel-confirm').hidden=true;$('safety').checked=state.safe;$('manual-start').disabled=!state.safe;
    const labels={intro:'카메라로 점검 시작',locate:'다음: 육안 점검',check:state.index===2?'응답 전체 확인':'다음 항목',review:'이 응답으로 결과 확정',done:'새 점검 시작'};$('primary').textContent=labels[state.step];
    $('primary').disabled=state.step==='intro'?!state.safe:state.step==='check'?!Object.hasOwn(TIRE_ANSWERS,state.record.responses[TIRE_CHECKS[state.index].id]):state.step==='done'?Date.now()<restartAfter:false;
    if(state.step==='check'){const c=TIRE_CHECKS[state.index],attemptId=state.record.inspectionId;$('question-count').textContent=`육안 점검 ${state.index+1}/3 · ${task.label}`;$('question-title').textContent=c.label;$('question-help').textContent=c.help;
      const field=$('tire-answers'),question=`${attemptId}:${c.id}`;
      // Keep the active radio mounted while answering; camera aid updates must not steal keyboard focus.
      if(field.dataset.question!==question){field.dataset.question=question;field.replaceChildren();const legend=document.createElement('legend');legend.textContent='직접 본 내용을 선택하세요';field.append(legend);
        for(const [answer,label]of Object.entries(TIRE_ANSWERS)){const l=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name=c.id;input.value=answer;input.onchange=()=>dispatch({type:'ANSWER',checkId:c.id,answer,attemptId});span.textContent=label;l.append(input,span);field.append(l);}}
      for(const input of field.querySelectorAll('input'))input.checked=state.record.responses[c.id]===input.value;}
    if(state.step==='review')renderSummary($('confirm-summary'),rows());if(state.step==='done'){if(validateTireResult(state.record).length)throw Error('Invalid completed tire result');renderSummary($('done-summary'),rows());$('done-follow').textContent='발견한 징후나 확인하지 못한 부분은 제조사 서비스 또는 정비 전문가에게 확인하세요. 이 화면은 점검·정비·주행 가능 판정이 아닙니다.';$('result-json').textContent=JSON.stringify(state.record,null,2);}
  }
  function dispatch(event){const prev=state,next=reduceTire(state,event);if(next===prev)return false;state=next;const changed=prev.step!==state.step||prev.index!==state.index;
    if(changed)camera.clearMark();if(!canCamera())camera.stop();if(prev.step!=='done'&&state.step==='done'){restartAfter=Date.now()+1000;setTimeout(render,1020);}render();
    if(changed){scrollTo(0,0);document.querySelector(`#step-${state.step} h2`)?.focus({preventScroll:true});}
    if(prev.step!=='done'&&state.step==='done')onComplete(state.record);if(prev.step==='done'&&state.step==='intro')onRestart();return true;}
  $('safety').onchange=e=>dispatch({type:'SAFETY',value:e.target.checked});$('primary').onclick=()=>run(()=>{switch(state.step){case'intro':{const changed=dispatch({type:'START',camera:true});if(changed)void camera.start();return changed;}case'locate':return dispatch({type:'TO_CHECK'});case'check':return dispatch({type:'NEXT',index:state.index});case'review':return dispatch({type:'CONFIRM'});case'done':return Date.now()>=restartAfter&&dispatch({type:'RESTART'});}});
  $('manual-start').onclick=()=>run(()=>dispatch({type:'START',camera:false}));$('locate-manual').onclick=()=>run(()=>dispatch({type:'TO_CHECK',manual:true}));$('back').onclick=()=>run(()=>dispatch({type:'BACK'}));
  $('cancel').onclick=()=>{camera.stop('취소 확인 중 카메라를 중지했습니다.');$('cancel-confirm').hidden=false;$('cancel-no').focus();};$('cancel-no').onclick=()=>{$('cancel-confirm').hidden=true;$('cancel').focus();};$('cancel-yes').onclick=()=>dispatch({type:'CANCEL'});
  $('handoff-status').textContent=handoff.source==='qr-sync'?`차량에서 요청한 점검: ${task.label}`:`직접 선택: ${task.label} · 차량 연결 없음`;addEventListener('hashchange',()=>location.reload());
  render();window.__tireInspection={get state(){return state;},get mark(){return camera.mark;}};return {get state(){return state;}};
}

import {EXTRA_TASKS} from './extra-tasks.mjs';
import {getExtraResult} from './extra-result.mjs';
import {ANSWERS} from './checklist-result.mjs';
import {createChecklistFlow} from './checklist-flow.mjs';
const profiles=new Map(EXTRA_TASKS.map(task=>{
  const result=getExtraResult(task.id),bonnet=task.kind==='bonnet';
  return [task.id,Object.freeze({...task,result,answers:ANSWERS,hook:'__extraInspection',answerId:'inspection-answers',
    flow:createChecklistFlow({matchesTask:id=>id===task.id,checks:task.checks,result,stopOnFinding:true}),supportsObservationStop:true,
    description:`${task.label}의 외부에서 보이는 범위만 세 항목으로 기록합니다. 가려지거나 구별할 수 없는 항목은 확인할 수 없음으로 남기세요.`,
    limitations:'수동 카메라 보조·2D 위치 표시입니다. 부품 자동 인식·공간 추적·수치 측정·정상·고장·주행 가능 판정을 하지 않습니다.',
    safetyText:bonnet?'평탄하고 안전한 곳에 정차해 P·주차브레이크·전원 꺼짐·충전 중이 아님·보닛 지지를 확인했습니다. 모터룸이 완전히 식었으며 부품을 만지거나 캡·덮개를 열지 않고 외부만 관찰하겠습니다.':task.kind==='wiper'?'안전한 곳에 정차해 P·주차브레이크·전원 및 자동 와이퍼 꺼짐을 확인했습니다. 완전히 정지한 와이퍼를 만지거나 들어 올리거나 작동시키지 않겠습니다.':'안전한 곳에 정차해 P·주차브레이크·전원 꺼짐·조명 소등을 확인했습니다. 램프가 식었으며 점등·광축 시험이나 접촉·분해 없이 외부만 관찰하겠습니다.',
    safetyHelp:bonnet?'조건을 확인하지 못하면 시작하지 마세요. 팬은 전원 OFF 후에도 움직일 수 있습니다. 뜨거운 부품·고전압 케이블·단자·배선에 접근하지 마세요. 화기·흡연·스파크·금속 도구를 멀리 두세요. 캡 개방·보충·충전·단자 청소·퓨즈 교환·덮개 분리를 안내하지 않습니다.':'차량을 움직이거나 전원을 켜서 시험하지 마세요. 선택한 쪽·영역을 설명서로 대조하세요. 가려짐·식별 불가 시 확인할 수 없음을 선택하세요.',
    stopAdvice:'누액·손상·그을림·부풀음 등 이상 징후나 관찰 환경 변화가 있으면 즉시 접근·관찰을 중단하고 제조사 서비스에 문의하세요. 이미 본 내용만 기록하고 나머지는 직접 확인할 수 없음을 선택하세요.',
    locateHelp:'설명서의 표기와 선택한 부품을 대조한 뒤 화면을 탭해 직접 지정하세요. 찾기 어렵거나 가려졌으면 카메라 없이 진행하고 해당 질문에 확인할 수 없음을 선택하세요.',
    followup:'사용자가 외부에서 관찰한 보고이며 정상·안전·주행 가능 여부를 인증하지 않습니다. 발견한 징후나 확인하지 못한 부분은 제조사 서비스에 문의하세요. 직접 보충·분해·수리·접촉 시험을 하지 마세요.',
    restartHelp:'새 점검은 새 기록입니다. 다른 저장통·좌우 부품·상향등·하향등 결과를 대신 완료하지 않습니다.',
    drawGuide(ctx,r,d){ctx.strokeStyle='#ffe16a';ctx.lineWidth=3*d;ctx.setLineDash([8*d,6*d]);ctx.strokeRect(r.x+r.width*.2,r.y+r.height*.22,r.width*.6,r.height*.56);},
  })];
}));
export function getExtraProfile(id){return profiles.get(id);}

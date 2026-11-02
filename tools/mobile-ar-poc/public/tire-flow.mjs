import {isTireTask} from './inspection-tasks.mjs';
import {TIRE_CHECKS,TIRE_ANSWERS,startTireResult,answerTire,noteTireAids,completeTireResult} from './tire-result.mjs';
export function initialTireState(taskId){if(!isTireTask(taskId))throw Error('Unknown tire task');return Object.freeze({taskId,step:'intro',safe:false,mode:null,index:0,record:null});}
export function reduceTire(s,e,ctx={}){const to=p=>Object.freeze({...s,...p});
  if(e.attemptId!==undefined&&e.attemptId!==s.record?.inspectionId)return s;
  switch(e.type){
    case 'SAFETY':return s.step==='intro'&&typeof e.value==='boolean'?to({safe:e.value}):s;
    case 'START':return s.step==='intro'&&s.safe?to({step:e.camera?'locate':'check',mode:e.camera?'camera':'manual',record:startTireResult(s.taskId,ctx)}):s;
    case 'NOTE_AIDS':return s.record&&['locate','check'].includes(s.step)?to({record:noteTireAids(s.record,e)}):s;
    case 'TO_CHECK':return s.step==='locate'?to({step:'check',mode:e.manual?'manual':s.mode}):s;
    case 'ANSWER':return s.step==='check'&&e.checkId===TIRE_CHECKS[s.index].id&&Object.hasOwn(TIRE_ANSWERS,e.answer)?to({record:answerTire(s.record,e.checkId,e.answer)}):s;
    case 'NEXT':return s.step==='check'&&e.index===s.index&&Object.hasOwn(TIRE_ANSWERS,s.record.responses[TIRE_CHECKS[s.index].id])?to(s.index<2?{index:s.index+1}:{step:'review'}):s;
    case 'CONFIRM':return s.step==='review'?to({step:'done',record:completeTireResult(s.record,ctx)}):s;
    case 'BACK':if(s.step==='review')return to({step:'check',index:2});if(s.step==='check'&&s.index>0)return to({index:s.index-1});if(s.step==='check'&&s.mode==='camera')return to({step:'locate'});return ['check','locate'].includes(s.step)?initialTireState(s.taskId):s;
    case 'CANCEL':return ['intro','done'].includes(s.step)?s:initialTireState(s.taskId);
    case 'RESTART':return s.step==='done'?initialTireState(s.taskId):s;
    default:return s;
  }
}

// Shared transitions; observation stop and not-charging safety are opt-in policies.
import {isAnswer} from './checklist-result.mjs';
export function createChecklistFlow({matchesTask,checks,result,requiresNotCharging=false,stopOnFinding=false}) {
  function initial(taskId) {
    if (!matchesTask(taskId)) throw Error('Unknown checklist task');
    return Object.freeze({taskId,step:'intro',safe:false,mode:null,index:0,record:null,
      ...(requiresNotCharging ? {notCharging:false} : {}),
      ...(requiresNotCharging || stopOnFinding ? {observationStopped:false} : {})});
  }
  function reduce(s,e,ctx={}) {
    const to = patch => Object.freeze({...s,...patch});
    if (e.attemptId !== undefined && e.attemptId !== s.record?.inspectionId) return s;
    switch (e.type) {
      case 'SAFETY': return s.step === 'intro' && typeof e.value === 'boolean' ? to({safe:e.value}) : s;
      case 'NOT_CHARGING': return requiresNotCharging && s.step === 'intro' && typeof e.value === 'boolean' ? to({notCharging:e.value}) : s;
      case 'START': return s.step === 'intro' && s.safe && (!requiresNotCharging || s.notCharging)
        ? to({step:e.camera?'locate':'check',mode:e.camera?'camera':'manual',record:result.start(s.taskId,ctx)}) : s;
      case 'NOTE_AIDS': return s.record && ['locate','check'].includes(s.step) ? to({record:result.noteAids(s.record,e)}) : s;
      case 'TO_CHECK': return s.step === 'locate' ? to({step:'check',mode:e.manual?'manual':s.mode}) : s;
      case 'ANSWER':
        if (s.step !== 'check' || e.checkId !== checks[s.index].id || !isAnswer(e.answer)) return s;
        return to({record:result.answer(s.record,e.checkId,e.answer),
          ...(stopOnFinding && e.answer === 'FOUND' ? {mode:'manual',observationStopped:true} : {})});
      case 'STOP_OBSERVATION': return (requiresNotCharging || stopOnFinding) && ['locate','check'].includes(s.step)
        ? to({step:'check',mode:'manual',observationStopped:true}) : s;
      case 'NEXT': return s.step === 'check' && e.index === s.index && isAnswer(s.record.responses[checks[s.index].id])
        ? to(s.index < checks.length-1 ? {index:s.index+1} : {step:'review'}) : s;
      case 'CONFIRM': return s.step === 'review' ? to({step:'done',record:result.complete(s.record,ctx)}) : s;
      case 'BACK':
        if (s.step === 'review') return to({step:'check',index:checks.length-1});
        if (s.step === 'check' && s.index > 0) return to({index:s.index-1});
        if (s.step === 'check' && s.mode === 'camera') return to({step:'locate'});
        return ['check','locate'].includes(s.step) ? initial(s.taskId) : s;
      case 'CANCEL': return ['intro','done'].includes(s.step) ? s : initial(s.taskId);
      case 'RESTART': return s.step === 'done' ? initial(s.taskId) : s;
      default: return s;
    }
  }
  return Object.freeze({initial,reduce});
}

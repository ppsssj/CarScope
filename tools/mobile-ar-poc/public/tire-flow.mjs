import {isTireTask} from './inspection-tasks.mjs';
import {TIRE_CHECKS,tireResult} from './tire-result.mjs';
import {createChecklistFlow} from './checklist-flow.mjs';
export const tireFlow=createChecklistFlow({matchesTask:isTireTask,checks:TIRE_CHECKS,result:tireResult});
export const {initial:initialTireState,reduce:reduceTire}=tireFlow;

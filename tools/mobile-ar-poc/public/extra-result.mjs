import {EXTRA_TASKS,extraTask} from './extra-tasks.mjs';
import {createChecklistResult} from './checklist-result.mjs';
const results=new Map(EXTRA_TASKS.map(task=>[task.id,createChecklistResult({matchesTask:id=>id===task.id,checks:task.checks})]));
export function getExtraResult(id){const result=results.get(id);if(!result)throw Error('Unknown extra task');return result;}
export function validateExtraResult(record){const task=extraTask(record?.taskId);return task?getExtraResult(task.id).validate(record):['schema/task'];}

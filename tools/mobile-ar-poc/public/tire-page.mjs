// Compatibility adapters: preserve the existing tire-only entry contract.
import {isTireTask} from './inspection-tasks.mjs';
import {prepareChecklistPage,startChecklistPage} from './checklist-page.mjs';
export function prepareTirePage(taskId,options) {
  if(!isTireTask(taskId))throw Error('Unknown tire task');
  return prepareChecklistPage(taskId,options);
}
export function startTireInspectionPage(options) {
  if(!isTireTask(options?.handoff?.task))throw Error('Unknown tire task');
  return startChecklistPage(options);
}

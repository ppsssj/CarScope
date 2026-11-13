// Typed boundary around the existing, regression-tested JS domain. No DOM renderer imports.
import {
  initialState,
  reduce,
  CHECK_ITEMS,
  allChecked,
} from "../public/self-inspection.mjs";
import { getChecklistProfile } from "../public/checklist-profiles.mjs";
import {
  taskLinks,
  inspectionTask as lookupTask,
} from "../public/inspection-tasks.mjs";
export { CHECK_ITEMS, allChecked, taskLinks };
export function inspectionTask(id: string) {
  return lookupTask(id) as
    { id: string; label: string; position: string; kind?: string } | undefined;
}
export type Answer = "FOUND" | "NOT_FOUND" | "UNABLE";
export type Step =
  "intro" | "locate" | "check" | "result" | "confirm" | "review" | "done";
export interface RecordDTO {
  inspectionId: string;
  taskId: string;
  status?: string;
  state: string;
  completedAt?: string;
  responses?: Record<string, Answer>;
  [key: string]: unknown;
}
export interface FlowState {
  step: Step;
  safe?: boolean;
  notCharging?: boolean;
  mode: "camera" | "manual" | null;
  index?: number;
  record: RecordDTO | null;
  checks?: Record<string, boolean>;
  choice?: string;
  observationStopped?: boolean;
}
export interface FlowEvent {
  type: string;
  [key: string]: unknown;
}
export interface Profile {
  id: string;
  label: string;
  position: string;
  description: string;
  limitations: string;
  safetyText: string;
  safetyHelp: string;
  extraSafety?: string;
  requiresNotCharging?: boolean;
  supportsObservationStop?: boolean;
  stopAdvice?: string;
  locateHelp: string;
  followup: string;
  checks: { id: string; label: string; help: string }[];
  answers: Record<Answer, string>;
  flow: {
    initial: (id: string) => FlowState;
    reduce: (s: FlowState, e: FlowEvent) => FlowState;
  };
  result: { validate: (r: RecordDTO) => string[] };
}
export function flowFor(taskId: string) {
  const washer = taskId === "washer-fluid";
  const profile = washer
    ? null
    : (getChecklistProfile(taskId) as unknown as Profile);
  return {
    washer,
    profile,
    initial: () =>
      washer
        ? (initialState() as unknown as FlowState)
        : profile!.flow.initial(taskId),
    reduce: (state: FlowState, event: FlowEvent) =>
      washer
        ? (reduce as unknown as (s: FlowState, e: FlowEvent) => FlowState)(
            state,
            event,
          )
        : profile!.flow.reduce(state, event),
  };
}

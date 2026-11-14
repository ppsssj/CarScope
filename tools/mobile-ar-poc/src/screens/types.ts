import type { Ref } from "react";
import type { FlowEvent, FlowState, Profile } from "../domain";

export interface TaskCopy {
  points: readonly string[];
  limit: string;
  lead?: string;
  stop?: string;
  follow?: string;
}
export interface Guide {
  partId: string;
  title: string;
  role: string;
  area: string;
  identifyingFeatures: readonly string[];
  safetyNotes: readonly string[];
  detailImage?: { file: string; alt: string; caption: string } | null;
}
/** What every inspection screen gets. State and events are the existing reducers'. */
export interface StepProps {
  taskId: string;
  task: { id: string; label: string; position: string; kind?: string };
  washer: boolean;
  profile: Profile | null;
  state: FlowState;
  event: (e: FlowEvent) => void;
  copy: TaskCopy;
  guide: Guide | undefined;
  headingRef: Ref<HTMLHeadingElement>;
  /** Exit dialog open: camera and photo work must stop. */
  paused: boolean;
}

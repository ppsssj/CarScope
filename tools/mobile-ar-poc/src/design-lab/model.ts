import { taskLinks, inspectionTask } from "../../public/inspection-tasks.mjs";
import { getChecklistProfile } from "../../public/checklist-profiles.mjs";
export type Concept = "scope" | "atlas" | "logbook";
export type Stage = "explore" | "prepare" | "camera" | "analysis" | "delivery";
export type Kind =
  | "cap"
  | "reservoir"
  | "battery"
  | "fuse"
  | "wheel"
  | "lamp"
  | "wiper"
  | "port";
export type Observation = "FOUND" | "NOT_FOUND" | "UNABLE";
export interface Task {
  id: string;
  label: string;
  position: string;
  zone: string;
  kind: Kind;
  safety: string[];
  checks: string[];
  code: string;
}
export const tasks: Task[] = taskLinks().map((t, i) => {
  const task = inspectionTask(t.id) as { position: string };
  const kind: Kind = t.id.startsWith("tire.")
    ? "wheel"
    : t.id.startsWith("light-")
      ? "lamp"
      : t.id.startsWith("wiper.")
        ? "wiper"
        : t.id === "ev-charge.port"
          ? "port"
          : t.id === "battery-12v"
            ? "battery"
            : t.id === "fuse-box"
              ? "fuse"
              : t.id === "washer-fluid"
                ? "cap"
                : "reservoir";
  const profile =
    t.id === "washer-fluid"
      ? null
      : (getChecklistProfile(t.id) as unknown as {
          safetyText: string;
          safetyHelp: string;
          extraSafety?: string;
          checks: readonly { label: string }[];
        });
  return {
    id: t.id,
    label: t.label,
    position: task.position,
    kind,
    zone: ["cap", "reservoir", "battery", "fuse"].includes(kind)
      ? "보닛 안"
      : kind === "wheel"
        ? "네 바퀴"
        : kind === "port"
          ? "충전구"
          : "시야와 조명",
    code: `CS-${String(i + 1).padStart(2, "0")}`,
    safety: [
      profile?.safetyText ??
        "안전하게 정차하고 주차·전원 꺼짐·보닛 지지 상태를 확인합니다.",
      profile?.safetyHelp ??
        "캡을 열거나 뜨겁고 움직이는 부품에 접근하지 않습니다. 설명서와 캡의 워셔 표시를 대조합니다.",
      ...(profile?.extraSafety ? [profile.extraSafety] : []),
    ],
    checks: profile?.checks.map((c: { label: string }) => c.label) ?? [
      "설명서와 워셔 표시 대조",
      "보이는 상태 확인",
      "확인할 수 없는 범위 구분",
    ],
  };
});
export interface LabState {
  stage: Stage;
  taskId: string;
  plan: string[];
  safe: boolean;
  camera: "off" | "live" | "denied";
  captured: boolean;
  consent: boolean;
  ai: "idle" | "busy" | "result" | "failed";
  scenario: "finding" | "uncertain" | "failure";
  answers: Record<number, Observation>;
  ack: boolean;
  confirmed: boolean;
  delivery: "idle" | "sending" | "server" | "vehicle" | "failed";
  events: string[];
}
export const initial: LabState = {
  stage: "explore",
  taskId: "washer-fluid",
  plan: ["washer-fluid"],
  safe: false,
  camera: "off",
  captured: false,
  consent: false,
  ai: "idle",
  scenario: "finding",
  answers: {},
  ack: false,
  confirmed: false,
  delivery: "idle",
  events: [],
};
export type Event = {
  type: string;
  id?: string;
  value?: boolean | number | string;
};
export function reduce(s: LabState, e: Event): LabState {
  switch (e.type) {
    case "SELECT":
      return tasks.some((t) => t.id === e.id)
        ? {
            ...initial,
            taskId: e.id!,
            plan: s.plan.includes(e.id!) ? s.plan : [...s.plan, e.id!],
          }
        : s;
    case "PLAN":
      return tasks.some((t) => t.id === e.id)
        ? {
            ...s,
            plan: s.plan.includes(e.id!)
              ? s.plan.filter((id) => id !== e.id)
              : [...s.plan, e.id!],
          }
        : s;
    case "PREPARE":
      return s.stage === "explore" ? { ...s, stage: "prepare" } : s;
    case "SAFETY":
      return s.stage === "prepare" ? { ...s, safe: e.value === true } : s;
    case "START":
      return s.stage === "prepare" && s.safe
        ? { ...s, stage: "camera", camera: "off" }
        : s;
    case "CAMERA":
      return s.stage === "camera"
        ? {
            ...s,
            camera:
              e.value === "denied"
                ? "denied"
                : s.camera === "live"
                  ? "off"
                  : "live",
          }
        : s;
    case "CAPTURE":
      return s.stage === "camera"
        ? {
            ...s,
            stage: "analysis",
            camera: "off",
            captured: e.value !== false,
            consent: false,
          }
        : s;
    case "CONSENT":
      return s.stage === "analysis" && s.ai !== "busy"
        ? { ...s, consent: e.value === true }
        : s;
    case "SCENARIO":
      return ["finding", "uncertain", "failure"].includes(String(e.value))
        ? { ...s, scenario: e.value as LabState["scenario"] }
        : s;
    case "ANALYZE":
      return s.stage === "analysis" &&
        s.consent &&
        s.captured &&
        s.ai !== "busy"
        ? { ...s, ai: "busy", consent: false, ack: false }
        : s;
    case "AI_DONE":
      return s.ai === "busy"
        ? { ...s, ai: s.scenario === "failure" ? "failed" : "result" }
        : s;
    case "ACK":
      return s.stage === "analysis" ? { ...s, ack: e.value === true } : s;
    case "ANSWER":
      return s.stage === "analysis" &&
        ["FOUND", "NOT_FOUND", "UNABLE"].includes(String(e.value))
        ? {
            ...s,
            answers: { ...s.answers, [Number(e.id)]: e.value as Observation },
          }
        : s;
    case "CONFIRM":
      return s.stage === "analysis" &&
        s.ack &&
        tasks
          .find((t) => t.id === s.taskId)!
          .checks.every((_, i) => s.answers[i])
        ? {
            ...s,
            stage: "delivery",
            confirmed: true,
            events: ["사용자 보고 확정 · 모의 10:42"],
          }
        : s;
    case "SEND":
      return s.confirmed && ["idle", "failed"].includes(s.delivery)
        ? {
            ...s,
            delivery: "sending",
            events: [s.events[0], "모의 전송 요청 · 10:43"],
          }
        : s;
    case "SERVER":
      return s.delivery === "sending"
        ? {
            ...s,
            delivery: "server",
            events: [...s.events, "모의 서버 접수 · 10:43"],
          }
        : s;
    case "VEHICLE":
      return s.delivery === "server"
        ? {
            ...s,
            delivery: "vehicle",
            events: [...s.events, "모의 차량 앱 수신 · 10:44"],
          }
        : s;
    case "NETWORK_FAIL":
      return ["sending", "server"].includes(s.delivery)
        ? {
            ...s,
            delivery: "failed",
            events: [s.events[0], "모의 네트워크 장애 · 수신 확인 불가"],
          }
        : s;
    case "RETAKE":
      return s.stage === "analysis"
        ? {
            ...s,
            stage: "camera",
            camera: "off",
            consent: false,
            ai: "idle",
            ack: false,
            captured: false,
          }
        : s;
    case "RESET":
      return { ...initial, plan: s.plan };
    default:
      return s;
  }
}
export const taskOf = (s: LabState) => tasks.find((t) => t.id === s.taskId)!;
export const canConfirm = (s: LabState) =>
  s.ack && taskOf(s).checks.every((_, i) => s.answers[i]);

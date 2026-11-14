// What the AI photo aid may offer on this page, from the single capability table (part-capabilities.mjs) and the
// markers this page's own server put on <body>. Never "available" without a QR v2 connection and a server approval.
import {
  partCapabilities,
  partIdForTask,
  aiNote,
  PLAN,
  SUPPORT,
} from "../../public/part-capabilities.mjs";
import { analysisProfile, ANALYSIS_SERVICES } from "../../public/part-analysis.mjs";
import { detectionForTask } from "../../public/part-detection.mjs";
import { CAI_PLAN } from "../../public/camera-ai-flow.mjs";
import { transport } from "../session";

export interface AiOffer {
  partId: string;
  /** Camera flow plan, or null when the camera AI cannot run here. */
  plan: (typeof CAI_PLAN)[keyof typeof CAI_PLAN] | null;
  /** Plain sentence for why (or how) the AI is offered. */
  note: string;
  draft: boolean;
  /** Who analyses: "OpenAI", or the local MOCK label. */
  service: string;
  /** What the part is called in the AI copy, e.g. "워셔액 주입구". */
  partLabel: string;
  crop: object | undefined;
  positionNote: string | undefined;
}

type Capabilities = (
  partId: string,
  options: {
    taskId: string;
    host: {
      connected: boolean;
      detection: boolean;
      analysis: boolean;
      draftAnalysis: boolean;
    };
  },
) => ReturnType<typeof partCapabilities>;

export function aiOffer(taskId: string): AiOffer {
  const data = document.body.dataset;
  const partId = detectionForTask(taskId)?.partId ?? partIdForTask(taskId);
  const cap = (partCapabilities as unknown as Capabilities)(partId, {
    taskId,
    host: {
      connected: !!transport,
      detection: data.partDetection === "enabled",
      analysis: data.partAnalysis === "enabled",
      draftAnalysis: data.partAnalysisDraft === "enabled",
    },
  });
  const offered = cap.offered as string;
  const plan =
    offered === PLAN.DETECT_AND_ANALYZE
      ? CAI_PLAN.DETECT
      : offered === PLAN.MARK_AND_ANALYZE
        ? CAI_PLAN.MARK
        : null;
  const profile = analysisProfile(partId) as {
    label?: string;
    crop?: object;
    positionNote?: string;
  } | null;
  return {
    partId,
    plan,
    note: aiNote(cap),
    draft: cap.stage === SUPPORT.DRAFT,
    service:
      ANALYSIS_SERVICES[
        data.partAnalysisService as keyof typeof ANALYSIS_SERVICES
      ] ?? "외부 AI",
    partLabel: profile?.label ?? "부품",
    crop: profile?.crop,
    positionNote: profile?.positionNote,
  };
}

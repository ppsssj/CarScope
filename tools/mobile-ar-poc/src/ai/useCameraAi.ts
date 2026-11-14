// P21 camera AI assist: one captured frame → detector candidates → the person confirms (or drags) the part →
// automatic crop + analysis. Requests use the existing QR v2 transport (detectPart/analyzePart), the existing crop
// (cropWithContext) and the existing result contract (validateAnalysisResult). The reducer in camera-ai-flow.mjs is
// driven synchronously through a ref, so a double tap or a late answer can never start or apply a second request.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAI,
  CAPTURE_LIMITS,
  acceptCandidates,
  initialCameraAi,
  reduceCameraAi,
  scaledSize,
  uploadProblem,
} from "../../public/camera-ai-flow.mjs";
import { DETECTION_CONSENT } from "../../public/part-detection.mjs";
import {
  ANALYSIS_CONSENT,
  validateAnalysisResult,
} from "../../public/part-analysis.mjs";
import { cropWithContext } from "../../public/context-crop.mjs";
import { transport } from "../session";
import type { CameraControl } from "../Camera";
import type { AiOffer } from "./offer";
import type { Analysis } from "./AiResult";

export type CameraAiPhase = (typeof CAI)[keyof typeof CAI];
/** Mirror of camera-ai-flow.mjs state (a UI work state for the photo aid only). */
export interface CameraAiState {
  phase: CameraAiPhase;
  plan: string | null;
  attempt: number;
  live: boolean;
  consent: { detect: boolean; analyze: boolean };
  candidates: readonly { box: readonly number[]; score: number }[];
  selected: number;
  region: readonly number[] | null;
  regionSource: "AI_CANDIDATE" | "MANUAL" | null;
  code: string | null;
  result: Analysis | null;
  provenance: string | null;
  regionError: string | null;
}
type Event = { type: string; [key: string]: unknown };

const ANALYSIS_MAX_BYTES = 2 * 1024 * 1024; // the analysis route's own bound

const encode = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));

export function useCameraAi({
  camera,
  offer,
  paused,
}: {
  camera: CameraControl;
  offer: AiOffer;
  paused: boolean;
}) {
  const [state, setState] = useState<CameraAiState>(
    () => initialCameraAi(offer.plan, camera.live) as unknown as CameraAiState,
  );
  const ref = useRef(state),
    controller = useRef<AbortController | null>(null);
  /** The full-resolution still of the current capture: the crop source, never uploaded whole. */
  const [still, setStill] = useState<HTMLCanvasElement | null>(null);
  const [cropView, setCropView] = useState<HTMLCanvasElement | null>(null);
  const send = useCallback((e: Event): CameraAiState => {
    const next = reduceCameraAi(
      ref.current as never,
      e as never,
    ) as unknown as CameraAiState;
    if (next !== ref.current) {
      // A new attempt means whatever was in flight belongs to the past.
      if (next.attempt !== ref.current.attempt) {
        controller.current?.abort();
        controller.current = null;
      }
      ref.current = next;
      setState(next);
    }
    return next;
  }, []);

  useEffect(() => {
    send({ type: "CAMERA", live: camera.live });
  }, [camera.live, send]);
  // Exit dialog, hidden page, page leaving, unmount: nothing in flight may land afterwards.
  useEffect(() => {
    if (paused) send({ type: "CANCEL" });
  }, [paused, send]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) send({ type: "CANCEL" });
    };
    const leave = () => send({ type: "CANCEL" });
    document.addEventListener("visibilitychange", hide);
    addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      removeEventListener("pagehide", leave);
      controller.current?.abort();
      controller.current = null;
      ref.current = { ...ref.current, attempt: ref.current.attempt + 1 };
    };
  }, [send]);

  const current = (attempt: number) => ref.current.attempt === attempt;
  function fail(attempt: number, error: unknown) {
    send({
      type: "FAIL",
      attempt,
      code: error instanceof Error ? error.message : "UNAVAILABLE",
    });
  }

  async function capture() {
    const s = send({ type: "CAPTURE" });
    if (s.phase !== CAI.CAPTURING) return;
    const attempt = s.attempt;
    setCropView(null);
    const frame = camera.captureFrame(CAPTURE_LIMITS.cropSourceMaxSide);
    if ("error" in frame) return fail(attempt, new Error(frame.error));
    setStill(frame.canvas);
    if (send({ type: "CAPTURED", attempt }).phase !== CAI.DETECTING) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      // The detector gets a smaller copy of the same frame; its fractions are the still's fractions.
      const size = scaledSize(
        frame.canvas.width,
        frame.canvas.height,
        CAPTURE_LIMITS.detectMaxSide,
      );
      const small = document.createElement("canvas");
      small.width = size.width;
      small.height = size.height;
      small.getContext("2d")!.drawImage(frame.canvas, 0, 0, size.width, size.height);
      const blob = await encode(small, 0.85);
      const problem = uploadProblem(blob, CAPTURE_LIMITS.detectMaxBytes);
      if (problem) throw new Error(problem);
      if (!current(attempt) || ctrl.signal.aborted) return;
      const answer = await transport!.detectPart(offer.partId, blob!, {
        consent: DETECTION_CONSENT,
        signal: ctrl.signal,
      });
      if (!current(attempt)) return;
      if (!answer.ok) throw new Error(answer.code ?? "UNAVAILABLE");
      send({
        type: "DETECTED",
        attempt,
        candidates: acceptCandidates(answer.candidates),
      });
    } catch (error) {
      if (current(attempt)) fail(attempt, error);
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  /** Runs once per confirmation: crop the confirmed region from the still, then the analysis request. */
  async function analyze(attempt: number) {
    const s = ref.current;
    const box = s.region,
      regionSource = s.regionSource;
    if (!still || !box || !regionSource) return fail(attempt, new Error("UNAVAILABLE"));
    send({ type: "CROP_START", attempt });
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const crop = await cropWithContext(still, [...box], offer.crop ?? {});
      if (!current(attempt) || ctrl.signal.aborted) return;
      const problem = uploadProblem(crop.blob, ANALYSIS_MAX_BYTES);
      if (problem) throw new Error(problem);
      setCropView(crop.canvas);
      send({ type: "CROPPED", attempt });
      const a = await transport!.analyzePart(offer.partId, crop.blob!, {
        consent: ANALYSIS_CONSENT,
        targetInCrop: crop.plan.targetInCrop,
        regionSource,
        signal: ctrl.signal,
      });
      if (!current(attempt)) return;
      if (!a.ok) throw new Error(a.code ?? "UNAVAILABLE");
      const checked = validateAnalysisResult(offer.partId, a.result) as {
        ok: boolean;
        result?: Analysis;
      };
      if (!checked.ok || !checked.result) throw new Error("INVALID_RESPONSE");
      send({
        type: "ANALYZED",
        attempt,
        result: checked.result,
        provenance:
          a.analysis?.provider === "mock" ? "로컬 시험용 MOCK" : offer.service,
      });
    } catch (error) {
      if (current(attempt)) fail(attempt, error);
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  /** "이 부품이 맞아요" / "이 영역이 맞아요": the only way an analysis starts, with no further tap. */
  function confirm() {
    const s = send({ type: "CONFIRM" });
    if (s.phase === CAI.CONFIRMING_PART) void analyze(s.attempt);
  }
  function retryAnalysis() {
    const s = send({ type: "RETRY_ANALYSIS" });
    if (s.phase === CAI.CONFIRMING_PART) void analyze(s.attempt);
  }
  function reset() {
    send({ type: "RESET" });
    setStill(null);
    setCropView(null);
  }
  return {
    state,
    still,
    cropView,
    capture,
    confirm,
    retryAnalysis,
    reset,
    cancel: () => send({ type: "CANCEL" }),
    consent: (kind: "detect" | "analyze", value: boolean) =>
      send({ type: "CONSENT", kind, value }),
    select: (index: number) => send({ type: "SELECT", index }),
    manual: () => send({ type: "MANUAL" }),
    region: (box: readonly number[] | null, error?: string) =>
      send({ type: "REGION", box, error }),
  };
}
export type CameraAi = ReturnType<typeof useCameraAi>;

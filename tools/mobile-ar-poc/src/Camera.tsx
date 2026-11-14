// Real camera aid. The existing CameraSession, colour-candidate detector and
// 2D coordinate/marker helpers do the work; this file only presents them in
// the P19 viewfinder. The camera never starts without an explicit tap.
import { useEffect, useRef, useState } from "react";
import { CameraSession, cameraError } from "../public/camera.mjs";
import { detectCandidates, containRect } from "../public/detector.mjs";
import {
  tapToVideoPoint,
  videoPointToStage,
  drawMarker,
} from "../public/marker.mjs";
import { captureProblem, scaledSize } from "../public/camera-ai-flow.mjs";
import type { FlowEvent } from "./domain";

/** View status of the CameraSession (presentation only, not a domain state). */
export type CameraStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "unsupported"
  | "failed";

export const CANDIDATE_LABEL = "색 후보 · 미검증";

export function useCamera(dispatch: (e: FlowEvent) => void, taskId: string) {
  const video = useRef<HTMLVideoElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    session = useRef<CameraSession | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle"),
    [message, setMessage] = useState("카메라는 직접 켤 때만 시작해요."),
    [mark, setMark] = useState<{ x: number; y: number } | null>(null),
    [candidateCount, setCandidateCount] = useState(0);
  const detects = taskId === "washer-fluid";
  const live = status === "live";
  const liveNow = useRef(false);
  liveNow.current = live;

  useEffect(() => {
    const cam = new CameraSession(video.current, navigator.mediaDevices, () => {
      setStatus("idle");
      setMark(null);
      setMessage("카메라 연결이 끝났어요. 다시 켜거나 카메라 없이 계속해요.");
    });
    session.current = cam;
    const stop = () => {
      cam.stop();
      setStatus((s) => (s === "live" || s === "requesting" ? "idle" : s));
      setMark(null);
      setMessage("카메라를 껐어요. 다시 켤 수 있어요.");
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      cam.stop();
      session.current = null;
      removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  // Candidate boxes and the user's mark, re-projected through the same
  // contain rectangle the helpers use for taps.
  useEffect(() => {
    if (!live) return;
    const frame = document.createElement("canvas"),
      ctx = frame.getContext("2d", { willReadFrequently: true })!;
    const timer = setInterval(() => {
      const v = video.current,
        c = overlay.current;
      if (!v?.videoWidth || !c) return;
      const rect = c.getBoundingClientRect(),
        dpr = devicePixelRatio || 1;
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      const paint = c.getContext("2d")!,
        r = containRect(v.videoWidth, v.videoHeight, c.width, c.height);
      if (detects) {
        const scale = Math.min(320 / v.videoWidth, 240 / v.videoHeight, 1);
        frame.width = Math.max(1, Math.round(v.videoWidth * scale));
        frame.height = Math.max(1, Math.round(v.videoHeight * scale));
        ctx.drawImage(v, 0, 0, frame.width, frame.height);
        const boxes = detectCandidates(
          ctx.getImageData(0, 0, frame.width, frame.height),
        );
        setCandidateCount(boxes.length);
        paint.font = `600 ${13 * dpr}px system-ui, sans-serif`;
        for (const box of boxes) {
          const x = r.x + box.x * r.width,
            y = r.y + box.y * r.height;
          paint.save();
          paint.strokeStyle = "rgba(255,255,255,0.92)";
          paint.lineWidth = 2 * dpr;
          paint.setLineDash([6 * dpr, 4 * dpr]);
          paint.strokeRect(x, y, box.width * r.width, box.height * r.height);
          paint.setLineDash([]);
          const w = paint.measureText(CANDIDATE_LABEL).width + 14 * dpr,
            h = 22 * dpr,
            bottom = y + box.height * r.height,
            // Below the box: the user's mark draws its own label above
            // the point, so the two labels never cover each other.
            ly =
              bottom + h + 4 * dpr > c.height
                ? bottom - h - 4 * dpr
                : bottom + 4 * dpr;
          paint.fillStyle = "rgba(24,28,33,0.82)";
          paint.fillRect(x, ly, w, h);
          paint.fillStyle = "#ffffff";
          paint.fillText(CANDIDATE_LABEL, x + 7 * dpr, ly + 15.5 * dpr);
          paint.restore();
        }
      }
      if (mark)
        drawMarker(
          paint,
          videoPointToStage(
            mark,
            v.videoWidth,
            v.videoHeight,
            c.width,
            c.height,
          ),
          dpr,
        );
    }, 200);
    return () => clearInterval(timer);
  }, [live, mark, detects]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setMessage("이 브라우저에서는 카메라를 쓸 수 없어요.");
      return;
    }
    setStatus("requesting");
    setMessage("카메라 권한을 기다리고 있어요.");
    try {
      if (await session.current?.start()) {
        setStatus("live");
        dispatch({ type: "NOTE_AIDS", cameraUsed: true });
        setMessage(
          detects
            ? "부품을 화면 가운데에 맞춰 주세요. 위치 표시는 직접 지정해요."
            : "부품을 화면 가운데에 맞춰 주세요. 자동으로 찾지 않아요.",
        );
      }
    } catch (error) {
      setStatus(
        (error as Error)?.name === "NotAllowedError" ? "denied" : "failed",
      );
      setMessage(cameraError(error));
    }
  }
  function stop() {
    session.current?.stop();
    setStatus("idle");
    setMark(null);
    setMessage("카메라를 껐어요. 다시 켤 수 있어요.");
  }
  /**
   * P21: one still frame of the live picture, at most `maxSide` on its long side, as an upright canvas (video frames
   * are already orientation-corrected by the browser; a canvas carries no EXIF). Refused unless the picture is live
   * right now, so a capture can never come from a camera that was just stopped.
   */
  function captureFrame(
    maxSide: number,
  ): { canvas: HTMLCanvasElement } | { error: string } {
    const v = video.current;
    if (!liveNow.current || !v || !v.srcObject) return { error: "CAMERA_OFF" };
    const problem = captureProblem(v.videoWidth, v.videoHeight);
    if (problem) return { error: problem };
    const size = scaledSize(v.videoWidth, v.videoHeight, maxSide);
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return { canvas: c };
  }
  function place(point: { x: number; y: number } | null) {
    setMark(point);
    if (point) dispatch({ type: "NOTE_AIDS", locationMarked: true });
  }
  /** Announced status (changes only on user actions or permission results). */
  const statusLine = live && mark
    ? "직접 표시 1곳 · 자동 인식 결과가 아니에요."
    : message;
  /** Quiet caption for the colour candidates; updates with the picture, so not a live region. */
  const detail =
    live && detects
      ? `${CANDIDATE_LABEL.split(" · ")[0]} ${candidateCount}곳 · 색만 본 표시라 정확하지 않아요. 앞유리·물줄기 모양 표시를 직접 확인해 주세요.`
      : live
        ? "2D 보조예요. 자동 인식이나 공간 추적이 아니에요."
        : "";
  return {
    video,
    overlay,
    status,
    statusLine,
    detail,
    mark,
    live,
    start,
    stop,
    place,
    captureFrame,
  };
}
export type CameraControl = ReturnType<typeof useCamera>;

/**
 * The viewfinder. The video is the centre of the screen; the tap surface and
 * the in-picture controls are siblings (no nested interactive roles).
 * `inlineStart` adds a start chip for the observation step, where the bottom
 * CTA belongs to the checklist instead of the camera.
 */
export function CameraView({
  camera,
  label,
  inlineStart = false,
  hidden = false,
}: {
  camera: CameraControl;
  label: string;
  inlineStart?: boolean;
  /** Kept mounted (the session owns this <video>) but not shown, e.g. while a captured still is on screen. */
  hidden?: boolean;
}) {
  const { video, overlay, status, live, mark } = camera;
  const blocked =
    status === "denied" || status === "unsupported" || status === "failed";
  return (
    <section className="cb-camera" aria-label="카메라 보조" hidden={hidden}>
      <div
        className="cb-viewfinder"
        data-picture={live ? "on" : blocked ? "blocked" : "off"}
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label={`${label} 카메라`}
        />
        {live && (
          <>
            <span className="cb-corners" aria-hidden="true" />
            <canvas
              className="cb-camera-overlay"
              ref={overlay}
              role="button"
              tabIndex={0}
              aria-label={
                mark
                  ? "카메라 화면. 누르면 표시를 옮겨요"
                  : "카메라 화면. 누르면 그 위치를 직접 표시해요"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  camera.place({ x: 0.5, y: 0.5 });
                }
              }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect(),
                  v = video.current!;
                const point = tapToVideoPoint(
                  e.clientX - r.left,
                  e.clientY - r.top,
                  v.videoWidth,
                  v.videoHeight,
                  r.width,
                  r.height,
                );
                if (point) camera.place(point);
              }}
            />
            <span className="cb-finder-chip" aria-hidden="true">
              실시간 카메라 · 2D 보조
            </span>
            <div className="cb-finder-controls">
              <button
                type="button"
                className="cb-chip cb-chip-dark"
                onClick={() => camera.place(mark ? null : { x: 0.5, y: 0.5 })}
              >
                {mark ? "표시 지우기" : "가운데에 표시"}
              </button>
              <button
                type="button"
                className="cb-chip cb-chip-dark"
                onClick={camera.stop}
              >
                카메라 끄기
              </button>
            </div>
          </>
        )}
        {!live && (
          <div className="cb-finder-empty">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
              <path
                d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="13"
                r="3.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              {blocked && (
                <path
                  d="M4 4l16 16"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
            <p>
              {status === "requesting"
                ? "권한 창에서 ‘허용’을 눌러 주세요"
                : blocked
                  ? "카메라 화면 없이 진행해요"
                  : "카메라를 켜면 여기에 보여요"}
            </p>
            {inlineStart && !blocked && (
              <button
                type="button"
                className="cb-chip"
                disabled={status === "requesting"}
                onClick={() => void camera.start()}
              >
                카메라 켜기
              </button>
            )}
          </div>
        )}
      </div>
      <p role="status" className="cb-camera-status">
        {camera.statusLine}
      </p>
      {camera.detail && <p className="cb-caption">{camera.detail}</p>}
    </section>
  );
}

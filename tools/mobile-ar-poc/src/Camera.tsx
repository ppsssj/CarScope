import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CameraSession, cameraError } from "../public/camera.mjs";
import { detectCandidates, containRect } from "../public/detector.mjs";
import {
  tapToVideoPoint,
  videoPointToStage,
  drawMarker,
} from "../public/marker.mjs";
import type { FlowEvent } from "./domain";
export function Camera({
  dispatch,
  label,
  taskId,
}: {
  dispatch: (e: FlowEvent) => void;
  label: string;
  taskId: string;
}) {
  const video = useRef<HTMLVideoElement>(null),
    session = useRef<CameraSession | null>(null);
  const [message, setMessage] = useState("카메라는 직접 켜야 시작됩니다."),
    [live, setLive] = useState(false),
    [mark, setMark] = useState<{ x: number; y: number } | null>(null),
    [candidateCount, setCandidateCount] = useState(0);
  const overlay = useRef<HTMLCanvasElement>(null);
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
      if (taskId === "washer-fluid") {
        const scale = Math.min(320 / v.videoWidth, 240 / v.videoHeight, 1);
        frame.width = Math.max(1, Math.round(v.videoWidth * scale));
        frame.height = Math.max(1, Math.round(v.videoHeight * scale));
        ctx.drawImage(v, 0, 0, frame.width, frame.height);
        const boxes = detectCandidates(
          ctx.getImageData(0, 0, frame.width, frame.height),
        );
        setCandidateCount(boxes.length);
        paint.strokeStyle = "#ffe9a0";
        paint.lineWidth = 2 * dpr;
        paint.setLineDash([6 * dpr, 4 * dpr]);
        for (const box of boxes)
          paint.strokeRect(
            r.x + box.x * r.width,
            r.y + box.y * r.height,
            box.width * r.width,
            box.height * r.height,
          );
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
  }, [live, mark, taskId]);
  useEffect(() => {
    const cam = new CameraSession(video.current, navigator.mediaDevices, () => {
      setLive(false);
      setMessage("카메라 연결이 끝났습니다. 다시 켜거나 수동으로 계속하세요.");
    });
    session.current = cam;
    const stop = () => {
      cam.stop();
      setLive(false);
      setMessage("카메라를 껐습니다. 다시 켤 수 있습니다.");
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
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "이 환경은 카메라를 지원하지 않습니다. 수동으로 계속할 수 있습니다.",
      );
      return;
    }
    setMessage("카메라 권한을 확인하고 있습니다…");
    try {
      if (await session.current?.start()) {
        setLive(true);
        dispatch({ type: "NOTE_AIDS", cameraUsed: true });
        setMessage(
          "선택한 부품을 화면 가운데 맞추세요. 위치 표시는 사용자가 직접 지정합니다.",
        );
      }
    } catch (error) {
      setLive(false);
      setMessage(cameraError(error));
    }
  }
  return (
    <section className="camera-panel" aria-label="카메라 보조">
      <div className="viewfinder">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label={`${label} 카메라`}
        />
        {live && (
          <canvas
            className="camera-overlay"
            ref={overlay}
            aria-label="카메라 화면에서 위치 직접 지정"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMark({ x: 0.5, y: 0.5 });
                dispatch({ type: "NOTE_AIDS", locationMarked: true });
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
              if (point) {
                setMark(point);
                dispatch({ type: "NOTE_AIDS", locationMarked: true });
              }
            }}
          />
        )}
        {!live && (
          <div className="camera-placeholder">
            <span aria-hidden="true">◎</span>
            <p>직접 보고, 직접 확인해요</p>
          </div>
        )}
        {live && <div className="reticle" aria-hidden="true" />}
      </div>
      <p role="status">{message}</p>
      <div className="button-row">
        <Button
          label={live ? "카메라 끄기" : "카메라 켜기"}
          onClick={() => {
            if (live) {
              session.current?.stop();
              setLive(false);
              setMessage("카메라를 껐습니다.");
            } else void start();
          }}
        />
        {live && (
          <Button
            label={mark ? "위치 표시 지우기" : "가운데 위치 직접 지정"}
            onClick={() => {
              setMark(mark ? null : { x: 0.5, y: 0.5 });
              if (!mark) dispatch({ type: "NOTE_AIDS", locationMarked: true });
            }}
          />
        )}
      </div>
      {live && taskId === "washer-fluid" && (
        <p className="fine">
          파란색 후보 {candidateCount}개 · 색상만 보는 미검증 표시입니다. 워셔
          표시를 직접 확인하세요. 화면을 탭해 위치를 지정할 수 있습니다.
        </p>
      )}
      <p className="fine">2D 수동 보조 · 자동 인식이나 공간 추적이 아닙니다.</p>
    </section>
  );
}

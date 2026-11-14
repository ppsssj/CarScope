import { lazy, Suspense, useEffect, useMemo } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CameraView, useCamera, type CameraStatus } from "../Camera";
import { Dock, Heading, Section, Rows, Bullets, TextAction } from "../ui/kit";
import type { StepProps } from "./types";
import { aiOffer } from "../ai/offer";
import { useCameraAi } from "../ai/useCameraAi";
import { CAI } from "../../public/camera-ai-flow.mjs";
import {
  CameraAiStage,
  aiHeading,
  cameraAiActions,
} from "../ai/CameraAiPanel";

const PhotoAnalysis = lazy(() =>
  import("../PhotoAnalysis").then((m) => ({ default: m.PhotoAnalysis })),
);

const TITLE: Record<CameraStatus, (label: string) => string> = {
  idle: (l) => `카메라로 ${l} 위치를 찾아볼게요`,
  requesting: () => "카메라 사용을 허용해 주세요",
  live: () => "찾으면 화면을 눌러 표시해 주세요",
  denied: () => "카메라 없이도 점검할 수 있어요",
  unsupported: () => "카메라 없이 계속 점검할 수 있어요",
  failed: () => "카메라를 켜지 못했어요",
};

/** Step 2: the real camera screen (P19 layout on the existing CameraSession). */
export function Locate(p: StepProps) {
  const { task, taskId, washer, profile, event, copy, guide, paused } = p;
  const camera = useCamera(p.event, taskId);
  const { status, mark } = camera;
  // P21: the camera AI assist runs only where the capability table, the QR v2 connection and this server allow it.
  const offer = useMemo(() => aiOffer(taskId), [taskId]);
  const aiMode = offer.plan !== null;
  const ai = useCameraAi({ camera, offer, paused });
  const aiHead = aiMode ? aiHeading(ai, offer) : null;
  const stillShown =
    aiMode &&
    !!ai.still &&
    ai.state.phase !== CAI.IDLE &&
    ai.state.phase !== CAI.CAMERA_READY;
  // The exit dialog stops the camera, like leaving the page.
  useEffect(() => {
    if (paused && (status === "live" || status === "requesting")) camera.stop();
  }, [paused, status, camera]);
  const locateHelp =
    profile?.locateHelp ??
    "색만 보고 고르지 말고, 설명서와 캡의 표시를 직접 대조해 주세요.";
  const body =
    status === "idle"
      ? `찾아볼 곳 · ${guide?.area ?? task.label}. 실제 자리는 차마다 달라요.`
      : status === "requesting"
        ? "브라우저 권한 창에서 ‘허용’을 누르면 화면이 켜져요."
        : status === "live"
          ? mark
            ? "표시는 내가 지정한 위치예요. 다시 누르면 옮길 수 있어요."
            : locateHelp
          : status === "denied"
            ? "카메라 권한이 꺼져 있어요. 눈으로 직접 보고 다음 단계로 가면 돼요."
            : status === "unsupported"
              ? "이 브라우저는 카메라를 지원하지 않아요. 눈으로 직접 보고 답하면 돼요."
              : "다시 시도하거나, 눈으로 직접 보고 다음 단계로 가면 돼요.";
  const manual = () => event({ type: "TO_CHECK", manual: true });
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow="2단계 · 위치 찾기"
        title={
          aiHead?.title ??
          (status === "live" && mark
            ? "표시한 곳이 맞는지 직접 확인해 주세요"
            : TITLE[status](task.label))
        }
        body={aiHead?.body ?? body}
      />
      <CameraView camera={camera} label={task.label} hidden={stillShown} />
      {aiMode && <CameraAiStage ai={ai} offer={offer} />}
      {washer && (
        <TextAction
          label="부품을 확인할 수 없음"
          onClick={() => event({ type: "CANNOT_CONFIRM" })}
        />
      )}
      {status === "denied" && (
        <Section id="permission-title" title="카메라를 다시 쓰려면">
          <ol className="cb-steps">
            <li>주소창 옆의 사이트 정보 아이콘을 눌러요.</li>
            <li>카메라를 ‘허용’으로 바꿔요.</li>
            <li>이 화면으로 돌아와 ‘권한 다시 요청하기’를 눌러요.</li>
          </ol>
        </Section>
      )}
      {guide && (
        <Section id="looks-title" title="이런 점을 확인해 주세요">
          <Rows items={guide.identifyingFeatures.map((t) => ({ title: t }))} />
          <p className="cb-caption">{task.position}</p>
        </Section>
      )}
      {aiMode ? (
        // The camera flow is the main path; a saved photo stays available as an alternative.
        <details className="cb-disclosure cb-photo-section">
          <summary>갤러리 사진으로 대신 살펴보기</summary>
          <Suspense fallback={<p role="status">사진 보조를 준비하고 있어요.</p>}>
            {!paused && <PhotoAnalysis taskId={taskId} />}
          </Suspense>
        </details>
      ) : (
        <Section
          id="photo-title"
          title="사진으로 한 번 더 살펴보기"
          className="cb-photo-section"
        >
          <Suspense fallback={<p role="status">사진 보조를 준비하고 있어요.</p>}>
            {!paused && <PhotoAnalysis taskId={taskId} />}
          </Suspense>
        </Section>
      )}
      <Section id="locate-safety" title="살펴보는 동안" tone="quiet">
        <Bullets items={[...copy.points, ...(copy.stop ? [copy.stop] : [])]} />
      </Section>
      {aiMode ? (
        <AiDock
          actions={cameraAiActions(ai, offer, status, {
            toCheck: () =>
              event(camera.live ? { type: "TO_CHECK" } : { type: "TO_CHECK", manual: true }),
            startCamera: () => void camera.start(),
            manual,
          })}
        />
      ) : (
        <Dock>
          {status === "live" ? (
            <Button
              label="위치 확인 후 관찰하기"
              variant="primary"
              size="lg"
              width="100%"
              onClick={() => event({ type: "TO_CHECK" })}
            />
          ) : status === "idle" || status === "requesting" ? (
            <Button
              label="카메라 켜기"
              variant="primary"
              size="lg"
              width="100%"
              isLoading={status === "requesting"}
              onClick={() => void camera.start()}
            />
          ) : (
            <Button
              label="카메라 없이 계속하기"
              variant="primary"
              size="lg"
              width="100%"
              onClick={manual}
            />
          )}
          {(status === "live" ||
            status === "idle" ||
            status === "requesting") && (
            // Stays enabled while the permission prompt is open: leaving must
            // never wait on the browser (the session discards a late stream).
            <Button
              label="카메라 없이 계속하기"
              variant="ghost"
              size="lg"
              width="100%"
              onClick={manual}
            />
          )}
          {(status === "denied" || status === "failed") && (
            <Button
              label={status === "denied" ? "권한 다시 요청하기" : "다시 시도하기"}
              variant="ghost"
              size="lg"
              width="100%"
              onClick={() => void camera.start()}
            />
          )}
        </Dock>
      )}
    </>
  );
}

function AiDock({
  actions,
}: {
  actions: ReturnType<typeof cameraAiActions>;
}) {
  const { primary, secondary, hint } = actions;
  return (
    <Dock>
      {primary && (
        <Button
          label={primary.label}
          variant="primary"
          size="lg"
          width="100%"
          isLoading={primary.loading}
          isDisabled={primary.disabled}
          onClick={primary.onClick}
        />
      )}
      {secondary && (
        <Button
          label={secondary.label}
          variant="ghost"
          size="lg"
          width="100%"
          onClick={secondary.onClick}
        />
      )}
      {hint && <p className="cb-dock-hint">{hint}</p>}
    </Dock>
  );
}

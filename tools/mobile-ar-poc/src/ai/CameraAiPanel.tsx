// Screens of the P21 camera AI assist, in the 차보담 (P19/P20) language: one primary action per state,
// consent before anything leaves the phone, AI output labelled as unconfirmed reference.
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { CAI, CAI_PLAN, canCapture, BUSY } from "../../public/camera-ai-flow.mjs";
import { Section } from "../ui/kit";
import type { CameraStatus } from "../Camera";
import { AiResult } from "./AiResult";
import { RegionSelector, regionErrorText } from "./RegionSelector";
import type { AiOffer } from "./offer";
import type { CameraAi } from "./useCameraAi";

const ERRORS: Record<string, string> = {
  BUDGET_EXHAUSTED: "AI 사용 한도에 도달했어요. 직접 점검은 계속할 수 있어요.",
  RATE_LIMITED: "요청이 많아요. 잠시 후 다시 시도해 주세요.",
  BUSY: "이미 분석 중인 사진이 있어요. 잠시 후 다시 시도해 주세요.",
  IN_PROGRESS: "이미 분석 중인 사진이 있어요. 잠시 후 다시 시도해 주세요.",
  NOT_CONNECTED: "차량 연결을 확인할 수 없어요. 새 QR이 필요할 수 있어요.",
  INVALID_RESPONSE: "AI 응답이 약속된 형식과 맞지 않아 보여 주지 않았어요.",
  TOO_LARGE: "사진이 너무 커서 보내지 않았어요. 다시 촬영해 주세요.",
  UNREADABLE: "사진을 읽지 못했어요. 다시 촬영해 주세요.",
  CAMERA_OFF: "카메라 화면을 가져오지 못했어요. 카메라를 켠 뒤 다시 시도해 주세요.",
  NO_VIDEO_FRAME: "카메라 화면을 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  FRAME_TOO_SMALL: "카메라 화면이 너무 작아 보낼 수 없어요.",
};
const errorText = (code: string | null) =>
  (code && ERRORS[code]) ??
  (code?.startsWith("CROP_")
    ? "사진을 자르지 못했어요. 다시 촬영해 주세요."
    : "AI 요청을 마치지 못했어요. 다시 촬영하거나 직접 점검해 주세요.");

/** Title and one supporting line for the locate step while the AI assist is offered. */
export function aiHeading(
  ai: CameraAi,
  offer: AiOffer,
): { title: string; body: string } | null {
  const s = ai.state;
  const detect = offer.plan === CAI_PLAN.DETECT;
  switch (s.phase) {
    case CAI.CAMERA_READY:
      return detect
        ? {
            title: "부품을 화면에 담고 AI로 찾아볼게요",
            body: "사진 한 장만 찍어 AI가 부품 후보를 찾아요. 영상은 보내지 않아요.",
          }
        : {
            title: "부품을 화면에 담고 사진을 찍어 주세요",
            body: "이 부품은 AI가 자동으로 찾지 않아요. 찍은 사진에서 부품 영역을 직접 지정해요.",
          };
    case CAI.CAPTURING:
    case CAI.DETECTING:
      return { title: "AI가 부품을 찾고 있어요", body: "찍은 사진 한 장만 살펴봐요." };
    case CAI.CANDIDATE_FOUND:
      return {
        title: `${offer.partLabel} 후보를 찾았어요`,
        body: "확정되지 않은 후보예요. 표시한 곳이 맞는지 직접 확인해 주세요.",
      };
    case CAI.NONE_FOUND:
      return {
        title: "부품 후보를 찾지 못했어요",
        body: "같은 사진에서 부품 영역을 직접 지정할 수 있어요.",
      };
    case CAI.MANUAL_REGION:
      return {
        title: "사진에서 부품 영역을 끌어서 지정해 주세요",
        body: "부품 전체를 감싸도록 끌면 돼요. 작은 부품도 큰 부품도 원하는 크기로 지정할 수 있어요.",
      };
    case CAI.CONFIRMING_PART:
    case CAI.CROPPING:
    case CAI.ANALYZING:
      return {
        title: "AI가 사진을 살펴보고 있어요",
        body: "확인한 부분만 잘라서 보냈어요. 원본 전체는 보내지 않아요.",
      };
    case CAI.RESULT:
      return {
        title: "AI가 살펴본 결과를 확인해 주세요",
        body: "참고 정보예요. 점검 응답은 다음 단계에서 직접 골라 주세요.",
      };
    case CAI.ERROR:
      return { title: "AI 분석을 마치지 못했어요", body: errorText(s.code) };
    case CAI.CANCELLED:
      return {
        title: "AI 요청을 취소했어요",
        body: "보낸 요청의 결과는 표시하지 않아요. 다시 촬영하거나 직접 점검해 주세요.",
      };
    default:
      return null;
  }
}

/** Shows the still (candidates, dragged region), the crop sent, the result; and the consents before a capture. */
export function CameraAiStage({ ai, offer }: { ai: CameraAi; offer: AiOffer }) {
  const s = ai.state;
  const [ack, setAck] = useState(false);
  const detect = offer.plan === CAI_PLAN.DETECT;
  const before = s.phase === CAI.IDLE || s.phase === CAI.CAMERA_READY;
  const busy = (BUSY as readonly string[]).includes(s.phase);
  // From confirmation on, the crop that was sent replaces the full still, and the findings come first.
  const analysing =
    s.phase === CAI.CONFIRMING_PART ||
    s.phase === CAI.CROPPING ||
    s.phase === CAI.ANALYZING;
  return (
    <div className="cb-cai" data-ai-phase={s.phase}>
      {before && (
        <Section id="cai-consent" title="AI 사진 보조 · 실험" className="cb-cai-consent">
          <p className="cb-body-sm">
            AI는 부품 위치와 겉모습만 참고로 알려 줘요. 정상·안전을 판정하지 않고,
            점검 응답은 직접 골라야 해요.
            {offer.draft && " 시험 단계라 실제 사진으로 정확도를 확인하지 않았어요."}
          </p>
          {offer.positionNote && <p className="cb-note">{offer.positionNote}</p>}
          <div className="cb-checks">
            {detect && (
              <CheckboxInput
                label="축소한 사진 한 장을 Roboflow 부품 탐지 서비스로 보내는 데 동의해요"
                description="사람이나 번호판이 보이지 않게 찍어 주세요. 다른 부품을 잘못 표시할 수 있어요."
                value={s.consent.detect}
                onChange={(v) => ai.consent("detect", v)}
              />
            )}
            <CheckboxInput
              label={`내가 확인한 부품 부분만 잘라 ${offer.service} 외관 분석으로 보내는 데 동의해요`}
              description="원본 전체는 보내지 않아요. 부품을 확인하면 바로 분석을 시작해요."
              value={s.consent.analyze}
              onChange={(v) => ai.consent("analyze", v)}
            />
          </div>
          <p className="cb-caption">
            동의는 이번 사진 한 장에만 쓰여요. 다시 찍으면 다시 물어봐요.
          </p>
        </Section>
      )}
      {ai.still && !before && !analysing && s.phase !== CAI.RESULT && (
        <div className="cb-cai-still">
          <RegionSelector
            source={ai.still}
            label={`${offer.partLabel} 사진`}
            candidates={s.phase === CAI.CANDIDATE_FOUND ? s.candidates : []}
            selected={s.selected}
            region={
              s.phase === CAI.MANUAL_REGION
                ? s.region
                : s.phase === CAI.CANDIDATE_FOUND
                  ? null
                  : s.region
            }
            selectable={s.phase === CAI.MANUAL_REGION}
            onRegion={ai.region}
          />
          {s.phase === CAI.CANDIDATE_FOUND && (
            <>
              <p className="cb-caption">
                <span className="cb-tag cb-tag-ai">AI 탐지 후보 · 확정되지 않음</span>{" "}
                후보 {s.selected + 1}/{s.candidates.length}를 강조했어요.
              </p>
              <div className="cb-chip-row">
                {s.candidates.length > 1 && (
                  <Button
                    label="다른 후보 선택"
                    variant="secondary"
                    onClick={() =>
                      ai.select((s.selected + 1) % s.candidates.length)
                    }
                  />
                )}
                <Button label="다시 찾기" variant="secondary" onClick={ai.reset} />
              </div>
            </>
          )}
          {s.phase === CAI.MANUAL_REGION && s.regionError && (
            <p role="alert" className="cb-note cb-note-caution">
              {regionErrorText(s.regionError)}
            </p>
          )}
          {s.phase === CAI.MANUAL_REGION && (
            <div className="cb-chip-row">
              <Button label="다시 촬영하기" variant="secondary" onClick={ai.reset} />
            </div>
          )}
          {s.phase === CAI.NONE_FOUND && (
            <p className="cb-caption">
              이 사진에서는 해당 부품 후보가 없었어요. 다른 부품만 보였을 수 있어요.
            </p>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="cb-note">
          {s.phase === CAI.CAPTURING || s.phase === CAI.DETECTING
            ? "부품 후보를 찾고 있어요."
            : "확인한 부분을 AI가 살펴보고 있어요."}
        </p>
      )}
      {s.phase === CAI.RESULT && s.result && (
        <AiResult
          result={s.result}
          provenance={s.provenance ?? offer.service}
          ack={ack}
          setAck={setAck}
        />
      )}
      {ai.cropView && (s.phase === CAI.ANALYZING || s.phase === CAI.RESULT) && (
        <figure className="cb-cai-crop">
          <CropPreview canvas={ai.cropView} />
          <figcaption className="cb-caption">
            {s.regionSource === "MANUAL"
              ? "내가 직접 지정한 영역"
              : "AI 후보에서 내가 확인한 영역"}
            을 주변과 함께 잘라 보낸 사진이에요.
          </figcaption>
        </figure>
      )}
      {(s.phase === CAI.ERROR || s.phase === CAI.CANCELLED) && (
        <>
          <p role="alert" className="cb-note cb-note-caution">
            {s.phase === CAI.CANCELLED ? "AI 요청을 취소했어요." : errorText(s.code)}
          </p>
          {s.region && (
            <div className="cb-consent">
              <CheckboxInput
                label={`확인한 부분을 다시 ${offer.service} 외관 분석으로 보내는 데 동의해요`}
                value={s.consent.analyze}
                onChange={(v) => ai.consent("analyze", v)}
              />
              <Button
                label="다시 분석"
                variant="secondary"
                width="100%"
                isDisabled={!s.consent.analyze}
                onClick={ai.retryAnalysis}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CropPreview({ canvas }: { canvas: HTMLCanvasElement }) {
  return (
    <canvas
      className="cb-photo-canvas"
      aria-label="분석에 보낸 잘라낸 사진"
      role="img"
      ref={(c) => {
        if (c && (c.width !== canvas.width || c.height !== canvas.height)) {
          c.width = canvas.width;
          c.height = canvas.height;
        }
        c?.getContext("2d")?.drawImage(canvas, 0, 0);
      }}
    />
  );
}

/** The bottom actions while the AI assist is offered. Camera-off states keep the existing camera actions. */
export function cameraAiActions(
  ai: CameraAi,
  offer: AiOffer,
  cameraStatus: CameraStatus,
  go: { toCheck: () => void; startCamera: () => void; manual: () => void },
) {
  const s = ai.state;
  const detect = offer.plan === CAI_PLAN.DETECT;
  type Action = {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
  let primary: Action | null = null,
    secondary: Action | null = null,
    hint = "";
  switch (s.phase) {
    case CAI.CAMERA_READY:
      primary = {
        label: detect ? "AI로 부품 찾기" : "사진 찍고 영역 지정하기",
        onClick: () => void ai.capture(),
        disabled: !canCapture(s as never),
      };
      secondary = { label: "직접 점검 계속하기", onClick: go.toCheck };
      if (!canCapture(s as never)) hint = "위의 전송 동의를 확인하면 시작할 수 있어요.";
      break;
    case CAI.CAPTURING:
    case CAI.DETECTING:
      primary = { label: "부품을 찾고 있어요", onClick: () => {}, loading: true };
      secondary = { label: "취소", onClick: ai.cancel };
      break;
    case CAI.CANDIDATE_FOUND:
      primary = { label: "이 부품이 맞아요", onClick: ai.confirm };
      secondary = { label: "직접 위치 지정하기", onClick: ai.manual };
      break;
    case CAI.NONE_FOUND:
      primary = { label: "직접 위치 지정하기", onClick: ai.manual };
      secondary = { label: "다시 찾기", onClick: ai.reset };
      break;
    case CAI.MANUAL_REGION:
      primary = {
        label: "이 영역이 맞아요",
        onClick: ai.confirm,
        disabled: !s.region,
      };
      secondary = { label: "다시 선택", onClick: () => ai.region(null) };
      if (!s.region) hint = "사진 위에서 부품을 감싸도록 끌어 주세요.";
      break;
    case CAI.CONFIRMING_PART:
    case CAI.CROPPING:
    case CAI.ANALYZING:
      primary = { label: "AI가 살펴보고 있어요", onClick: () => {}, loading: true };
      secondary = { label: "분석 취소", onClick: ai.cancel };
      break;
    case CAI.RESULT:
    case CAI.ERROR:
    case CAI.CANCELLED:
      primary = { label: "직접 점검 계속하기", onClick: go.toCheck };
      secondary = { label: "다시 촬영하기", onClick: ai.reset };
      break;
    default: // IDLE: the camera is off — the existing camera actions
      if (cameraStatus === "idle" || cameraStatus === "requesting") {
        primary = {
          label: "카메라 켜기",
          onClick: go.startCamera,
          loading: cameraStatus === "requesting",
        };
        secondary = { label: "카메라 없이 계속하기", onClick: go.manual };
      } else {
        primary = { label: "카메라 없이 계속하기", onClick: go.manual };
        if (cameraStatus === "denied" || cameraStatus === "failed")
          secondary = {
            label: cameraStatus === "denied" ? "권한 다시 요청하기" : "다시 시도하기",
            onClick: go.startCamera,
          };
      }
  }
  return { primary, secondary, hint };
}

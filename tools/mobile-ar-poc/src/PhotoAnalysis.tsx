import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import {
  detectionForTask,
  offersDetection,
} from "../public/part-detection.mjs";
import {
  analysisProfile,
  offersAnalysis,
  validateAnalysisResult,
  ANALYSIS_SERVICES,
} from "../public/part-analysis.mjs";
import {
  cropWithContext,
  validateBox,
} from "../public/context-crop.mjs";
import { transport, type Candidate } from "./session";
import { AiResult, type Analysis } from "./ai/AiResult";
import { RegionSelector, regionErrorText } from "./ai/RegionSelector";
type Crop = {
  blob: Blob;
  plan: { targetInCrop: readonly number[] };
  canvas: HTMLCanvasElement;
};
const errors: Record<string, string> = {
  BUDGET_EXHAUSTED: "AI 사용 한도에 도달했어요. 직접 점검은 계속할 수 있어요.",
  RATE_LIMITED: "요청이 많아요. 잠시 후 다시 시도해 주세요.",
  NOT_CONNECTED: "차량 연결을 확인할 수 없어요. 새 QR이 필요할 수 있어요.",
  INVALID_RESPONSE: "AI 응답이 약속된 형식과 맞지 않아 보여 주지 않았어요.",
  TOO_LARGE: "사진은 15MB 이하로 골라 주세요.",
  UNREADABLE:
    "읽을 수 없는 사진이에요. JPEG, PNG, WebP 사진을 다시 골라 주세요.",
};
export function PhotoAnalysis({ taskId }: { taskId: string }) {
  const entry = detectionForTask(taskId),
    partId = entry?.partId ?? "";
  const canDetect =
    !!transport &&
    document.body.dataset.partDetection === "enabled" &&
    offersDetection(entry);
  const canAnalyze =
    !!transport &&
    document.body.dataset.partAnalysis === "enabled" &&
    offersAnalysis(partId, {
      allowDraft: document.body.dataset.partAnalysisDraft === "enabled",
    });
  const profile = analysisProfile(partId);
  const service =
    ANALYSIS_SERVICES[
      document.body.dataset
        .partAnalysisService as keyof typeof ANALYSIS_SERVICES
    ];
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [crop, setCrop] = useState<Crop | null>(null),
    [regionSource, setRegionSource] = useState("MANUAL"),
    // P21: a dragged region waiting for the person's "이 영역이 맞아요". No fixed-size tap box any more.
    [pending, setPending] = useState<readonly number[] | null>(null),
    [regionError, setRegionError] = useState("");
  const [detectConsent, setDetectConsent] = useState(false),
    [analysisConsent, setAnalysisConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Analysis | null>(null),
    [ack, setAck] = useState(false),
    [provenance, setProvenance] = useState("");
  const preview = useRef<HTMLCanvasElement>(null),
    original = useRef<File | null>(null),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    lock = useRef(false);
  const invalidate = () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
  };
  useEffect(() => () => invalidate(), []);
  useEffect(() => {
    if (crop && preview.current) {
      preview.current.width = crop.canvas.width;
      preview.current.height = crop.canvas.height;
      preview.current.getContext("2d")!.drawImage(crop.canvas, 0, 0);
    }
  }, [crop]);
  if (!canDetect && !canAnalyze)
    return (
      <p className="cb-caption cb-photo-off">
        이 연결에서는 AI 사진 보조를 쓸 수 없어요. 그림 안내를 보며 직접
        점검해 주세요.
      </p>
    );
  function resetResult() {
    setCrop(null);
    setAnalysisConsent(false);
    setResult(null);
    setAck(false);
    setError("");
  }
  async function load(file?: File) {
    if (!file) return;
    invalidate();
    const g = generation.current;
    resetResult();
    setDetectConsent(false);
    setProvenance("");
    setCandidates([]);
    setPending(null);
    setRegionError("");
    setPhoto(null);
    setBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw Error("TOO_LARGE");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw Error("UNREADABLE");
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      try {
        if (g !== generation.current) return;
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bitmap.width * scale));
        c.height = Math.max(1, Math.round(bitmap.height * scale));
        c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
        original.current = file;
        setPhoto(c);
      } finally {
        bitmap.close();
      }
    } catch (e) {
      if (g === generation.current)
        setError(errors[(e as Error).message] ?? errors.UNREADABLE);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function detect() {
    if (!photo || !detectConsent || lock.current) return;
    invalidate();
    const g = generation.current;
    lock.current = true;
    setBusy(true);
    resetResult();
    setDetectConsent(false);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const blob = await new Promise<Blob | null>((r) =>
        photo.toBlob(r, "image/jpeg", 0.85),
      );
      if (!blob) throw Error("UNREADABLE");
      if (g !== generation.current) return;
      const answer = await transport!.detectPart(partId, blob, {
        consent: "external-ai-v1",
        signal: ctrl.signal,
      });
      if (g !== generation.current) return;
      if (!answer.ok) throw Error(answer.code);
      if (!Array.isArray(answer.candidates) || answer.candidates.length > 3)
        throw Error("INVALID_RESPONSE");
      for (const c of answer.candidates) {
        validateBox(c.box);
        if (!Number.isFinite(c.score) || c.score < 0.4 || c.score > 1)
          throw Error("INVALID_RESPONSE");
      }
      setCandidates(answer.candidates);
      setProvenance(
        answer.detection?.provider === "mock"
          ? "로컬 시험용 MOCK"
          : "Roboflow 실험",
      );
      if (!answer.candidates.length)
        setError(
          "후보를 찾지 못했어요. 사진에서 직접 위치를 지정하거나 직접 점검을 이어가 주세요.",
        );
    } catch (e) {
      if (g === generation.current)
        setError(
          errors[(e as Error).message] ??
            "AI 위치 찾기에 실패했어요. 사진을 다시 고르거나 직접 지정해 주세요.",
        );
    } finally {
      if (g === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function choose(box: number[], source: string) {
    if (!canAnalyze || !original.current || busy) return;
    invalidate();
    const g = generation.current;
    resetResult();
    setBusy(true);
    try {
      const next = await cropWithContext(original.current, box, profile?.crop);
      if (g === generation.current) {
        setCrop(next as Crop);
        setRegionSource(source);
      }
    } catch {
      if (g === generation.current)
        setError("사진을 자르지 못했어요. 다른 사진을 골라 주세요.");
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function analyze() {
    if (!crop || !analysisConsent || lock.current) return;
    invalidate();
    const g = generation.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setAck(false);
    setAnalysisConsent(false);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const a = await transport!.analyzePart(partId, crop.blob, {
        consent: "external-vision-v1",
        targetInCrop: crop.plan.targetInCrop,
        regionSource,
        signal: ctrl.signal,
      });
      if (g !== generation.current) return;
      if (!a.ok) throw Error(a.code);
      const checked = validateAnalysisResult(partId, a.result);
      if (!checked.ok || !("result" in checked))
        throw Error("INVALID_RESPONSE");
      setResult(checked.result as Analysis);
      setProvenance(
        a.analysis?.provider === "mock"
          ? "로컬 시험용 MOCK"
          : (service ?? "외부 AI"),
      );
    } catch (e) {
      if (g === generation.current)
        setError(
          errors[(e as Error).message] ??
            "AI 분석에 실패했어요. 다시 동의한 뒤 다시 시도하거나 직접 점검해 주세요.",
        );
    } finally {
      if (g === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="cb-photo">
      <p className="cb-photo-intro">
        <span className="cb-tag cb-tag-ai">AI 실험</span>
        사진에 보이는 겉모습만 참고로 살펴봐요. 정확도가 검증된 진단이 아니에요.
        점검 응답은 직접 골라 주세요.
      </p>
      {profile?.positionNote && (
        <p className="cb-note">{profile.positionNote}</p>
      )}
      <div className="cb-photo-step">
        <h3 className="cb-h3">1 · 사진 고르기</h3>
        <label className="cb-file">
          사진 찍기 또는 고르기
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void load(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="cb-caption">
          고르기만 해서는 보내지 않아요. 보낼 때는 위치·촬영 정보를 지워요.
        </p>
      </div>
      {photo && (
        <div className="cb-photo-step">
          <h3 className="cb-h3">2 · 부품 위치 정하기</h3>
          <RegionSelector
            source={photo}
            label="고른 사진"
            candidates={candidates}
            region={canAnalyze ? pending : null}
            selectable={canAnalyze && !busy}
            onRegion={(box, error) => {
              setPending(box);
              setRegionError(regionErrorText(error));
            }}
          />
          {regionError && (
            <p role="alert" className="cb-note cb-note-caution">
              {regionError}
            </p>
          )}
          {canAnalyze && (
            <div className="cb-chip-row">
              <Button
                label="이 영역이 맞아요"
                variant="secondary"
                isDisabled={!pending || busy}
                onClick={() => pending && void choose([...pending], "MANUAL")}
              />
              <Button
                label="다시 선택"
                variant="ghost"
                isDisabled={!pending || busy}
                onClick={() => {
                  setPending(null);
                  setRegionError("");
                }}
              />
            </div>
          )}
          {canDetect && (
            <div className="cb-consent">
              <p className="cb-body-sm">
                AI 위치 찾기 · 줄인 사진 한 장을 외부 서비스(Roboflow)에 보내요.
                사람이나 번호판이 보이지 않는 사진을 골라 주세요. 다른 부품을
                잘못 표시할 수 있어요.
              </p>
              <CheckboxInput
                label="이 사진의 외부 위치 분석에 동의합니다"
                value={detectConsent}
                onChange={setDetectConsent}
              />
              <Button
                label="AI 위치 후보 찾기"
                variant="secondary"
                width="100%"
                isDisabled={!detectConsent || busy}
                onClick={() => void detect()}
              />
            </div>
          )}
          {candidates.length > 0 && (
            <div className="cb-candidates">
              <p className="cb-caption">
                {provenance} · 확정되지 않은 위치 후보예요. 맞는 후보를 직접
                골라 주세요.
              </p>
              <div className="cb-chip-row">
                {candidates.map((c, i) => (
                  <Button
                    key={i}
                    label={`후보 ${i + 1} 선택`}
                    variant="secondary"
                    isDisabled={busy || !canAnalyze}
                    onClick={() => void choose(c.box, "AI_CANDIDATE")}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {crop && (
        <div className="cb-photo-step cb-consent">
          <h3 className="cb-h3">3 · 이 부분만 분석해요</h3>
          <canvas
            ref={preview}
            className="cb-photo-canvas"
            aria-label="분석에 보낼 잘라낸 사진"
          />
          <p className="cb-body-sm">
            {regionSource === "MANUAL"
              ? "내가 직접 지정한 부분이에요."
              : "AI 후보에서 내가 고른 부분이에요."}{" "}
            주변을 조금 포함해 자른 사진 한 장만 {service}에 보내요. 원본 전체는
            보내지 않아요.
          </p>
          <CheckboxInput
            label="잘라낸 사진의 외부 AI 분석에 동의합니다"
            value={analysisConsent}
            onChange={setAnalysisConsent}
          />
          <Button
            label={result ? "다시 분석" : "사진 상태 분석"}
            variant="primary"
            width="100%"
            isDisabled={!analysisConsent || busy}
            onClick={() => void analyze()}
          />
        </div>
      )}
      {busy && (
        <div role="status" className="cb-busy">
          <p className="cb-body-sm">사진을 처리하고 있어요.</p>
          <Button
            label="사진 처리 취소"
            variant="ghost"
            onClick={() => {
              invalidate();
              setBusy(false);
              setAnalysisConsent(false);
              setDetectConsent(false);
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="cb-note cb-note-danger">
          {error}
        </p>
      )}
      {result && (
        <AiResult
          result={result}
          provenance={provenance}
          ack={ack}
          setAck={setAck}
        />
      )}
    </div>
  );
}

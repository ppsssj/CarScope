import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Badge } from "@astryxdesign/core/Badge";
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
  boxAroundPoint,
  cropWithContext,
  validateBox,
} from "../public/context-crop.mjs";
import { transport, type Candidate } from "./session";
type Analysis = {
  assessment: string;
  observations: readonly string[];
  suspectedIssues: readonly {
    code: string;
    description: string;
    evidence: string;
  }[];
  limitations: readonly string[];
  retakeInstructions: readonly string[];
};
type Crop = {
  blob: Blob;
  plan: { targetInCrop: readonly number[] };
  canvas: HTMLCanvasElement;
};
const titles: Record<string, string> = {
  NO_VISIBLE_ISSUE_DETECTED: "사진에서 이상 징후를 찾지 못했어요",
  SUSPECTED_ISSUE: "사진에서 이상이 의심되는 부분이 있어요",
  INDETERMINATE: "이 사진으로는 판단하기 어려워요",
  WRONG_PART: "선택한 부품이 아닌 것 같아요",
};
const errors: Record<string, string> = {
  BUDGET_EXHAUSTED: "AI 사용 한도에 도달했습니다.",
  RATE_LIMITED: "요청이 많습니다. 잠시 후 다시 시도하세요.",
  NOT_CONNECTED: "차량 연결을 확인할 수 없습니다. 새 QR이 필요할 수 있습니다.",
  INVALID_RESPONSE: "AI 응답이 데이터 계약과 맞지 않아 표시하지 않았습니다.",
  TOO_LARGE: "사진은 15MB 이하로 선택하세요.",
  UNREADABLE:
    "읽을 수 없는 사진입니다. JPEG, PNG, WebP 사진을 다시 선택하세요.",
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
    [regionSource, setRegionSource] = useState("MANUAL");
  const [detectConsent, setDetectConsent] = useState(false),
    [analysisConsent, setAnalysisConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Analysis | null>(null),
    [ack, setAck] = useState(false),
    [provenance, setProvenance] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    preview = useRef<HTMLCanvasElement>(null),
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
    if (photo && canvas.current) {
      const c = canvas.current;
      c.width = photo.width;
      c.height = photo.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(photo, 0, 0);
      candidates.forEach(({ box }, i) => {
        ctx.strokeStyle = "#0a766b";
        ctx.lineWidth = 5;
        ctx.strokeRect(
          box[0] * c.width,
          box[1] * c.height,
          box[2] * c.width,
          box[3] * c.height,
        );
        ctx.fillStyle = "#073b37";
        ctx.font = "bold 30px sans-serif";
        ctx.fillText(
          String(i + 1),
          box[0] * c.width + 6,
          box[1] * c.height + 32,
        );
      });
    }
  }, [photo, candidates]);
  useEffect(() => {
    if (crop && preview.current) {
      preview.current.width = crop.canvas.width;
      preview.current.height = crop.canvas.height;
      preview.current.getContext("2d")!.drawImage(crop.canvas, 0, 0);
    }
  }, [crop]);
  if (!canDetect && !canAnalyze)
    return (
      <p className="fine">
        이 연결에서는 AI 사진 보조가 제공되지 않습니다. 그림 안내와 수동 점검을
        이용하세요.
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
          "후보를 찾지 못했습니다. 사진에서 직접 위치를 지정하거나 수동 점검을 계속하세요.",
        );
    } catch (e) {
      if (g === generation.current)
        setError(
          errors[(e as Error).message] ??
            "AI 위치 찾기에 실패했습니다. 사진을 다시 고르거나 직접 지정하세요.",
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
        setError("사진을 자르지 못했습니다. 다른 사진을 선택하세요.");
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
            "AI 분석에 실패했습니다. 다시 동의한 뒤 재시도하거나 직접 점검하세요.",
        );
    } finally {
      if (g === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="photo-workspace">
      <div className="section-label">
        <h3>사진으로 관찰 돕기</h3>
        <Badge label="AI 실험" variant="purple" />
      </div>
      <p>
        사진에서 보이는 모습만 참고합니다. 정확도가 검증된 진단이 아니며, 아래
        점검 응답은 직접 선택해야 합니다.
      </p>
      {profile?.positionNote && (
        <p className="notice">{profile.positionNote}</p>
      )}
      <label className="file-input">
        사진 촬영 또는 선택
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p className="fine">
        선택만으로는 전송되지 않습니다. 위치·촬영 메타데이터는 전송 이미지에서
        제거합니다.
      </p>
      {photo && (
        <>
          <canvas
            ref={canvas}
            className="photo-canvas"
            tabIndex={canAnalyze ? 0 : undefined}
            role={canAnalyze ? "button" : "img"}
            aria-label={
              canAnalyze
                ? "사진에서 부품 위치 직접 지정. Enter는 중앙 선택"
                : "AI 위치 후보가 표시된 사진"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void choose(boxAroundPoint(photo, [0.5, 0.5]), "MANUAL");
              }
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              void choose(
                boxAroundPoint(photo, [
                  (e.clientX - r.left) / r.width,
                  (e.clientY - r.top) / r.height,
                ]),
                "MANUAL",
              );
            }}
          />
          {canAnalyze && (
            <p className="fine">
              부품 위치를 탭하세요. 키보드에서는 Enter로 중앙을 선택할 수
              있습니다.
            </p>
          )}
          {canDetect && (
            <div className="consent">
              <p>
                AI 위치 찾기 · Roboflow에 축소한 사진 한 장을 보냅니다.
                개인정보가 보이지 않는 사진을 고르세요. 다른 부품을 잘못 표시할
                수 있습니다.
              </p>
              <CheckboxInput
                label="이 사진의 외부 위치 분석에 동의합니다"
                value={detectConsent}
                onChange={setDetectConsent}
              />
              <Button
                label="AI 위치 후보 찾기"
                isDisabled={!detectConsent || busy}
                onClick={() => void detect()}
              />
            </div>
          )}
          {candidates.length > 0 && (
            <>
              <p>{provenance} · 확정되지 않은 위치 후보</p>
              <div className="button-row">
                {candidates.map((c, i) => (
                  <Button
                    key={i}
                    label={`후보 ${i + 1} 선택`}
                    isDisabled={busy || !canAnalyze}
                    onClick={() => void choose(c.box, "AI_CANDIDATE")}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {crop && (
        <div className="consent">
          <h4>이 영역만 분석합니다</h4>
          <canvas
            ref={preview}
            className="photo-canvas"
            aria-label="분석에 보낼 잘라낸 사진"
          />
          <p>
            {regionSource === "MANUAL"
              ? "사용자가 직접 지정한 영역"
              : "AI 후보에서 사용자가 선택한 영역"}{" "}
            · 주변 문맥을 포함한 잘라낸 사진 한 장을 {service}에 보냅니다. 원본
            전체는 보내지 않습니다.
          </p>
          <CheckboxInput
            label="잘라낸 사진의 외부 AI 분석에 동의합니다"
            value={analysisConsent}
            onChange={setAnalysisConsent}
          />
          <Button
            label={result ? "다시 분석" : "사진 상태 분석"}
            variant="primary"
            isDisabled={!analysisConsent || busy}
            onClick={() => void analyze()}
          />
        </div>
      )}
      {busy && (
        <div role="status">
          <p>사진을 처리하고 있습니다…</p>
          <Button
            label="사진 처리 취소"
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
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-result">
          <Badge label={provenance} variant="purple" />
          <h4>{titles[result.assessment]}</h4>
          <p>부품 정상·차량 안전·주행 가능 판정이 아닙니다.</p>
          {[
            ...result.observations,
            ...result.suspectedIssues.map(
              (s) => `${s.description} — ${s.evidence}`,
            ),
            ...result.limitations,
            ...result.retakeInstructions,
          ].map((s, i) => (
            <p key={i}>{s}</p>
          ))}
          <CheckboxInput
            label="AI의 한계를 이해했고, 실제 부품을 직접 확인하겠습니다"
            value={ack}
            onChange={setAck}
          />
          {ack && (
            <p className="fine">
              아래 사용자 점검을 이어가세요. AI 결과는 응답을 자동으로 바꾸지
              않습니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

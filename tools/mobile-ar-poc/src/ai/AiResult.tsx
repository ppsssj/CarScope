// The validated AI answer in the 차보담 hierarchy. Shared by the camera flow and the photo-file flow.
import { useId } from "react";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";

export type Analysis = {
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
export const titles: Record<string, string> = {
  NO_VISIBLE_ISSUE_DETECTED: "사진에서 이상 징후를 찾지 못했어요",
  SUSPECTED_ISSUE: "사진에서 이상이 의심되는 부분이 있어요",
  INDETERMINATE: "이 사진으로는 판단하기 어려워요",
  WRONG_PART: "선택한 부품이 아닌 것 같아요",
};

/**
 * The validated AI answer, most important first: the headline, what it
 * suspects (with its evidence), what it saw, then its limits. Nothing here is
 * invented: every line is a field of the validated response.
 */
export function AiResult({
  result,
  provenance,
  ack,
  setAck,
}: {
  result: Analysis;
  provenance: string;
  ack: boolean;
  setAck: (v: boolean) => void;
}) {
  const titleId = useId();
  return (
    <section className="cb-ai-result" aria-labelledby={titleId}>
      <p className="cb-ai-tags">
        <span className="cb-tag cb-tag-ai">{provenance}</span>
        <span className="cb-tag">참고 정보</span>
      </p>
      <h3 id={titleId} className="cb-ai-title">
        {titles[result.assessment]}
      </h3>
      <p className="cb-caption">
        부품 정상·차량 안전·주행 가능 여부를 판정한 결과가 아니에요.
      </p>
      {result.suspectedIssues.length > 0 && (
        <div className="cb-ai-block">
          <h4>먼저 살펴볼 점</h4>
          <ul>
            {result.suspectedIssues.map((s, i) => (
              <li key={i}>
                <strong>{s.description}</strong>
                <span>근거 · {s.evidence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.observations.length > 0 && (
        <div className="cb-ai-block">
          <h4>사진에서 보인 것</h4>
          <ul>
            {result.observations.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {result.limitations.length > 0 && (
        <div className="cb-ai-block cb-ai-limits">
          <h4>이 결과의 한계</h4>
          <ul>
            {result.limitations.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {result.retakeInstructions.length > 0 && (
        <div className="cb-ai-block">
          <h4>다시 찍는다면</h4>
          <ul>
            {result.retakeInstructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <CheckboxInput
        label="AI의 한계를 이해했고, 실제 부품을 직접 확인하겠습니다"
        value={ack}
        onChange={setAck}
      />
      {ack && (
        <p className="cb-caption">
          점검 응답은 직접 골라 주세요. AI 결과는 응답을 바꾸지 않아요.
        </p>
      )}
    </section>
  );
}

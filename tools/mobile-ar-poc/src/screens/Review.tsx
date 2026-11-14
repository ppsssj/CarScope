import { Button } from "@astryxdesign/core/Button";
import {
  CHECKLIST_OUTCOME,
  WASHER_OUTCOME,
  REPORT_NOTE,
} from "../../public/inspection-copy.mjs";
import { Dock, Heading, TextAction } from "../ui/kit";
import type { StepProps } from "./types";

const OUTCOME: Record<string, { title: string; tone: string }> = {
  ...CHECKLIST_OUTCOME,
  ...WASHER_OUTCOME,
};
export const ANSWER_TITLES: Record<string, string> = {
  FOUND: "이상 징후 발견",
  NOT_FOUND: "발견하지 못함",
  UNABLE: "확인할 수 없음",
};

/** Summary of the person's own answers. Tone colours never mean "safe". */
export function Outcome({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  const o = OUTCOME[status];
  return (
    <div className="cb-outcome" data-tone={o?.tone ?? "unable"}>
      <span className="cb-tag">{label}</span>
      <p className="cb-outcome-title">{o?.title}</p>
      <p className="cb-caption">{REPORT_NOTE}</p>
    </div>
  );
}

export function reviewStatus(p: StepProps) {
  if (p.washer) return p.state.choice ?? "";
  const answers = Object.values(p.state.record?.responses ?? {});
  return answers.includes("FOUND")
    ? "REVIEW_NEEDED"
    : answers.includes("UNABLE")
      ? "UNABLE"
      : "NO_FINDINGS_REPORTED";
}

/** Step 4a: check and edit before confirming. Confirming does not send. */
export function Review(p: StepProps) {
  const { profile, state, event } = p;
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow="4단계 · 확인"
        title="확정하기 전에 한 번 더 봐 주세요"
        body="확정한 기록은 바꿀 수 없어요. 고칠 응답이 있으면 지금 수정해 주세요."
      />
      <Outcome status={reviewStatus(p)} label="내가 직접 본 결과" />
      {profile ? (
        <ul className="cb-review-list" aria-label="내 응답">
          {profile.checks.map((c, index) => (
            <li key={c.id}>
              <span className="cb-row-text">
                <strong>{c.label}</strong>
                <span>
                  {ANSWER_TITLES[state.record?.responses?.[c.id] ?? "UNABLE"]}
                </span>
              </span>
              <Button
                label={`${c.label} 수정`}
                size="md"
                variant="secondary"
                onClick={() => event({ type: "EDIT", index })}
              >
                수정
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cb-body">
          확인하지 못한 항목은 확인한 것으로 기록하지 않아요.
        </p>
      )}
      <p className="cb-caption">
        {profile?.followup ??
          "이상이 의심되거나 확인하지 못했다면 제조사 서비스에 문의해 주세요. AI의 관찰과 내 응답은 별개예요."}
      </p>
      <TextAction label="응답으로 돌아가기" onClick={() => event({ type: "BACK" })} />
      <Dock>
        <Button
          label="직접 확인한 결과로 확정"
          variant="primary"
          size="lg"
          width="100%"
          onClick={() => event({ type: "CONFIRM" })}
        />
        <p className="cb-dock-hint">
          확정해도 자동으로 보내지 않아요. 보내기는 다음 화면에서 따로 해요.
        </p>
      </Dock>
    </>
  );
}

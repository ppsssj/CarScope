import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { CHECK_ITEMS, type FlowEvent } from "../domain";
import { questionCopy, WASHER_OUTCOME } from "../../public/inspection-copy.mjs";
import { CameraView, useCamera } from "../Camera";
import { Dock, Heading, TextAction } from "../ui/kit";
import type { StepProps } from "./types";

const PhotoAnalysis = lazy(() =>
  import("../PhotoAnalysis").then((m) => ({ default: m.PhotoAnalysis })),
);

function InlineCamera({
  event,
  taskId,
  label,
  paused,
}: {
  event: (e: FlowEvent) => void;
  taskId: string;
  label: string;
  paused: boolean;
}) {
  const camera = useCamera(event, taskId);
  useEffect(() => {
    if (paused && (camera.status === "live" || camera.status === "requesting"))
      camera.stop();
  }, [paused, camera]);
  return <CameraView camera={camera} label={label} inlineStart />;
}

/** One exclusive answer, shown as a large pressed/unpressed choice. */
function Choices({
  label,
  options,
  selected,
  choose,
}: {
  label: string;
  options: [string, string][];
  selected: string | undefined;
  choose: (value: string) => void;
}) {
  return (
    <div className="cb-choices" role="group" aria-label={label}>
      {options.map(([value, text]) => (
        <button
          type="button"
          key={value}
          aria-pressed={selected === value}
          onClick={() => choose(value)}
        >
          <span className="cb-choice-dot" aria-hidden="true" />
          {text}
        </button>
      ))}
    </div>
  );
}

/** Step 3: the person's own observation. AI never answers here. */
export function Observe(p: StepProps) {
  const { washer, profile, state, event, task, taskId, paused } = p;
  const [aiOpen, setAiOpen] = useState(false);
  const index = state.index ?? 0;
  const check = profile?.checks[index];
  const question = check ? questionCopy(task, check) : null;
  const answered = washer
    ? CHECK_ITEMS.every((c) => state.checks?.[c.id])
    : !!state.record?.responses?.[check!.id];
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow={
          washer
            ? "3단계 · 직접 확인"
            : `3단계 · 관찰 ${index + 1}/${profile!.checks.length}`
        }
        title={washer ? "직접 확인한 항목만 골라 주세요" : question?.title}
        body={
          washer
            ? "확인하지 못한 항목은 고르지 마세요. 그대로 기록돼요."
            : check?.help
        }
      />
      {state.mode === "camera" && !state.observationStopped && (
        <InlineCamera
          event={event}
          taskId={taskId}
          label={task.label}
          paused={paused}
        />
      )}
      <section className="cb-observation">
        {washer ? (
          <div className="cb-checks">
            {CHECK_ITEMS.map((item) => (
              <CheckboxInput
                key={item.id}
                label={item.label}
                value={!!state.checks?.[item.id]}
                onChange={(value) =>
                  event({ type: "TOGGLE", id: item.id, value })
                }
              />
            ))}
          </div>
        ) : (
          <>
            {question?.tip && <p className="cb-note">{question.tip}</p>}
            <Choices
              label="관찰 응답"
              options={Object.entries(profile!.answers)}
              selected={state.record?.responses?.[check!.id]}
              choose={(answer) =>
                event({ type: "ANSWER", checkId: check!.id, answer })
              }
            />
          </>
        )}
        {state.observationStopped && (
          <p role="status" className="cb-note cb-note-caution">
            접근과 관찰을 멈췄어요. 이미 본 내용만 기록하고, 나머지는 ‘확인할 수
            없음’을 직접 골라 주세요.
          </p>
        )}
      </section>
      {profile?.stopAdvice && (
        <p className="cb-note cb-note-caution">{profile.stopAdvice}</p>
      )}
      <TextAction label="이전 단계" onClick={() => event({ type: "BACK" })} />
      <details
        className="cb-disclosure"
        open={aiOpen}
        onToggle={(e) => setAiOpen(e.currentTarget.open)}
      >
        <summary>사진으로 살펴보기 · 선택</summary>
        <Suspense fallback={<p>사진 보조를 준비하고 있어요.</p>}>
          {aiOpen && !paused && <PhotoAnalysis taskId={taskId} />}
        </Suspense>
      </details>
      <Dock>
        <Button
          label={
            washer
              ? "관찰 결과 선택하기"
              : index < profile!.checks.length - 1
                ? "다음 관찰"
                : "전체 응답 확인하기"
          }
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!answered}
          onClick={() =>
            event(washer ? { type: "TO_RESULT" } : { type: "NEXT", index })
          }
        />
        {washer ? (
          <Button
            label="직접 확인할 수 없음"
            variant="ghost"
            size="lg"
            width="100%"
            onClick={() => event({ type: "CANNOT_CONFIRM" })}
          />
        ) : (
          profile?.supportsObservationStop &&
          !state.observationStopped && (
            <Button
              label="접근과 관찰 중단"
              variant="ghost"
              size="lg"
              width="100%"
              onClick={() => event({ type: "STOP_OBSERVATION" })}
            />
          )
        )}
      </Dock>
    </>
  );
}

/** Washer only: the amount the person saw. */
export function WasherResult(p: StepProps) {
  const { state, event } = p;
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow="3단계 · 직접 확인"
        title="워셔액 양이 어떤가요?"
        body="직접 본 양을 기준으로 골라 주세요. 사진 속 캡만으로는 양을 알 수 없어요."
      />
      <section className="cb-observation">
        <Choices
          label="워셔액 상태"
          options={Object.entries(WASHER_OUTCOME).map(([status, o]) => [
            status,
            o.title,
          ])}
          selected={state.choice}
          choose={(status) => event({ type: "SELECT", status })}
        />
      </section>
      <TextAction label="관찰로 돌아가기" onClick={() => event({ type: "BACK" })} />
      <Dock>
        <Button
          label="선택한 결과 확인하기"
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!state.choice}
          onClick={() => event({ type: "TO_CONFIRM" })}
        />
      </Dock>
    </>
  );
}

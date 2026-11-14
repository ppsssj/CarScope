import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dock, Heading, Section, Bullets } from "../ui/kit";
import { Guide } from "../Guide";
import type { StepProps } from "./types";

/** Step 1: what we inspect and the safety gate. Safety text is never hidden. */
export function Intro(
  p: StepProps & { canStart: (washerSafe: boolean) => boolean },
) {
  const { washer, profile, state, event, copy, task, taskId } = p;
  const [washerSafe, setWasherSafe] = useState(false);
  const canStart = p.canStart(washerSafe);
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow="1단계 · 준비"
        title="시작하기 전에 안전부터 확인해 주세요"
        body={
          copy.lead ??
          profile?.description ??
          "워셔액 주입구를 찾고, 직접 확인한 상태를 기록해요. 카메라 없이도 진행할 수 있어요."
        }
      />
      <Section
        id="safety-title"
        title="이렇게 준비해 주세요"
        tone="caution"
        className="cb-safety"
      >
        <Bullets items={copy.points} />
        <p className="cb-caption">
          {profile?.safetyHelp ??
            "안전 조건을 확인하지 못하면 시작하지 마세요. 차종별 설명서를 따라 주세요."}
        </p>
        <div className="cb-checks">
          <CheckboxInput
            label={
              profile?.safetyText ??
              "안전 조건을 확인했고, 설명서에 따라 바깥에서만 살펴볼게요"
            }
            value={washer ? washerSafe : !!state.safe}
            onChange={(v) =>
              washer ? setWasherSafe(v) : event({ type: "SAFETY", value: v })
            }
          />
          {profile?.requiresNotCharging && (
            <CheckboxInput
              label={profile.extraSafety!}
              value={!!state.notCharging}
              onChange={(value) => event({ type: "NOT_CHARGING", value })}
            />
          )}
        </div>
      </Section>
      <p className="cb-caption cb-limit">{copy.limit}</p>
      <Section id="part-title" title={`${task.label}, 이렇게 생겼어요`}>
        <Guide taskId={taskId} compact />
      </Section>
      <Dock>
        <Button
          label="직접 점검 시작"
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!canStart}
          onClick={() => event({ type: "START", camera: false })}
        />
        <Button
          label="카메라 보조로 시작"
          variant="ghost"
          size="lg"
          width="100%"
          isDisabled={!canStart}
          onClick={() => event({ type: "START", camera: true })}
        />
        {!canStart && (
          <p className="cb-dock-hint">위 안전 조건을 확인하면 시작할 수 있어요.</p>
        )}
      </Dock>
    </>
  );
}

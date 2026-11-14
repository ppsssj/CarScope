// 차보담 mobile inspection shell. The state owner is the existing reducer
// (flowFor → self-inspection / checklist-flow); screens only present it.
import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { flowFor, inspectionTask } from "./domain";
import {
  handoff,
  showCatalog,
  transport,
  subscribeSync,
  type SyncSnapshot,
} from "./session";
import { guideForTask } from "../public/part-guides.mjs";
import { taskCopy } from "../public/inspection-copy.mjs";
import { validateResult } from "../public/inspection-result.mjs";
import { Dock, Heading, TaskBar } from "./ui/kit";
import { BrandBar, Footer } from "./screens/Brand";
import { Catalog } from "./screens/Catalog";
import { Intro } from "./screens/Intro";
import { Locate } from "./screens/Locate";
import { Observe, WasherResult } from "./screens/Observe";
import { Review } from "./screens/Review";
import { Done } from "./screens/Done";
import { ExitDialog } from "./screens/ExitDialog";
import type { StepProps, TaskCopy, Guide } from "./screens/types";

const STEP_INFO: Record<string, [number, string]> = {
  intro: [1, "준비"],
  locate: [2, "위치 찾기"],
  check: [3, "관찰"],
  result: [3, "관찰"],
  review: [4, "확인"],
  confirm: [4, "확인"],
  done: [4, "기록 완료"],
};

function SkipLink() {
  // A plain #main link would change the hash, which reloads this app.
  return (
    <a
      className="cb-skip"
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
    >
      본문으로 건너뛰기
    </a>
  );
}

function InvalidLink() {
  return (
    <>
      <BrandBar />
      <main id="main" tabIndex={-1} className="cb-main">
        <Heading
          eyebrow="연결 확인"
          title="이 QR로는 시작할 수 없어요"
          body="유효하지 않거나 지원하지 않는 요청이에요. 차에서 새 QR을 만들어 다시 열어 주세요."
        />
        <Dock>
          <Button
            label="QR 없이 둘러보기"
            href="/"
            variant="primary"
            size="lg"
            width="100%"
          />
        </Dock>
      </main>
    </>
  );
}

function Inspection({ backToCatalog }: { backToCatalog: () => void }) {
  const [sync, setSync] = useState<SyncSnapshot | null>(
      transport?.snapshot ?? null,
    ),
    [exit, setExit] = useState(false);
  const taskId = handoff.task,
    flow = useRef(flowFor(taskId)).current;
  const [state, dispatch] = useReducer(flow.reduce, undefined, flow.initial);
  const { washer, profile } = flow,
    step = state.step,
    task = inspectionTask(taskId)!;
  const copy: TaskCopy = taskCopy(task) ?? {
    points: [
      "안전한 곳에 세우고 주차 상태와 전원이 꺼졌는지 확인해 주세요.",
      "보닛을 안전하게 고정하고, 뜨겁거나 움직이는 부품에 가까이 가지 마세요.",
      "캡의 앞유리·물줄기 모양 표시를 확인해 주세요. 색만 보고 고르지 마세요.",
    ],
    limit: "수치를 재거나 차량의 안전을 판정하지 않아요.",
  };
  const heading = useRef<HTMLHeadingElement>(null),
    lastStep = useRef(`${step}:${state.index ?? 0}`),
    completion = useRef<string | null>(null);
  useEffect(() => subscribeSync(setSync), []);
  // A new step or a new question moves focus to its title, so screen
  // readers announce what changed.
  const position = `${step}:${state.index ?? 0}`;
  useEffect(() => {
    document.body.dataset.ready = "true";
    document.body.dataset.step = step;
    if (position !== lastStep.current) {
      lastStep.current = position;
      heading.current?.focus();
      window.scrollTo({ top: 0 });
    }
  }, [step, position]);
  // Completion makes the record available to the transport; it never sends.
  useEffect(() => {
    if (
      step === "done" &&
      state.record &&
      completion.current !== state.record.inspectionId
    ) {
      completion.current = state.record.inspectionId;
      transport?.setResult(state.record);
    }
  }, [step, state.record]);
  const completed = step === "done";
  const recordValid =
    !completed ||
    (!!state.record &&
      (washer
        ? validateResult(state.record).length === 0
        : profile!.result.validate(state.record).length === 0));
  function restart() {
    if (transport) {
      transport.close();
      location.replace("/");
      return;
    }
    dispatch({ type: "RESTART" });
    completion.current = null;
  }
  const props: StepProps = {
    taskId,
    task,
    washer,
    profile,
    state,
    event: dispatch,
    copy,
    guide: guideForTask(taskId) as Guide | undefined,
    headingRef: heading,
    paused: exit,
  };
  const canStart = (washerSafe: boolean) =>
    handoff.valid &&
    (washer
      ? washerSafe
      : !!state.safe && (!profile?.requiresNotCharging || !!state.notCharging));
  const [n, name] = STEP_INFO[step] ?? [1, "준비"];
  const toCatalog = step === "intro" && !transport;
  return (
    <>
      <TaskBar
        backLabel={
          toCatalog ? "점검 목록으로" : completed ? "홈으로" : "점검 나가기"
        }
        onBack={() => {
          if (toCatalog) backToCatalog();
          else if (!completed) setExit(true);
          else location.assign("/");
        }}
        title={`${task.label} 점검`}
        step={n}
        total={4}
        stepName={name}
      />
      <p className="cb-connection" data-connected={sync ? "true" : "false"}>
        {sync
          ? (sync.connectionMessage ?? "차량 연결을 확인하고 있어요")
          : "체험 점검 · 기록은 이 화면에만 남아요"}
      </p>
      <main id="main" tabIndex={-1} className="cb-main" data-step={step}>
        {step === "intro" && <Intro {...props} canStart={canStart} />}
        {step === "locate" && <Locate {...props} />}
        {step === "check" && <Observe {...props} />}
        {step === "result" && <WasherResult {...props} />}
        {(step === "review" || step === "confirm") && <Review {...props} />}
        {completed && (
          <Done
            {...props}
            sync={sync}
            recordValid={recordValid}
            resultStatus={state.record?.status ?? state.choice ?? ""}
            restart={restart}
          />
        )}
      </main>
      {exit && (
        <ExitDialog
          cancel={() => setExit(false)}
          confirm={() => {
            setExit(false);
            dispatch({ type: "CANCEL" });
            transport?.close();
            if (transport) location.replace("/");
          }}
        />
      )}
    </>
  );
}

export function App() {
  useEffect(() => {
    document.body.dataset.ready = "true";
    if (showCatalog) document.body.dataset.step = "catalog";
  }, []);
  return (
    <div className="cb-app">
      <SkipLink />
      {!handoff.valid ? (
        <InvalidLink />
      ) : showCatalog ? (
        <Catalog />
      ) : (
        // A fresh page for the list, so the same part link opens again.
        <Inspection backToCatalog={() => location.assign("/")} />
      )}
      <Footer />
    </div>
  );
}

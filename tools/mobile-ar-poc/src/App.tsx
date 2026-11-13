import { lazy, Suspense, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Badge } from "@astryxdesign/core/Badge";
import {
  flowFor,
  taskLinks,
  inspectionTask,
  CHECK_ITEMS,
  type FlowEvent,
} from "./domain";
import {
  handoff,
  showCatalog,
  transport,
  subscribeSync,
  type SyncSnapshot,
} from "./session";
import { Guide } from "./Guide";
import { Camera } from "./Camera";
import { guideForTask, infoGuides } from "../public/part-guides.mjs";
import {
  questionCopy,
  taskCopy,
  CHECKLIST_OUTCOME,
  WASHER_OUTCOME,
  REPORT_NOTE,
} from "../public/inspection-copy.mjs";
import { validateResult } from "../public/inspection-result.mjs";
const PhotoAnalysis = lazy(() =>
  import("./PhotoAnalysis").then((m) => ({ default: m.PhotoAnalysis })),
);
const outcomeTitles: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CHECKLIST_OUTCOME).map(([k, v]) => [k, v.title]),
  ),
  ...Object.fromEntries(
    Object.entries(WASHER_OUTCOME).map(([k, v]) => [k, v.title]),
  ),
};
const answerTitles: Record<string, string> = {
  FOUND: "이상 징후 발견",
  NOT_FOUND: "발견하지 못함",
  UNABLE: "확인할 수 없음",
};
function category(id: string) {
  return id.startsWith("tire.")
    ? "타이어"
    : id.startsWith("wiper.") || id.startsWith("light-")
      ? "시야·조명"
      : id.startsWith("ev-")
        ? "충전"
        : "보닛 내부";
}
function ExitDialog({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      aria-labelledby="exit-title"
    >
      <h2 id="exit-title">점검을 그만둘까요?</h2>
      <p>확정하지 않은 응답은 남지 않습니다. 카메라는 꺼집니다.</p>
      <div className="button-row">
        <Button label="점검 계속하기" onClick={cancel} />
        <Button label="그만두기" variant="destructive" onClick={confirm} />
      </div>
    </dialog>
  );
}
function Catalog() {
  const [filter, setFilter] = useState("전체");
  return (
    <>
      <section className="catalog-heading">
        <div className="eyebrow">YOUR NEXT CHECK</div>
        <h1>
          내 차를 살피는
          <br />
          작은 습관.
        </h1>
        <p>
          어디부터 살펴볼까요?
          <br />
          부품을 고르면 안전 준비부터 차근차근 안내합니다.
        </p>
        <div className="catalog-note">
          <span aria-hidden="true">↗</span>
          <p>
            <strong>차량에서 QR로 시작하셨나요?</strong>
            <br />
            QR 링크로 접속하면 해당 점검과 차량 전송이 연결됩니다.
          </p>
        </div>
      </section>
      <nav className="filters" aria-label="점검 분류">
        {["전체", "보닛 내부", "타이어", "시야·조명", "충전"].map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </nav>
      <div className="section-label">
        <h2>직접 점검하기</h2>
        <span>로그인 없이 체험</span>
      </div>
      <div className="part-grid">
        {taskLinks()
          .filter((t) => filter === "전체" || category(t.id) === filter)
          .map((t, i) => {
            const g = guideForTask(t.id);
            return (
              <a className="part-card" href={t.href} key={t.id}>
                <div className="part-art">
                  {g?.detailImage && (
                    <img
                      src={`/${g.detailImage.file}`}
                      alt=""
                      loading={i > 3 ? "lazy" : "eager"}
                    />
                  )}
                  <span>{category(t.id)}</span>
                </div>
                <div className="part-card-copy">
                  <h3>{t.label}</h3>
                  <span aria-hidden="true">↗</span>
                  <p>
                    {t.id === "washer-fluid"
                      ? "상태를 직접 보고 기록"
                      : "외관 관찰 · 3개 항목"}
                  </p>
                </div>
              </a>
            );
          })}
      </div>
      <section className="reading-note">
        <h2>알고 시작해요</h2>
        <p>
          체험 결과는 이 화면에서만 확인할 수 있습니다. AI 사진 보조는 허용된 QR
          실험 연결에서만 제공됩니다. 모든 결과는 사용자 관찰이며 차량의 안전을
          인증하지 않습니다.
        </p>
        <details>
          <summary>점검 없이 부품 안내만 보기</summary>
          {infoGuides().map((g) => (
            <article key={g.partId}>
              <h3>{g.title}</h3>
              <p>{g.role}</p>
              <p>{g.vehicleApplicability.text}</p>
              <ul>
                {g.safetyNotes.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </article>
          ))}
        </details>
      </section>
    </>
  );
}
function Delivery({ sync }: { sync: SyncSnapshot | null }) {
  return (
    <section className="delivery">
      <div className="section-label">
        <h3>차량에 전달하기</h3>
        <Badge label={sync ? "QR 연결" : "이 휴대폰만"} variant="neutral" />
      </div>
      <ol>
        <li className="complete">
          <strong>01 · 사용자 점검 확정</strong>
          <p>직접 선택한 내용으로 기록을 만들었습니다.</p>
        </li>
        <li className={sync?.received ? "complete" : ""}>
          <strong>02 · 서버에 전송</strong>
          <p>
            {sync?.received
              ? "서버가 이 결과를 받았습니다."
              : "아직 전송을 확인하지 않았습니다."}
          </p>
        </li>
        <li className={sync?.display === "ACCEPTED" ? "complete" : ""}>
          <strong>03 · 차량 앱 수신</strong>
          <p>
            {sync?.display === "ACCEPTED"
              ? "차량 앱이 결과를 받아 이력에 저장했습니다."
              : "차량 앱의 수신 확인을 기다립니다."}
          </p>
        </li>
      </ol>
      {sync ? (
        <>
          <p role="status" data-sync-state={sync.display}>
            {sync.message}
          </p>
          <div className="button-row">
            {!sync.received && (
              <Button
                label={
                  ["FAILED_NETWORK", "FAILED_TIMEOUT", "RATE_LIMITED"].includes(
                    sync.display,
                  )
                    ? "같은 결과 다시 보내기"
                    : "차량으로 결과 보내기"
                }
                variant="primary"
                isDisabled={!sync.canSend}
                onClick={() => void transport?.send()}
              />
            )}
            <Button
              label="수신 상태 다시 확인"
              isDisabled={!sync.canRefresh}
              onClick={() => void transport?.refresh()}
            />
          </div>
          <p className="fine">
            차량 앱의 자동 접수는 소유자의 승인이나 차량 안전 판정이 아닙니다.
            AVD의 이력은 실제 OEM 검증 차량 이력이 아닙니다.
          </p>
        </>
      ) : (
        <p>
          이 점검은 차량에 연결되지 않았습니다. 차량 전송은 차량에서 새 QR을
          만들어 시작하세요.
        </p>
      )}
    </section>
  );
}
export function App() {
  const [catalog, setCatalog] = useState(showCatalog),
    [sync, setSync] = useState<SyncSnapshot | null>(
      transport?.snapshot ?? null,
    ),
    [exit, setExit] = useState(false),
    [cameraPaused, setCameraPaused] = useState(false),
    [aiOpen, setAiOpen] = useState(false);
  const taskId = handoff.task,
    flow = useRef(flowFor(taskId)).current;
  const [state, dispatch] = useReducer(flow.reduce, undefined, flow.initial);
  const { washer, profile } = flow,
    step = state.step,
    task = inspectionTask(taskId)!;
  const copy = taskCopy(task) ?? {
    points: [
      "안전한 곳에 정차하고 주차 상태와 전원 꺼짐을 확인하세요.",
      "보닛을 안전하게 지지하고 뜨겁거나 움직이는 부품에 접근하지 마세요.",
      "캡의 앞유리·분사 모양 표시를 확인하세요. 색만으로 부품을 구별하지 마세요.",
    ],
    limit: "수치를 측정하거나 차량의 안전을 판정하지 않습니다.",
  };
  const [washerSafe, setWasherSafe] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    lastStep = useRef(step),
    completion = useRef<string | null>(null);
  useEffect(() => subscribeSync(setSync), []);
  useEffect(() => {
    document.body.dataset.ready = "true";
    document.body.dataset.step = step;
    if (step !== lastStep.current) {
      lastStep.current = step;
      heading.current?.focus();
      window.scrollTo({ top: 0 });
    }
  }, [step]);
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
  const completed = step === "done",
    review = step === "review" || step === "confirm";
  const check = profile?.checks[state.index ?? 0];
  const question = check ? questionCopy(task, check) : null;
  const canStart =
    handoff.valid &&
    (washer
      ? washerSafe
      : !!state.safe && (!profile?.requiresNotCharging || !!state.notCharging));
  const progress =
    step === "intro"
      ? 0
      : step === "locate"
        ? 1
        : step === "check" || step === "result"
          ? 2
          : 3;
  const resultStatus = state.record?.status ?? state.choice ?? "";
  const reviewStatus = washer
    ? (state.choice ?? "")
    : Object.values(state.record?.responses ?? {}).includes("FOUND")
      ? "REVIEW_NEEDED"
      : Object.values(state.record?.responses ?? {}).includes("UNABLE")
        ? "UNABLE"
        : "NO_FINDINGS_REPORTED";
  const recordValid =
    !completed ||
    (!!state.record &&
      (washer
        ? validateResult(state.record).length === 0
        : profile!.result.validate(state.record).length === 0));
  function event(e: FlowEvent) {
    dispatch(e);
  }
  function restart() {
    if (transport) {
      transport.close();
      location.replace("/");
      return;
    }
    dispatch({ type: "RESTART" });
    setWasherSafe(false);
    completion.current = null;
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <a href="/" className="wordmark" aria-label="CarScope 홈">
          <span className="brand-symbol" aria-hidden="true">
            c<span />
          </span>
          CarScope<span className="wordmark-dot">.</span>
        </a>
        <span className="header-label">모바일 점검</span>
        {!catalog && handoff.valid && (
          <Badge
            label={sync ? "QR 점검" : "체험 점검"}
            variant={sync ? "teal" : "neutral"}
          />
        )}
      </header>
      <main id="main">
        {!handoff.valid ? (
          <section className="invalid">
            <div className="eyebrow">CONNECTION CHECK</div>
            <h1>
              이 QR로는
              <br />
              시작할 수 없어요.
            </h1>
            <p>
              유효하지 않거나 지원하지 않는 요청입니다. 차량에서 새 QR을 만들어
              다시 연결하세요.
            </p>
            <Button label="로그인 없이 체험하기" href="/" variant="primary" />
          </section>
        ) : catalog ? (
          <Catalog />
        ) : (
          <>
            <div className="inspection-top">
              <button
                className="text-back"
                onClick={() => {
                  if (step === "intro" && !transport) setCatalog(true);
                  else if (!completed) {
                    setCameraPaused(true);
                    setExit(true);
                  } else location.assign("/");
                }}
              >
                ← {step === "intro" && !transport ? "점검 목록" : "점검 나가기"}
              </button>
              <span>
                {sync
                  ? (sync.connectionMessage ?? "QR 연결 확인 중")
                  : "기록은 현재 화면에서만 유지됩니다"}
              </span>
            </div>
            <nav aria-label="점검 진행" className="progress">
              <ol>
                {["준비", "위치", "관찰", "확인·전달"].map((label, i) => (
                  <li
                    key={label}
                    aria-current={progress === i ? "step" : undefined}
                    className={i < progress || completed ? "complete" : ""}
                  >
                    <span>{i < progress || completed ? "✓" : `0${i + 1}`}</span>
                    {label}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="inspection-layout">
              <div className="inspection-content">
                <div className="task-heading">
                  <div className="eyebrow">
                    {category(taskId)} <span>SELF INSPECTION</span>
                  </div>
                  <h1 ref={heading} tabIndex={-1}>
                    {completed
                      ? "점검을 기록했어요."
                      : review
                        ? "보낸 뒤 바꿀 수 없으니,"
                        : step === "check"
                          ? "지금 보이는 모습을"
                          : step === "locate"
                            ? "어디에 있는지,"
                            : task.label}
                    <br />
                    {review
                      ? "한 번 더 확인해요."
                      : step === "check"
                        ? "알려 주세요."
                        : step === "locate"
                          ? "함께 찾아볼까요?"
                          : ""}
                  </h1>
                  {step !== "intro" && (
                    <p className="current-part">
                      {task.label}{" "}
                      {step === "check" &&
                        !washer &&
                        `· 관찰 ${(state.index ?? 0) + 1}/${profile!.checks.length}`}
                    </p>
                  )}
                </div>
                {step === "intro" && (
                  <>
                    <p className="intro-lead">
                      {profile?.description ??
                        "워셔액 주입구를 찾고, 직접 확인한 상태를 기록해요. 카메라 없이도 진행할 수 있어요."}
                    </p>
                    <div className="mini-route">
                      <span>안전 준비</span>
                      <span>직접 관찰</span>
                      <span>확인 후 전송</span>
                    </div>
                    <section className="safety-card">
                      <div className="section-label">
                        <h2>시작 전, 안전부터</h2>
                        <span aria-hidden="true">↗</span>
                      </div>
                      <ul>
                        {copy.points.map((s: string) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                      <p className="fine">
                        {profile?.safetyHelp ??
                          "안전 조건을 확인하지 못하면 시작하지 마세요. 차종별 설명서를 따르세요."}
                      </p>
                      <CheckboxInput
                        label={
                          profile?.safetyText ??
                          "안전 조건을 확인했고, 설명서에 따라 외부에서만 관찰하겠습니다"
                        }
                        value={washer ? washerSafe : !!state.safe}
                        onChange={(v) =>
                          washer
                            ? setWasherSafe(v)
                            : event({ type: "SAFETY", value: v })
                        }
                      />
                      {profile?.requiresNotCharging && (
                        <CheckboxInput
                          label={profile.extraSafety!}
                          value={!!state.notCharging}
                          onChange={(value) =>
                            event({ type: "NOT_CHARGING", value })
                          }
                        />
                      )}
                    </section>
                    <p className="fine">{copy.limit}</p>
                    <div className="action-dock">
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
                        width="100%"
                        isDisabled={!canStart}
                        onClick={() => event({ type: "START", camera: true })}
                      />
                    </div>
                  </>
                )}
                {step === "locate" && (
                  <>
                    <p>{task.position}</p>
                    <p>
                      {profile?.locateHelp ??
                        "색상만으로 구별하지 말고 사용설명서와 캡의 표시를 직접 대조하세요."}
                    </p>
                    {!cameraPaused && (
                      <Camera
                        dispatch={dispatch}
                        label={task.label}
                        taskId={taskId}
                      />
                    )}
                    <Suspense
                      fallback={<p role="status">사진 보조 준비 중…</p>}
                    >
                      {!exit && <PhotoAnalysis taskId={taskId} />}
                    </Suspense>
                    <div className="action-dock">
                      <Button
                        label="위치 확인 후 관찰하기"
                        variant="primary"
                        width="100%"
                        onClick={() => event({ type: "TO_CHECK" })}
                      />
                      <Button
                        label="카메라 없이 계속하기"
                        width="100%"
                        onClick={() =>
                          event({ type: "TO_CHECK", manual: true })
                        }
                      />
                      {washer && (
                        <Button
                          label="부품을 확인할 수 없음"
                          onClick={() => event({ type: "CANNOT_CONFIRM" })}
                        />
                      )}
                    </div>
                  </>
                )}
                {step === "check" && (
                  <>
                    {state.mode === "camera" &&
                      !cameraPaused &&
                      !state.observationStopped && (
                        <Camera
                          dispatch={dispatch}
                          label={task.label}
                          taskId={taskId}
                        />
                      )}
                    <section className="observation-card">
                      {washer ? (
                        <>
                          <h2>직접 확인한 항목만 선택하세요</h2>
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
                        </>
                      ) : (
                        <>
                          <div className="eyebrow">
                            OBSERVATION 0{(state.index ?? 0) + 1}
                          </div>
                          <h2>{question?.title}</h2>
                          <p>{check?.help}</p>
                          {question?.tip && (
                            <p className="notice">{question.tip}</p>
                          )}
                          <div
                            className="answer-list"
                            role="group"
                            aria-label="관찰 응답"
                          >
                            {Object.entries(profile!.answers).map(
                              ([answer, label]) => (
                                <button
                                  key={answer}
                                  aria-pressed={
                                    state.record?.responses?.[check!.id] ===
                                    answer
                                  }
                                  onClick={() =>
                                    event({
                                      type: "ANSWER",
                                      checkId: check!.id,
                                      answer,
                                    })
                                  }
                                >
                                  <span
                                    className="answer-indicator"
                                    aria-hidden="true"
                                  />
                                  {label}
                                </button>
                              ),
                            )}
                          </div>
                        </>
                      )}
                      {state.observationStopped && (
                        <p role="status" className="notice">
                          접근·관찰을 중단했습니다. 이미 본 내용만 기록하고,
                          나머지는 ‘확인할 수 없음’을 직접 선택하세요.
                        </p>
                      )}
                    </section>
                    {profile?.stopAdvice && (
                      <p className="notice">{profile.stopAdvice}</p>
                    )}
                    <div className="action-dock">
                      <Button
                        label={
                          washer
                            ? "관찰 결과 선택하기"
                            : (state.index ?? 0) < profile!.checks.length - 1
                              ? "다음 관찰"
                              : "전체 응답 확인하기"
                        }
                        variant="primary"
                        width="100%"
                        isDisabled={
                          washer
                            ? !CHECK_ITEMS.every((c) => state.checks?.[c.id])
                            : !state.record?.responses?.[check!.id]
                        }
                        onClick={() =>
                          event(
                            washer
                              ? { type: "TO_RESULT" }
                              : { type: "NEXT", index: state.index },
                          )
                        }
                      />
                      {washer ? (
                        <Button
                          label="직접 확인할 수 없음"
                          onClick={() => event({ type: "CANNOT_CONFIRM" })}
                        />
                      ) : (
                        profile?.supportsObservationStop &&
                        !state.observationStopped && (
                          <Button
                            label="접근과 관찰 중단"
                            onClick={() => event({ type: "STOP_OBSERVATION" })}
                          />
                        )
                      )}
                      <Button
                        label="이전 단계"
                        variant="ghost"
                        onClick={() => event({ type: "BACK" })}
                      />
                    </div>
                    <details
                      className="optional-ai"
                      open={aiOpen}
                      onToggle={(e) => setAiOpen(e.currentTarget.open)}
                    >
                      <summary>AI 사진 보조 · 선택 사항</summary>
                      <Suspense fallback={<p>사진 보조 준비 중…</p>}>
                        {aiOpen && !exit && <PhotoAnalysis taskId={taskId} />}
                      </Suspense>
                    </details>
                  </>
                )}
                {step === "result" && (
                  <>
                    <section className="observation-card">
                      <h2>워셔액 상태가 어떤가요?</h2>
                      <p>
                        직접 본 양을 기준으로 고르세요. 사진의 캡만으로 액체
                        양을 알 수 없습니다.
                      </p>
                      <div className="answer-list">
                        {Object.entries(WASHER_OUTCOME).map(([status, o]) => (
                          <button
                            key={status}
                            aria-pressed={state.choice === status}
                            onClick={() => event({ type: "SELECT", status })}
                          >
                            <span
                              className="answer-indicator"
                              aria-hidden="true"
                            />
                            {o.title}
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="action-dock">
                      <Button
                        label="선택한 결과 확인하기"
                        variant="primary"
                        width="100%"
                        isDisabled={!state.choice}
                        onClick={() => event({ type: "TO_CONFIRM" })}
                      />
                      <Button
                        label="관찰로 돌아가기"
                        variant="ghost"
                        onClick={() => event({ type: "BACK" })}
                      />
                    </div>
                  </>
                )}
                {review && (
                  <>
                    <section className="review-card">
                      <Badge label="사용자 직접 관찰" variant="teal" />
                      <h2>{outcomeTitles[reviewStatus]}</h2>
                      {profile ? (
                        <ul className="review-list">
                          {profile.checks.map((c, index) => (
                            <li key={c.id}>
                              <div>
                                <strong>{c.label}</strong>
                                <p>
                                  {
                                    answerTitles[
                                      state.record?.responses?.[c.id] ??
                                        "UNABLE"
                                    ]
                                  }
                                </p>
                              </div>
                              <Button
                                label={`${c.label} 수정`}
                                size="sm"
                                variant="ghost"
                                onClick={() => event({ type: "EDIT", index })}
                              >
                                수정
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          워셔액 상태 · {outcomeTitles[reviewStatus]}
                          <br />
                          확인하지 못한 항목은 확인한 것으로 기록하지 않습니다.
                        </p>
                      )}
                      <p className="notice">{REPORT_NOTE}</p>
                    </section>
                    <p>
                      {profile?.followup ??
                        "이상이 의심되거나 확인하지 못했다면 제조사 서비스에 문의하세요. AI의 관찰과 내 응답은 별개입니다."}
                    </p>
                    <div className="action-dock">
                      <Button
                        label="직접 확인한 결과로 확정"
                        variant="primary"
                        size="lg"
                        width="100%"
                        onClick={() => event({ type: "CONFIRM" })}
                      />
                      <p className="fine">
                        확정 후 별도로 전송합니다. 자동으로 보내지 않습니다.
                      </p>
                      <Button
                        label="응답으로 돌아가기"
                        variant="ghost"
                        onClick={() => event({ type: "BACK" })}
                      />
                    </div>
                  </>
                )}
                {completed && (
                  <>
                    <section className="completion-card">
                      <span className="completion-symbol" aria-hidden="true">
                        ✓
                      </span>
                      <Badge label="사용자 보고" variant="teal" />
                      <h2>{outcomeTitles[resultStatus]}</h2>
                      <p>{REPORT_NOTE}</p>
                      <p className="fine">
                        {state.record?.completedAt &&
                          new Date(state.record.completedAt).toLocaleString(
                            "ko-KR",
                          )}
                      </p>
                    </section>
                    {recordValid ? (
                      <Delivery sync={sync} />
                    ) : (
                      <p role="alert">
                        결과 데이터 검증에 실패해 전송하지 않았습니다. 새 점검을
                        시작하세요.
                      </p>
                    )}
                    <p className="notice">
                      {profile?.followup ??
                        "확인하지 못한 부분이나 이상이 의심되는 부분은 제조사 서비스에 문의하세요."}
                    </p>
                    <div className="action-dock">
                      <Button
                        label={
                          transport ? "연결 종료하고 홈으로" : "새 점검 시작"
                        }
                        onClick={restart}
                      />
                      <Button
                        label="다른 부품 살펴보기"
                        href="/"
                        variant="ghost"
                      />
                    </div>
                  </>
                )}
              </div>
              {completed ? (
                <details className="completion-guide">
                  <summary>부품 안내 다시 보기</summary>
                  <Guide taskId={taskId} />
                </details>
              ) : (
                <Guide taskId={taskId} />
              )}
            </div>
            {exit && (
              <ExitDialog
                cancel={() => {
                  setExit(false);
                  setCameraPaused(false);
                }}
                confirm={() => {
                  setExit(false);
                  event({ type: "CANCEL" });
                  setWasherSafe(false);
                  setCameraPaused(false);
                  transport?.close();
                  if (transport) location.replace("/");
                }}
              />
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>CarScope</span>
        <p>눈으로 관찰하고, 내가 확인한 만큼만 기록해요.</p>
      </footer>
    </div>
  );
}

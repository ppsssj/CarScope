import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import {
  CAMERA_STATES,
  COPY,
  MOCK,
  STATUS,
  primaryAction,
  reduce,
  stateFromHash,
  type CameraState,
  type LabState,
} from "./model";
import { MockScene, WasherSymbol } from "./MockScene";

const LAB_LABEL: Record<CameraState, string> = {
  idle: "대기",
  requesting: "권한 요청",
  live: "촬영 중",
  marked: "위치 표시",
  denied: "권한 거부",
  unsupported: "미지원",
};

function init(): LabState {
  return reduce(
    { camera: "idle", mark: null },
    { type: "JUMP", state: stateFromHash(location.hash) },
  );
}

/** Toast: feedback for a completed action, polite live region, 3000ms (TDS). */
function useToast() {
  const [text, setText] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    text,
    show(message: string) {
      clearTimeout(timer.current);
      setText(message);
      timer.current = window.setTimeout(() => setText(""), 3000);
    },
  };
}

export function CameraLab() {
  const [state, dispatch] = useReducer(reduce, undefined, init);
  const toast = useToast();
  const finder = useRef<HTMLDivElement>(null);
  const { camera, mark } = state;
  const copy = COPY[camera];
  const primary = primaryAction(camera);
  const pictureOn = camera === "live" || camera === "marked";
  const blocked = camera === "denied" || camera === "unsupported";

  useEffect(() => {
    const onHash = () =>
      dispatch({ type: "JUMP", state: stateFromHash(location.hash) });
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // MOCK permission prompt: resolves after a short, fixed wait. No getUserMedia.
  useEffect(() => {
    if (camera !== "requesting") return;
    const t = setTimeout(() => dispatch({ type: "GRANTED" }), 900);
    return () => clearTimeout(t);
  }, [camera]);

  useEffect(() => {
    document.body.dataset.labState = camera;
  }, [camera]);

  function onPrimary() {
    if (primary.intent === "start") dispatch({ type: "START" });
    else
      toast.show(
        "실험 화면이라 다음 단계로 넘어가지 않아요. 실제 점검에는 영향이 없어요.",
      );
  }

  function markAt(clientX: number, clientY: number) {
    const r = finder.current!.getBoundingClientRect();
    dispatch({
      type: "MARK",
      point: { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height },
    });
  }

  const c = MOCK.candidate;
  return (
    <div className="tl-app" data-state={camera}>
      <header className="tl-top">
        <button
          type="button"
          className="tl-icon-btn"
          aria-label="점검 나가기"
          onClick={() => toast.show("실험 화면에서는 나가기가 동작하지 않아요.")}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <p className="tl-top-title">{MOCK.taskLabel} 점검</p>
        <p className="tl-top-step">
          <span className="tl-sr">진행 </span>
          {MOCK.step.index}/{MOCK.step.total}
        </p>
      </header>
      <div
        className="tl-progress"
        role="progressbar"
        aria-label="점검 진행"
        aria-valuemin={0}
        aria-valuemax={MOCK.step.total}
        aria-valuenow={MOCK.step.index}
        aria-valuetext={`${MOCK.step.total}단계 중 ${MOCK.step.index}단계, ${MOCK.step.name}`}
      >
        <span style={{ width: `${(MOCK.step.index / MOCK.step.total) * 100}%` }} />
      </div>

      <main className="tl-main">
        <p className="tl-mock-note">
          <Badge label="모의 데이터" variant="neutral" />
          <span>실제 카메라·AI·전송을 쓰지 않는 디자인 실험이에요.</span>
        </p>

        <p className="tl-eyebrow">
          {MOCK.step.index}단계 · {MOCK.step.name}
        </p>
        <h1 className="tl-title">
          {copy.title}
        </h1>
        <p className="tl-body">{copy.body}</p>

        <div
          ref={finder}
          className="tl-finder"
          data-picture={pictureOn ? "on" : blocked ? "blocked" : "off"}
        >
          {pictureOn ? (
            <>
              <MockScene />
              <span className="tl-corners" aria-hidden="true" />
              <span
                className="tl-candidate"
                aria-hidden="true"
                style={{
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  width: `${c.width * 100}%`,
                  height: `${c.height * 100}%`,
                }}
              >
                <span>색 후보 · 미검증</span>
              </span>
              {mark && (
                <span
                  className="tl-mark"
                  aria-hidden="true"
                  style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                >
                  <span className="tl-mark-label">내가 표시한 곳</span>
                </span>
              )}
              <span className="tl-finder-chip tl-finder-chip-start" aria-hidden="true">
                모의 화면
              </span>
              {/* Tap surface and controls are siblings: no nested interactive roles. */}
              <div
                className="tl-finder-tap"
                role="button"
                tabIndex={0}
                aria-label={
                  mark
                    ? "모의 카메라 화면. 누르면 표시를 옮겨요"
                    : "모의 카메라 화면. 누르면 그 위치를 표시해요"
                }
                onClick={(e) => markAt(e.clientX, e.clientY)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    dispatch({ type: "MARK", point: { x: 0.5, y: 0.5 } });
                  }
                }}
              />
              <div className="tl-finder-controls">
                <button
                  type="button"
                  className="tl-chip"
                  onClick={() =>
                    mark
                      ? dispatch({ type: "CLEAR_MARK" })
                      : dispatch({ type: "MARK", point: { x: 0.5, y: 0.5 } })
                  }
                >
                  {mark ? "표시 지우기" : "가운데에 표시"}
                </button>
                <button
                  type="button"
                  className="tl-chip"
                  onClick={() => dispatch({ type: "STOP" })}
                >
                  카메라 끄기
                </button>
              </div>
            </>
          ) : (
            <div className="tl-finder-empty">
              <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
                <path
                  d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                {blocked && (
                  <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                )}
              </svg>
              <p>
                {camera === "requesting"
                  ? "권한 창에서 ‘허용’을 눌러 주세요"
                  : blocked
                    ? "카메라 화면 없이 진행해요"
                    : "카메라를 켜면 여기에 보여요"}
              </p>
            </div>
          )}
        </div>

        <p role="status" className="tl-status">
          {STATUS[camera]}
        </p>

        {camera === "denied" && (
          <section className="tl-section" aria-labelledby="tl-permission">
            <h2 id="tl-permission" className="tl-h2">
              카메라를 다시 쓰려면
            </h2>
            <ol className="tl-steps">
              <li>주소창 왼쪽의 사이트 정보 아이콘을 눌러요.</li>
              <li>카메라를 ‘허용’으로 바꿔요.</li>
              <li>이 화면으로 돌아와 ‘권한 다시 요청하기’를 눌러요.</li>
            </ol>
          </section>
        )}

        <section className="tl-section" aria-labelledby="tl-looks">
          <h2 id="tl-looks" className="tl-h2">
            이런 점을 확인해 주세요
          </h2>
          <ul className="tl-list">
            {MOCK.looks.map((item, i) => (
              <li key={item.title} className="tl-row">
                <span className="tl-row-lead" aria-hidden="true">
                  {i === 0 ? <WasherSymbol size={24} /> : i + 1}
                </span>
                <span className="tl-row-text">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="tl-caption">찾아볼 곳 · {MOCK.area}</p>
        </section>

        <section className="tl-section tl-safety" aria-labelledby="tl-safety">
          <h2 id="tl-safety" className="tl-h2">
            보닛을 열기 전에
          </h2>
          <ul>
            {MOCK.safety.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        <aside className="tl-lab" aria-label="실험 도구">
          <p className="tl-lab-title">실험 도구 · 제품 화면 아님</p>
          <p className="tl-lab-body">모의 상태를 바로 열어 볼 수 있어요.</p>
          <nav className="tl-lab-states" aria-label="모의 상태">
            {CAMERA_STATES.map((s) => (
              <a key={s} href={`#${s}`} aria-current={s === camera ? "true" : undefined}>
                {LAB_LABEL[s]}
              </a>
            ))}
          </nav>
        </aside>
      </main>

      <div className="tl-cta">
        <Button
          label={primary.label}
          variant="primary"
          size="lg"
          width="100%"
          isLoading={primary.loading}
          onClick={onPrimary}
        />
        {pictureOn && (
          <Button
            label="주입구를 찾을 수 없어요"
            variant="ghost"
            size="lg"
            width="100%"
            onClick={() =>
              toast.show("실험 화면이라 기록하지 않아요. 실제 점검에는 영향이 없어요.")
            }
          />
        )}
        {(camera === "idle" || camera === "requesting") && (
          <Button
            label="카메라 없이 계속하기"
            variant="ghost"
            size="lg"
            width="100%"
            isDisabled={camera === "requesting"}
            onClick={() =>
              toast.show("실험 화면이라 다음 단계로 넘어가지 않아요. 실제 점검에는 영향이 없어요.")
            }
          />
        )}
        {camera === "denied" && (
          <Button
            label="권한 다시 요청하기"
            variant="ghost"
            size="lg"
            width="100%"
            onClick={() => dispatch({ type: "START" })}
          />
        )}
      </div>

      <div className="tl-toast-region" aria-live="polite">
        {toast.text && <p className="tl-toast">{toast.text}</p>}
      </div>
    </div>
  );
}

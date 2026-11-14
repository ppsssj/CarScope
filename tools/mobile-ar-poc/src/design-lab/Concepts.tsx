import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { tasks } from "./model";
import type { Lab } from "./useLab";
import { PartObject } from "./PartObject";
import {
  LabTop,
  Title,
  TaskIndex,
  Safety,
  CameraScene,
  AiControls,
  Evidence,
  HumanReport,
  DeliveryControls,
  StepBack,
} from "./shared";

const stages = ["탐색", "준비", "관찰", "확인", "전달"];
function Progress({ lab }: { lab: Lab }) {
  return (
    <ol className="journey" aria-label="점검 진행">
      {["explore", "prepare", "camera", "analysis", "delivery"].map((s, i) => (
        <li key={s} aria-current={lab.state.stage === s ? "step" : undefined}>
          <span>0{i + 1}</span>
          {stages[i]}
        </li>
      ))}
    </ol>
  );
}
function Begin({
  lab,
  label = "이 부품 점검 준비",
}: {
  lab: Lab;
  label?: string;
}) {
  return (
    <Button
      label={label}
      variant="primary"
      size="lg"
      onClick={() => lab.dispatch({ type: "PREPARE" })}
    />
  );
}
function TaskCaption({ lab }: { lab: Lab }) {
  return (
    <div className="task-caption">
      <span>
        {lab.task.code} / {lab.task.zone}
      </span>
      <strong>{lab.task.label}</strong>
      <p>{lab.task.position}</p>
    </div>
  );
}

export function Scope({ lab }: { lab: Lab }) {
  const s = lab.state;
  return (
    <div className="concept scope">
      <LabTop concept="scope" />
      <main>
        <div className="instrument-header">
          <span>SCOPE / FIELD INSTRUMENT</span>
          <span>SIM 01</span>
        </div>
        <Progress lab={lab} />
        {s.stage === "explore" ? (
          <>
            <Title kicker="01 — SELECT YOUR SUBJECT">
              차를 살피는
              <br />
              새로운 시선.
            </Title>
            <p className="intro">
              하나를 고르고, 가까이 보고,
              <br />
              직접 확인한 사실을 남기세요.
            </p>
            <div className="scope-subject">
              <span className="instrument-corner">OPTICAL STUDY / 01</span>
              <PartObject task={lab.task} mode="instrument" />
              <TaskCaption lab={lab} />
              <div className="scope-reading">
                <span>외관 관찰</span>
                <span>분해 없음</span>
                <span>판정은 직접</span>
              </div>
            </div>
            <div className="scope-toolrail" aria-label="점검 도구 선택">
              {tasks.map((t) => (
                <button
                  key={t.id}
                  aria-label={`${t.code} ${t.label}`}
                  aria-pressed={t.id === s.taskId}
                  onClick={() => lab.dispatch({ type: "SELECT", id: t.id })}
                >
                  <span>{t.code.slice(3)}</span>
                  <strong>{t.label}</strong>
                </button>
              ))}
            </div>
            <Begin lab={lab} />
            <TaskIndex lab={lab} />
          </>
        ) : s.stage === "prepare" ? (
          <>
            <StepBack lab={lab} />
            <Title kicker="02 — FIELD BRIEFING">
              {lab.task.label}
              <br />
              접근 전 브리핑.
            </Title>
            <div className="scope-prep">
              <PartObject task={lab.task} mode="instrument" />
              <p>
                실제 위치는 차량 설명서와 대조하세요.
                <br />이 도해는 차량 형상·수치의 근거가 아닙니다.
              </p>
            </div>
            <Safety lab={lab} />
          </>
        ) : s.stage === "camera" ? (
          <>
            <Title kicker={`03 — ${lab.task.code} / OBSERVATION`}>
              가까이 보고,
              <br />
              멈춰서 확인.
            </Title>
            <CameraScene lab={lab} variant="scope" />
          </>
        ) : s.stage === "analysis" ? (
          <>
            <Title kicker="04 — EVIDENCE / NOT A DIAGNOSIS">
              관찰과 판단을
              <br />
              분리합니다.
            </Title>
            <div className="scope-analysis">
              <div className="scope-evidence">
                <PartObject task={lab.task} mode="instrument" />
                <Evidence lab={lab} />
              </div>
              <AiControls lab={lab} />
              <HumanReport lab={lab} />
            </div>
          </>
        ) : (
          <>
            <Title kicker="05 — SIGNAL PATH">
              보고는 끝났고,
              <br />
              전달은 남았습니다.
            </Title>
            <div className={`signal-path status-${s.delivery}`}>
              {["사용자 확인", "서버 접수", "차량 앱 수신"].map((label, i) => (
                <div
                  key={label}
                  className={
                    i === 0 ||
                    (i === 1 && ["server", "vehicle"].includes(s.delivery)) ||
                    (i === 2 && s.delivery === "vehicle")
                      ? "signal-done"
                      : ""
                  }
                >
                  <span className="signal-dot" />
                  <span>0{i + 1}</span>
                  <strong>{label}</strong>
                  <small>
                    {i === 0
                      ? "모의 보고 확정"
                      : i === 1
                        ? ["server", "vehicle"].includes(s.delivery)
                          ? "모의 접수됨"
                          : "접수 전"
                        : s.delivery === "vehicle"
                          ? "모의 수신됨"
                          : "수신 전"}
                  </small>
                </div>
              ))}
            </div>
            <DeliveryControls lab={lab} />
          </>
        )}
      </main>
      <footer className="concept-foot">
        SCOPE — 관찰을 위한 도구. 안전을 인증하는 도구가 아닙니다.
      </footer>
    </div>
  );
}

export function Atlas({ lab }: { lab: Lab }) {
  const s = lab.state;
  const [zone, setZone] = useState(lab.task.zone),
    [spread, setSpread] = useState(0),
    [turn, setTurn] = useState(0),
    [layer, setLayer] = useState<"seen" | "unknown">("seen");
  const zones = [...new Set(tasks.map((t) => t.zone))],
    near = tasks.filter((t) => t.zone === zone),
    index = near.findIndex((t) => t.id === s.taskId);
  const choose = (id: string) => {
    lab.dispatch({ type: "SELECT", id });
    setSpread(0);
  };
  return (
    <div className="concept atlas">
      <LabTop concept="atlas" />
      <main>
        <div className="atlas-name">
          ATLAS<span>작은 부품, 넓은 이해.</span>
        </div>
        <Progress lab={lab} />
        {s.stage === "explore" ? (
          <>
            <Title kicker="A WORKSPACE FOR YOUR CAR">
              어디부터
              <br />
              살펴볼까요?
            </Title>
            <div className="zone-tabs" role="group" aria-label="차량 영역">
              {zones.map((z) => (
                <button
                  key={z}
                  aria-pressed={z === zone}
                  onClick={() => {
                    setZone(z);
                    choose(tasks.find((t) => t.zone === z)!.id);
                  }}
                >
                  {z}
                </button>
              ))}
            </div>
            <div className="atlas-stage">
              <span className="orbit-label">
                OBJECT {String(tasks.indexOf(lab.task) + 1).padStart(2, "0")} /
                17
              </span>
              <PartObject
                task={lab.task}
                mode="object"
                spread={spread}
                turn={turn}
              />
              <span className="object-note">
                드래그 대신 아래 조절기로
                <br />
                구조를 펼쳐보세요.
              </span>
            </div>
            <div className="object-dial">
              <button
                aria-label="이전 부품"
                onClick={() =>
                  choose(near[(index - 1 + near.length) % near.length].id)
                }
              >
                ←
              </button>
              <TaskCaption lab={lab} />
              <button
                aria-label="다음 부품"
                onClick={() => choose(near[(index + 1) % near.length].id)}
              >
                →
              </button>
            </div>
            <div className="object-sliders">
              <label>
                구조 펼치기
                <input
                  type="range"
                  aria-label="구조 펼치기"
                  min="0"
                  max="100"
                  value={spread}
                  onChange={(e) => setSpread(Number(e.target.value))}
                />
              </label>
              <label>
                시점 돌리기
                <input
                  type="range"
                  aria-label="시점 돌리기"
                  min="-15"
                  max="15"
                  value={turn}
                  onChange={(e) => setTurn(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="fine-print">
              설명용 도해입니다. 실제 위치·형상은 차량 설명서를 확인하세요.
            </p>
            <Begin lab={lab} label="이 부품을 알아보고 시작" />
            <TaskIndex lab={lab} />
          </>
        ) : s.stage === "prepare" ? (
          <>
            <StepBack lab={lab} />
            <Title kicker="OPEN THE WORKSPACE">
              {lab.task.label},<br />세 가지만 먼저.
            </Title>
            <div className="atlas-prep">
              <PartObject task={lab.task} mode="object" spread={45} />
              <div>
                <span>01 / 위치 대조</span>
                <span>02 / 접근 조건</span>
                <span>03 / 직접 관찰</span>
              </div>
            </div>
            <Safety lab={lab} />
          </>
        ) : s.stage === "camera" ? (
          <>
            <Title kicker="MATCH / OBSERVE / KEEP">
              화면보다
              <br />
              실물을 보세요.
            </Title>
            <CameraScene lab={lab} variant="atlas" />
            <p className="atlas-aside">
              보이는 것과 보이지 않는 것을 구분하는 연습입니다. 모의 장면은 점검
              근거가 아닙니다.
            </p>
          </>
        ) : s.stage === "analysis" ? (
          <>
            <Title kicker="TWO LAYERS OF EVIDENCE">
              보인 것.
              <br />
              아직 모르는 것.
            </Title>
            <div className="layer-tabs" role="group" aria-label="관찰 레이어">
              <button
                aria-pressed={layer === "seen"}
                onClick={() => setLayer("seen")}
              >
                표면에서 본 것
              </button>
              <button
                aria-pressed={layer === "unknown"}
                onClick={() => setLayer("unknown")}
              >
                사진 밖의 것
              </button>
            </div>
            <div className={`atlas-evidence ${layer}`}>
              <PartObject
                task={lab.task}
                mode="object"
                spread={layer === "unknown" ? 70 : 0}
              />
              <p>
                {layer === "seen"
                  ? "외관의 일부만 관찰할 수 있습니다."
                  : "내부 상태와 작동 성능은 이 사진으로 알 수 없습니다."}
              </p>
            </div>
            <Evidence lab={lab} />
            <AiControls lab={lab} />
            <HumanReport lab={lab} />
          </>
        ) : (
          <>
            <Title kicker="HANDOFF / THREE LAYERS">
              같은 보고,
              <br />
              다른 도착점.
            </Title>
            <div className={`handoff-stack status-${s.delivery}`}>
              <div>
                <span>01 / YOU</span>
                <h2>직접 확인한 보고</h2>
                <p>모의 확정 · 전송과 별도</p>
              </div>
              <div
                className={
                  ["server", "vehicle"].includes(s.delivery) ? "arrived" : ""
                }
              >
                <span>02 / SERVER</span>
                <h2>서버 접수</h2>
                <p>
                  {["server", "vehicle"].includes(s.delivery)
                    ? "모의 접수 완료"
                    : "아직 접수 전"}
                </p>
              </div>
              <div className={s.delivery === "vehicle" ? "arrived" : ""}>
                <span>03 / VEHICLE</span>
                <h2>차량 앱 수신</h2>
                <p>
                  {s.delivery === "vehicle"
                    ? "모의 수신 완료"
                    : "서버 접수 후에도 별도 확인"}
                </p>
              </div>
            </div>
            <DeliveryControls lab={lab} />
          </>
        )}
      </main>
      <footer className="concept-foot">
        ATLAS — 조작 가능한 이해의 공간. 모든 값은 모의 데이터입니다.
      </footer>
    </div>
  );
}

export function Logbook({ lab }: { lab: Lab }) {
  const s = lab.state;
  const zones = [...new Set(tasks.map((t) => t.zone))];
  return (
    <div className="concept logbook">
      <LabTop concept="logbook" />
      <main>
        <div className="journal-masthead">
          <span>No. 018</span>
          <strong>THE CAR JOURNAL</strong>
          <span>모의 기록</span>
        </div>
        <Progress lab={lab} />
        {s.stage === "explore" ? (
          <>
            <Title kicker="A LITTLE CARE, REGULARLY.">
              오늘의 작은 관심이
              <br />
              다음 여정을 만듭니다.
            </Title>
            <p className="journal-intro">
              모든 것을 한 번에 끝낼 필요는 없어요.
              <br />
              오늘 살펴볼 곳을 골라 나만의 순서를 만드세요.
            </p>
            <div className="history-strip">
              <span>모의 기록 / 실제 이력 아님</span>
              <div>
                <i />
                <i />
                <i className="today" />
                <i />
                <i />
              </div>
              <p>지난 관찰 → 오늘의 계획 → 다음 점검</p>
            </div>
            <div className="journal-dock">
              <p>
                <strong>{s.plan.length}개</strong>를 오늘의 계획에 담았습니다.
                <br />
                <span>먼저: {lab.task.label}</span>
              </p>
              <Begin lab={lab} label="선택한 점검 준비" />
            </div>
            <section className="journal-plan" aria-label="오늘의 점검 계획">
              {zones.map((z) => (
                <div key={z} className="plan-group">
                  <h2>{z}</h2>
                  {tasks
                    .filter((t) => t.zone === z)
                    .map((t) => (
                      <div className="plan-row" key={t.id}>
                        <button
                          className="plan-check"
                          aria-label={`${t.label} 계획 ${s.plan.includes(t.id) ? "빼기" : "추가"}`}
                          aria-pressed={s.plan.includes(t.id)}
                          onClick={() =>
                            lab.dispatch({ type: "PLAN", id: t.id })
                          }
                        >
                          {s.plan.includes(t.id) ? "✓" : "+"}
                        </button>
                        <button
                          className="plan-title"
                          data-task={t.id}
                          aria-pressed={s.taskId === t.id}
                          onClick={() =>
                            lab.dispatch({ type: "SELECT", id: t.id })
                          }
                        >
                          <span>{t.label}</span>
                          <small>{t.code} · 직접 관찰</small>
                        </button>
                        <span className="plan-arrow">↗</span>
                      </div>
                    ))}
                </div>
              ))}
            </section>
          </>
        ) : s.stage === "prepare" ? (
          <>
            <StepBack lab={lab} />
            <Title kicker="BEFORE THE FIRST NOTE">
              {lab.task.label}
              <br />
              천천히 시작해요.
            </Title>
            <div className="journal-illustration">
              <PartObject task={lab.task} mode="ink" />
              <p>Fig. {lab.task.code.slice(3)} — 외관 관찰용 설명 도해</p>
            </div>
            <aside className="journal-itinerary">
              <span>오늘의 계획</span>
              <ol>
                {s.plan.map((id) => (
                  <li
                    key={id}
                    aria-current={s.taskId === id ? "step" : undefined}
                  >
                    {tasks.find((t) => t.id === id)!.label}
                  </li>
                ))}
              </ol>
            </aside>
            <Safety lab={lab} />
          </>
        ) : s.stage === "camera" ? (
          <>
            <Title kicker="FIELD NOTE / 01">
              한 장의 관찰,
              <br />한 줄의 기록.
            </Title>
            <p className="journal-intro">
              확실하지 않은 부분은 비워두어도 괜찮아요.
              <br />
              ‘확인 불가’도 필요한 점검 기록입니다.
            </p>
            <CameraScene lab={lab} variant="logbook" />
          </>
        ) : s.stage === "analysis" ? (
          <>
            <Title kicker="NOTES & YOUR ACCOUNT">
              도움받은 관찰과
              <br />
              내가 본 사실.
            </Title>
            <div className="journal-annotation">
              <span className="margin-note">
                참고 메모
                <br />
                확정 전
              </span>
              <Evidence lab={lab} />
            </div>
            <AiControls lab={lab} />
            <HumanReport lab={lab} />
          </>
        ) : (
          <>
            <Title kicker="A RECORD HAS A JOURNEY, TOO.">
              기록을 남긴 뒤에도
              <br />
              도착을 확인해요.
            </Title>
            <div className="journal-receipt">
              <div>
                <span>모의 보고 / CS-018</span>
                <strong>{lab.task.label}</strong>
              </div>
              <ol>
                {s.events.map((event, i) => (
                  <li key={`${i}-${event}`}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {event}
                  </li>
                ))}
              </ol>
              <p>
                {s.delivery === "vehicle"
                  ? "모의 차량 앱 수신까지 기록했습니다."
                  : "차량 앱 수신은 아직 확인되지 않았습니다."}
              </p>
            </div>
            <DeliveryControls lab={lab} />
          </>
        )}
      </main>
      <footer className="concept-foot">
        LOGBOOK — 성급한 판정 대신, 이어지는 관찰.
      </footer>
    </div>
  );
}

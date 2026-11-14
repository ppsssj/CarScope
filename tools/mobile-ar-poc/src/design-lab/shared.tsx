import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { Concept, Task } from "./model";
import { tasks } from "./model";
import type { Lab } from "./useLab";
import { PartObject } from "./PartObject";
export function LabTop({ concept }: { concept: Concept }) {
  return (
    <>
      <div className="lab-notice">
        DESIGN LAB · 모의 카메라 / AI / 수신 · 외부 전송 없음
      </div>
      <header className="lab-top">
        <a href="/design-lab/" aria-label="디자인 3안 비교 홈">
          CarScope<span>®</span>
        </a>
        <nav aria-label="콘셉트 전환">
          {(["scope", "atlas", "logbook"] as const).map((c, i) => (
            <a
              key={c}
              href={`/design-lab/${c}`}
              aria-current={c === concept ? "page" : undefined}
            >
              {String.fromCharCode(65 + i)}
              <span>{c}</span>
            </a>
          ))}
        </nav>
      </header>
    </>
  );
}
export function Title({
  kicker,
  children,
}: {
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lab-title">
      <p className="lab-kicker">{kicker}</p>
      <h1 data-stage-title tabIndex={-1}>
        {children}
      </h1>
    </div>
  );
}
export function TaskIndex({ lab }: { lab: Lab }) {
  return (
    <details className="task-index">
      <summary>전체 17개 점검 대상</summary>
      <div className="index-rows">
        {tasks.map((t) => (
          <button
            key={t.id}
            data-task={t.id}
            onClick={() => lab.dispatch({ type: "SELECT", id: t.id })}
            aria-pressed={t.id === lab.task.id}
          >
            <span>{t.code}</span>
            {t.label}
            <span>↗</span>
          </button>
        ))}
      </div>
    </details>
  );
}
export function Safety({ lab }: { lab: Lab }) {
  return (
    <section className="lab-safety" aria-label="필수 안전 준비">
      <h2>접근하기 전에</h2>
      {lab.task.safety.map((s, i) => (
        <p key={s}>
          <span className="number">0{i + 1}</span>
          {s}
        </p>
      ))}
      <CheckboxInput
        label="위 안전 조건을 모두 확인했습니다"
        value={lab.state.safe}
        onChange={(value) => lab.dispatch({ type: "SAFETY", value })}
      />
      <Button
        label="준비 완료 · 점검으로"
        variant="primary"
        size="lg"
        isDisabled={!lab.state.safe}
        onClick={() => lab.dispatch({ type: "START" })}
      />
    </section>
  );
}
export function CameraScene({ lab, variant }: { lab: Lab; variant: Concept }) {
  const [grid, setGrid] = useState(false),
    [mark, setMark] = useState(false),
    [frame, setFrame] = useState(50);
  return (
    <section
      className={`camera-scene ${variant} ${grid ? "with-grid" : ""} ${lab.state.camera === "live" ? "scene-live" : ""}`}
      aria-label="모의 카메라 작업 공간"
    >
      <div className="scene-visual">
        <PartObject
          task={lab.task}
          mode={
            variant === "scope"
              ? "instrument"
              : variant === "atlas"
                ? "object"
                : "ink"
          }
          turn={(frame - 50) * 0.18}
        />
        <div className="scene-reticle" aria-hidden="true">
          {mark && <span>＋</span>}
        </div>
        <span className="scene-source">SIMULATED VIEW · 실제 영상 아님</span>
        <span className="scene-code">{lab.task.code}</span>
      </div>
      <div className="scene-controls">
        <div className="small-actions">
          <Button
            label={
              lab.state.camera === "live" ? "모의 장면 끄기" : "모의 장면 켜기"
            }
            onClick={() => lab.dispatch({ type: "CAMERA" })}
          />
          <Button
            label={grid ? "격자 끄기" : "격자 켜기"}
            onClick={() => setGrid(!grid)}
          />
          <Button
            label={mark ? "표시 지우기" : "위치 직접 표시"}
            onClick={() => setMark(!mark)}
          />
        </div>
        <label className="lab-range">
          구도 살펴보기 · 모의 조작
          <input
            type="range"
            aria-label="모의 구도 조절"
            min="0"
            max="100"
            value={frame}
            onChange={(e) => setFrame(Number(e.target.value))}
          />
        </label>
        <p className="scene-status" role="status">
          {lab.state.camera === "denied"
            ? "카메라 권한 거부를 재현했습니다. 수동 관찰로 계속할 수 있습니다."
            : lab.state.camera === "live"
              ? "모의 장면 활성 · 실제 카메라 권한은 요청하지 않습니다."
              : "설명용 장면입니다. 실제 차량의 위치·수치를 알 수 없습니다."}
        </p>
        <div className="capture-row">
          <Button
            label="권한 거부 재현"
            variant="ghost"
            onClick={() => lab.dispatch({ type: "CAMERA", value: "denied" })}
          />
          <button
            className="shutter"
            aria-label="모의 촬영"
            onClick={() => lab.dispatch({ type: "CAPTURE", value: true })}
          >
            <span />
          </button>
          <Button
            label="수동으로 계속"
            variant="ghost"
            onClick={() => lab.dispatch({ type: "CAPTURE", value: false })}
          />
        </div>
      </div>
    </section>
  );
}
export function AiControls({ lab }: { lab: Lab }) {
  const s = lab.state;
  return (
    <section className="ai-controls">
      <label className="scenario-picker">
        실험할 모의 응답
        <select
          aria-label="모의 AI 시나리오"
          value={s.scenario}
          onChange={(e) =>
            lab.dispatch({ type: "SCENARIO", value: e.target.value })
          }
        >
          <option value="finding">외관 징후 관찰</option>
          <option value="uncertain">판단 불가</option>
          <option value="failure">분석 실패</option>
        </select>
      </label>
      <p>
        이 프로토타입은 원본 사진과 인증 자료를 사용하지 않습니다. 실제
        제품에서는 외부 AI에 보낼 영역과 처리 조건을 별도로 확인해야 합니다.
      </p>
      <CheckboxInput
        label="사진 분석 동의 절차를 모의 체험합니다"
        value={s.consent}
        onChange={(value) => lab.dispatch({ type: "CONSENT", value })}
      />
      <Button
        label={s.ai === "busy" ? "모의 분석 중" : "모의 AI 분석"}
        variant="primary"
        isDisabled={!s.consent || !s.captured || s.ai === "busy"}
        onClick={() => lab.dispatch({ type: "ANALYZE" })}
      />
      {!s.captured && (
        <p>수동 관찰 경로입니다. AI 없이 아래 응답을 직접 선택하세요.</p>
      )}
      {s.ai === "failed" && (
        <p role="alert">
          모의 분석 실패 · 성공 결과를 만들지 않았습니다. 다시 동의해
          재시도하거나 수동으로 계속하세요.
        </p>
      )}
    </section>
  );
}
export function Evidence({ lab }: { lab: Lab }) {
  const s = lab.state;
  return (
    <div className="evidence-copy" aria-live="polite">
      {s.ai === "busy" ? (
        <p>모의 사진에서 관찰할 영역을 분리하고 있습니다…</p>
      ) : s.ai === "result" ? (
        <>
          <p className="source-label">MOCK AI OBSERVATION</p>
          <h2>
            {s.scenario === "uncertain"
              ? "이 장면만으로는 판단하기 어려워요."
              : "모의 장면에 외관 징후가 표시됐어요."}
          </h2>
          <dl>
            <div>
              <dt>관찰한 범위</dt>
              <dd>{lab.task.label}의 외부 표면 일부</dd>
            </div>
            <div>
              <dt>알 수 없는 것</dt>
              <dd>가려진 면, 작동 성능, 차량 안전</dd>
            </div>
            <div>
              <dt>다음 행동</dt>
              <dd>실제 부품을 직접 보고 아래 응답을 선택하세요.</dd>
            </div>
          </dl>
          <p>
            AI 관찰은 차량 안전 인증이 아닙니다. 사용자 보고에 자동 반영되지
            않습니다.
          </p>
        </>
      ) : (
        <>
          <p className="source-label">PROVISIONAL EVIDENCE</p>
          <h2>
            사진의 관찰과
            <br />내 확인은 따로.
          </h2>
          <p>
            선택적 모의 AI 분석을 실행하거나, 직접 관찰한 내용만 기록하세요.
          </p>
        </>
      )}
    </div>
  );
}
export function HumanReport({ lab }: { lab: Lab }) {
  return (
    <section className="human-report">
      <div className="report-heading">
        <span>HUMAN OBSERVATION</span>
        <h2>내가 확인한 만큼만.</h2>
      </div>
      {lab.task.checks.map((check, i) => (
        <fieldset key={check}>
          <legend>
            <span>0{i + 1}</span>
            {check}
          </legend>
          <div className="report-answers">
            {(
              [
                ["FOUND", "징후 발견"],
                ["NOT_FOUND", "발견 못함"],
                ["UNABLE", "확인 불가"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={lab.state.answers[i] === value}
                onClick={() =>
                  lab.dispatch({ type: "ANSWER", id: String(i), value })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <CheckboxInput
        label="AI의 한계를 이해했고, 직접 본 응답을 확인합니다"
        value={lab.state.ack}
        onChange={(value) => lab.dispatch({ type: "ACK", value })}
      />
      <div className="report-footer">
        <Button
          label="사용자 보고 확정"
          variant="primary"
          size="lg"
          isDisabled={!lab.canConfirm}
          onClick={() => lab.dispatch({ type: "CONFIRM" })}
        />
        <Button
          label="다시 관찰하기"
          variant="ghost"
          onClick={() => lab.dispatch({ type: "RETAKE" })}
        />
      </div>
    </section>
  );
}
export function DeliveryControls({ lab }: { lab: Lab }) {
  const s = lab.state;
  return (
    <div className="delivery-controls">
      <p role="status">
        {s.delivery === "vehicle"
          ? "모의 차량 앱 수신까지 확인했습니다."
          : s.delivery === "failed"
            ? "모의 네트워크 장애입니다. 실제 수신 여부를 만들지 않았습니다."
            : s.delivery === "server"
              ? "모의 서버만 접수했습니다. 차량 앱 수신은 아직입니다."
              : s.delivery === "sending"
                ? "모의 전송 요청을 보냈습니다. 접수 전입니다."
                : "사용자 보고를 확정했습니다. 아직 전송하지 않았습니다."}
      </p>
      {["idle", "failed"].includes(s.delivery) && (
        <Button
          label={
            s.delivery === "failed" ? "같은 모의 보고 재시도" : "모의 전송 시작"
          }
          variant="primary"
          size="lg"
          onClick={() => lab.dispatch({ type: "SEND" })}
        />
      )}
      <div className="simulation-actions">
        {s.delivery === "sending" && (
          <Button
            label="모의 서버 접수 진행"
            onClick={() => lab.dispatch({ type: "SERVER" })}
          />
        )}
        {s.delivery === "server" && (
          <Button
            label="모의 차량 수신 진행"
            onClick={() => lab.dispatch({ type: "VEHICLE" })}
          />
        )}
        {["sending", "server"].includes(s.delivery) && (
          <Button
            label="네트워크 실패 재현"
            variant="ghost"
            onClick={() => lab.dispatch({ type: "NETWORK_FAIL" })}
          />
        )}
      </div>
      <p className="fine-print">
        모든 단계는 모의 데이터입니다. 실제 서버·차량에 보내지 않습니다. 차량
        앱의 수신은 소유자 승인이나 차량 안전 판정이 아닙니다.
      </p>
      <Button
        label="다른 점검 탐색"
        variant="ghost"
        onClick={() => lab.dispatch({ type: "RESET" })}
      />
    </div>
  );
}
export function StepBack({ lab }: { lab: Lab }) {
  return (
    <button
      className="step-back"
      onClick={() => lab.dispatch({ type: "RESET" })}
    >
      ← 탐색으로
    </button>
  );
}

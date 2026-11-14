import { Button } from "@astryxdesign/core/Button";
import { transport, type SyncSnapshot } from "../session";
import { Dock, Heading, Section } from "../ui/kit";
import { Guide } from "../Guide";
import { Outcome } from "./Review";
import type { StepProps } from "./types";

const RETRYABLE = ["FAILED_NETWORK", "FAILED_TIMEOUT", "RATE_LIMITED"];
const STOPPED = [
  "CANCELLED",
  "REJECTED_EXPIRED",
  "REJECTED_CLOSED",
  "REJECTED_CONFLICT",
  "REJECTED_INVALID",
  "REJECTED_UNAUTHORIZED",
];
type Tone = "done" | "active" | "waiting" | "error";

/**
 * The four facts stay separate: the person completed it, the phone sent it,
 * the server took it, the vehicle app took it. A server receipt never reads
 * as a vehicle receipt; failures say what is uncertain.
 */
export function deliverySteps(sync: SyncSnapshot) {
  const failed = RETRYABLE.includes(sync.display),
    stopped = STOPPED.includes(sync.display),
    accepted = sync.display === "ACCEPTED";
  const send: [Tone, string] = sync.received
    ? ["done", "결과를 보냈어요."]
    : sync.display === "SENDING"
      ? ["active", "보내고 있어요."]
      : failed
        ? ["error", "전송을 확인하지 못했어요. 같은 결과로 다시 보낼 수 있어요."]
        : stopped
          ? ["error", "이 연결로는 더 보낼 수 없어요."]
          : ["waiting", "아직 보내지 않았어요."];
  const server: [Tone, string] = sync.received
    ? ["done", "서버가 결과를 접수했어요."]
    : ["waiting", "서버 접수를 확인하기 전이에요."];
  const vehicle: [Tone, string] = accepted
    ? ["done", "차량 앱이 받아 점검 이력에 저장했어요."]
    : sync.received && sync.display === "CANCELLED"
      ? ["error", "차량에서 점검을 취소했어요."]
      : sync.received
        ? ["active", "차량 앱이 받기를 기다리고 있어요."]
        : ["waiting", "차량 앱 수신 전이에요."];
  return [
    { title: "점검 확정", tone: "done" as Tone, text: "직접 고른 내용으로 기록했어요." },
    { title: "서버로 보내기", tone: send[0], text: send[1] },
    { title: "서버 접수", tone: server[0], text: server[1] },
    { title: "차량 앱 수신", tone: vehicle[0], text: vehicle[1] },
  ];
}

const TONE_LABEL: Record<Tone, string> = {
  done: "완료",
  active: "진행 중",
  waiting: "대기",
  error: "확인 필요",
};

function Delivery({ sync }: { sync: SyncSnapshot }) {
  const problem =
    RETRYABLE.includes(sync.display) || STOPPED.includes(sync.display);
  return (
    <Section id="delivery-title" title="차량에 보내기" className="cb-delivery">
      <ol className="cb-timeline">
        {deliverySteps(sync).map((s) => (
          <li key={s.title} data-tone={s.tone}>
            <span className="cb-timeline-dot" aria-hidden="true" />
            <span className="cb-row-text">
              <strong>
                {s.title}
                <span className="cb-sr"> · {TONE_LABEL[s.tone]}</span>
              </strong>
              <span>{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p
        role="status"
        className={problem ? "cb-note cb-note-caution" : "cb-note"}
        data-sync-state={sync.display}
      >
        {sync.message}
      </p>
      <p className="cb-caption">
        차량 앱의 자동 접수는 소유자의 승인이나 차량 안전 판정이 아니에요. AVD의
        이력은 실제 제조사 검증 차량 이력이 아니에요.
      </p>
    </Section>
  );
}

/** Step 4b: the immutable record, then a separate, explicit send. */
export function Done(
  p: StepProps & {
    sync: SyncSnapshot | null;
    recordValid: boolean;
    resultStatus: string;
    restart: () => void;
  },
) {
  const { sync, recordValid, state, profile, taskId } = p;
  const retry = !!sync && RETRYABLE.includes(sync.display);
  return (
    <>
      <Heading
        headingRef={p.headingRef}
        eyebrow="4단계 · 기록 완료"
        title="점검을 기록했어요"
        body={
          sync
            ? "기록은 아직 이 휴대폰에만 있어요. 차량에 보내려면 아래 버튼을 눌러 주세요."
            : "이 기록은 이 화면에서만 볼 수 있어요."
        }
      />
      <Outcome status={p.resultStatus} label="사용자 보고" />
      {state.record?.completedAt && (
        <p className="cb-caption">
          기록한 시각 ·{" "}
          {new Date(state.record.completedAt).toLocaleString("ko-KR")}
        </p>
      )}
      {!recordValid ? (
        <p role="alert" className="cb-note cb-note-danger">
          결과 데이터 검증에 실패해 보내지 않았어요. 새 점검을 시작해 주세요.
        </p>
      ) : sync ? (
        <Delivery sync={sync} />
      ) : (
        <Section id="local-title" title="차량에 보내려면" tone="quiet">
          <p className="cb-body-sm">
            이 점검은 차량에 연결되지 않았어요. 차에서 새 QR을 만들어 열면
            점검과 차량 전송이 연결돼요.
          </p>
        </Section>
      )}
      <p className="cb-note">
        {profile?.followup ??
          "확인하지 못한 부분이나 이상이 의심되는 부분은 제조사 서비스에 문의해 주세요."}
      </p>
      <details className="cb-disclosure">
        <summary>부품 안내 다시 보기</summary>
        <Guide taskId={taskId} />
      </details>
      <Dock>
        {sync && recordValid && !sync.received ? (
          <>
            <Button
              label={retry ? "같은 결과 다시 보내기" : "차량으로 결과 보내기"}
              variant="primary"
              size="lg"
              width="100%"
              isDisabled={!sync.canSend}
              isLoading={sync.display === "SENDING"}
              onClick={() => void transport?.send()}
            />
            <Button
              label="수신 상태 다시 확인"
              variant="ghost"
              size="lg"
              width="100%"
              isDisabled={!sync.canRefresh}
              onClick={() => void transport?.refresh()}
            />
          </>
        ) : sync && sync.received && sync.display !== "ACCEPTED" && sync.canRefresh ? (
          <>
            <Button
              label="수신 상태 다시 확인"
              variant="primary"
              size="lg"
              width="100%"
              onClick={() => void transport?.refresh()}
            />
            <Button
              label="연결 종료하고 홈으로"
              variant="ghost"
              size="lg"
              width="100%"
              onClick={p.restart}
            />
          </>
        ) : (
          <>
            <Button
              label={transport ? "연결 종료하고 홈으로" : "새 점검 시작"}
              variant="primary"
              size="lg"
              width="100%"
              onClick={p.restart}
            />
            <Button
              label="다른 부품 살펴보기"
              href="/"
              variant="ghost"
              size="lg"
              width="100%"
            />
          </>
        )}
      </Dock>
    </>
  );
}

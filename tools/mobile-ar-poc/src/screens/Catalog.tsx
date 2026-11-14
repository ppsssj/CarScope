import { useState } from "react";
import { taskLinks } from "../domain";
import { guideForTask, infoGuides } from "../../public/part-guides.mjs";
import { getChecklistProfile } from "../../public/checklist-profiles.mjs";
import {
  partCapabilities,
  partIdForTask,
  SUPPORT,
} from "../../public/part-capabilities.mjs";
import { CHECK_ITEMS } from "../domain";
import { BrandBar } from "./Brand";

export const CATEGORIES = ["보닛 내부", "타이어", "시야·조명", "충전"] as const;
export function category(id: string) {
  return id.startsWith("tire.")
    ? "타이어"
    : id.startsWith("wiper.") || id.startsWith("light-")
      ? "시야·조명"
      : id.startsWith("ev-")
        ? "충전"
        : "보닛 내부";
}

/** Plain words for how a task is inspected. Never claims an AI result. */
export function methodOf(taskId: string) {
  const questions =
    taskId === "washer-fluid"
      ? CHECK_ITEMS.length
      : (getChecklistProfile(taskId) as unknown as { checks: readonly unknown[] })
          .checks.length;
  // The JS signature defaults taskId to null; a task id is its documented input.
  const capabilities = partCapabilities as unknown as (
    partId: string,
    options: { taskId: string },
  ) => ReturnType<typeof partCapabilities>;
  const cap = capabilities(partIdForTask(taskId), { taskId });
  // Only parts with an evaluated (EXPERIMENTAL) photo method are labelled.
  // DRAFT profiles are offered by no default host, so they are not advertised.
  const ai = cap.experimental && cap.stage === SUPPORT.EXPERIMENTAL;
  return {
    method:
      taskId === "washer-fluid"
        ? `눈으로 확인 ${questions}가지 · 양 기록`
        : `눈으로 살펴보기 · 질문 ${questions}개`,
    ai,
  };
}

export function Catalog() {
  const [filter, setFilter] = useState<string>("전체");
  const tasks = taskLinks();
  const groups = CATEGORIES.map((name) => ({
    name,
    tasks: tasks.filter((t) => category(t.id) === name),
  })).filter((g) => filter === "전체" || g.name === filter);
  return (
    <>
      <BrandBar />
      <main id="main" className="cb-main cb-catalog">
        <div className="cb-heading">
          <p className="cb-eyebrow">내 차 살펴보기</p>
          <h1 className="cb-title" tabIndex={-1}>
            오늘은 어디를 살펴볼까요?
          </h1>
          <p className="cb-body">
            부품을 고르면 안전 준비부터 기록까지 차근차근 안내해요.
          </p>
        </div>
        <div className="cb-qr-note">
          <span className="cb-qr-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </span>
          <span>
            <strong>차에서 QR로 시작하셨나요?</strong>
            <span>QR로 열면 그 점검과 차량 전송이 바로 연결돼요.</span>
          </span>
        </div>
        <nav className="cb-filters" aria-label="점검 분류">
          {["전체", ...CATEGORIES].map((f) => (
            <button
              type="button"
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </nav>
        {groups.map((g) => (
          <section
            key={g.name}
            className="cb-part-group"
            aria-labelledby={`group-${g.name}`}
          >
            <h2 id={`group-${g.name}`} className="cb-group-title">
              {g.name} <span>{g.tasks.length}</span>
            </h2>
            <ul className="cb-part-list">
              {g.tasks.map((t, i) => {
                const guide = guideForTask(t.id);
                const { method, ai } = methodOf(t.id);
                return (
                  <li key={t.id}>
                    <a className="cb-part" href={t.href}>
                      <span className="cb-part-art">
                        {guide?.detailImage && (
                          <img
                            src={`/${guide.detailImage.file}`}
                            alt=""
                            loading={i > 3 ? "lazy" : "eager"}
                          />
                        )}
                      </span>
                      <span className="cb-part-text">
                        <strong>{t.label}</strong>
                        <span>{guide?.area}</span>
                        <span className="cb-part-meta">
                          {method}
                          {ai && (
                            <span className="cb-tag cb-tag-ai">
                              AI 사진 보조 · 실험
                            </span>
                          )}
                        </span>
                      </span>
                      <svg
                        className="cb-chevron"
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        aria-hidden="true"
                      >
                        <path
                          d="M9 5l7 7-7 7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section className="cb-section cb-quiet" aria-labelledby="qr-help">
          <h2 id="qr-help" className="cb-h2">
            알고 시작해요
          </h2>
          <ul className="cb-bullets">
            <li>
              여기서 바로 시작한 점검은 이 화면에만 남아요. 차량에 보내려면
              차에서 QR을 만들어 열어 주세요.
            </li>
            <li>
              ‘AI 사진 보조 · 실험’ 표시가 있는 부품만, 차량 QR로 연결했을 때
              사진을 참고용으로 살펴볼 수 있어요.
            </li>
            <li>
              모든 결과는 내가 직접 본 내용이에요. 차량의 정상·안전을 판정하지
              않아요.
            </li>
          </ul>
        </section>
        <section className="cb-section" aria-labelledby="info-only">
          <h2 id="info-only" className="cb-h2">
            점검 없이 부품만 알아보기
          </h2>
          <ul className="cb-link-list">
            {infoGuides().map((g) => (
              <li key={g.partId}>
                <a href={`/part-info.html#${g.partId}`}>
                  <span>{g.title}</span>
                  <span className="cb-caption">{g.area}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

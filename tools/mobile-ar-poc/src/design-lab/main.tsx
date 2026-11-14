import { createRoot } from "react-dom/client";
import { Button } from "@astryxdesign/core/Button";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./style.css";
import { Scope, Atlas, Logbook } from "./Concepts";
import { useLab } from "./useLab";
import type { Concept } from "./model";
// CARSCOPE_DESIGN_LAB: separate entry; never reads QR fragments, storage or credentials.
if (location.hash) history.replaceState(null, "", location.pathname);
function App() {
  const lab = useLab();
  const concept = location.pathname.split("/")[2] as Concept;
  return concept === "scope" ? (
    <Scope lab={lab} />
  ) : concept === "atlas" ? (
    <Atlas lab={lab} />
  ) : concept === "logbook" ? (
    <Logbook lab={lab} />
  ) : (
    <div className="lab-home">
      <p className="lab-kicker">CARSCOPE / PRODUCT EXPLORATION 018</p>
      <h1 data-stage-title tabIndex={-1}>
        한 가지 점검.
        <br />세 가지 경험.
      </h1>
      <p>
        실제 React + Astryx로 조작하는 디자인 탐색입니다.
        <br />
        카메라·AI·차량 수신은 모두 모의 상태이며 외부로 보내지 않습니다.
      </p>
      <nav aria-label="디자인 콘셉트 선택">
        {[
          {
            id: "scope",
            title: "SCOPE",
            lead: "살피는 도구",
            detail:
              "카메라를 중심에. 선택은 도구 레일에서, 결과는 증거와 신호 경로로.",
          },
          {
            id: "atlas",
            title: "ATLAS",
            lead: "이해하는 공간",
            detail:
              "영역을 고르고, 부품을 펼치고, 보이는 것과 모르는 것을 나눕니다.",
          },
          {
            id: "logbook",
            title: "LOGBOOK",
            lead: "이어지는 관찰",
            detail:
              "오늘의 점검을 계획하고, 직접 본 사실을 기록하고, 도착을 남깁니다.",
          },
        ].map((c, i) => (
          <a key={c.id} href={`/design-lab/${c.id}`} className={`home-${c.id}`}>
            <span>
              0{i + 1} / {c.lead}
            </span>
            <h2>{c.title}</h2>
            <p>{c.detail}</p>
            <span className="home-link">프로토타입 열기 ↗</span>
          </a>
        ))}
      </nav>
      <p>동일한 17개 작업 · 동일한 모의 결과 · 제품 UI 적용 전 비교용</p>
      <Button
        label="첫 번째 콘셉트부터"
        onClick={() => location.assign("/design-lab/scope")}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <Theme
    theme={neutralTheme}
    mode={location.pathname.endsWith("/scope") ? "dark" : "light"}
  >
    <App />
  </Theme>,
);

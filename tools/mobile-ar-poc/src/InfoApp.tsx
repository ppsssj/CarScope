import { infoGuides } from "../public/part-guides.mjs";
import { Guide } from "./Guide";
import { useEffect } from "react";
export function InfoApp() {
  useEffect(() => {
    document.body.dataset.ready = "true";
  }, []);
  let id = "";
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    /* Invalid escaped IDs never select a part. */
  }
  const guide = infoGuides().find((g) => g.partId === id);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          CarScope.
        </a>
        <span className="header-label">부품 안내</span>
      </header>
      <main>
        <section className="catalog-heading">
          <div className="eyebrow">REFERENCE ONLY</div>
          <h1>{guide?.title ?? "부품을 알아봐요."}</h1>
          <p>점검 항목이 아닙니다. 답변을 기록하거나 차량에 보내지 않습니다.</p>
        </section>
        {guide && <Guide partId={guide.partId} expanded />}
        <nav className="filters" aria-label="다른 부품 안내">
          {infoGuides().map((g) => (
            <a key={g.partId} href={`#${g.partId}`}>
              {g.title}
            </a>
          ))}
        </nav>
        <p className="fine">점검 화면에서 왔다면 이 탭을 닫으면 돌아갑니다.</p>
      </main>
    </div>
  );
}

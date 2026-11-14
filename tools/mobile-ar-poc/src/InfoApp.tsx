import { infoGuides } from "../public/part-guides.mjs";
import { Guide } from "./Guide";
import { useEffect } from "react";
import { BrandBar, Footer } from "./screens/Brand";

/** Read-only part guide (`/part-info.html#<partId>`). Never records or sends. */
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
    <div className="cb-app">
      <BrandBar label="부품 안내" />
      <main id="main" className="cb-main cb-info">
        <div className="cb-heading">
          <p className="cb-eyebrow">부품 알아보기 · 기록하지 않아요</p>
          <h1 className="cb-title">{guide?.title ?? "부품을 알아봐요"}</h1>
          <p className="cb-body">
            점검 화면이 아니에요. 답을 기록하거나 차량에 보내지 않아요.
          </p>
        </div>
        {guide && <Guide partId={guide.partId} expanded />}
        <nav className="cb-section" aria-labelledby="other-parts">
          <h2 id="other-parts" className="cb-h2">
            다른 부품 안내
          </h2>
          <ul className="cb-link-list">
            {infoGuides().map((g) => (
              <li key={g.partId}>
                <a
                  href={`#${g.partId}`}
                  aria-current={g.partId === id ? "page" : undefined}
                >
                  <span>{g.title}</span>
                  <span className="cb-caption">{g.area}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="cb-caption">점검 화면에서 왔다면 이 탭을 닫으면 돌아가요.</p>
      </main>
      <Footer />
    </div>
  );
}

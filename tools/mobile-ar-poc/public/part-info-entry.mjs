// P12-A2: the information page for parts with no inspection. Read-only: no task, no answers, no result, no QR, no request but its own files.
// A part that has an inspection is refused here, so this page can never stand in for one.
import { renderPartGuide } from './part-guide.mjs';
import { infoGuides } from './part-guides.mjs';

const main = document.getElementById('part-info-main');
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
function show() {
  const id = decodeURIComponent(location.hash.slice(1));
  const guide = infoGuides().find(entry => entry.partId === id);
  const links = el('nav', 'task-links'); links.setAttribute('aria-label', '다른 부품 안내');
  for (const entry of infoGuides()) if (entry !== guide) { const a = el('a', null, entry.title); a.href = `#${entry.partId}`; links.append(a); }
  main.replaceChildren();
  if (guide) {
    document.title = `CarScope · ${guide.title} 안내`;
    const { body, load } = renderPartGuide(guide);
    main.append(el('h1', null, guide.title), el('p', 'card muted', '점검 항목이 아니에요. 답변을 기록하거나 차량으로 보내지 않아요.'), body);
    load();
  } else {
    document.title = 'CarScope · 부품 안내';
    main.append(el('h1', null, '안내할 부품을 찾지 못했어요'), el('p', null, '아래 부품의 안내를 볼 수 있어요. 점검은 차량 앱이나 QR에서 시작해 주세요.'));
  }
  main.append(links, el('p', 'fine', '점검 화면에서 왔다면 이 탭을 닫으면 돌아가요.'));
  document.body.dataset.partInfo = guide ? guide.partId : 'none';
  scrollTo(0, 0);
}
addEventListener('hashchange', show);
show();

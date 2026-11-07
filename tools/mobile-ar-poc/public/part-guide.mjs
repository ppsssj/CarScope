// P12-A: the part guide on the inspection page. One closed row on the first step, and inside the location help after it.
// It reads and changes no inspection state, and needs no camera or AR. Pictures are requested only when the row is opened.
// A picture that is absent, refused by part-guides.mjs or fails to load becomes a sentence, never an empty frame or a broken icon.
import { guideForTask, IMAGE_KIND, PART_GUIDES, usableImage } from './part-guides.mjs';

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const list = (title, items) => { const box = el('div', 'part-guide-block'), ul = el('ul'); box.append(el('p', 'safety-title', title), ul); for (const item of items) ul.append(el('li', null, item)); return box; };

let dialog = null, zoomImage = null, zoomCaption = null, zoomToggle = null, historyPushed = false;
function ensureDialog() {
  if (dialog) return;
  dialog = el('dialog', 'part-guide-zoom'); dialog.id = 'part-guide-zoom'; dialog.setAttribute('aria-label', '그림 크게 보기');
  const bar = el('div', 'part-guide-zoom-bar'), close = el('button', null, '닫기'), view = el('div', 'part-guide-zoom-view');
  zoomToggle = el('button', null, '더 크게'); zoomToggle.id = 'part-guide-zoom-toggle'; zoomToggle.type = 'button';
  close.id = 'part-guide-zoom-close'; close.type = 'button';
  zoomImage = el('img'); zoomCaption = el('p', 'part-guide-zoom-caption');
  view.append(zoomImage); bar.append(zoomToggle, close); dialog.append(bar, view, zoomCaption);
  close.addEventListener('click', () => dialog.close());
  zoomToggle.addEventListener('click', () => { zoomToggle.textContent = dialog.classList.toggle('enlarged') ? '원래 크기' : '더 크게'; });
  // Every way of closing lands here: the button, Esc, or Back through popstate below.
  dialog.addEventListener('close', () => { dialog.classList.remove('enlarged'); zoomToggle.textContent = '더 크게'; if (historyPushed) { historyPushed = false; history.back(); } });
  // Back closes the picture rather than leaving the page, which would discard a QR connection for good. Same URL by construction.
  addEventListener('popstate', () => { if (dialog.open) { historyPushed = false; dialog.close(); } });
  document.body.append(dialog);
}
function openZoom(src, image) {
  ensureDialog();
  zoomImage.src = src; zoomImage.alt = image.alt; zoomCaption.textContent = `${image.caption} ${notice(image)}`;
  dialog.showModal();
  history.scrollRestoration = 'manual';
  history.pushState({ carscopePartGuideZoom: true }, '');
  historyPushed = true;
}

const vehicleName = ({ make, model, year }) => `${year} ${make} ${model}`;
const notice = image => (image.kind === IMAGE_KIND.PHOTO ? `${vehicleName(image.vehicle)} 사진이에요. 내 차와 다를 수 있어요.` : '실제 사진이 아니에요.');

function figure(image) {
  const box = el('figure', 'part-guide-figure'), frame = el('button', 'part-guide-frame'), picture = el('img'), state = el('p', 'part-guide-state fine', '그림을 불러오는 중이에요…'), caption = el('figcaption');
  frame.type = 'button'; frame.disabled = true; frame.setAttribute('aria-label', `${image.caption} 크게 보기`);
  picture.alt = image.alt;
  caption.append(el('span', 'part-guide-badge', image.kind === IMAGE_KIND.PHOTO ? '실제 사진' : '설명용 그림'), el('span', null, image.caption), el('span', 'fine part-guide-credit', `${notice(image)} 출처: ${image.imageSource}`));
  frame.append(picture, state); box.append(frame, caption);
  const src = new URL(`./${image.file}`, import.meta.url).href;
  picture.addEventListener('load', () => { state.remove(); frame.disabled = false; box.dataset.image = 'loaded'; });
  picture.addEventListener('error', () => {
    // The sentence takes the frame's place, carrying what the picture would have shown.
    const missing = el('p', 'part-guide-missing', `그림을 불러오지 못했어요. ${image.alt}`);
    frame.replaceWith(missing); box.dataset.image = 'failed';
  });
  frame.addEventListener('click', () => openZoom(src, image));
  box.dataset.image = 'waiting';
  return { box, load: () => { if (!picture.getAttribute('src')) picture.src = src; } };
}

/** The guide's content. `load` asks for its pictures, and is called on opening so a closed row costs no network. */
export function renderPartGuide(guide) {
  const body = el('div', 'part-guide-body'), figures = el('div', 'part-guide-figures');
  body.append(el('p', 'part-guide-role', `${guide.role} ${guide.taskId ? '찾아볼 곳' : '있는 곳'}: ${guide.area}.`));
  const pictures = [guide.overviewImage, guide.detailImage].map(usableImage).filter(Boolean).map(figure);
  for (const picture of pictures) figures.append(picture.box);
  const hasPhoto = [guide.overviewImage, guide.detailImage].some(image => usableImage(image)?.kind === IMAGE_KIND.PHOTO);
  if (!hasPhoto) body.append(el('p', 'card muted part-guide-no-photo', pictures.length ? '아직 실제 사진이 없어 설명용 그림으로 보여 드려요.' : '아직 준비된 사진이나 그림이 없어요. 아래 설명과 차량 설명서로 찾아 주세요.'));
  if (pictures.length) body.append(figures);
  body.append(list('이렇게 구별해요', guide.identifyingFeatures), list('꼭 지켜 주세요', guide.safetyNotes), el('p', 'fine part-guide-applies', guide.vehicleApplicability.text));
  if (guide.manualReference) {
    const manual = el('p', 'fine part-guide-manual'), link = el('a', null, guide.manualReference.label);
    // A new tab: leaving this one would discard the connection and the answers.
    link.href = guide.manualReference.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    manual.append(link, ` ${guide.manualReference.applicability}`); body.append(manual);
  }
  if (guide.relatedInfo?.length) {
    // A new tab here too: it is a separate page, and this one holds the answers and the connection.
    const related = el('p', 'fine part-guide-related');
    related.append('함께 알아 두기: ');
    for (const partId of guide.relatedInfo) { const link = el('a', null, PART_GUIDES[partId].title); link.href = new URL(`./part-info.html#${partId}`, import.meta.url).href; link.target = '_blank'; link.rel = 'noopener noreferrer'; related.append(link); }
    body.append(related);
  }
  return { body, load: () => pictures.forEach(picture => picture.load()) };
}

function attach(details, guide) {
  const { body, load } = renderPartGuide(guide);
  details.append(body);
  details.addEventListener('toggle', () => { if (details.open) load(); });
}

/** The closed row on the first step. Does nothing for a part with no guide. */
export function mountPartGuide(taskId, before) {
  const guide = guideForTask(taskId);
  if (!guide || !before) return null;
  const details = el('details', 'part-guide card'), summary = el('summary', null, `${guide.title} 찾는 법 보기`);
  details.setAttribute('aria-label', `${guide.title} 안내`); details.append(summary); before.before(details);
  attach(details, guide);
  return details;
}
/** Adds the guide to the location help that the locate and check steps already show. */
export function extendLocationGuide(taskId, details) {
  const guide = guideForTask(taskId);
  if (guide) attach(details, guide);
}

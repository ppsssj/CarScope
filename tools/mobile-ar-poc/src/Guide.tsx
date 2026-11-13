import {
  guideForTask,
  usableImage,
  infoGuides,
} from "../public/part-guides.mjs";
import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
function IllustrationZoom({
  title,
  file,
  alt,
  close,
}: {
  title: string;
  file: string;
  alt: string;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="illustration-dialog"
      ref={ref}
      aria-label={`${title} 그림 확대`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="section-label">
        <h2>{title}</h2>
        <Button label="확대 그림 닫기" onClick={close} />
      </div>
      <p className="fine">
        설명용 그림입니다. 옆으로 움직여 세부를 살펴보세요.
      </p>
      <div
        className="illustration-pan"
        tabIndex={0}
        role="region"
        aria-label="확대한 부품 그림"
      >
        <img src={`/${file}`} alt={alt} />
      </div>
    </dialog>
  );
}
export function Guide({
  taskId = "",
  partId,
  expanded = false,
}: {
  taskId?: string;
  partId?: string;
  expanded?: boolean;
}) {
  const [zoom, setZoom] = useState(false);
  const guide = partId
    ? infoGuides().find((g) => g.partId === partId)
    : guideForTask(taskId);
  if (!guide) return null;
  const image = usableImage(guide.detailImage);
  return (
    <aside className="guide">
      <div className="eyebrow">
        PART GUIDE <span>위치와 생김새</span>
      </div>
      {image && (
        <figure>
          <img src={`/${image.file}`} alt={image.alt} />
          <figcaption>{image.caption}</figcaption>
          <Button
            label="그림 크게 보기"
            size="sm"
            variant="ghost"
            onClick={() => setZoom(true)}
          />
        </figure>
      )}
      <h3>{guide.title}</h3>
      <p>{guide.role}</p>
      <details open={expanded || undefined}>
        <summary>부품을 찾는 방법</summary>
        <p>{guide.area}</p>
        {guide.overviewImage && (
          <img
            src={`/${guide.overviewImage.file}`}
            alt={guide.overviewImage.alt}
          />
        )}
        <ul>
          {guide.identifyingFeatures.map((s: string) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>{guide.vehicleApplicability.text}</p>
      </details>
      {guide.relatedInfo?.map((id: string) => {
        const related = infoGuides().find((g) => g.partId === id);
        return related ? (
          <p key={id}>
            <a href={`/part-info.html#${id}`} target="_blank" rel="noreferrer">
              {related.title} 안내 ↗
            </a>
          </p>
        ) : null;
      })}
      {zoom && image && (
        <IllustrationZoom
          title={guide.title}
          file={image.file}
          alt={image.alt}
          close={() => setZoom(false)}
        />
      )}
      <details>
        <summary>안전 안내와 참고 설명서</summary>
        <ul>
          {guide.safetyNotes.map((s: string) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {guide.manualReference && (
          <>
            <a
              href={guide.manualReference.url}
              target="_blank"
              rel="noreferrer"
            >
              {guide.manualReference.label} ↗
            </a>
            <p>{guide.manualReference.applicability}</p>
          </>
        )}
      </details>
      {taskId === "washer-fluid" &&
        document.body.dataset.webxrGuide === "enabled" && (
          <a
            className="webxr-link"
            href="/webxr-guide.html#v=1&task=washer-fluid"
            target="_blank"
            rel="noreferrer"
          >
            3D AR 위치 안내 · 별도 체험 ↗
          </a>
        )}
    </aside>
  );
}

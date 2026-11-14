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
      className="cb-dialog cb-zoom"
      ref={ref}
      aria-label={`${title} 그림 확대`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="cb-zoom-head">
        <h2 className="cb-h2">{title}</h2>
        <Button label="확대 그림 닫기" variant="secondary" onClick={close} />
      </div>
      <p className="cb-caption">
        설명용 그림이에요. 옆으로 움직여 자세히 볼 수 있어요.
      </p>
      <div
        className="cb-zoom-pan"
        tabIndex={0}
        role="region"
        aria-label="확대한 부품 그림"
      >
        <img src={`/${file}`} alt={alt} />
      </div>
    </dialog>
  );
}

/**
 * Part guide: picture, role, how to find it, safety and manual references.
 * `compact` shows the picture and role first and folds the rest, so a guide
 * never pushes the task's main action away.
 */
export function Guide({
  taskId = "",
  partId,
  expanded = false,
  compact = false,
}: {
  taskId?: string;
  partId?: string;
  expanded?: boolean;
  compact?: boolean;
}) {
  const [zoom, setZoom] = useState(false);
  const guide = partId
    ? infoGuides().find((g) => g.partId === partId)
    : guideForTask(taskId);
  if (!guide) return null;
  const image = usableImage(guide.detailImage);
  return (
    <aside className="cb-guide" aria-label={`${guide.title} 안내`}>
      {image && (
        <figure className="cb-guide-figure">
          <img src={`/${image.file}`} alt={image.alt} />
          <figcaption>
            <span>{image.caption}</span>
            <Button
              label="그림 크게 보기"
              size="md"
              variant="secondary"
              onClick={() => setZoom(true)}
            />
          </figcaption>
        </figure>
      )}
      {!compact && <h3 className="cb-h3">{guide.title}</h3>}
      <p className="cb-body-sm">{guide.role}</p>
      <details className="cb-disclosure" open={expanded || undefined}>
        <summary>부품을 찾는 방법</summary>
        <p className="cb-body-sm">{guide.area}</p>
        {guide.overviewImage && (
          <img
            className="cb-guide-overview"
            src={`/${guide.overviewImage.file}`}
            alt={guide.overviewImage.alt}
          />
        )}
        <ul className="cb-bullets">
          {guide.identifyingFeatures.map((s: string) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="cb-caption">{guide.vehicleApplicability.text}</p>
      </details>
      <details className="cb-disclosure" open={expanded || undefined}>
        <summary>안전 안내와 참고 설명서</summary>
        <ul className="cb-bullets">
          {guide.safetyNotes.map((s: string) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {guide.manualReference && (
          <p className="cb-caption">
            <a
              href={guide.manualReference.url}
              target="_blank"
              rel="noreferrer"
            >
              {guide.manualReference.label} ↗
            </a>
            <br />
            {guide.manualReference.applicability}
          </p>
        )}
      </details>
      {guide.relatedInfo?.map((id: string) => {
        const related = infoGuides().find((g) => g.partId === id);
        return related ? (
          <p key={id} className="cb-caption">
            <a href={`/part-info.html#${id}`} target="_blank" rel="noreferrer">
              {related.title} 안내 ↗
            </a>
          </p>
        ) : null;
      })}
      {taskId === "washer-fluid" &&
        document.body.dataset.webxrGuide === "enabled" && (
          <a
            className="cb-caption cb-webxr-link"
            href="/webxr-guide.html#v=1&task=washer-fluid"
            target="_blank"
            rel="noreferrer"
          >
            3D AR 위치 안내 · 별도 체험 ↗
          </a>
        )}
      {zoom && image && (
        <IllustrationZoom
          title={guide.title}
          file={image.file}
          alt={image.alt}
          close={() => setZoom(false)}
        />
      )}
    </aside>
  );
}

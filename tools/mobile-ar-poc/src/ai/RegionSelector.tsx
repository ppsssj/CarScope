// A still picture with detector candidates and/or a region the person drags (Pointer Events: touch, mouse, pen).
// The picture keeps its own aspect ratio; every pointer position is mapped through elementToImagePoint() from the
// current layout, so rotation, zoom and letterboxing all land on the same source pixels the crop uses.
import { useEffect, useRef, useState } from "react";
import {
  dragToBox,
  elementToImagePoint,
  keyboardStartBox,
  nudgeBox,
} from "../../public/camera-ai-flow.mjs";

export type Box = readonly number[];
const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const REGION_ERRORS: Record<string, string> = {
  REGION_TOO_SMALL:
    "영역이 너무 작아요. 부품 전체를 감싸도록 더 크게 끌어 주세요.",
  REGION_INVALID: "영역을 읽지 못했어요. 다시 끌어서 선택해 주세요.",
};
export const regionErrorText = (code: string | null | undefined) =>
  code ? (REGION_ERRORS[code] ?? REGION_ERRORS.REGION_INVALID) : "";

export function RegionSelector({
  source,
  label,
  candidates = [],
  selected = -1,
  region = null,
  selectable = false,
  onRegion,
}: {
  source: HTMLCanvasElement;
  label: string;
  candidates?: readonly { box: Box; score: number }[];
  selected?: number;
  region?: Box | null;
  selectable?: boolean;
  onRegion?: (box: Box | null, error?: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null),
    start = useRef<number[] | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const W = source.width,
    H = source.height;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = W;
    c.height = H;
    c.getContext("2d")!.drawImage(source, 0, 0);
  }, [source, W, H]);
  const point = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect();
    return elementToImagePoint(
      e.clientX - r.left,
      e.clientY - r.top,
      r.width,
      r.height,
      W,
      H,
    );
  };
  const shown = draft ?? region;
  return (
    <div className="cb-region-wrap">
      <div className="cb-region" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvas} aria-hidden="true" />
        {candidates.map((c, i) => (
          <span
            key={i}
            className="cb-region-candidate"
            data-selected={i === selected ? "true" : "false"}
            aria-hidden="true"
            style={{
              left: pct(c.box[0]),
              top: pct(c.box[1]),
              width: pct(c.box[2]),
              height: pct(c.box[3]),
            }}
          >
            <span>
              후보 {i + 1} · {Math.round(c.score * 100)}%
            </span>
          </span>
        ))}
        {shown && (
          <span
            className="cb-region-box"
            data-draft={draft ? "true" : "false"}
            aria-hidden="true"
            style={{
              left: pct(shown[0]),
              top: pct(shown[1]),
              width: pct(shown[2]),
              height: pct(shown[3]),
            }}
          />
        )}
        {selectable && (
          <div
            ref={surface}
            className="cb-region-surface"
            role="application"
            tabIndex={0}
            aria-label={`${label}. 끌어서 영역을 지정해요. 키보드: Enter로 가운데 영역 만들기, 화살표로 이동, Shift+화살표로 크기 조절, Esc로 지우기`}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.pointerType === "mouse") return;
              const p = point(e);
              if (!p) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = p;
              setDraft([p[0], p[1], 0, 0]);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = point(e);
              if (!p) return;
              const s = start.current;
              setDraft([
                Math.min(s[0], p[0]),
                Math.min(s[1], p[1]),
                Math.abs(p[0] - s[0]),
                Math.abs(p[1] - s[1]),
              ]);
            }}
            onPointerUp={(e) => {
              const s = start.current;
              start.current = null;
              setDraft(null);
              if (!s) return;
              const r = dragToBox(s, point(e), W, H);
              onRegion?.(r.box ?? null, r.error);
            }}
            onPointerCancel={() => {
              start.current = null;
              setDraft(null);
            }}
            onKeyDown={(e) => {
              const step = 0.02;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!region) onRegion?.(keyboardStartBox());
                return;
              }
              if (e.key === "Escape") {
                if (region) {
                  e.preventDefault();
                  e.stopPropagation();
                  onRegion?.(null);
                }
                return;
              }
              const dir = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[e.key];
              if (!dir || !region) return;
              e.preventDefault();
              onRegion?.(
                nudgeBox(
                  region,
                  e.shiftKey
                    ? { dw: dir[0], dh: dir[1] }
                    : { dx: dir[0], dy: dir[1] },
                ),
              );
            }}
          />
        )}
      </div>
      {selectable && (
        <p className="cb-caption" aria-live="polite">
          {region
            ? `선택한 영역 · 가로 ${Math.round(region[2] * 100)}%, 세로 ${Math.round(region[3] * 100)}%`
            : "사진 위에서 부품을 감싸도록 끌어 주세요. 키보드에서는 사진을 선택하고 Enter를 눌러 시작해요."}
        </p>
      )}
    </div>
  );
}

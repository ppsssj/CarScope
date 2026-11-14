// 차보담 presentation primitives (P19 design language). No domain logic here.
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Top bar of an inspection: back/exit, task title, step counter. */
export function TaskBar({
  backLabel,
  onBack,
  title,
  step,
  total,
  stepName,
}: {
  backLabel: string;
  onBack: () => void;
  title: string;
  step: number;
  total: number;
  stepName: string;
}) {
  // Sticky only while it stays small: with large text a sticky bar would
  // permanently cover a large share of a phone screen.
  const bar = useRef<HTMLElement>(null);
  const [sticky, setSticky] = useState(true);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    // Decided on the sticky (one-row) layout only, so the two layouts cannot
    // flip back and forth; a viewport change starts a fresh decision.
    const measure = () => {
      if (el.dataset.layout !== "sticky") return;
      setSticky(
        el.getBoundingClientRect().height <= innerHeight * BAR_MAX_SHARE,
      );
    };
    const reset = () => setSticky(true);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    addEventListener("resize", reset);
    return () => {
      observer.disconnect();
      removeEventListener("resize", reset);
    };
  }, []);
  return (
    <>
      <header
        ref={bar}
        className="cb-taskbar"
        data-layout={sticky ? "sticky" : "static"}
      >
        <button
          type="button"
          className="cb-icon-btn"
          aria-label={backLabel}
          onClick={onBack}
        >
          <BackIcon />
        </button>
        <p className="cb-taskbar-title">{title}</p>
        <p className="cb-taskbar-step">
          <span className="cb-sr">진행 </span>
          {step}/{total}
        </p>
      </header>
      <div
        className="cb-progress"
        role="progressbar"
        aria-label="점검 진행"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`${total}단계 중 ${step}단계, ${stepName}`}
      >
        <span style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </>
  );
}

/** Step label, title (receives focus on step change), one supporting line. */
export function Heading({
  eyebrow,
  title,
  body,
  headingRef,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="cb-heading">
      {eyebrow && <p className="cb-eyebrow">{eyebrow}</p>}
      <h1 ref={headingRef} tabIndex={-1} className="cb-title">
        {title}
      </h1>
      {body && <p className="cb-body">{body}</p>}
    </div>
  );
}

export function Section({
  title,
  id,
  tone,
  children,
  className = "",
}: {
  title?: ReactNode;
  id: string;
  tone?: "plain" | "quiet" | "caution";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`cb-section ${tone && tone !== "plain" ? `cb-${tone}` : ""} ${className}`}
      aria-labelledby={title ? id : undefined}
    >
      {title && (
        <h2 id={id} className="cb-h2">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** ListRow-like rows: a lead (number or icon), a title and one line. */
export function Rows({
  items,
}: {
  items: readonly { title: ReactNode; body?: ReactNode; lead?: ReactNode }[];
}) {
  return (
    <ul className="cb-rows">
      {items.map((item, i) => (
        <li key={i} className="cb-row">
          <span className="cb-row-lead" aria-hidden="true">
            {item.lead ?? i + 1}
          </span>
          <span className="cb-row-text">
            <strong>{item.title}</strong>
            {item.body && <span>{item.body}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="cb-bullets">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

/**
 * Bottom CTA. Fixed to the viewport by default (one predictable place for the
 * next action). When the user's text size makes it cover too much of the
 * screen (P19 open issue: ~35% at 200%), it becomes part of the page flow so
 * content is never hidden behind it.
 */
export const DOCK_MAX_SHARE = 0.3;
export const BAR_MAX_SHARE = 0.12;
/** Fixed dock padding: 1.5rem top + 0.75rem bottom (see .cb-dock). */
const DOCK_FIXED_PADDING_REM = 2.25;
export function Dock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inline, setInline] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Decide on the height the dock *would* have when fixed (content plus
    // the fixed padding), so the choice does not depend on the current
    // layout and cannot oscillate between the two.
    const measure = () => {
      const style = getComputedStyle(el),
        rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const content =
        el.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const fixedHeight = content + DOCK_FIXED_PADDING_REM * rem;
      const next = fixedHeight > innerHeight * DOCK_MAX_SHARE;
      setInline(next);
      document.documentElement.style.setProperty(
        "--cb-dock-space",
        next ? "0px" : `${Math.ceil(fixedHeight)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--cb-dock-space");
    };
  }, []);
  return (
    <div
      ref={ref}
      className="cb-dock"
      data-layout={inline ? "inline" : "fixed"}
    >
      {children}
    </div>
  );
}

/** Quiet text action for tertiary choices kept out of the dock. */
export function TextAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="cb-text-action" onClick={onClick}>
      {label}
    </button>
  );
}

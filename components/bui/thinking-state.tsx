"use client";

// Beautiful UI `thinking-state` (https://www.beautifului.dev/r/thinking-state.json, MIT).
// Adapted: the timer-driven demo sequence is replaced by a controlled
// `working` flag, and the trace body is the caller's content (streamed
// reasoning prose) instead of canned rows.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export default function ThinkingState({
  activeLabel,
  children,
  doneLabel,
  working,
}: {
  /** header while `working` (shimmering) */
  activeLabel: string;
  /** trace body shown when expanded */
  children: ReactNode;
  /** header once settled */
  doneLabel: string;
  /** auto-expands while true, auto-collapses once false */
  working: boolean;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? working;
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);

  // The trace rule follows the body height as reasoning streams in.
  useLayoutEffect(() => {
    const trace = traceRef.current;
    if (!trace) return;
    setLineHeight(trace.offsetHeight);
    const observer = new ResizeObserver(() => setLineHeight(trace.offsetHeight));
    observer.observe(trace);
    return () => observer.disconnect();
  }, []);

  // Keep the newest reasoning visible while it streams in.
  useEffect(() => {
    if (expanded && working && traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [children, expanded, working]);

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1
          transition-colors duration-100 hover:bg-hover-2"
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={working ? "var(--ink-2)" : "var(--ink-3)"}
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          {working ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {activeLabel}
            </span>
          ) : (
            <span
              className="text-[13px] font-medium whitespace-nowrap text-ink-2"
              style={{ animation: "fade-in 350ms ease-out both" }}
            >
              {doneLabel}
            </span>
          )}
        </span>
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{
                top: -8,
                height: lineHeight ? lineHeight + 4 : 0,
                transition: "height 500ms cubic-bezier(0.23,1,0.32,1)",
              }}
            />
            <div
              ref={traceRef}
              className="max-h-60 overflow-y-auto py-1 pr-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2 [scrollbar-width:thin]"
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

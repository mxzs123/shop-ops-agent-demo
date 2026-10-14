"use client";

import { useEffect, useState, type ReactNode } from "react";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION = 320;

/**
 * Height-animated disclosure (grid 0fr ↔ 1fr). Children mount on open and
 * unmount after the close transition, so collapsed panels cost nothing.
 */
export function Collapse({
  children,
  className,
  open,
}: {
  children: ReactNode;
  className?: string;
  open: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      const timer = window.setTimeout(() => setMounted(false), DURATION + 40);
      return () => window.clearTimeout(timer);
    }
    setMounted(true);
    // Let the collapsed (0fr) frame paint first so the transition runs.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setExpanded(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      aria-hidden={!open}
      className="grid"
      style={{
        gridTemplateRows: expanded ? "1fr" : "0fr",
        transition: `grid-template-rows ${DURATION}ms ${EASE}`,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={className}
          style={{
            opacity: expanded ? 1 : 0,
            transform: expanded ? "none" : "translateY(-4px)",
            transition: `opacity ${expanded ? "220ms 60ms" : "140ms"} ease, transform ${DURATION}ms ${EASE}`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

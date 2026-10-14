"use client";

// Beautiful UI `tool-chips` (https://www.beautifului.dev/r/tool-chips.json, MIT).
// Adapted: rows come from live tool parts instead of a timed demo reveal, each
// row carries a real status (running / done / error), and the file-diff chip
// footer is dropped — goods edits get their own DiffTable card.

import { useState } from "react";

const Icons: Record<ToolChipIcon, React.ReactNode> = {
  search: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </g>
  ),
  read: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </g>
  ),
  write: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </g>
  ),
  run: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-5-6-5M12 19h8" />
    </g>
  ),
};

export type ToolChipIcon = "read" | "run" | "search" | "write";

export type ToolChipStep = {
  key: string;
  icon: ToolChipIcon;
  label: string;
  /** short argument summary shown in the chip */
  chip?: string;
  mono?: boolean;
  status: "done" | "error" | "running";
  /** lines revealed when the row is expanded */
  detail: { text: string; tone?: "error" }[];
};

function StatusGlyph({ step }: { step: ToolChipStep }) {
  if (step.status === "running") {
    return (
      <span
        className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
        style={{ animation: "spin 700ms linear infinite" }}
      />
    );
  }

  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      className={step.status === "error" ? "text-red" : undefined}
    >
      {step.status === "error" ? (
        <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </g>
      ) : (
        Icons[step.icon]
      )}
    </svg>
  );
}

function ToolRow({
  onToggle,
  open,
  step,
}: {
  onToggle: () => void;
  open: boolean;
  step: ToolChipStep;
}) {
  const expandable = step.detail.length > 0;

  return (
    <div style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={onToggle}
        className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover-2"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
          <span
            className={`flex transition-opacity duration-100 ${
              expandable ? "group-hover/row:opacity-0" : ""
            } ${open ? "opacity-0" : ""}`}
          >
            <StatusGlyph step={step} />
          </span>
          {expandable ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${
                open ? "opacity-100" : "opacity-0"
              }`}
              style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          ) : null}
        </span>
        {step.status === "running" ? (
          <span
            className="shrink-0 bg-clip-text text-[12.5px] font-medium text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
              backgroundSize: "200% 100%",
              animation: "shimmer-text 1.4s linear infinite",
            }}
          >
            {step.label}
          </span>
        ) : (
          <span
            className={`shrink-0 text-[12.5px] font-medium ${
              step.status === "error" ? "text-red" : "text-ink"
            }`}
          >
            {step.label}
          </span>
        )}
        {step.chip ? (
          <span
            className={`inline-flex h-5.5 min-w-0 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline ${
              step.mono ? "font-mono" : ""
            }`}
          >
            <span className="truncate">{step.chip}</span>
          </span>
        ) : null}
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
            {step.detail.map((line, index) => (
              <span
                key={index}
                className={`text-[11.5px] leading-[1.6] break-words ${
                  line.tone === "error" ? "text-red" : "text-ink-2"
                }`}
              >
                {line.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ToolChips({
  header,
  steps,
}: {
  /** collapsible run summary; omitted for a single row */
  header?: string;
  steps: ToolChipStep[];
}) {
  // Error rows start expanded so the failure reason is visible without a click.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(true);

  const toggleRow = (step: ToolChipStep) =>
    setOpenRows((current) => ({
      ...current,
      [step.key]: !(current[step.key] ?? step.status === "error"),
    }));

  const rows = (
    <div className="flex flex-col gap-1">
      {steps.map((step) => (
        <ToolRow
          key={step.key}
          onToggle={() => toggleRow(step)}
          open={openRows[step.key] ?? step.status === "error"}
          step={step}
        />
      ))}
    </div>
  );

  if (!header) {
    return <div className="w-full max-w-md">{rows}</div>;
  }

  return (
    <div className="w-full max-w-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-200"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">{header}</span>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5">{rows}</div>
        </div>
      </div>
    </div>
  );
}

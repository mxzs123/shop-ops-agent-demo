"use client";

// Beautiful UI `task-rows` (https://www.beautifului.dev/r/task-rows.json, MIT).
// Adapted: the timed pending → failed → completed demo run is replaced by a
// controlled per-row status; rows only expand when they carry details.

import { useState } from "react";

function SpinnerRing() {
  const size = 22;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={{ animation: "spin 1.1s linear infinite" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.28} ${c * 0.72}`}
        />
      </svg>
    </span>
  );
}

function Badge({ tone, children }: { tone: "green" | "neutral" | "red"; children: React.ReactNode }) {
  return (
    <span
      className={`flex size-5.5 shrink-0 items-center justify-center rounded-full ${
        tone === "red" ? "bg-red text-white" : tone === "green" ? "bg-green text-white" : "bg-hover-2 text-ink-2"
      }`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const CheckIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const SkipIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export type TaskDetail = { label: string; meta?: string; tone?: "error" };

export type TaskRow = {
  key: string;
  label: string;
  amount?: string;
  status: "done" | "failed" | "running" | "skipped";
  details: TaskDetail[];
};

const PILLS: Record<TaskRow["status"], { className: string; label: string } | null> = {
  done: { className: "bg-green-tint text-green", label: "已完成" },
  failed: { className: "bg-red-tint text-red", label: "失败" },
  running: null,
  skipped: { className: "bg-hover-2 text-ink-2", label: "已跳过" },
};

export default function TaskRows({ rows }: { rows: TaskRow[] }) {
  // Failed rows open by default so the reasons are visible right away.
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  const badgeFor = (row: TaskRow) => {
    if (row.status === "done") return <Badge tone="green">{CheckIcon}</Badge>;
    if (row.status === "failed") return <Badge tone="red">{XIcon}</Badge>;
    if (row.status === "skipped") return <Badge tone="neutral">{SkipIcon}</Badge>;
    return <SpinnerRing />;
  };

  return (
    <div className="tool-card-enter flex w-full flex-col gap-2">
      {rows.map((row, i) => {
        const expandable = row.details.length > 0;
        const open = expandable && (manualOpen[row.key] ?? row.status === "failed");
        const pill = PILLS[row.status];
        return (
          <div
            key={row.key}
            className={`self-stretch overflow-hidden bg-surface shadow-card transition-[border-radius,background-color] duration-300 ${
              expandable ? "hover:bg-inset" : ""
            }`}
            style={{
              borderRadius: open ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={expandable ? open : undefined}
              disabled={!expandable}
              onClick={() => setManualOpen((current) => ({ ...current, [row.key]: !open }))}
              className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">{badgeFor(row)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{row.label}</span>
              {row.amount ? (
                <span className="shrink-0 text-[12.5px] text-ink-2 tabular-nums">{row.amount}</span>
              ) : null}
              {pill ? (
                <span
                  className={`inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium ${pill.className}`}
                  style={{ animation: "fade-in 200ms ease-out both" }}
                >
                  {pill.label}
                </span>
              ) : null}
              {expandable ? (
                <span aria-hidden="true" className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform duration-300"
                    style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
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
                <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                  <span aria-hidden className="mx-auto h-full w-px bg-line" />
                  <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                    {row.details.map((d, j) => (
                      <div
                        key={`${d.label}-${j}`}
                        className="flex items-start justify-between gap-3"
                        style={open ? { animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${Math.min(j, 8) * 60}ms both` } : undefined}
                      >
                        <span className="min-w-0 text-[12px] leading-5 text-ink-2">{d.label}</span>
                        {d.meta ? (
                          <span
                            className={`max-w-[55%] shrink-0 text-right text-[12px] leading-5 tabular-nums break-words ${
                              d.tone === "error" ? "text-red" : "text-ink-3"
                            }`}
                          >
                            {d.meta}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

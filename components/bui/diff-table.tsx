"use client";

// Beautiful UI `diff-table` (https://www.beautifului.dev/r/diff-table.json, MIT).
// Adapted: columns and rows are data-driven, rows are tinted by change kind
// (added / removed / changed), the footer is a controlled confirm flow that
// follows the plan through execution (the server freezes the plan under a
// previewId, so rows are not toggleable), and narrow screens get a stacked
// before → after list instead of a horizontally scrolling table.

import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/bui/button";

export type DiffTableColumn = {
  key: string;
  label: string;
  width?: string;
  /** "before" cells strike through, "after" cells take the change tone */
  role?: "after" | "before";
};

export type DiffTableRow = {
  key: string;
  cells: Record<string, ReactNode>;
  /** add → green tint, remove → red tint, change → before/after tones only */
  kind: "add" | "change" | "remove";
  /** first row of a new target group draws a stronger rule above it */
  groupStart?: boolean;
};

export type DiffTableStatus =
  | "cancelled"
  | "done"
  | "failed"
  | "idle"
  | "partial"
  | "submitted";

function ChangeMark({ kind }: { kind: DiffTableRow["kind"] }) {
  if (kind === "change") return null;
  return (
    <span
      aria-hidden
      className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] text-white ${
        kind === "remove" ? "bg-red" : "bg-green"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        {kind === "remove" ? <path d="M5 12h14" /> : <path d="M12 5v14M5 12h14" />}
      </svg>
    </span>
  );
}

function rowBackground(kind: DiffTableRow["kind"]) {
  return kind === "remove"
    ? "var(--red-tint)"
    : kind === "add"
      ? "var(--green-tint)"
      : undefined;
}

function cellTone(
  role: DiffTableColumn["role"],
  kind: DiffTableRow["kind"],
): CSSProperties | undefined {
  if (role === "before" && kind !== "add") {
    return {
      color: "var(--red)",
      textDecorationLine: "line-through",
      textDecorationColor: "color-mix(in srgb, var(--red) 50%, transparent)",
    };
  }
  if (role === "after" && kind !== "remove") return { color: "var(--green)" };
  if (kind === "remove") return { color: "var(--red)" };
  return undefined;
}

const CheckGlyph = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const CrossGlyph = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const BangGlyph = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
    <path d="M12 6v8M12 18.5v.01" />
  </svg>
);

const STATUS_PILLS: Record<
  Exclude<DiffTableStatus, "idle">,
  { glyph: ReactNode; label: string; tint: string; tone: string }
> = {
  cancelled: { glyph: null, label: "已取消", tint: "bg-hover-2", tone: "text-ink-2" },
  done: { glyph: CheckGlyph, label: "已执行", tint: "bg-green-tint", tone: "text-green" },
  failed: { glyph: CrossGlyph, label: "执行失败", tint: "bg-red-tint", tone: "text-red" },
  partial: { glyph: BangGlyph, label: "部分执行成功", tint: "bg-orange-tint", tone: "text-orange" },
  submitted: { glyph: null, label: "已确认，正在执行", tint: "bg-hover-2", tone: "text-ink-2" },
};

function StatusPill({ status }: { status: Exclude<DiffTableStatus, "idle"> }) {
  const pill = STATUS_PILLS[status];
  const solid =
    status === "done" ? "bg-green" : status === "failed" ? "bg-red" : status === "partial" ? "bg-orange" : "";

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 text-[12.5px] font-medium ${pill.tint} ${pill.tone} ${
        pill.glyph || status === "submitted" ? "pl-1" : "pl-2.5"
      }`}
      style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {status === "submitted" ? (
        <span className="flex size-4.5 items-center justify-center">
          <span
            className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
            style={{ animation: "spin 700ms linear infinite" }}
          />
        </span>
      ) : pill.glyph ? (
        <span className={`flex size-4.5 items-center justify-center rounded-full text-white ${solid}`}>
          {pill.glyph}
        </span>
      ) : null}
      {pill.label}
    </span>
  );
}

export default function DiffTable({
  cancelLabel = "取消",
  columns,
  confirmLabel,
  disabled,
  hideActions = false,
  meta,
  minWidth,
  notice,
  onCancel,
  onConfirm,
  rows,
  status,
  sticky = false,
  summary,
  title,
  warnings = [],
}: {
  cancelLabel?: string;
  columns: DiffTableColumn[];
  confirmLabel: string;
  disabled: boolean;
  hideActions?: boolean;
  /** right side of the title bar */
  meta?: ReactNode;
  minWidth?: string;
  /** line under the table, e.g. "only the first N rows are shown" */
  notice?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  rows: DiffTableRow[];
  status: DiffTableStatus;
  /** footer summary next to the actions */
  summary?: ReactNode;
  /** keep the footer in view under long tables */
  sticky?: boolean;
  title: ReactNode;
  warnings?: string[];
}) {
  const pending = status === "idle";
  const labelColumns = columns.filter((column) => !column.role);
  const beforeColumn = columns.find((column) => column.role === "before");
  const afterColumn = columns.find((column) => column.role === "after");

  return (
    <div className="tool-card-enter w-full">
      <div className="relative rounded-card bg-surface shadow-card">
        <div className="primitive-card-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line">
          <span className="min-w-0 text-[13px] font-medium text-ink">{title}</span>
          {meta ? (
            <span className="text-[11.5px] tabular-nums text-ink-3">{meta}</span>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <>
            {/* ≥ sm: the full table */}
            <div className="hidden overflow-x-auto sm:block">
              <table
                className="w-full table-fixed border-collapse text-left"
                style={{ minWidth }}
              >
                <colgroup>
                  {columns.map((column) => (
                    <col key={column.key} style={{ width: column.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-line">
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        className="primitive-table-cell text-[12px] font-medium text-ink-3"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className={`border-b border-line last:border-0 ${
                        row.groupStart ? "border-t border-t-line-strong first:border-t-0" : ""
                      }`}
                      style={{ background: rowBackground(row.kind) }}
                    >
                      {columns.map((column, index) => (
                        <td
                          key={column.key}
                          className={`primitive-table-cell align-middle text-[12.5px] leading-[1.45] break-words tabular-nums ${
                            column.role ? "font-medium" : "text-ink"
                          }`}
                          style={cellTone(column.role, row.kind)}
                        >
                          {index === 0 ? (
                            <span className="flex items-start gap-2">
                              <span className="min-w-0 flex-1">{row.cells[column.key]}</span>
                              <ChangeMark kind={row.kind} />
                            </span>
                          ) : (
                            row.cells[column.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* < sm: stacked rows so the new value never scrolls off-screen */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className={`px-3 py-2.5 text-[12.5px] leading-[1.45] ${
                    row.groupStart ? "border-t-line-strong" : ""
                  }`}
                  style={{ background: rowBackground(row.kind) }}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5 text-ink">
                      {labelColumns.map((column) =>
                        row.cells[column.key] ? (
                          <div key={column.key} className={column.key === labelColumns.at(-1)?.key ? "text-ink-2" : undefined}>
                            {row.cells[column.key]}
                          </div>
                        ) : null,
                      )}
                    </div>
                    <ChangeMark kind={row.kind} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium tabular-nums">
                    {beforeColumn && row.kind !== "add" ? (
                      <>
                        <span style={cellTone("before", row.kind)}>{row.cells[beforeColumn.key]}</span>
                        <span aria-hidden className="text-ink-3">→</span>
                      </>
                    ) : null}
                    {afterColumn ? (
                      <span style={cellTone("after", row.kind)}>{row.cells[afterColumn.key]}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {notice ? (
          <div className="border-t border-line px-3 py-2 text-[11.5px] text-ink-3">
            {notice}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="flex gap-2 border-t border-line bg-orange-tint px-3 py-2 text-[12px] leading-5 text-orange">
            <svg aria-hidden className="mt-[3px] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
            </svg>
            <span className="min-w-0">{warnings.join(" ")}</span>
          </div>
        ) : null}

        <div
          className={`primitive-card-footer flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-b-card border-t border-line bg-surface ${
            // Long batch tables scroll past the fold; keep the confirm bar in
            // view at the bottom of the conversation viewport.
            sticky && pending && !hideActions ? "sticky bottom-0 z-10" : ""
          }`}
        >
          {pending ? (
            <span className="text-[11.5px] tabular-nums text-ink-3">{summary}</span>
          ) : (
            <StatusPill status={status} />
          )}

          {pending && !hideActions ? (
            <span className="ml-auto flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={onCancel}
                className="text-[12px]"
              >
                {cancelLabel}
              </Button>
              <Button
                variant="accent"
                size="sm"
                disabled={disabled}
                onClick={onConfirm}
                className="text-[12px]"
              >
                {confirmLabel}
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import type { UIMessage } from "ai";

import type { ToolChipIcon, ToolChipStep } from "@/components/bui/tool-chips";
import { isRecord } from "@/lib/format";
import {
  EXECUTE_TOOL_NAMES,
  PLAN_TOOL_NAMES,
  readToolOutput,
  readToolPartName,
  readToolPartState,
  toolCompleteMessage,
  toolLabel,
  toolPendingMessage,
} from "@/lib/tool-parts";

type MessagePart = UIMessage["parts"][number];

/** Tools whose successful output renders as its own card. */
export function isCardTool(name: string) {
  return (
    name === "goods_search" ||
    PLAN_TOOL_NAMES.has(name) ||
    EXECUTE_TOOL_NAMES.has(name)
  );
}

/**
 * How a tool part renders: a dedicated card (search results, plan diff,
 * execution rows) or a compact row inside a ToolChips run.
 */
export function toolPartLayout(part: MessagePart): "card" | "chip" {
  const name = readToolPartName(part);
  if (!name) {
    return "chip";
  }

  const state = readToolPartState(part);
  if (state !== "output-available") {
    // A pending execute is shown as a running task row, not a chip.
    return EXECUTE_TOOL_NAMES.has(name) ? "card" : "chip";
  }

  const output = readToolOutput("output" in part ? part.output : undefined);
  if (name === "goods_search" && isEmptySearch(output.data)) {
    // A search with no hits has nothing to show beyond a one-line result.
    return "chip";
  }
  return output.ok && isCardTool(name) ? "card" : "chip";
}

function isEmptySearch(data: unknown) {
  return isRecord(data) && Array.isArray(data.rows) && data.rows.length === 0;
}

function toolIcon(name: string): ToolChipIcon {
  if (name === "goods_search") return "search";
  if (name === "goods_get_editable") return "read";
  if (PLAN_TOOL_NAMES.has(name)) return "write";
  return "run";
}

function countLabel(value: unknown) {
  return Array.isArray(value) ? `${value.length} 件` : undefined;
}

/** One-line summary of the call arguments for the chip. */
function summarizeInput(name: string, input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  switch (name) {
    case "goods_search": {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      const page = typeof input.page === "number" && input.page > 1 ? ` · ${input.page} ページ目` : "";
      return `${query ? `“${query}”` : "すべての商品"}${page}`;
    }
    case "goods_get_editable":
      return input.id !== undefined ? `ID ${String(input.id)}` : undefined;
    case "goods_plan_edit":
      return countLabel(input.operations);
    case "goods_plan_create":
    case "goods_plan_batch_create":
      return countLabel(input.items);
    case "goods_plan_delete":
      return countLabel(input.ids);
    case "goods_plan_filter_edit": {
      const selector = isRecord(input.selector) ? input.selector : {};
      const query = typeof selector.query === "string" ? selector.query.trim() : "";
      return query ? `“${query}”` : "条件指定";
    }
    default:
      return undefined;
  }
}

export function toToolChipStep(part: MessagePart, key: string): ToolChipStep {
  const name = readToolPartName(part) ?? "tool";
  const state = readToolPartState(part);
  const chip = summarizeInput(name, "input" in part ? part.input : undefined);
  const base = { chip, icon: toolIcon(name), key };

  if (state === "output-error") {
    const errorText = "errorText" in part ? part.errorText : undefined;
    return {
      ...base,
      detail: errorText ? [{ text: errorText, tone: "error" }] : [],
      label: `${toolLabel(name)}に失敗`,
      status: "error",
    };
  }

  if (state !== "output-available") {
    return { ...base, detail: [], label: toolPendingMessage(name), status: "running" };
  }

  const output = readToolOutput("output" in part ? part.output : undefined);
  if (!output.ok) {
    return {
      ...base,
      detail: output.error ? [{ text: output.error, tone: "error" }] : [],
      label: `${toolLabel(name)}に失敗`,
      status: "error",
    };
  }

  if (name === "goods_search" && isEmptySearch(output.data)) {
    return { ...base, detail: [], label: "該当する商品がありません", status: "done" };
  }

  return { ...base, detail: [], label: toolCompleteMessage(name), status: "done" };
}

export function toolRunHeader(steps: ToolChipStep[]): string | undefined {
  if (steps.length < 2) {
    return undefined;
  }

  const running = steps.filter((step) => step.status === "running").length;
  const failed = steps.filter((step) => step.status === "error").length;
  return [
    `ツール呼び出し ${steps.length} 回`,
    running > 0 ? `実行中 ${running} 件` : "",
    failed > 0 ? `失敗 ${failed} 件` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Outcome of the execute call that consumed a plan preview. */
export type PreviewExecutionState = "done" | "failed" | "partial" | "running";

function executionState(part: MessagePart): PreviewExecutionState {
  const state = readToolPartState(part);
  if (state === "output-error") {
    return "failed";
  }
  if (state !== "output-available") {
    return "running";
  }

  const output = readToolOutput("output" in part ? part.output : undefined);
  if (!output.ok || !isRecord(output.data)) {
    return output.ok ? "done" : "failed";
  }

  const { failureCount, successCount } = output.data;
  const failures = typeof failureCount === "number" ? failureCount : 0;
  if (failures === 0) {
    return "done";
  }
  return typeof successCount === "number" && successCount > 0
    ? "partial"
    : "failed";
}

/**
 * Maps each previewId to the state of the execute call that consumed it.
 * Derived from the conversation itself, so plan cards show the right status
 * after a reload or session switch without persisting extra UI state. The
 * last execute call per preview wins (a retry after a failure).
 */
export function collectPreviewExecutions(
  messages: UIMessage[],
): Record<string, PreviewExecutionState> {
  const result: Record<string, PreviewExecutionState> = {};

  for (const message of messages) {
    for (const part of message.parts) {
      const name = readToolPartName(part);
      if (!name || !EXECUTE_TOOL_NAMES.has(name)) {
        continue;
      }
      const input = "input" in part ? part.input : undefined;
      if (isRecord(input) && typeof input.previewId === "string") {
        result[input.previewId] = executionState(part);
      }
    }
  }

  return result;
}

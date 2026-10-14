import type { UIMessage } from "ai";

import { isRecord } from "@/lib/format";
import { readToolName } from "@/src/part-utils";
import type {
  GoodsBatchEditExecution,
  GoodsBatchEditPlan,
  GoodsEditExecution,
  GoodsEditPlan,
  ToolWarning,
} from "@/src/types";

export interface ToolOutput<T = unknown> {
  data?: T;
  error?: string;
  ok?: boolean;
  status?: number;
}

export type PlanActionState =
  | { status: "cancelled" }
  | { plannedCount?: number; status: "submitted" };

export interface PlanConfirmationContext {
  executeToolName?: string;
  plannedCount?: number;
  previewId?: string;
}

export const TOOL_LABELS: Record<string, string> = {
  goods_execute: "プレビューの実行",
  // Legacy execute tool names kept readable for restored sessions.
  goods_execute_batch_edit: "商品の一括編集の実行",
  goods_execute_batch_create: "商品の一括登録の実行",
  goods_execute_filter_edit: "範囲指定の一括編集の実行",
  goods_execute_create: "商品登録の実行",
  goods_execute_delete: "商品削除の実行",
  goods_execute_edit: "商品編集の実行",
  goods_get_editable: "商品詳細の読み取り",
  goods_plan_batch_edit: "商品の一括編集プレビュー",
  goods_plan_batch_create: "商品の一括登録プレビュー",
  goods_plan_create: "商品登録プレビュー",
  goods_plan_delete: "商品削除プレビュー",
  goods_plan_edit: "商品編集プレビュー",
  goods_plan_filter_edit: "範囲指定の一括編集プレビュー",
  goods_search: "商品検索",
};

export const TOOL_PENDING_MESSAGES: Record<string, string> = {
  goods_execute: "操作を実行中",
  goods_execute_batch_edit: "一括操作を実行中",
  goods_execute_batch_create: "一括登録を実行中",
  goods_execute_filter_edit: "範囲指定の一括操作を実行中",
  goods_execute_create: "商品を登録中",
  goods_execute_delete: "商品を削除中",
  goods_execute_edit: "商品編集を実行中",
  goods_get_editable: "商品詳細を読み取り中",
  goods_plan_batch_edit: "一括プレビューを作成中",
  goods_plan_batch_create: "一括登録プレビューを作成中",
  goods_plan_create: "登録プレビューを作成中",
  goods_plan_delete: "削除プレビューを作成中",
  goods_plan_edit: "編集プレビューを作成中",
  goods_plan_filter_edit: "範囲指定の一括プレビューを作成中",
  goods_search: "商品を検索中",
};

export const PLAN_TOOL_NAMES = new Set([
  "goods_plan_batch_create",
  "goods_plan_batch_edit",
  "goods_plan_create",
  "goods_plan_delete",
  "goods_plan_edit",
  "goods_plan_filter_edit",
]);

export const EXECUTE_TOOL_NAMES = new Set([
  "goods_execute",
  "goods_execute_batch_create",
  "goods_execute_batch_edit",
  "goods_execute_create",
  "goods_execute_delete",
  "goods_execute_edit",
  "goods_execute_filter_edit",
]);

export function isToolPart(part: UIMessage["parts"][number]) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export const readToolPartName = readToolName;

export function readToolPartState(part: UIMessage["parts"][number]) {
  return "state" in part ? part.state : "input-available";
}

export function readToolOutput(output: unknown): ToolOutput {
  if (!isRecord(output)) {
    return { data: output, ok: true };
  }

  if ("ok" in output) {
    return output as ToolOutput;
  }

  return { data: output, ok: true };
}

export function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name;
}

export function toolPendingMessage(name: string, plannedCount?: number) {
  if (plannedCount !== undefined && EXECUTE_TOOL_NAMES.has(name)) {
    return `${plannedCount.toLocaleString("ja-JP")} 件を実行中`;
  }

  return TOOL_PENDING_MESSAGES[name] ?? "実行中";
}

export function toolFailureMessage(name: string, error?: string) {
  return `${toolLabel(name)}に失敗${error ? `：${error}` : ""}`;
}

export function toolCompleteMessage(name: string) {
  return `${toolLabel(name)}が完了`;
}

export function collectConsecutivePlans(
  parts: UIMessage["parts"],
  startIndex: number,
): { consumed: number; plans: GoodsEditPlan[] } {
  const plans: GoodsEditPlan[] = [];
  let consumed = 0;

  for (let index = startIndex; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      break;
    }

    const name = readToolPartName(part);
    if (name === "goods_get_editable") {
      consumed += 1;
      continue;
    }

    if (name !== "goods_plan_edit") {
      break;
    }

    if (readToolPartState(part) !== "output-available") {
      break;
    }

    const output = readToolOutput("output" in part ? part.output : undefined);
    const data = output.data;
    // Only legacy single-plan outputs are merged here; batch-shaped outputs
    // (with items[]) render their own BatchPlanCard.
    if (!output.ok || !isRecord(data) || Array.isArray(data.items)) {
      break;
    }

    plans.push(data as unknown as GoodsEditPlan);
    consumed += 1;
  }

  return { consumed: Math.max(consumed, 1), plans };
}

export function isBatchExecution(
  value: GoodsBatchEditExecution | GoodsEditExecution,
): value is GoodsBatchEditExecution {
  return "items" in value && Array.isArray(value.items);
}

export function getPlanKey(plan: GoodsEditPlan) {
  return getPlansKey([plan]);
}

export function getPlansKey(plans: GoodsEditPlan[], previewId?: string) {
  if (previewId) {
    return `preview:${previewId}`;
  }

  return plans.map(getSinglePlanKey).join("|");
}

function getSinglePlanKey(plan: GoodsEditPlan) {
  return [
    plan.action ?? "goods.update",
    plan.target.id,
    JSON.stringify(plan.patch),
    JSON.stringify(plan.changes),
  ].join(":");
}

export function getPlanConfirmationContext(
  plan?: GoodsBatchEditPlan,
): PlanConfirmationContext | undefined {
  if (!plan?.previewId) {
    return undefined;
  }

  return {
    executeToolName: "goods_execute",
    plannedCount: plan.plannedCount,
    previewId: plan.previewId,
  };
}

export function compactConfirmationContext(
  confirmation: PlanConfirmationContext,
): PlanConfirmationContext {
  return {
    executeToolName: confirmation.executeToolName,
    previewId: confirmation.previewId,
  };
}

// Older server versions stuffed informational batch summaries into warnings
// as plain strings; sessions restored from localStorage can still carry them.
function isLegacyBatchInfoMessage(warning: string) {
  return (
    /^已冻结 \d+ 个待修改商品/.test(warning) ||
    /^已生成 \d+ 个商品的批量(?:录入)?预览/.test(warning) ||
    warning.startsWith("下方仅展示前") ||
    warning.includes("确认后会执行全部冻结目标")
  );
}

/**
 * Normalizes warnings into the structured {code, message} contract. Current
 * tool outputs already use it; legacy strings from restored sessions get a
 * `legacy` code (or `info.legacy-batch` for old batch summary texts).
 */
export function normalizeToolWarnings(warnings: unknown): ToolWarning[] {
  if (!Array.isArray(warnings)) {
    return [];
  }

  const result: ToolWarning[] = [];
  for (const entry of warnings) {
    if (typeof entry === "string") {
      if (!entry) {
        continue;
      }
      result.push({
        code: isLegacyBatchInfoMessage(entry) ? "info.legacy-batch" : "legacy",
        message: entry,
      });
      continue;
    }

    if (
      isRecord(entry) &&
      typeof entry.message === "string" &&
      entry.message
    ) {
      result.push({
        code:
          typeof entry.code === "string" && entry.code ? entry.code : "unknown",
        message: entry.message,
      });
    }
  }

  return result;
}

// Codes hidden from batch plan cards; the card header already carries the
// same information as counters.
const HIDDEN_BATCH_WARNING_CODES = new Set(["info.legacy-batch"]);

export function planWarningMessages(warnings: unknown): string[] {
  return uniqueMessages(normalizeToolWarnings(warnings));
}

export function batchPlanWarningMessages(warnings: unknown): string[] {
  return uniqueMessages(
    normalizeToolWarnings(warnings).filter(
      (entry) => !HIDDEN_BATCH_WARNING_CODES.has(entry.code),
    ),
  );
}

function uniqueMessages(warnings: ToolWarning[]): string[] {
  return Array.from(new Set(warnings.map((entry) => entry.message)));
}

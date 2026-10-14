"use client";

import { memo, useMemo } from "react";

import DiffTable, {
  type DiffTableColumn,
  type DiffTableRow,
  type DiffTableStatus,
} from "@/components/bui/diff-table";
import { usePlanActions } from "@/components/chat/plan-actions-context";
import { renderChangeValue } from "@/components/tool-cards/media-value";
import {
  batchPlanWarningMessages,
  getPlanKey,
  getPlansKey,
  planWarningMessages,
  type PlanActionState,
  type PlanConfirmationContext,
  type ToolOutput,
} from "@/lib/tool-parts";
import type { PreviewExecutionState } from "@/lib/ui-adapters";
import type { GoodsBatchEditPlan, GoodsEditPlan } from "@/src/types";

type PlanActionType =
  | "goods.batchCreate"
  | "goods.batchDelete"
  | "goods.create"
  | "goods.delete"
  | string;

function planTitle(actionType: PlanActionType, single: boolean): string {
  if (actionType === "goods.create" || actionType === "goods.batchCreate") {
    return single ? "录入预览" : "批量录入预览";
  }
  if (actionType === "goods.delete" || actionType === "goods.batchDelete") {
    return single ? "删除预览" : "批量删除预览";
  }
  return single ? "修改预览" : "批量修改预览";
}

function planConfirmLabel(actionType: PlanActionType): string {
  if (actionType === "goods.create" || actionType === "goods.batchCreate") {
    return "确认录入";
  }
  if (actionType === "goods.delete" || actionType === "goods.batchDelete") {
    return "确认删除";
  }
  return "确认执行";
}

function rowKind(plan: GoodsEditPlan): DiffTableRow["kind"] {
  if (plan.action === "goods.create") return "add";
  if (plan.action === "goods.delete") return "remove";
  return "change";
}

/**
 * The execute call recorded in the conversation is the source of truth once
 * it exists (it survives reloads); the in-memory confirm/cancel click covers
 * the gap before it arrives and legacy plans without a previewId.
 */
function diffStatus(
  action?: PlanActionState,
  execution?: PreviewExecutionState,
): DiffTableStatus {
  if (execution) {
    return execution === "running" ? "submitted" : execution;
  }
  return action?.status ?? "idle";
}

const FIELD_COLUMNS: DiffTableColumn[] = [
  { key: "field", label: "字段", width: "7rem" },
  { key: "before", label: "修改前", role: "before" },
  { key: "after", label: "修改后", role: "after" },
];

const BATCH_COLUMNS: DiffTableColumn[] = [
  { key: "product", label: "商品", width: "40%" },
  { key: "field", label: "字段", width: "16%" },
  { key: "before", label: "修改前", role: "before", width: "22%" },
  { key: "after", label: "修改后", role: "after", width: "22%" },
];

export const PlanCard = memo(function PlanCard({
  mediaBaseUrl,
  output,
}: {
  mediaBaseUrl: string;
  output: ToolOutput<GoodsEditPlan>;
}) {
  const { disabled, onCancelPlan, onConfirmPlan, planActions } =
    usePlanActions();
  const plan = output.data;

  if (!plan) {
    return null;
  }

  const action = planActions[getPlanKey(plan)];
  const actionType = plan.action ?? "goods.update";
  const kind = rowKind(plan);

  return (
    <DiffTable
      columns={FIELD_COLUMNS}
      confirmLabel={planConfirmLabel(actionType)}
      disabled={disabled}
      meta={`ID ${plan.target.id}`}
      onCancel={() => onCancelPlan(plan)}
      onConfirm={() => onConfirmPlan(plan)}
      rows={plan.changes.map((change) => ({
        cells: {
          after: renderChangeValue(change.field, change.after, mediaBaseUrl),
          before: renderChangeValue(change.field, change.before, mediaBaseUrl),
          field: change.label,
        },
        key: change.field,
        kind,
      }))}
      status={diffStatus(action)}
      summary={`${plan.changes.length} 个字段变化`}
      title={
        <>
          <span className="text-ink-3">{planTitle(actionType, true)} · </span>
          {plan.target.name}
        </>
      }
      warnings={planWarningMessages(plan.warnings)}
    />
  );
});

export const BatchPlanCard = memo(function BatchPlanCard({
  confirmation,
  mediaBaseUrl,
  plan,
  plans,
}: {
  confirmation?: PlanConfirmationContext;
  mediaBaseUrl: string;
  plan?: GoodsBatchEditPlan;
  plans: GoodsEditPlan[];
}) {
  const {
    disabled,
    onCancelPlans,
    onConfirmPlans,
    planActions,
    previewExecutions,
  } = usePlanActions();

  // Building the row tree involves per-change JSX; memoize it so streaming
  // sibling text does not rebuild large batch tables on every token.
  const rows = useMemo<DiffTableRow[]>(
    () =>
      plans.flatMap((item) =>
        item.changes.map((change, index) => ({
          cells: {
            after: renderChangeValue(change.field, change.after, mediaBaseUrl),
            before: renderChangeValue(
              change.field,
              change.before,
              mediaBaseUrl,
            ),
            field: change.label,
            product:
              index === 0 ? (
                <>
                  <div className="font-medium text-ink">{item.target.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                    ID {item.target.id}
                  </div>
                </>
              ) : null,
          },
          groupStart: index === 0,
          key: `${item.target.id}-${change.field}`,
          kind: rowKind(item),
        })),
      ),
    [mediaBaseUrl, plans],
  );

  if (plans.length === 0 && !plan) {
    return null;
  }

  const rawWarnings = plan?.warnings ?? plans.flatMap((item) => item.warnings);
  const action = planActions[getPlansKey(plans, confirmation?.previewId)];
  const status = diffStatus(
    action,
    confirmation?.previewId
      ? previewExecutions[confirmation.previewId]
      : undefined,
  );
  const changeCount = plans.reduce((sum, item) => sum + item.changes.length, 0);
  const totalCount = plan?.totalCount ?? plans.length;
  const plannedCount = plan?.plannedCount ?? plans.length;
  const skippedCount = plan?.skippedCount ?? 0;
  const sampleCount = plan?.sampleCount ?? plans.length;
  const actionType = plan?.action ?? "goods.batchUpdate";

  return (
    <DiffTable
      columns={BATCH_COLUMNS}
      confirmLabel={planConfirmLabel(actionType)}
      disabled={disabled}
      hideActions={plannedCount <= 0}
      meta={[
        `${plannedCount} 件${status === "idle" ? "待执行" : ""}`,
        totalCount !== plannedCount ? `${totalCount} 件匹配` : "",
        skippedCount > 0 ? `跳过 ${skippedCount} 件` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      minWidth="40rem"
      notice={
        sampleCount < plannedCount
          ? `仅展示前 ${sampleCount} 个用于核对；确认后将处理全部 ${plannedCount} 个商品。`
          : undefined
      }
      onCancel={() => onCancelPlans(plans, confirmation)}
      onConfirm={() => onConfirmPlans(plans, confirmation)}
      rows={rows}
      status={status}
      sticky
      summary={`${
        sampleCount < plannedCount
          ? `${sampleCount} 个样本`
          : `${plannedCount} 件商品`
      } · ${changeCount} 个字段变化`}
      title={planTitle(actionType, totalCount === 1)}
      warnings={batchPlanWarningMessages(rawWarnings)}
    />
  );
});

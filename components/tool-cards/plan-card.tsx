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
    return single ? "登録プレビュー" : "一括登録プレビュー";
  }
  if (actionType === "goods.delete" || actionType === "goods.batchDelete") {
    return single ? "削除プレビュー" : "一括削除プレビュー";
  }
  return single ? "変更プレビュー" : "一括変更プレビュー";
}

function planConfirmLabel(actionType: PlanActionType): string {
  if (actionType === "goods.create" || actionType === "goods.batchCreate") {
    return "登録を確定";
  }
  if (actionType === "goods.delete" || actionType === "goods.batchDelete") {
    return "削除を確定";
  }
  return "確認して実行";
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
  { key: "field", label: "項目", width: "7rem" },
  { key: "before", label: "変更前", role: "before" },
  { key: "after", label: "変更後", role: "after" },
];

const BATCH_COLUMNS: DiffTableColumn[] = [
  { key: "product", label: "商品", width: "40%" },
  { key: "field", label: "項目", width: "16%" },
  { key: "before", label: "変更前", role: "before", width: "22%" },
  { key: "after", label: "変更後", role: "after", width: "22%" },
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
      summary={`${plan.changes.length} 項目を変更`}
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
        `${plannedCount} 件${status === "idle" ? "が実行待ち" : ""}`,
        totalCount !== plannedCount ? `${totalCount} 件が該当` : "",
        skippedCount > 0 ? `スキップ ${skippedCount} 件` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      minWidth="40rem"
      notice={
        sampleCount < plannedCount
          ? `確認用に先頭 ${sampleCount} 件のみ表示しています。確定すると ${plannedCount} 件すべてを処理します。`
          : undefined
      }
      onCancel={() => onCancelPlans(plans, confirmation)}
      onConfirm={() => onConfirmPlans(plans, confirmation)}
      rows={rows}
      status={status}
      sticky
      summary={`${
        sampleCount < plannedCount
          ? `サンプル ${sampleCount} 件`
          : `商品 ${plannedCount} 件`
      } · ${changeCount} 項目を変更`}
      title={planTitle(actionType, totalCount === 1)}
      warnings={batchPlanWarningMessages(rawWarnings)}
    />
  );
});

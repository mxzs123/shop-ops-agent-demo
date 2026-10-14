import { memo } from "react";

import TaskRows, { type TaskRow } from "@/components/bui/task-rows";
import { formatValue } from "@/lib/format";
import { isBatchExecution, type ToolOutput } from "@/lib/tool-parts";
import type {
  GoodsBatchEditExecution,
  GoodsEditExecution,
} from "@/src/types";

/** Long values (rich text, image lists) collapse to a short preview. */
function shortValue(value: unknown) {
  const text = formatValue(value).replace(/\s+/g, " ");
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function changeSummary(item: GoodsEditExecution) {
  return item.changes
    .map((change) => `${change.label} → ${shortValue(change.after)}`)
    .join("、");
}

function batchRows(data: GoodsBatchEditExecution): TaskRow[] {
  const rows: TaskRow[] = [];
  const failureCount = data.failureCount ?? data.failures?.length ?? 0;
  const skippedCount = data.skippedCount ?? 0;
  const sampleCount = data.sampleCount ?? data.items.length;

  if (data.successCount > 0 || (failureCount === 0 && skippedCount === 0)) {
    rows.push({
      amount: `${data.successCount.toLocaleString("ja-JP")} 件`,
      details: [
        ...data.items.map((item) => ({
          label: item.target.name,
          meta: changeSummary(item) || `ID ${item.target.id}`,
        })),
        ...(sampleCount < data.successCount
          ? [{ label: `先頭 ${sampleCount} 件のみ表示` }]
          : []),
      ],
      key: "success",
      label: "実行成功",
      status: "done",
    });
  }

  if (failureCount > 0) {
    rows.push({
      amount: `${failureCount.toLocaleString("ja-JP")} 件`,
      details: (data.failures ?? []).map((failure) => ({
        label:
          failure.target?.name ??
          (failure.id !== undefined ? `ID ${failure.id}` : `${failure.index + 1} 件目`),
        meta: failure.error,
        tone: "error" as const,
      })),
      key: "failed",
      label: "実行失敗",
      status: "failed",
    });
  }

  if (skippedCount > 0) {
    rows.push({
      amount: `${skippedCount.toLocaleString("ja-JP")} 件`,
      details: [],
      key: "skipped",
      label: "未実行",
      status: "skipped",
    });
  }

  return rows;
}

function singleRow(data: GoodsEditExecution): TaskRow {
  return {
    amount: `ID ${data.target.id}`,
    details: data.changes.map((change) => ({
      label: change.label,
      meta: `→ ${shortValue(change.after)}`,
    })),
    key: "single",
    label: data.target.name,
    status: "done",
  };
}

export const ExecutionCard = memo(function ExecutionCard({
  output,
}: {
  output: ToolOutput<GoodsBatchEditExecution | GoodsEditExecution>;
}) {
  if (!output.data) {
    return null;
  }

  return (
    <TaskRows
      rows={
        isBatchExecution(output.data)
          ? batchRows(output.data)
          : [singleRow(output.data)]
      }
    />
  );
});

/** An execute call still in flight: one spinning task row. */
export function PendingExecutionCard({ label }: { label: string }) {
  return (
    <TaskRows rows={[{ details: [], key: "running", label, status: "running" }]} />
  );
}

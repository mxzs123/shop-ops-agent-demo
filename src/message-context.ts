import type { UIMessage } from "ai";

import { isRecord, readToolName } from "./part-utils";

const MODEL_CONTEXT_MESSAGE_LIMIT = 8;
const STORAGE_MESSAGE_LIMIT = 16;
const MODEL_TOOL_ROW_LIMIT = 3;
const STORAGE_TOOL_ROW_LIMIT = 5;
const MAX_WARNING_COUNT = 8;
const MAX_FAILURE_COUNT = 8;
const MAX_CHANGE_COUNT = 12;
const MAX_STRING_LENGTH = 360;

interface CompactOptions {
  batchItemLimit: number;
  messageLimit: number;
  stripFiles: boolean;
}

export function compactMessagesForModelRequest(
  messages: UIMessage[],
): UIMessage[] {
  return compactMessages(messages, {
    batchItemLimit: MODEL_TOOL_ROW_LIMIT,
    messageLimit: MODEL_CONTEXT_MESSAGE_LIMIT,
    stripFiles: false,
  });
}

export function compactMessagesForStorage(messages: UIMessage[]): UIMessage[] {
  return compactMessages(messages, {
    batchItemLimit: STORAGE_TOOL_ROW_LIMIT,
    messageLimit: STORAGE_MESSAGE_LIMIT,
    stripFiles: true,
  });
}

function compactMessages(
  messages: UIMessage[],
  options: CompactOptions,
): UIMessage[] {
  return messages.slice(-options.messageLimit).map((message) => ({
    ...message,
    parts: Array.isArray(message.parts)
      ? message.parts.flatMap((part) => compactPart(part, options))
      : [],
  }));
}

function compactPart(
  part: UIMessage["parts"][number],
  options: CompactOptions,
): UIMessage["parts"] {
  if (options.stripFiles && part.type === "file") {
    return [];
  }

  const toolName = readToolName(part);
  if (!toolName) {
    return [part];
  }

  if (!("state" in part)) {
    return [part];
  }

  const compactedPart = compactToolInputPart(part, toolName, options);

  if (part.state === "output-available" && "output" in part) {
    return [
      {
        ...compactedPart,
        output: compactToolOutput(toolName, part.output, options),
      } as UIMessage["parts"][number],
    ];
  }

  if (part.state === "output-error" && "errorText" in part) {
    return [
      {
        ...compactedPart,
        errorText: truncateText(String(part.errorText)),
      } as UIMessage["parts"][number],
    ];
  }

  return [compactedPart];
}

function compactToolInputPart(
  part: UIMessage["parts"][number],
  toolName: string,
  options: CompactOptions,
): UIMessage["parts"][number] {
  if (!("input" in part)) {
    return part;
  }

  return {
    ...part,
    input: compactToolInput(toolName, part.input, options),
  } as UIMessage["parts"][number];
}

function compactToolInput(
  toolName: string,
  input: unknown,
  options: CompactOptions,
): unknown {
  if (!isRecord(input)) {
    return compactUnknown(input);
  }

  if (toolName === "goods_plan_edit" || toolName === "goods_plan_batch_edit") {
    // Legacy goods_plan_edit calls carried a single {id, patch} instead of
    // an operations array; normalize so restored sessions stay readable.
    const operations = Array.isArray(input.operations)
      ? input.operations
      : input.id !== undefined
        ? [{ id: input.id, patch: input.patch }]
        : [];
    return {
      operations: operations
        .slice(0, options.batchItemLimit)
        .map(compactBatchEditInput),
      totalInputCount: operations.length,
    };
  }

  if (toolName === "goods_execute_batch_edit") {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    return {
      operations: operations
        .slice(0, options.batchItemLimit)
        .map(compactBatchEditInput),
      previewId: input.previewId,
      totalInputCount: operations.length,
    };
  }

  if (
    toolName === "goods_plan_create" ||
    toolName === "goods_plan_batch_create"
  ) {
    const items = Array.isArray(input.items) ? input.items : [];
    return {
      items: items.slice(0, options.batchItemLimit).map(compactCreateInput),
      totalInputCount: items.length,
    };
  }

  if (toolName === "goods_execute_batch_create") {
    const items = Array.isArray(input.items) ? input.items : [];
    return {
      items: items.slice(0, options.batchItemLimit).map(compactCreateInput),
      previewId: input.previewId,
      totalInputCount: items.length,
    };
  }

  if (toolName === "goods_plan_delete") {
    const ids = Array.isArray(input.ids) ? input.ids : [];
    return {
      ids: ids.slice(0, options.batchItemLimit),
      totalInputCount: ids.length || (input.id !== undefined ? 1 : 0),
    };
  }

  if (toolName === "goods_plan_filter_edit") {
    return {
      maxItems: input.maxItems,
      patch: compactPatch(input.patch),
      selector: compactUnknown(input.selector),
    };
  }

  if (toolName === "goods_search") {
    return {
      goodsCategoryId: input.goodsCategoryId,
      isMarketable: input.isMarketable,
      limit: input.limit,
      page: input.page,
      query: compactOptionalString(input.query),
    };
  }

  return compactUnknown(input);
}

function compactToolOutput(
  toolName: string,
  output: unknown,
  options: CompactOptions,
): unknown {
  if (!isRecord(output)) {
    return output;
  }

  if (output.ok === false) {
    return {
      error: truncateText(String(output.error ?? "ツールの呼び出しに失敗しました")),
      ok: false,
      status: output.status,
    };
  }

  return {
    ...output,
    data: compactToolData(toolName, output.data, options),
  };
}

function compactToolData(
  toolName: string,
  data: unknown,
  options: CompactOptions,
): unknown {
  if (!isRecord(data)) {
    return compactUnknown(data);
  }

  if (toolName === "goods_search") {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    return {
      pageSize: data.pageSize,
      rows: rows.slice(0, options.batchItemLimit).map(compactGoodsSummary),
      total: data.total,
    };
  }

  if (toolName === "goods_get_editable") {
    const model = isRecord(data.model) ? data.model : {};
    return {
      fieldCount: Object.keys(model).length,
      target: compactGoodsSummary(model),
    };
  }

  if (
    toolName === "goods_plan_edit" ||
    toolName === "goods_plan_create" ||
    toolName === "goods_plan_delete" ||
    toolName === "goods_plan_batch_edit" ||
    toolName === "goods_plan_batch_create" ||
    toolName === "goods_plan_filter_edit"
  ) {
    // Legacy single-item plan tools returned a bare plan without items[];
    // keep that shape for restored sessions.
    if (!Array.isArray(data.items)) {
      return compactPlan(data);
    }

    const items = data.items;
    return {
      action: data.action,
      confirmRequired: data.confirmRequired,
      items: items.slice(0, options.batchItemLimit).map(compactPlan),
      plannedCount: data.plannedCount,
      previewId: data.previewId,
      sampleCount: Math.min(
        Number(data.sampleCount ?? items.length),
        options.batchItemLimit,
      ),
      skippedCount: data.skippedCount,
      totalCount: data.totalCount,
      warnings: compactWarnings(data.warnings),
    };
  }

  if (
    toolName === "goods_execute" ||
    toolName === "goods_execute_batch_edit" ||
    toolName === "goods_execute_batch_create" ||
    toolName === "goods_execute_filter_edit"
  ) {
    const items = Array.isArray(data.items) ? data.items : [];
    const failures = Array.isArray(data.failures) ? data.failures : [];
    return {
      adminMessage: truncateText(String(data.adminMessage ?? "")),
      failureCount: data.failureCount,
      failureSampleCount: data.failureSampleCount,
      failures: failures.slice(0, MAX_FAILURE_COUNT).map(compactFailure),
      items: items.slice(0, options.batchItemLimit).map(compactExecution),
      resultId: data.resultId,
      sampleCount: data.sampleCount,
      skippedCount: data.skippedCount,
      successCount: data.successCount,
      totalCount: data.totalCount,
      warnings: compactWarnings(data.warnings),
    };
  }

  if (
    toolName === "goods_execute_edit" ||
    toolName === "goods_execute_create" ||
    toolName === "goods_execute_delete"
  ) {
    return compactExecution(data);
  }

  return compactUnknown(data);
}

function compactPlan(value: unknown) {
  const plan = isRecord(value) ? value : {};
  return {
    action: plan.action,
    changes: compactChanges(plan.changes),
    confirmRequired: plan.confirmRequired,
    patch: compactPatch(plan.patch),
    target: compactGoodsSummary(plan.target),
    warnings: compactWarnings(plan.warnings),
  };
}

function compactExecution(value: unknown) {
  const execution = isRecord(value) ? value : {};
  return {
    adminMessage: truncateText(String(execution.adminMessage ?? "")),
    changes: compactChanges(execution.changes),
    target: compactGoodsSummary(execution.target),
    warnings: compactWarnings(execution.warnings),
  };
}

function compactFailure(value: unknown) {
  const failure = isRecord(value) ? value : {};
  return {
    error: truncateText(String(failure.error ?? "実行に失敗しました")),
    id: failure.id,
    index: failure.index,
    status: failure.status,
  };
}

function compactBatchEditInput(value: unknown) {
  const operation = isRecord(value) ? value : {};
  return {
    expectedChanges: compactChanges(operation.expectedChanges),
    id: operation.id ?? operation.targetId,
    patch: compactPatch(operation.patch),
  };
}

function compactCreateInput(value: unknown) {
  const operation = isRecord(value) ? value : {};
  const source = isRecord(operation.input) ? operation.input : operation;
  return {
    expectedChanges: compactChanges(operation.expectedChanges),
    input: compactPatch(source),
  };
}

function compactChanges(value: unknown) {
  return Array.isArray(value)
    ? value.slice(0, MAX_CHANGE_COUNT).filter(isRecord).map((change) => ({
        after: compactUnknown(change.after),
        before: compactUnknown(change.before),
        field: change.field,
        label: change.label,
      }))
    : [];
}

function compactPatch(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactUnknown(entry)]),
  );
}

function compactGoodsSummary(value: unknown) {
  const goods = isRecord(value) ? value : {};
  return {
    bn: compactOptionalString(goods.bn),
    goodsCategoryId: goods.goodsCategoryId,
    id: goods.id,
    image: compactOptionalString(goods.image),
    isMarketable: goods.isMarketable,
    name: compactOptionalString(goods.name) ?? "",
    price: goods.price,
    sn: compactOptionalString(goods.sn),
    stock: goods.stock,
  };
}

// Warnings are {code, message} objects in the current contract, but restored
// legacy sessions may still carry bare strings; both shapes are preserved.
function compactWarnings(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (isRecord(item) && typeof item.message === "string") {
        return { code: item.code, message: truncateText(item.message) };
      }

      return truncateText(String(item));
    })
    .filter((item) => (typeof item === "string" ? item : item.message))
    .slice(0, MAX_WARNING_COUNT);
}

function compactOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return truncateText(String(value));
}

function compactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateText(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, MODEL_TOOL_ROW_LIMIT).map(compactUnknown);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 24)
      .map(([key, entry]) => [key, compactUnknown(entry)]),
  );
}

function truncateText(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...`
    : value;
}


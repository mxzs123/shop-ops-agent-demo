import { AdminApiError } from "./admin-client";
import type { AuditLog } from "./audit-log";
import { saveBulkExecutionResult } from "./bulk-preview-store";
import type { AgentConfig } from "./config";
import {
  createGoodsBatchDeletePlan,
  createGoodsBatchEditPlan,
  createGoodsBatchCreatePlan,
  createGoodsCreatePlan,
  createGoodsDeletePlan,
  createGoodsEditPlan,
  createGoodsFilterEditPlan,
  getGoodsDetailSummary,
  executeGoodsBatchCreate,
  executeGoodsBatchDelete,
  executeGoodsCreate,
  executeGoodsDelete,
  executeGoodsBatchEdit,
  executeGoodsEdit,
  executeGoodsFilterEdit,
  executeGoodsPreview,
  getEditableGoods,
  searchGoods,
} from "./goods-tools";
import { isRecord } from "./part-utils";
import type {
  AdminAuth,
  AdminTransport,
  GoodsBatchEditExecution,
  GoodsEditExecution,
} from "./types";

const BATCH_EXECUTION_RESPONSE_SAMPLE_SIZE = 20;
const BATCH_FAILURE_RESPONSE_SAMPLE_SIZE = 20;

export interface GoodsToolContext {
  adminClient: AdminTransport;
  auditLog: AuditLog;
  auth: AdminAuth;
  config: Pick<AgentConfig, "backend">;
}

type GoodsToolHandler = (
  context: GoodsToolContext,
  input: unknown,
) => Promise<unknown>;
type BatchAuditKind =
  | "goods.executeBatchCreate"
  | "goods.executeBatchDelete"
  | "goods.executeBatchEdit"
  | "goods.executeFilterEdit";

const goodsToolHandlers: Record<string, GoodsToolHandler> = {
  "goods.detail": (context, input) =>
    getGoodsDetailSummary(context.adminClient, context.auth, input),
  "goods.executeBatchCreate": (context, input) =>
    executeGoodsBatchCreateWithAudit(context, input),
  "goods.executeBatchDelete": (context, input) =>
    executeGoodsBatchDeleteWithAudit(context, input),
  "goods.executeBatchEdit": (context, input) =>
    executeGoodsBatchEditWithAudit(context, input),
  "goods.executeCreate": (context, input) =>
    executeGoodsCreateWithAudit(context, input),
  "goods.executeDelete": (context, input) =>
    executeGoodsDeleteWithAudit(context, input),
  "goods.executeEdit": (context, input) =>
    executeGoodsEditWithAudit(context, input),
  "goods.executeFilterEdit": (context, input) =>
    executeGoodsFilterEditWithAudit(context, input),
  "goods.executePreview": (context, input) =>
    executeGoodsPreviewWithAudit(context, input),
  "goods.getEditable": (context, input) =>
    getEditableGoods(context.adminClient, context.auth, input),
  "goods.planBatchCreate": (context, input) =>
    createGoodsBatchCreatePlan(context.adminClient, context.auth, input),
  "goods.planBatchDelete": (context, input) =>
    createGoodsBatchDeletePlan(context.adminClient, context.auth, input),
  "goods.planBatchEdit": (context, input) =>
    createGoodsBatchEditPlan(context.adminClient, context.auth, input),
  "goods.planCreate": (context, input) =>
    createGoodsCreatePlan(context.adminClient, context.auth, input),
  "goods.planDelete": (context, input) =>
    createGoodsDeletePlan(context.adminClient, context.auth, input),
  "goods.planEdit": (context, input) =>
    createGoodsEditPlan(context.adminClient, context.auth, input),
  "goods.planFilterEdit": (context, input) =>
    createGoodsFilterEditPlan(context.adminClient, context.auth, input),
  "goods.search": (context, input) =>
    searchGoods(context.adminClient, context.auth, input),
};

export async function runGoodsTool(
  context: GoodsToolContext,
  tool: string,
  input: unknown,
) {
  const handler = goodsToolHandlers[tool];
  if (handler) {
    return handler(context, input);
  }

  throw new AdminApiError(`Unknown tool endpoint: ${tool}`, 404);
}

export async function executeGoodsEditWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);
  assertPreviewBackedWrite(context.config, input);
  assertSinglePreview(input);

  const result = await executeGoodsEdit(
    context.adminClient,
    context.auth,
    input,
  );
  const auditLogged = await writeAuditLog(context.auditLog, {
    changes: result.changes,
    kind: "goods.executeEdit",
    target: result.target,
  });

  return { ...result, auditLogged };
}

export async function executeGoodsBatchEditWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);
  assertPreviewBackedWrite(context.config, input);
  assertBatchPreviews(input);

  return executeBatchWithAudit(context, "goods.executeBatchEdit", () =>
    executeGoodsBatchEdit(context.adminClient, context.auth, input),
  );
}

export async function executeGoodsFilterEditWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);

  return executeBatchWithAudit(context, "goods.executeFilterEdit", () =>
    executeGoodsFilterEdit(context.adminClient, context.auth, input),
  );
}

export async function executeGoodsCreateWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);
  assertPreviewBackedWrite(context.config, input);
  assertSinglePreview(input);

  const result = await executeGoodsCreate(
    context.adminClient,
    context.auth,
    input,
  );
  const auditLogged = await writeAuditLog(context.auditLog, {
    changes: result.changes,
    kind: "goods.executeCreate",
    target: result.target,
  });

  return { ...result, auditLogged };
}

export async function executeGoodsBatchCreateWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);
  assertPreviewBackedWrite(context.config, input);
  assertBatchCreatePreviews(input);

  return executeBatchWithAudit(context, "goods.executeBatchCreate", () =>
    executeGoodsBatchCreate(context.adminClient, context.auth, input),
  );
}

export async function executeGoodsBatchDeleteWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);

  return executeBatchWithAudit(context, "goods.executeBatchDelete", () =>
    executeGoodsBatchDelete(context.adminClient, context.auth, input),
  );
}

const PREVIEW_AUDIT_KINDS: Record<string, BatchAuditKind> = {
  "goods.batchCreate": "goods.executeBatchCreate",
  "goods.batchDelete": "goods.executeBatchDelete",
  "goods.batchEdit": "goods.executeBatchEdit",
};

export async function executeGoodsPreviewWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);

  const { kind, result } = await executeGoodsPreview(
    context.adminClient,
    context.auth,
    input,
  );
  const auditLogged = await writeAuditLog(
    context.auditLog,
    buildBatchAuditEntry(
      PREVIEW_AUDIT_KINDS[kind] ?? "goods.executeBatchEdit",
      result,
    ),
  );

  return {
    ...(await compactBatchExecutionForResponse(
      withAuditWarning(result, auditLogged),
    )),
    auditLogged,
  };
}

export async function executeGoodsDeleteWithAudit(
  context: GoodsToolContext,
  input: unknown,
): Promise<GoodsEditExecution & { auditLogged: boolean }> {
  assertWritesAllowed(context.config);
  assertPreviewBackedWrite(context.config, input);
  assertSinglePreview(input);

  const result = await executeGoodsDelete(
    context.adminClient,
    context.auth,
    input,
  );
  const auditLogged = await writeAuditLog(context.auditLog, {
    changes: result.changes,
    kind: "goods.executeDelete",
    target: result.target,
  });

  return { ...result, auditLogged };
}

async function compactBatchExecutionForResponse(
  result: GoodsBatchEditExecution,
): Promise<GoodsBatchEditExecution> {
  const stored = await saveBulkExecutionResult({
    adminMessage: result.adminMessage,
    failureCount: result.failureCount,
    failures: result.failures,
    items: result.items,
    skippedCount: result.skippedCount,
    successCount: result.successCount,
    totalCount: result.totalCount,
    warnings: result.warnings,
  });
  const failures = result.failures ?? [];

  return {
    ...result,
    failureSampleCount: Math.min(
      failures.length,
      BATCH_FAILURE_RESPONSE_SAMPLE_SIZE,
    ),
    failures: failures.slice(0, BATCH_FAILURE_RESPONSE_SAMPLE_SIZE),
    items: result.items.slice(0, BATCH_EXECUTION_RESPONSE_SAMPLE_SIZE),
    resultExpiresAt: stored.expiresAt,
    resultId: stored.resultId,
    sampleCount: Math.min(
      result.items.length,
      BATCH_EXECUTION_RESPONSE_SAMPLE_SIZE,
    ),
  };
}

async function executeBatchWithAudit(
  context: GoodsToolContext,
  kind: BatchAuditKind,
  run: () => Promise<GoodsBatchEditExecution>,
): Promise<GoodsBatchEditExecution & { auditLogged: boolean }> {
  const result = await run();
  const auditLogged = await writeAuditLog(
    context.auditLog,
    buildBatchAuditEntry(kind, result),
  );

  return {
    ...(await compactBatchExecutionForResponse(
      withAuditWarning(result, auditLogged),
    )),
    auditLogged,
  };
}

/**
 * A write that completed without a durable audit line must be surfaced to
 * the operator, not silently flagged in a field the UI never renders.
 */
function withAuditWarning(
  result: GoodsBatchEditExecution,
  auditLogged: boolean,
): GoodsBatchEditExecution {
  if (auditLogged) {
    return result;
  }

  return {
    ...result,
    warnings: [
      ...result.warnings,
      {
        code: "audit.write-failed",
        message:
          "実行は完了しましたが、監査ログの書き込みに失敗しました。ログの設定を確認してください。",
      },
    ],
  };
}

function buildBatchAuditEntry(
  kind: BatchAuditKind,
  result: GoodsBatchEditExecution,
): Record<string, unknown> {
  return {
    failureCount: result.failureCount ?? 0,
    failures: result.failures ?? [],
    items: result.items.map((item) => ({
      changes: item.changes,
      target: item.target,
    })),
    kind,
    skippedCount: result.skippedCount ?? 0,
    successCount: result.successCount,
    totalCount: result.totalCount,
  };
}

/**
 * On non-fixture backends, every write must reference a server-side preview
 * (previewId). Raw patch/operations/items payloads stay usable only against
 * the fixture backend for tests and local tooling, so the shadow Admin can
 * never be mutated without a frozen, user-reviewable preview.
 */
function assertPreviewBackedWrite(
  config: Pick<AgentConfig, "backend">,
  input: unknown,
): void {
  if (config.backend === "fixture") {
    return;
  }

  const request = isRecord(input) ? input : {};
  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  if (!previewId) {
    throw new AdminApiError(
      "fixture 以外のバックエンドでは previewId による実行のみ許可されています。先に plan ツールでプレビューを作成してください。",
      403,
    );
  }
}

export function assertWritesAllowed(
  config: Pick<AgentConfig, "backend">,
): void {
  if (
    config.backend !== "fixture" &&
    process.env.ADMIN_AGENT_ALLOW_WRITES !== "true"
  ) {
    throw new AdminApiError(
      "現在のバックエンドは fixture ではなく、ADMIN_AGENT_ALLOW_WRITES も有効になっていないため、書き込みをブロックしました。",
      403,
    );
  }
}

async function writeAuditLog(
  auditLog: AuditLog,
  entry: Record<string, unknown>,
): Promise<boolean> {
  try {
    await auditLog.write(entry);
    return true;
  } catch (error) {
    console.error("Failed to write audit log", error);
    return false;
  }
}

function assertSinglePreview(input: unknown): void {
  const request = isRecord(input) ? input : {};
  if (!hasExpectedChanges(request.expectedChanges)) {
    throw new AdminApiError(
      "確認できる実行プレビューが見つかりません。先にプレビューを作成してから確認してください。",
      400,
    );
  }
}

function assertBatchPreviews(input: unknown): void {
  const request = isRecord(input) ? input : {};
  const operations = Array.isArray(request.operations)
    ? request.operations
    : Array.isArray(request.items)
      ? request.items
      : [];

  for (const operation of operations) {
    if (isRecord(operation) && !hasExpectedChanges(operation.expectedChanges)) {
      throw new AdminApiError(
        `商品 ${String(operation.id ?? operation.targetId ?? "")} の確認できる実行プレビューが見つかりません。先にプレビューを作成してから確認してください。`,
        400,
      );
    }
  }
}

function assertBatchCreatePreviews(input: unknown): void {
  const request = isRecord(input) ? input : {};
  if (typeof request.previewId === "string" && request.previewId.trim()) {
    return;
  }

  const operations = Array.isArray(request.items)
    ? request.items
    : Array.isArray(request.operations)
      ? request.operations
      : [];

  for (const operation of operations) {
    if (isRecord(operation) && !hasExpectedChanges(operation.expectedChanges)) {
      const input = isRecord(operation.input) ? operation.input : operation;
      throw new AdminApiError(
        `商品 ${String(input.name ?? input.bn ?? "")} の確認できる登録プレビューが見つかりません。先にプレビューを作成してから確認してください。`,
        400,
      );
    }
  }
}

function hasExpectedChanges(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

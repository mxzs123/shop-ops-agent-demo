import { AdminApiError } from "./admin-client";
import {
  consumeBulkPreview,
  readBulkCreatePreview,
  readBulkEditPreview,
  readBulkPreview,
  saveBulkCreatePreview,
  saveBulkDeletePreview,
  saveBulkEditPreview,
  type StoredBulkDeletePreview,
  type StoredBulkPreview,
} from "./bulk-preview-store";
import {
  CREATE_CHANGE_FIELD_ORDER,
  DETAIL_FIELD_ORDER,
  fieldLabel,
} from "./goods-labels";
import { isRecord } from "./part-utils";
import { getAgentRuntime } from "./runtime";
import type {
  AdminAuth,
  AdminEnvelope,
  AdminTransport,
  GoodsBatchExecutionFailure,
  EditChange,
  EditableGoodsState,
  GoodsDetailField,
  GoodsBatchEditExecution,
  GoodsBatchEditPlan,
  GoodsEditExecution,
  GoodsEditPlan,
  GoodsPatch,
  GoodsPatchValue,
  GoodsSearchResult,
  GoodsSummary,
  ToolWarning,
} from "./types";

// Stable warning codes shared with the UI (filter/dedupe by code).
const WARNING_CODES = {
  batchAllNoop: "batch.all-noop",
  batchNoopSkipped: "batch.noop-skipped",
  createDuplicateBnSkipped: "create.duplicate-bn-skipped",
  createExistingBnSkipped: "create.existing-bn-skipped",
  createIdMissing: "create.id-missing",
  createIdRefetched: "create.id-refetched",
  createNonePlannable: "create.none-plannable",
  createSingleSkuDefault: "create.single-sku-default",
  deletePermanent: "delete.permanent",
  editCategoryNav: "edit.category-nav",
  editMultiSkuDefaultOnly: "edit.multi-sku-default-only",
} as const;

function warning(
  code: (typeof WARNING_CODES)[keyof typeof WARNING_CODES],
  message: string,
): ToolWarning {
  return { code, message };
}

const SEARCH_PAGE_LIMIT = 200;
const DIRECT_BATCH_OPERATION_LIMIT = 1_000;
const FILTER_BATCH_OPERATION_LIMIT = 5_000;
const BULK_PREVIEW_SAMPLE_SIZE = 20;
const PLAN_CONCURRENCY = 12;
const WRITE_CONCURRENCY = 6;
// Long enough that a create plan reviewed at human pace does not re-trigger
// the full-catalog scan on the confirm click. Staleness is bounded: every
// create/delete/bn-edit through this agent invalidates the cache, and the
// Admin's own BN uniqueness check still rejects true conflicts at DoCreate.
const BN_SCAN_CACHE_TTL_MS = 10 * 60_000;
const SCAN_PAGE_CONCURRENCY = 4;
const NATIVE_BATCH_CHUNK_SIZE = 200;
const NATIVE_WRITE_CONCURRENCY = 2;
// Stop dispatching batch writes well before the API route's 300 s cap so the
// user gets an honest partial-result card instead of a dropped connection.
const BATCH_EXECUTION_TIME_BUDGET_MS = 240_000;
// Same guard for the plan-side per-item read fan-out (up to 5,000 GetEdit
// calls for filter plans): planning is atomic, so instead of partial results
// the user gets a fast, actionable error to narrow the filter.
const PLAN_TIME_BUDGET_MS = 240_000;

interface BatchEditOperation {
  expectedChanges?: unknown;
  id: string | number;
  patch: GoodsPatch;
}

const editableGoodsFields = [
  "bn",
  "brandId",
  "brief",
  "capacity",
  "costprice",
  "goodsCategoryId",
  "goodsParamsIds",
  "goodsSkuIds",
  "goodsTypeId",
  "image",
  "images",
  "intro",
  "isDel",
  "isFree",
  "isHot",
  "isMarketable",
  "isNomalVirtual",
  "isPrescription",
  "isRecommend",
  "labelName",
  "lang",
  "manufacturer",
  "mktprice",
  "name",
  "newSpec",
  "note",
  "openSpec",
  "packaging",
  "parameters",
  "price",
  "productsDistributionType",
  "sn",
  "sort",
  "specifications",
  "spesDesc",
  "stock",
  "unit",
  "video",
  "weight",
] as const;

const editableFieldSet = new Set<string>(editableGoodsFields);
const booleanFields = new Set([
  "isDel",
  "isFree",
  "isHot",
  "isMarketable",
  "isNomalVirtual",
  "isPrescription",
  "isRecommend",
]);
const numberFields = new Set([
  "brandId",
  "costprice",
  "goodsCategoryId",
  "goodsTypeId",
  "mktprice",
  "openSpec",
  "price",
  "productsDistributionType",
  "sort",
  "stock",
  "weight",
]);
const requiredStringFields = new Set(["bn", "name"]);
const productMirrorFields = new Set([
  "costprice",
  "image",
  "mktprice",
  "price",
  "sn",
  "stock",
  "weight",
]);
const mediaFields = new Set(["image", "images", "video"]);
const createRequiredFields = [
  "bn",
  "goodsCategoryId",
  "image",
  "name",
  "price",
  "stock",
  "weight",
] as const;

export async function searchGoods(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsSearchResult> {
  const request = isRecord(input) ? input : {};
  const query = getOptionalString(request, "query");
  const name = getOptionalString(request, "name") ?? query;
  const page = getPositiveInt(request.page, 1);
  const limit = Math.min(getPositiveInt(request.limit, 10), SEARCH_PAGE_LIMIT);
  const payload: Record<string, unknown> = { limit, page };

  if (name) {
    payload.name = name;
  }

  if (request.goodsCategoryId !== undefined && request.goodsCategoryId !== "") {
    payload.goodsCategoryId = normalizeNumber(
      "goodsCategoryId",
      request.goodsCategoryId,
    );
  }

  if (request.isMarketable !== undefined && request.isMarketable !== "") {
    payload.isMarketable = String(normalizeBoolean(request.isMarketable));
  }

  const response = await client.post<unknown>(
    "Api/Goods/GetPageList",
    payload,
    auth,
  );
  assertOk(response, "商品检索失败");

  return normalizeSearchResponse(response);
}

export async function getEditableGoods(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<EditableGoodsState> {
  const id = extractGoodsId(input);
  const response = await client.post<unknown>(
    `api/Goods/GetEdit?id=${encodeURIComponent(String(id))}`,
    {},
    auth,
  );
  assertOk(response, "商品详情获取失败");

  const data = isRecord(response.data) ? response.data : {};
  const model = firstRecord(data.model, data.goods, data);

  if (!model || model.id === undefined) {
    throw new AdminApiError("商品详情响应缺少 model.id", 502, {
      keys: Object.keys(data),
    });
  }

  return {
    goodsCategoryExtendIds:
      data.goodsCategoryExtendIds ?? data.goodsCategoryExtendId ?? "",
    gradePrice: firstArray(data.gradePrice, data.gradePrices),
    model,
    products: firstArray(data.products, data.productList),
  };
}

export async function getGoodsDetailSummary(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsSummary> {
  const id = extractGoodsId(input);
  const state = await getEditableGoods(client, auth, { id });
  return summarizeGoods(buildCurrentEditableModel(state), {
    includeDetails: true,
  });
}

export async function createGoodsEditPlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditPlan> {
  const request = isRecord(input) ? input : {};
  const id = extractGoodsId(request);
  const patch = normalizeGoodsPatch(request.patch);
  const state = await getEditableGoods(client, auth, { id });
  const current = buildCurrentEditableModel(state, patch);
  const changes = buildChanges(current, patch);
  const warnings = buildWarnings(state, patch);

  return {
    action: "goods.update",
    changes,
    confirmRequired: true,
    patch,
    target: summarizeGoods(current),
    warnings,
  };
}

export async function createGoodsBatchEditPlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditPlan> {
  const operations = normalizeBatchOperations(input);
  const items = await createGoodsEditPlans(client, auth, operations);
  const plannedItems = items.filter((item) => item.changes.length > 0);
  const skippedCount = items.length - plannedItems.length;
  const stored =
    plannedItems.length > 0
      ? await saveBulkEditPreview({
          operations: plannedItems.map((item) => ({
            expectedChanges: item.changes,
            id: item.target.id,
            patch: item.patch,
          })),
          patch: {},
          selector: { mode: "direct" },
          totalCount: operations.length,
        })
      : undefined;

  return buildBatchPlanResponse({
    action: "goods.batchUpdate",
    extraWarnings: noopSkippedWarnings(skippedCount),
    plannedItems,
    previewId: stored?.previewId,
    skippedCount,
    totalCount: items.length,
  });
}

export async function createGoodsFilterEditPlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditPlan> {
  const request = isRecord(input) ? input : {};
  const selector = normalizeSearchSelector(request.selector ?? request);
  const patch = normalizeGoodsPatch(request.patch);
  const maxItems = getCappedPositiveInt(
    request.maxItems,
    FILTER_BATCH_OPERATION_LIMIT,
    FILTER_BATCH_OPERATION_LIMIT,
  );
  const matched = await searchAllGoods(client, auth, selector);

  if (matched.length === 0) {
    throw new AdminApiError("没有找到符合条件的商品，无法生成批量预览", 404);
  }

  if (matched.length > maxItems) {
    throw new AdminApiError(
      `符合条件的商品有 ${matched.length} 个，超过本次上限 ${maxItems} 个。请缩小筛选范围。`,
      400,
    );
  }

  const operations = matched.map((goods) => ({
    id: goods.id,
    patch,
  }));
  const marketableValue = getUniformMarketablePatch(operations);
  const items =
    marketableValue === undefined
      ? await createGoodsEditPlans(client, auth, operations)
      : createGoodsEditPlansFromSearchRows(matched, patch);
  const plannedItems = items.filter((item) => item.changes.length > 0);
  const skippedCount = items.length - plannedItems.length;

  if (plannedItems.length === 0) {
    return buildBatchPlanResponse({
      action: "goods.batchUpdate",
      extraWarnings: [
        warning(
          WARNING_CODES.batchAllNoop,
          "所有匹配商品已是目标值，无需执行。",
        ),
      ],
      plannedItems: [],
      skippedCount,
      totalCount: items.length,
    });
  }

  const stored = await saveBulkEditPreview({
    operations: plannedItems.map((item) => ({
      expectedChanges: item.changes,
      id: item.target.id,
      patch: item.patch,
    })),
    patch,
    selector,
    totalCount: matched.length,
  });

  return buildBatchPlanResponse({
    action: "goods.batchUpdate",
    extraWarnings: noopSkippedWarnings(skippedCount),
    plannedItems,
    previewId: stored.previewId,
    skippedCount,
    totalCount: items.length,
  });
}

export async function createGoodsBatchCreatePlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditPlan> {
  const operations = normalizeBatchCreateOperations(input);
  const existingByBn = await findExistingGoodsByBn(
    client,
    auth,
    operations.map((operation) => operation.input.bn),
  );
  const seenBns = new Set<string>();
  const items = operations.flatMap((operation) => {
    const bn = normalizeBnKey(operation.input.bn);
    if (existingByBn.has(bn) || seenBns.has(bn)) {
      return [];
    }

    seenBns.add(bn);
    return [createGoodsCreatePlanFromPatch(operation.input)];
  });
  const skippedCount = operations.length - items.length;

  if (items.length === 0) {
    return buildBatchPlanResponse({
      action: "goods.batchCreate",
      extraWarnings:
        skippedCount > 0
          ? duplicateBnSkippedWarnings(skippedCount)
          : [
              warning(
                WARNING_CODES.createNonePlannable,
                "没有可录入的商品。",
              ),
            ],
      plannedItems: [],
      skippedCount,
      totalCount: operations.length,
    });
  }

  const stored = await saveBulkCreatePreview({
    operations: items.map((item) => ({
      expectedChanges: item.changes,
      input: item.patch,
    })),
    totalCount: operations.length,
  });

  return buildBatchPlanResponse({
    action: "goods.batchCreate",
    extraWarnings: duplicateBnSkippedWarnings(skippedCount),
    plannedItems: items,
    previewId: stored.previewId,
    skippedCount,
    totalCount: operations.length,
  });
}

export async function createGoodsCreatePlan(
  _client: AdminTransport,
  _auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditPlan> {
  const patch = normalizeGoodsCreateInput(input);
  return createGoodsCreatePlanFromPatch(patch);
}

function createGoodsCreatePlanFromPatch(patch: GoodsPatch): GoodsEditPlan {
  const changes = buildCreateChanges(patch);
  const payload = buildCreatePayload(patch);

  return {
    action: "goods.create",
    changes,
    confirmRequired: true,
    patch,
    target: summarizeGoods({ ...payload.payload.goods, id: "新商品" }),
    warnings: payload.warnings,
  };
}

export async function createGoodsDeletePlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditPlan> {
  const id = extractGoodsId(input);
  const state = await getEditableGoods(client, auth, { id });

  return {
    action: "goods.delete",
    changes: buildDeleteChanges(),
    confirmRequired: true,
    patch: {},
    target: summarizeGoods(state.model),
    warnings: [
      warning(
        WARNING_CODES.deletePermanent,
        "删除会永久移除商品及 SKU 数据，请确认目标无误。",
      ),
    ],
  };
}

export async function createGoodsBatchDeletePlan(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditPlan> {
  const ids = normalizeDeleteIds(input);
  const items = await mapWithConcurrency(ids, PLAN_CONCURRENCY, async (id) => {
    const state = await getEditableGoods(client, auth, { id });
    return {
      action: "goods.delete" as const,
      changes: buildDeleteChanges(),
      confirmRequired: true as const,
      patch: {},
      target: summarizeGoods(state.model),
      warnings: [],
    };
  });
  const stored = await saveBulkDeletePreview({
    operations: items.map((item) => ({
      expectedTarget: {
        bn: item.target.bn,
        id: item.target.id,
        name: item.target.name,
      },
      id: item.target.id,
    })),
    totalCount: ids.length,
  });

  return buildBatchPlanResponse({
    action: "goods.batchDelete",
    extraWarnings: [
      warning(
        WARNING_CODES.deletePermanent,
        "删除会永久移除商品及 SKU 数据，请确认目标无误。",
      ),
    ],
    plannedItems: items,
    previewId: stored.previewId,
    skippedCount: 0,
    totalCount: ids.length,
  });
}

function normalizeDeleteIds(input: unknown): Array<string | number> {
  const request = isRecord(input) ? input : {};
  const rawIds = Array.isArray(request.ids)
    ? request.ids
    : request.id !== undefined
      ? [request.id]
      : [];

  if (rawIds.length === 0) {
    throw new AdminApiError("缺少商品 id", 400);
  }

  if (rawIds.length > DIRECT_BATCH_OPERATION_LIMIT) {
    throw new AdminApiError(
      `单次批量删除最多支持 ${DIRECT_BATCH_OPERATION_LIMIT} 个商品`,
      400,
    );
  }

  const seen = new Set<string>();
  const ids: Array<string | number> = [];
  for (const raw of rawIds) {
    const id = extractGoodsId({ id: raw });
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      ids.push(id);
    }
  }

  return ids;
}

export async function executeGoodsEdit(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  // Same read → assert → diff → write pipeline as batch items; the only
  // single-edit difference is that a no-op is an error instead of a skip.
  const { result, skipped } = await executeGoodsEditForBatch(client, auth, {
    expectedChanges: request.expectedChanges,
    id: extractGoodsId(request),
    patch: normalizeGoodsPatch(request.patch),
  });

  if (skipped) {
    throw new AdminApiError("当前商品已经是预览中的值，无需执行", 409);
  }

  return result;
}

export async function executeGoodsCreate(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const patch = normalizeGoodsCreateInput(input);
  const changes = buildCreateChanges(patch);
  assertExpectedCreateValues(changes, request.expectedChanges);

  const payload = buildCreatePayload(patch);
  const response = await client.post<unknown>(
    "Api/Goods/DoCreate",
    payload.payload,
    auth,
  );
  invalidateBnScanCache();
  assertOk(response, "商品录入执行失败");

  const createdId = extractCreatedGoodsId(response.data);
  const resolvedTarget =
    createdId === undefined
      ? await resolveCreatedGoodsSummary(client, auth, patch)
      : undefined;
  const warnings = [...payload.warnings];
  if (createdId === undefined && resolvedTarget) {
    warnings.push(
      warning(
        WARNING_CODES.createIdRefetched,
        "Admin 未返回新商品 ID，已按商品编码回读确认。",
      ),
    );
  } else if (createdId === undefined) {
    warnings.push(
      warning(
        WARNING_CODES.createIdMissing,
        "Admin 未返回新商品 ID，请用商品编码检索确认。",
      ),
    );
  }

  return {
    adminMessage: response.msg ?? "录入成功",
    changes,
    result: response.data,
    target:
      resolvedTarget ??
      summarizeGoods({
        ...payload.payload.goods,
        id: createdId ?? "新商品",
      }),
    warnings,
  };
}

export async function executeGoodsDelete(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const id = extractGoodsId(request);
  const state = await getEditableGoods(client, auth, { id });
  assertExpectedTarget(state.model, request.expectedTarget);
  assertExpectedDeleteValues(request.expectedChanges);

  const response = await client.post<unknown>(
    "Api/Goods/DoDelete",
    { id },
    auth,
  );
  invalidateBnScanCache();
  assertOk(response, "商品删除执行失败");

  return {
    adminMessage: response.msg ?? "删除成功",
    changes: buildDeleteChanges(),
    result: response.data,
    target: summarizeGoods(state.model),
    warnings: [],
  };
}

export async function executeGoodsBatchEdit(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  const preview = previewId ? await readBulkEditPreview(previewId) : undefined;
  if (previewId && !preview) {
    throw new AdminApiError("批量预览不存在或已过期，请重新生成", 409);
  }

  const operations = preview?.operations ?? normalizeBatchOperations(request);
  return runBatchEditOperations(
    client,
    auth,
    operations,
    "批量执行完成",
    preview?.selector,
  );
}

export async function executeGoodsFilterEdit(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  if (!previewId) {
    throw new AdminApiError("缺少批量预览 ID", 400);
  }

  const preview = await readBulkEditPreview(previewId);
  if (!preview) {
    throw new AdminApiError("批量预览不存在或已过期，请重新生成", 409);
  }

  return runBatchEditOperations(
    client,
    auth,
    preview.operations,
    "筛选批量执行完成",
    preview.selector,
  );
}

/**
 * Shared execution engine for direct and filter batch edits: uniform
 * marketable patches take the native bulk endpoint, everything else runs
 * per-item read → assert → write.
 */
async function runBatchEditOperations(
  client: AdminTransport,
  auth: AdminAuth,
  operations: BatchEditOperation[],
  prefix: string,
  selector?: Record<string, unknown>,
): Promise<GoodsBatchEditExecution> {
  const marketableValue = getUniformMarketablePatch(operations);
  const result =
    marketableValue === undefined
      ? await executeBatchOperations(operations, (operation) =>
          executeGoodsEditForBatch(client, auth, operation),
        )
      : await executeNativeMarketableBatch(
          client,
          auth,
          operations,
          marketableValue,
          selector,
        );

  return buildBatchExecutionResponse(prefix, operations.length, result);
}

export async function executeGoodsBatchCreate(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  const preview = previewId ? await readBulkCreatePreview(previewId) : undefined;
  if (previewId && !preview) {
    throw new AdminApiError("批量录入预览不存在或已过期，请重新生成", 409);
  }

  const operations =
    preview?.operations ?? normalizeBatchCreateOperations(request);
  const existingByBn = await findExistingGoodsByBn(
    client,
    auth,
    operations.map((operation) => operation.input.bn),
  );
  const pendingOperations = operations.filter(
    (operation) => !existingByBn.has(normalizeBnKey(operation.input.bn)),
  );
  const result = await executeBatchOperations(pendingOperations, (operation) =>
    executeGoodsCreateForBatch(client, auth, operation),
  );
  const existingCount = operations.length - pendingOperations.length;
  const skippedCount = existingCount + result.skippedCount;

  return buildBatchExecutionResponse(
    "批量录入完成",
    operations.length,
    { ...result, skippedCount },
    existingCount > 0
      ? [
          warning(
            WARNING_CODES.createExistingBnSkipped,
            `${existingCount} 个商品编码已存在，本次批量录入已跳过。`,
          ),
        ]
      : [],
  );
}

export async function executeGoodsBatchDelete(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<GoodsBatchEditExecution> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  if (!previewId) {
    throw new AdminApiError("缺少批量预览 ID", 400);
  }

  const preview = await readBulkPreview(previewId);
  if (!preview || preview.kind !== "goods.batchDelete") {
    throw new AdminApiError("删除预览不存在或已过期，请重新生成", 409);
  }

  return runBatchDeleteOperations(client, auth, preview);
}

async function runBatchDeleteOperations(
  client: AdminTransport,
  auth: AdminAuth,
  preview: StoredBulkDeletePreview,
): Promise<GoodsBatchEditExecution> {
  const result = await executeBatchOperations(
    preview.operations,
    async (operation) => ({
      result: await executeGoodsDelete(client, auth, {
        confirm: true,
        expectedChanges: buildDeleteChanges(),
        expectedTarget: operation.expectedTarget,
        id: operation.id,
      }),
      skipped: false,
    }),
  );

  return buildBatchExecutionResponse(
    "批量删除完成",
    preview.operations.length,
    result,
  );
}

export type GoodsPreviewKind =
  | "goods.batchCreate"
  | "goods.batchDelete"
  | "goods.batchEdit";

// Previews currently being executed; blocks concurrent double-submits of the
// same previewId within this server process.
const executingPreviewIds = new Set<string>();

export async function executeGoodsPreview(
  client: AdminTransport,
  auth: AdminAuth,
  input: unknown,
): Promise<{ kind: GoodsPreviewKind; result: GoodsBatchEditExecution }> {
  const request = isRecord(input) ? input : {};
  if (request.confirm !== true) {
    throw new AdminApiError("执行前必须显式传入 confirm: true", 400);
  }

  const previewId =
    typeof request.previewId === "string" ? request.previewId.trim() : "";
  if (!previewId) {
    throw new AdminApiError(
      "缺少预览 ID。请先生成预览，等待用户确认后再执行。",
      400,
    );
  }

  if (executingPreviewIds.has(previewId)) {
    throw new AdminApiError("此预览正在执行，请等待完成", 409);
  }

  const preview = await readBulkPreview(previewId);
  if (!preview) {
    throw new AdminApiError("预览不存在或已过期，请重新生成", 409);
  }

  executingPreviewIds.add(previewId);
  try {
    const outcome = await dispatchGoodsPreview(client, auth, preview, previewId);
    // One confirmation authorizes exactly one execution run. Consume the
    // preview after the run completes (even partially) so the id cannot be
    // replayed; failures should be re-planned, not re-executed blindly.
    await consumeBulkPreview(previewId);
    return outcome;
  } finally {
    executingPreviewIds.delete(previewId);
  }
}

async function dispatchGoodsPreview(
  client: AdminTransport,
  auth: AdminAuth,
  preview: StoredBulkPreview,
  previewId: string,
): Promise<{ kind: GoodsPreviewKind; result: GoodsBatchEditExecution }> {
  switch (preview.kind) {
    case "goods.batchEdit":
      return {
        kind: preview.kind,
        result: await executeGoodsBatchEdit(client, auth, {
          confirm: true,
          previewId,
        }),
      };
    case "goods.batchCreate":
      return {
        kind: preview.kind,
        result: await executeGoodsBatchCreate(client, auth, {
          confirm: true,
          previewId,
        }),
      };
    case "goods.batchDelete":
      return {
        kind: preview.kind,
        result: await runBatchDeleteOperations(client, auth, preview),
      };
  }
}

async function createGoodsEditPlans(
  client: AdminTransport,
  auth: AdminAuth,
  operations: Array<{ id: string | number; patch: GoodsPatch }>,
): Promise<GoodsEditPlan[]> {
  const deadline = Date.now() + PLAN_TIME_BUDGET_MS;
  return mapWithConcurrency(operations, PLAN_CONCURRENCY, (operation) => {
    // Checked before each dispatch (workers pull one operation at a time), so
    // a slow Admin fails fast instead of exhausting the route's 300 s cap.
    if (Date.now() >= deadline) {
      throw new AdminApiError(
        "预览生成已达到执行时间上限，请缩小筛选范围以减少目标数量",
        504,
      );
    }

    return createGoodsEditPlan(client, auth, {
      id: operation.id,
      patch: operation.patch,
    });
  });
}

function sampleBatchPlanItems(items: GoodsEditPlan[]): GoodsEditPlan[] {
  return items.slice(0, BULK_PREVIEW_SAMPLE_SIZE).map(compactPlanForResponse);
}

function compactPlanForResponse(plan: GoodsEditPlan): GoodsEditPlan {
  return {
    ...plan,
    target: compactGoodsForBatchResponse(plan.target),
  };
}

function compactExecutionItemsForResponse(
  items: GoodsEditExecution[],
): GoodsEditExecution[] {
  return items.map((item) => ({
    ...item,
    target: compactGoodsForBatchResponse(item.target),
  }));
}

function compactGoodsForBatchResponse(goods: GoodsSummary): GoodsSummary {
  return {
    bn: goods.bn,
    goodsCategoryId: goods.goodsCategoryId,
    id: goods.id,
    image: goods.image,
    isMarketable: goods.isMarketable,
    name: goods.name,
    price: goods.price,
    sn: goods.sn,
    stock: goods.stock,
  };
}

function createGoodsEditPlansFromSearchRows(
  rows: GoodsSummary[],
  patch: GoodsPatch,
): GoodsEditPlan[] {
  return rows.map((goods) => ({
    action: "goods.update",
    changes: buildChanges(goods as unknown as Record<string, unknown>, patch),
    confirmRequired: true,
    patch,
    target: goods,
    warnings: [],
  }));
}

async function searchAllGoods(
  client: AdminTransport,
  auth: AdminAuth,
  selector: Record<string, unknown>,
): Promise<GoodsSummary[]> {
  const firstPage = await searchGoods(client, auth, {
    ...selector,
    limit: SEARCH_PAGE_LIMIT,
    page: 1,
  });
  const rows = [...firstPage.rows];
  const totalPages = Math.ceil(firstPage.total / SEARCH_PAGE_LIMIT);

  if (totalPages <= 1) {
    return rows;
  }

  const remainingPages = Array.from(
    { length: totalPages - 1 },
    (_, index) => index + 2,
  );
  const pages = await mapWithConcurrency(
    remainingPages,
    SCAN_PAGE_CONCURRENCY,
    (page) =>
      searchGoods(client, auth, {
        ...selector,
        limit: SEARCH_PAGE_LIMIT,
        page,
      }),
  );

  for (const page of pages) {
    rows.push(...page.rows);
  }

  return rows;
}

// Cache the full-catalog scan used for BN dedupe so plan + execute within a
// short window share one scan instead of re-reading every page. The cache is
// keyed by auth so different credentials never share rows, and any write that
// can change the catalog (create/delete) invalidates it immediately.
const bnScanCache = new Map<
  string,
  { expiresAt: number; rowsPromise: Promise<GoodsSummary[]> }
>();

function bnScanCacheKey(auth: AdminAuth): string {
  return auth.authorization ?? "";
}

function invalidateBnScanCache(): void {
  bnScanCache.clear();
}

async function scanAllGoodsForBnDedupe(
  client: AdminTransport,
  auth: AdminAuth,
): Promise<GoodsSummary[]> {
  const key = bnScanCacheKey(auth);
  const now = Date.now();
  const cached = bnScanCache.get(key);
  if (cached && cached.expiresAt > now) {
    try {
      return await cached.rowsPromise;
    } catch {
      bnScanCache.delete(key);
    }
  }

  const rowsPromise = searchAllGoods(client, auth, {});
  bnScanCache.set(key, {
    expiresAt: now + BN_SCAN_CACHE_TTL_MS,
    rowsPromise,
  });
  try {
    return await rowsPromise;
  } catch (error) {
    bnScanCache.delete(key);
    throw error;
  }
}

async function findExistingGoodsByBn(
  client: AdminTransport,
  auth: AdminAuth,
  bns: unknown[],
): Promise<Map<string, GoodsSummary>> {
  const wantedBns = new Set(
    bns.map(normalizeBnKey).filter((bn) => bn.length > 0),
  );
  if (wantedBns.size === 0) {
    return new Map();
  }

  const rows = await scanAllGoodsForBnDedupe(client, auth);
  const existing = new Map<string, GoodsSummary>();
  for (const row of rows) {
    const bn = normalizeBnKey(row.bn);
    if (wantedBns.has(bn)) {
      existing.set(bn, row);
    }
  }

  return existing;
}

async function executeGoodsEditForBatch(
  client: AdminTransport,
  auth: AdminAuth,
  operation: BatchEditOperation,
): Promise<{ result: GoodsEditExecution; skipped: boolean }> {
  const state = await getEditableGoods(client, auth, { id: operation.id });
  const current = buildCurrentEditableModel(state, operation.patch);
  assertExpectedValues(current, operation.expectedChanges);
  const changes = buildChanges(current, operation.patch);
  const warnings = buildWarnings(state, operation.patch);

  if (changes.length === 0) {
    return {
      result: {
        adminMessage: "已是目标值，跳过",
        changes: [],
        result: null,
        target: summarizeGoods(current),
        warnings,
      },
      skipped: true,
    };
  }

  const payload = buildEditPayload(state, operation.patch);
  const response = await client.post<unknown>(
    "Api/Goods/DoEdit",
    payload.payload,
    auth,
  );
  if (operation.patch.bn !== undefined) {
    invalidateBnScanCache();
  }
  assertOk(response, "商品编辑执行失败");

  return {
    result: {
      adminMessage: response.msg ?? "执行成功",
      changes,
      result: response.data,
      target: summarizeGoods(payload.payload.goods),
      warnings: payload.warnings,
    },
    skipped: false,
  };
}

async function executeNativeMarketableBatch(
  client: AdminTransport,
  auth: AdminAuth,
  operations: BatchEditOperation[],
  isMarketable: boolean,
  selector?: Record<string, unknown>,
): Promise<{
  failures: GoodsBatchExecutionFailure[];
  items: GoodsEditExecution[];
  skippedCount: number;
}> {
  const rowsById = await readNativeMarketableRowsById(
    client,
    auth,
    operations,
    selector,
  );
  const prepared = operations.map((operation, index) => {
    try {
      const current = rowsById.get(String(operation.id));
      if (!current) {
        throw new AdminApiError("商品数据已变化，请重新生成预览", 409, {
          id: operation.id,
        });
      }

      assertExpectedValues(
        current as unknown as Record<string, unknown>,
        operation.expectedChanges,
      );
      const changes = buildChanges(
        current as unknown as Record<string, unknown>,
        operation.patch,
      );

      if (changes.length === 0) {
        return {
          index,
          operation,
          result: {
            adminMessage: "已是目标值，跳过",
            changes: [],
            result: null,
            target: current,
            warnings: [],
          },
          skipped: true,
          valid: true as const,
        };
      }

      return {
        index,
        operation,
        result: {
          adminMessage: "执行成功",
          changes,
          result: null,
          target: {
            ...current,
            isMarketable,
          },
          warnings: [],
        },
        skipped: false,
        valid: true as const,
      };
    } catch (error) {
      return {
        failure: toBatchFailure(operation, index, error),
        index,
        operation,
        valid: false as const,
      };
    }
  });

  const failures = prepared
    .filter((item) => !item.valid)
    .map((item) => item.failure);
  const skippedCount = prepared.filter(
    (item) => item.valid && item.skipped,
  ).length;
  const pending = prepared.filter(
    (item) => item.valid && !item.skipped,
  ) as Array<Extract<(typeof prepared)[number], { valid: true }> & {
    skipped: false;
  }>;
  const successfulIndexes = new Set<number>();
  const chunks = chunkItems(pending, NATIVE_BATCH_CHUNK_SIZE);

  await mapWithConcurrency(chunks, NATIVE_WRITE_CONCURRENCY, async (chunk) => {
    try {
      const response = await client.post<unknown>(
        isMarketable
          ? "Api/Goods/DoBatchMarketableUp"
          : "Api/Goods/DoBatchMarketableDown",
        { id: chunk.map((item) => item.operation.id) },
        auth,
      );
      assertOk(response, "批量上下架执行失败");
      for (const item of chunk) {
        successfulIndexes.add(item.index);
      }
    } catch (error) {
      for (const item of chunk) {
        failures.push(toBatchFailure(item.operation, item.index, error));
      }
    }
  });

  const items = pending
    .filter((item) => successfulIndexes.has(item.index))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.result);

  return {
    failures,
    items,
    skippedCount,
  };
}

async function readNativeMarketableRowsById(
  client: AdminTransport,
  auth: AdminAuth,
  operations: BatchEditOperation[],
  selector?: Record<string, unknown>,
): Promise<Map<string, GoodsSummary>> {
  // Direct previews (explicit id lists) store `{ mode: "direct" }`, and raw
  // legacy operations arrive with no selector at all. Reading just the target
  // goods keeps those paths O(targets) instead of scanning the whole catalog.
  // Filter previews (selector may legitimately be {} = all goods) keep the
  // server-side filtered scan, which is cheaper for large matches.
  const isDirect =
    selector === undefined || (isRecord(selector) && selector.mode === "direct");
  if (isDirect) {
    return readGoodsRowsByIds(client, auth, operations);
  }

  const filterSelector = normalizeSearchSelector(selector);
  const wantedIds = new Set(operations.map((operation) => String(operation.id)));
  const rows = await searchAllGoods(client, auth, filterSelector);
  const rowsById = new Map<string, GoodsSummary>();

  for (const row of rows) {
    const id = String(row.id);
    if (wantedIds.has(id)) {
      rowsById.set(id, row);
    }
  }

  return rowsById;
}

async function readGoodsRowsByIds(
  client: AdminTransport,
  auth: AdminAuth,
  operations: BatchEditOperation[],
): Promise<Map<string, GoodsSummary>> {
  const uniqueOperations = [
    ...new Map(
      operations.map((operation) => [String(operation.id), operation]),
    ).values(),
  ];
  const rowsById = new Map<string, GoodsSummary>();

  await mapWithConcurrency(
    uniqueOperations,
    PLAN_CONCURRENCY,
    async (operation) => {
      try {
        const state = await getEditableGoods(client, auth, {
          id: operation.id,
        });
        const model = buildCurrentEditableModel(state, operation.patch);
        rowsById.set(String(operation.id), model as unknown as GoodsSummary);
      } catch {
        // Missing/changed goods stay absent from the map; the caller reports
        // them per item as a 409 asking to regenerate the preview.
      }
    },
  );

  return rowsById;
}

async function executeGoodsCreateForBatch(
  client: AdminTransport,
  auth: AdminAuth,
  operation: { expectedChanges?: unknown; input: GoodsPatch },
): Promise<{ result: GoodsEditExecution; skipped: boolean }> {
  const result = await executeGoodsCreate(client, auth, {
    confirm: true,
    expectedChanges: operation.expectedChanges,
    input: operation.input,
  });

  return { result, skipped: false };
}

async function executeBatchOperations<TOperation>(
  operations: TOperation[],
  execute: (
    operation: TOperation,
    index: number,
  ) => Promise<{ result: GoodsEditExecution; skipped: boolean }>,
): Promise<{
  failures: GoodsBatchExecutionFailure[];
  items: GoodsEditExecution[];
  skippedCount: number;
}> {
  const deadline = Date.now() + BATCH_EXECUTION_TIME_BUDGET_MS;
  const settled = await mapWithConcurrency(
    operations.map((operation, index) => ({ index, operation })),
    WRITE_CONCURRENCY,
    async ({ index, operation }) => {
      // Workers pull operations one at a time, so this check stops new
      // dispatches once the budget is spent; in-flight writes still finish.
      if (Date.now() >= deadline) {
        return {
          error: new AdminApiError(
            "因达到执行时间上限而未执行，请为剩余目标重新生成预览后再执行",
            503,
          ),
          index,
          ok: false as const,
          operation,
        };
      }

      try {
        const item = await execute(operation, index);
        return { index, item, ok: true as const, operation };
      } catch (error) {
        return {
          error,
          index,
          ok: false as const,
          operation,
        };
      }
    },
  );
  const items: GoodsEditExecution[] = [];
  const failures: GoodsBatchExecutionFailure[] = [];
  let skippedCount = 0;

  for (const item of settled) {
    if (item.ok) {
      if (item.item.skipped) {
        skippedCount += 1;
      } else {
        items.push(item.item.result);
      }
      continue;
    }

    failures.push(toBatchFailure(item.operation, item.index, item.error));
  }

  return { failures, items, skippedCount };
}

function toBatchFailure(
  operation: unknown,
  index: number,
  error: unknown,
): GoodsBatchExecutionFailure {
  const record = isRecord(operation) ? operation : {};
  return {
    error: error instanceof Error ? error.message : "执行失败",
    id:
      typeof record.id === "string" || typeof record.id === "number"
        ? record.id
        : undefined,
    index,
    patch: isRecord(record.patch) ? (record.patch as GoodsPatch) : undefined,
    status: error instanceof AdminApiError ? error.status : undefined,
  };
}

function buildBatchAdminMessage(
  prefix: string,
  result: {
    failures: GoodsBatchExecutionFailure[];
    items: GoodsEditExecution[];
    skippedCount: number;
  },
): string {
  return `${prefix}：成功 ${result.items.length} 件 · 跳过 ${result.skippedCount} 件 · 失败 ${result.failures.length} 件`;
}

/**
 * Single assembly point for batch plan responses so counters, sampling, and
 * warning aggregation cannot drift between the edit/filter/create/delete plan
 * paths.
 */
function buildBatchPlanResponse(input: {
  action: GoodsBatchEditPlan["action"];
  extraWarnings?: ToolWarning[];
  plannedItems: GoodsEditPlan[];
  previewId?: string;
  skippedCount: number;
  totalCount: number;
}): GoodsBatchEditPlan {
  return {
    action: input.action,
    confirmRequired: true,
    items: sampleBatchPlanItems(input.plannedItems),
    plannedCount: input.plannedItems.length,
    previewId: input.previewId,
    sampleCount: Math.min(input.plannedItems.length, BULK_PREVIEW_SAMPLE_SIZE),
    skippedCount: input.skippedCount,
    totalCount: input.totalCount,
    warnings: uniqueWarnings([
      ...input.plannedItems.flatMap((item) => item.warnings),
      ...(input.extraWarnings ?? []),
    ]),
  };
}

/** Execution-side counterpart of buildBatchPlanResponse. */
function buildBatchExecutionResponse(
  prefix: string,
  totalCount: number,
  result: {
    failures: GoodsBatchExecutionFailure[];
    items: GoodsEditExecution[];
    skippedCount: number;
  },
  extraWarnings: ToolWarning[] = [],
): GoodsBatchEditExecution {
  return {
    adminMessage: buildBatchAdminMessage(prefix, result),
    failureCount: result.failures.length,
    failures: result.failures,
    items: compactExecutionItemsForResponse(result.items),
    skippedCount: result.skippedCount,
    successCount: result.items.length,
    totalCount,
    warnings: uniqueWarnings([
      ...result.items.flatMap((item) => item.warnings),
      ...extraWarnings,
    ]),
  };
}

function noopSkippedWarnings(skippedCount: number): ToolWarning[] {
  return skippedCount > 0
    ? [
        warning(
          WARNING_CODES.batchNoopSkipped,
          `${skippedCount} 件已是目标值，执行时将跳过。`,
        ),
      ]
    : [];
}

function duplicateBnSkippedWarnings(skippedCount: number): ToolWarning[] {
  return skippedCount > 0
    ? [
        warning(
          WARNING_CODES.createDuplicateBnSkipped,
          `${skippedCount} 个商品编码已存在或在本次录入中重复，已从执行目标中排除。`,
        ),
      ]
    : [];
}

function normalizeSearchResponse(
  response: AdminEnvelope<unknown>,
): GoodsSearchResult {
  const data = response.data;
  const rowsSource = Array.isArray(data)
    ? data
    : isRecord(data)
      ? firstArray(data.rows, data.items, data.list, data.data)
      : [];
  const rows = rowsSource.map((item) =>
    summarizeGoods(isRecord(item) ? item : {}, { includeDetails: false }),
  );
  const rawTotal = response.count ?? (isRecord(data) ? data.count : undefined);
  const total = Number(rawTotal);

  return {
    pageSize: rows.length,
    rows,
    total: Number.isFinite(total) ? total : rows.length,
  };
}

function buildEditPayload(
  state: EditableGoodsState,
  patch: GoodsPatch,
): {
  payload: {
    goods: Record<string, unknown>;
    gradePrice: unknown[];
    goodsCategoryExtendIds: unknown;
    products: Record<string, unknown>[];
  };
  warnings: ToolWarning[];
} {
  const goods: Record<string, unknown> = { id: state.model.id };
  for (const field of editableGoodsFields) {
    if (field in state.model) {
      goods[field] = state.model[field];
    }
  }

  for (const [field, value] of Object.entries(patch)) {
    goods[field] = value;
  }

  const products = state.products.map((product) =>
    isRecord(product) ? { ...product } : {},
  );
  const warnings = applyPatchToProducts(products, patch);

  return {
    payload: {
      goods,
      goodsCategoryExtendIds: state.goodsCategoryExtendIds,
      gradePrice: state.gradePrice,
      products,
    },
    warnings,
  };
}

function buildCreatePayload(patch: GoodsPatch): {
  payload: {
    goods: Record<string, unknown>;
    gradePrice: unknown[];
    goodsCategoryExtendIds: unknown;
    products: Record<string, unknown>[];
  };
  warnings: ToolWarning[];
} {
  const goods: Record<string, unknown> = {
    bn: patch.bn,
    brandId: 0,
    brief: "",
    capacity: "",
    costprice: 0,
    goodsCategoryId: patch.goodsCategoryId,
    goodsParamsIds: "",
    goodsSkuIds: "",
    goodsTypeId: 0,
    image: patch.image,
    images: "",
    intro: "",
    isDel: false,
    isFree: false,
    isHot: false,
    isMarketable: true,
    isNomalVirtual: false,
    isPrescription: false,
    isRecommend: false,
    labelName: "",
    lang: 1,
    manufacturer: "",
    mktprice: patch.price,
    name: patch.name,
    newSpec: "",
    note: "",
    openSpec: 0,
    packaging: "",
    parameters: "",
    price: patch.price,
    productsDistributionType: 1,
    sn: patch.sn ?? patch.bn,
    sort: 1,
    specifications: "",
    spesDesc: "",
    stock: patch.stock,
    unit: "",
    video: "",
    weight: 0,
  };

  for (const [field, value] of Object.entries(patch)) {
    goods[field] = value;
  }

  const product = {
    costprice: goods.costprice ?? 0,
    goodsId: 0,
    id: 0,
    images: goods.image,
    isDefalut: true,
    levelOne: 0,
    levelThree: 0,
    levelTwo: 0,
    mktprice: goods.mktprice ?? goods.price,
    mktpriceCNY: 0,
    price: goods.price,
    priceCNY: 0,
    sn: goods.sn,
    spesDesc: "",
    stock: goods.stock,
    weight: goods.weight ?? 0,
  };

  return {
    payload: {
      goods,
      goodsCategoryExtendIds: "",
      gradePrice: [],
      products: [product],
    },
    warnings: [
      warning(
        WARNING_CODES.createSingleSkuDefault,
        "录入将创建单 SKU 默认货品。",
      ),
    ],
  };
}

function applyPatchToProducts(
  products: Record<string, unknown>[],
  patch: GoodsPatch,
): ToolWarning[] {
  const mirroredEntries = Object.entries(patch).filter(([field]) =>
    productMirrorFields.has(field),
  );
  if (mirroredEntries.length === 0) {
    return [];
  }

  const safeIndex = findDefaultProductIndex(products);
  const target = products[safeIndex];
  if (!target) {
    throw new AdminApiError("默认 SKU 货品不存在，无法执行商品货品字段修改", 502);
  }

  for (const [field, value] of mirroredEntries) {
    target[productFieldForGoodsField(field)] = value;
  }

  return products.length > 1
    ? [
        warning(
          WARNING_CODES.editMultiSkuDefaultOnly,
          "多 SKU 商品仅修改默认 SKU，其他 SKU 请手动核对。",
        ),
      ]
    : [];
}

function buildCurrentEditableModel(
  state: EditableGoodsState,
  patch?: GoodsPatch,
): Record<string, unknown> {
  const current = { ...state.model };
  const mirroredFields = patch
    ? Object.keys(patch).filter((field) => productMirrorFields.has(field))
    : Array.from(productMirrorFields);

  if (mirroredFields.length === 0) {
    return current;
  }

  const product = getDefaultProduct(state.products);
  for (const field of mirroredFields) {
    const productField = productFieldForGoodsField(field);
    const value = product[productField];
    if (value === undefined) {
      throw new AdminApiError(
        `默认 SKU 货品缺少字段：${fieldLabel(field)}`,
        502,
        { field, productField },
      );
    }

    current[field] = value;
  }

  return current;
}

function getDefaultProduct(products: unknown[]): Record<string, unknown> {
  const records = products.filter(isRecord);
  const index = findDefaultProductIndex(records);
  const product = records[index];
  if (!product) {
    throw new AdminApiError("默认 SKU 货品不存在，无法读取商品货品字段", 502);
  }

  return product;
}

function findDefaultProductIndex(products: Record<string, unknown>[]): number {
  if (products.length === 0) {
    throw new AdminApiError("商品没有返回 SKU 货品列表，无法处理货品字段", 502);
  }

  const defaultIndex = products.findIndex((product) =>
    normalizeProductDefault(product.isDefalut),
  );
  if (defaultIndex >= 0) {
    return defaultIndex;
  }

  if (products.length === 1) {
    return 0;
  }

  throw new AdminApiError("多 SKU 商品未找到默认货品，无法处理货品字段", 502);
}

function productFieldForGoodsField(field: string): string {
  return field === "image" ? "images" : field;
}

function normalizeGoodsPatch(value: unknown): GoodsPatch {
  if (!isRecord(value)) {
    throw new AdminApiError("patch 必须是对象", 400);
  }

  const patch: GoodsPatch = {};
  for (const [field, rawValue] of Object.entries(value)) {
    if (rawValue === undefined) {
      continue;
    }
    if (!editableFieldSet.has(field)) {
      throw new AdminApiError(`不允许修改字段: ${field}`, 400);
    }

    patch[field] = normalizePatchValue(field, rawValue);
  }

  if (Object.keys(patch).length === 0) {
    throw new AdminApiError("patch 不能为空", 400);
  }

  return patch;
}

function normalizeGoodsCreateInput(input: unknown): GoodsPatch {
  const raw = extractCreateInput(input);
  const patch = normalizeGoodsPatch(raw);

  for (const field of createRequiredFields) {
    const value = patch[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new AdminApiError(
        `录入商品缺少必填字段：${fieldLabel(field)}`,
        400,
      );
    }
  }

  if (Number(patch.goodsCategoryId) < 1) {
    throw new AdminApiError("商品分类必须是有效的分类 ID", 400);
  }

  if (Number(patch.price) < 0) {
    throw new AdminApiError("销售价不能小于 0", 400);
  }

  if (Number(patch.stock) < 0) {
    throw new AdminApiError("库存不能小于 0", 400);
  }

  if (Number(patch.weight) <= 0) {
    throw new AdminApiError("重量必须大于 0", 400);
  }

  if (patch.sn === undefined || String(patch.sn).trim() === "") {
    patch.sn = buildProductSn(patch.bn);
  }

  if (!String(patch.sn).startsWith("SN")) {
    throw new AdminApiError("货品货号必须以 SN 开头", 400);
  }

  if (patch.openSpec !== undefined && Number(patch.openSpec) !== 0) {
    throw new AdminApiError("商品录入当前只支持单 SKU，openSpec 必须为 0", 400);
  }

  return patch;
}

function extractCreateInput(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return input.input ?? input.patch ?? input.goods ?? input;
}

function buildProductSn(bn: unknown): string {
  const normalized = String(bn)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 28);

  if (!normalized) {
    throw new AdminApiError(
      "商品编码必须包含可用于生成货品货号的英文或数字",
      400,
    );
  }

  return `SN${normalized}`;
}

function normalizeBatchOperations(input: unknown): Array<{
  expectedChanges?: unknown;
  id: string | number;
  patch: GoodsPatch;
}> {
  const request = isRecord(input) ? input : {};
  const rawOperations = Array.isArray(request.operations)
    ? request.operations
    : Array.isArray(request.items)
      ? request.items
      : [];

  if (rawOperations.length === 0) {
    throw new AdminApiError("批量操作不能为空", 400);
  }

  if (rawOperations.length > DIRECT_BATCH_OPERATION_LIMIT) {
    throw new AdminApiError(
      `单次批量操作最多支持 ${DIRECT_BATCH_OPERATION_LIMIT} 个商品`,
      400,
    );
  }

  return rawOperations.map((operation, index) => {
    if (!isRecord(operation)) {
      throw new AdminApiError(`第 ${index + 1} 个批量操作格式错误`, 400);
    }

    return {
      expectedChanges: operation.expectedChanges,
      id: extractGoodsId(operation),
      patch: normalizeGoodsPatch(operation.patch),
    };
  });
}

function normalizeBatchCreateOperations(input: unknown): Array<{
  expectedChanges?: unknown;
  input: GoodsPatch;
}> {
  const request = isRecord(input) ? input : {};
  const rawItems = Array.isArray(request.items)
    ? request.items
    : Array.isArray(request.operations)
      ? request.operations
      : Array.isArray(request.inputs)
        ? request.inputs
        : [];

  if (rawItems.length === 0) {
    throw new AdminApiError("批量录入不能为空", 400);
  }

  if (rawItems.length > DIRECT_BATCH_OPERATION_LIMIT) {
    throw new AdminApiError(
      `单次批量录入最多支持 ${DIRECT_BATCH_OPERATION_LIMIT} 个商品`,
      400,
    );
  }

  return rawItems.map((item, index) => {
    const source = isRecord(item) && "input" in item ? item.input : item;
    try {
      return {
        expectedChanges: isRecord(item) ? item.expectedChanges : undefined,
        input: normalizeGoodsCreateInput(source),
      };
    } catch (error) {
      if (error instanceof AdminApiError) {
        throw new AdminApiError(
          `第 ${index + 1} 个录入商品格式错误：${error.message}`,
          error.status,
          error.details,
        );
      }
      throw error;
    }
  });
}

function normalizeSearchSelector(input: unknown): Record<string, unknown> {
  const request = isRecord(input) ? input : {};
  const selector: Record<string, unknown> = {};
  const query = getOptionalString(request, "query");

  if (query) {
    selector.query = query;
  }

  if (request.goodsCategoryId !== undefined && request.goodsCategoryId !== "") {
    selector.goodsCategoryId = normalizeNumber(
      "goodsCategoryId",
      request.goodsCategoryId,
    );
  }

  if (request.isMarketable !== undefined && request.isMarketable !== "") {
    selector.isMarketable = normalizeBoolean(request.isMarketable);
  }

  return selector;
}

function uniqueWarnings(warnings: ToolWarning[]): ToolWarning[] {
  const seen = new Set<string>();
  const result: ToolWarning[] = [];
  for (const entry of warnings) {
    const key = `${entry.code}:${entry.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function normalizePatchValue(field: string, value: unknown): GoodsPatchValue {
  if (booleanFields.has(field)) {
    return normalizeBoolean(value);
  }

  if (numberFields.has(field)) {
    return normalizeNumber(field, value);
  }

  if (mediaFields.has(field)) {
    return normalizeMediaPatchValue(field, value);
  }

  const text = value === null ? "" : String(value);
  if (requiredStringFields.has(field) && text.trim().length === 0) {
    throw new AdminApiError(`${field} 不能为空`, 400);
  }

  return requiredStringFields.has(field) ? text.trim() : text;
}

function normalizeMediaPatchValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const paths = splitAssetList(value);
  if (paths.length === 0) {
    throw new AdminApiError(
      `${field} 必须使用 /upload/... 路径或上传资源 URL`,
      400,
    );
  }

  return field === "images" ? paths.join(",") : (paths[0] ?? "");
}

function buildChanges(
  current: Record<string, unknown>,
  patch: GoodsPatch,
): EditChange[] {
  const changes: EditChange[] = [];

  for (const [field, after] of Object.entries(patch)) {
    const before = current[field];
    if (valuesEqual(before, after)) {
      continue;
    }

    changes.push({
      after,
      before: toDisplayValue(before),
      field,
      label: fieldLabel(field),
    });
  }

  return changes;
}

function buildCreateChanges(patch: GoodsPatch): EditChange[] {
  const orderedFields = uniqueStrings([
    ...CREATE_CHANGE_FIELD_ORDER,
    ...Object.keys(patch),
  ]);

  return orderedFields
    .filter((field) => Object.prototype.hasOwnProperty.call(patch, field))
    .map((field) => ({
      after: patch[field] as GoodsPatchValue,
      before: null,
      field,
      label: fieldLabel(field),
    }));
}

function buildDeleteChanges(): EditChange[] {
  return [
    {
      after: "删除",
      before: "保留",
      field: "delete",
      label: "操作",
    },
  ];
}

function buildWarnings(
  state: EditableGoodsState,
  patch: GoodsPatch,
): ToolWarning[] {
  const warnings: ToolWarning[] = [];
  const touchesProduct = Object.keys(patch).some((field) =>
    productMirrorFields.has(field),
  );

  if (touchesProduct && state.products.length > 1) {
    warnings.push(
      warning(
        WARNING_CODES.editMultiSkuDefaultOnly,
        "该商品存在多个 SKU，执行时只会同步默认货品。",
      ),
    );
  }

  if ("goodsCategoryId" in patch) {
    warnings.push(
      warning(
        WARNING_CODES.editCategoryNav,
        "分类变更会影响前台导航与筛选，请确认分类 ID 正确。",
      ),
    );
  }

  return warnings;
}

function assertExpectedValues(
  model: Record<string, unknown>,
  expectedChanges: unknown,
): void {
  // Fail closed: every edit write path must carry the frozen preview diff so
  // the stale-data check cannot be skipped by omitting expectedChanges.
  if (!Array.isArray(expectedChanges) || expectedChanges.length === 0) {
    throw new AdminApiError(
      "执行预览缺少 expectedChanges，请重新生成预览后再执行",
      400,
    );
  }

  const conflicts = expectedChanges
    .filter(isRecord)
    .filter((change) => {
      const field = typeof change.field === "string" ? change.field : "";
      return field && !valuesEqual(model[field], change.before);
    })
    .map((change) => ({
      current: toDisplayValue(model[String(change.field)]),
      expected: change.before,
      field: change.field,
    }));

  if (conflicts.length > 0) {
    throw new AdminApiError("商品数据已变化，请重新生成预览", 409, {
      conflicts,
    });
  }
}

function assertExpectedCreateValues(
  changes: EditChange[],
  expectedChanges: unknown,
): void {
  // Fail closed like assertExpectedValues: create writes must carry the
  // frozen preview diff.
  if (!Array.isArray(expectedChanges) || expectedChanges.length === 0) {
    throw new AdminApiError(
      "录入预览缺少 expectedChanges，请重新生成预览后再执行",
      400,
    );
  }

  const actualByField = new Map(
    changes.map((change) => [change.field, change.after]),
  );
  const conflicts = expectedChanges
    .filter(isRecord)
    .filter((change) => {
      const field = typeof change.field === "string" ? change.field : "";
      return field && !valuesEqual(change.after, actualByField.get(field));
    })
    .map((change) => ({
      actual: toDisplayValue(actualByField.get(String(change.field))),
      expected: toDisplayValue(change.after),
      field: change.field,
    }));

  if (conflicts.length > 0) {
    throw new AdminApiError("商品录入预览已变化，请重新生成预览", 409, {
      conflicts,
    });
  }
}

function assertExpectedDeleteValues(expectedChanges: unknown): void {
  if (!Array.isArray(expectedChanges)) {
    return;
  }

  const conflicts = expectedChanges
    .filter(isRecord)
    .filter((change) => {
      const field = typeof change.field === "string" ? change.field : "";
      return field === "delete" && change.after !== "删除";
    })
    .map((change) => ({
      expected: "删除",
      field: change.field,
      received: change.after,
    }));

  if (conflicts.length > 0) {
    throw new AdminApiError("商品删除预览已变化，请重新生成预览", 409, {
      conflicts,
    });
  }
}

function assertExpectedTarget(
  model: Record<string, unknown>,
  expectedTarget: unknown,
): void {
  if (!isRecord(expectedTarget)) {
    return;
  }

  const conflicts = ["id", "name", "bn"]
    .filter((field) => expectedTarget[field] !== undefined)
    .filter(
      (field) => String(model[field] ?? "") !== String(expectedTarget[field]),
    )
    .map((field) => ({
      current: toDisplayValue(model[field]),
      expected: toDisplayValue(expectedTarget[field]),
      field,
    }));

  if (conflicts.length > 0) {
    throw new AdminApiError("商品数据已变化，请重新生成删除预览", 409, {
      conflicts,
    });
  }
}

function summarizeGoods(
  model: Record<string, unknown>,
  options: { includeDetails?: boolean } = {},
): GoodsSummary {
  const image = firstMediaUrl(model.image, model.images);

  return {
    bn: toOptionalString(model.bn),
    details: options.includeDetails ? summarizeGoodsDetails(model) : undefined,
    goodsCategoryId: toOptionalNumber(model.goodsCategoryId),
    id: toOptionalNumber(model.id) ?? String(model.id ?? ""),
    image,
    isMarketable: toOptionalBoolean(model.isMarketable),
    name: toOptionalString(model.name) ?? "",
    price: toOptionalNumber(model.price),
    sn: toOptionalString(model.sn),
    stock: toOptionalNumber(model.stock),
  };
}

function extractCreatedGoodsId(data: unknown): string | number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const direct = data.id ?? data.goodsId;
  if (isPositiveIdentifier(direct)) {
    return direct;
  }

  const model = firstRecord(data.model, data.goods);
  const nested = model?.id ?? model?.goodsId;
  return isPositiveIdentifier(nested) ? nested : undefined;
}

async function resolveCreatedGoodsSummary(
  client: AdminTransport,
  auth: AdminAuth,
  patch: GoodsPatch,
): Promise<GoodsSummary | undefined> {
  const result = await searchGoods(client, auth, {
    limit: 20,
    query: String(patch.name),
  });

  return result.rows.find((row) => String(row.bn ?? "") === String(patch.bn));
}

function isPositiveIdentifier(value: unknown): value is string | number {
  if (typeof value !== "string" && typeof value !== "number") {
    return false;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function summarizeGoodsDetails(model: Record<string, unknown>) {
  const note = toOptionalString(model.note)?.trim();

  return {
    fields: summarizeGoodsFields(model),
    images: uniqueStrings([
      ...splitAssetList(model.image),
      ...splitAssetList(model.images),
    ]).map(toLocalMediaUrl),
    intro: toOptionalString(model.intro),
    usageGuidelines: [
      {
        body: "请遵照包装说明书或专业药剂师指导使用，切勿超量服用。",
        title: "用法用量",
      },
      {
        body:
          note || "如您正处于孕期、哺乳期或有基础疾病，请先咨询医生再行使用。",
        title: "注意事项",
      },
      {
        body: "置于阴凉干燥处保存，避免阳光直射，并远离儿童可触及的位置。",
        title: "存储建议",
      },
    ],
  };
}

function summarizeGoodsFields(
  model: Record<string, unknown>,
): GoodsDetailField[] {
  const orderedKeys = uniqueStrings([
    ...DETAIL_FIELD_ORDER,
    ...Object.keys(model),
  ]);

  return orderedKeys
    .filter((field) => Object.prototype.hasOwnProperty.call(model, field))
    .map((field) => ({
      field,
      label: fieldLabel(field),
      value: toDetailValue(field, model[field]),
    }));
}

function assertOk(
  response: AdminEnvelope<unknown>,
  fallbackMessage: string,
): void {
  if (response.code === 0) {
    return;
  }

  throw new AdminApiError(response.msg ?? fallbackMessage, 502, {
    code: response.code,
    msg: response.msg,
  });
}

function extractGoodsId(input: unknown): string | number {
  if (!isRecord(input)) {
    throw new AdminApiError("缺少商品 id", 400);
  }

  const id = input.id ?? input.targetId;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }

  throw new AdminApiError("缺少商品 id", 400);
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBnKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function getPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function getCappedPositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  return Math.min(getPositiveInt(value, fallback), max);
}

function getUniformMarketablePatch(
  operations: BatchEditOperation[],
): boolean | undefined {
  let target: boolean | undefined;

  for (const operation of operations) {
    const entries = Object.entries(operation.patch);
    const [field, value] = entries[0] ?? [];
    if (
      entries.length !== 1 ||
      field !== "isMarketable" ||
      typeof value !== "boolean"
    ) {
      return undefined;
    }

    if (target === undefined) {
      target = value;
      continue;
    }

    if (target !== value) {
      return undefined;
    }
  }

  return target;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index] as T, index);
      }
    }),
  );

  return results;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "on", "true", "yes"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(lowered)) {
      return false;
    }
  }

  throw new AdminApiError(`无法解析布尔值: ${String(value)}`, 400);
}

function normalizeNumber(field: string, value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AdminApiError(`${field} 必须是数字`, 400);
  }

  return parsed;
}

function normalizeProductDefault(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return false;
}

function valuesEqual(before: unknown, after: unknown): boolean {
  if (typeof after === "number") {
    return Number(before) === after;
  }
  if (typeof after === "boolean") {
    return toOptionalBoolean(before) === after;
  }

  return String(before ?? "") === String(after ?? "");
}

function toDisplayValue(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function toDetailValue(
  field: string,
  value: unknown,
): string | number | boolean | null {
  if (field === "image" || field === "images" || field === "video") {
    const paths = splitAssetList(value).map(toLocalMediaPath);
    return paths.length ? paths.join(", ") : null;
  }

  return toDisplayValue(value);
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true" || lowered === "1") {
      return true;
    }
    if (lowered === "false" || lowered === "0") {
      return false;
    }
  }

  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

function firstRecord(
  ...values: unknown[]
): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function firstArray(...values: unknown[]): unknown[] {
  const found = values.find(Array.isArray);
  return found ? [...found] : [];
}

function splitAssetList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(splitAssetList);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .map(toLocalMediaPath)
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function firstMediaUrl(...values: unknown[]): string | undefined {
  const path = values.flatMap(splitAssetList)[0];
  return path ? toLocalMediaUrl(path) : undefined;
}

function toLocalMediaUrl(path: string): string {
  const localPath = toLocalMediaPath(path);
  if (!localPath) {
    return "";
  }

  // Demo catalog assets live in this app's public/ dir, so a root-relative
  // path resolves against the agent origin that also serves the chat UI.
  if (localPath.startsWith("/demo-goods/")) {
    return localPath;
  }

  return new URL(
    localPath.replace(/^\/+/, ""),
    // Single config source: reuse the runtime config instead of a second
    // loadConfig() call that could drift from the served instance.
    getAgentRuntime().config.adminPublicBaseUrl,
  ).toString();
}

function isAllowedMediaPath(pathname: string): boolean {
  return (
    pathname.startsWith("/upload/") || pathname.startsWith("/demo-goods/")
  );
}

function toLocalMediaPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    return isAllowedMediaPath(url.pathname) ? url.pathname : "";
  } catch {
    const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return isAllowedMediaPath(normalized) ? normalized : "";
  }
}



import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const defaultFixturePath = path.join(appRoot, "fixtures/goods.example.json");
const fixturePath = process.env.ADMIN_AGENT_TEST_FIXTURE_PATH
  ? path.resolve(process.env.ADMIN_AGENT_TEST_FIXTURE_PATH)
  : path.join(appRoot, "logs/test-fixture.generated.json");
const port = 18183;

if (!process.env.ADMIN_AGENT_TEST_FIXTURE_PATH) {
  await createLargeFixture(defaultFixturePath, fixturePath);
}

const child = spawn("pnpm", ["dev"], {
  cwd: appRoot,
  env: {
    ...process.env,
    ADMIN_AGENT_AUDIT_LOG: path.join(appRoot, "logs/test-audit.jsonl"),
    ADMIN_AGENT_BACKEND: "fixture",
    ADMIN_AGENT_FIXTURE_PATH: fixturePath,
    ADMIN_AGENT_HOST: "127.0.0.1",
    ADMIN_AGENT_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += String(chunk);
});
child.stderr.on("data", (chunk) => {
  output += String(chunk);
});

try {
  await waitForHealth(port);

  const html = await fetchText(`http://127.0.0.1:${port}/`);
  assert.match(html, /今天要处理什么工作/);
  assert.match(html, /例如「检索胃药」/);
  assert.match(html, /__next/);

  const uploadFormData = new FormData();
  uploadFormData.append(
    "files",
    new File([new Uint8Array([137, 80, 78, 71])], "cover.png", {
      type: "image/png",
    }),
  );
  const upload = await postForm(port, "attachments/images", uploadFormData);
  assert.equal(upload.ok, true);
  assert.equal(upload.data.length, 1);
  assert.match(upload.data[0].path, /^\/upload\/admin-agent-fixture\//);

  const search = await postTool(port, "goods.search", {
    limit: 120,
    query: "",
  });
  assert.equal(search.ok, true);
  assert.ok(search.data.rows.length > 0);
  assert.equal(search.data.rows[0].details, undefined);

  const first = search.data.rows[0];
  const firstDetail = await postTool(port, "goods.detail", {
    id: first.id,
  });
  assert.equal(firstDetail.ok, true);
  assert.equal(firstDetail.data.id, first.id);
  assert.equal(firstDetail.data.price, first.price);
  assert.ok(firstDetail.data.details.fields.length > 0);

  const nextPrice = Number(first.price ?? 0) + 1;
  const plan = await postTool(port, "goods.planEdit", {
    id: first.id,
    patch: { price: nextPrice },
  });
  assert.equal(plan.ok, true);
  assert.ok(
    plan.data.changes.some(
      (change) =>
        change.field === "price" &&
        change.before === first.price &&
        change.after === nextPrice,
    ),
  );

  const execute = await postTool(port, "goods.executeEdit", {
    confirm: true,
    expectedChanges: plan.data.changes,
    id: first.id,
    patch: plan.data.patch,
  });
  assert.equal(execute.ok, true);
  assert.equal(execute.data.auditLogged, true);

  const mediaPlan = await postTool(port, "goods.planEdit", {
    id: first.id,
    patch: {
      image: "http://127.0.0.1:18080/upload/goods/cover.jpg",
      images: ["/upload/goods/cover.jpg", "/upload/goods/detail.jpg"],
    },
  });
  assert.equal(mediaPlan.ok, true);
  assert.equal(mediaPlan.data.patch.image, "/upload/goods/cover.jpg");
  assert.equal(
    mediaPlan.data.patch.images,
    "/upload/goods/cover.jpg,/upload/goods/detail.jpg",
  );
  assert.ok(mediaPlan.data.changes.some((change) => change.field === "image"));
  assert.ok(mediaPlan.data.changes.some((change) => change.field === "images"));

  const mediaExecute = await postTool(port, "goods.executeEdit", {
    confirm: true,
    expectedChanges: mediaPlan.data.changes,
    id: first.id,
    patch: mediaPlan.data.patch,
  });
  assert.equal(mediaExecute.ok, true);
  assert.equal(mediaExecute.data.auditLogged, true);

  const createInput = {
    bn: "DEMO-CREATE-TEST",
    brief: "自动化测试录入商品",
    goodsCategoryId: 10,
    image: upload.data[0].path,
    isMarketable: false,
    name: "测试商品 新录入",
    packaging: "盒",
    price: 1880,
    stock: 12,
    unit: "盒",
    weight: 100,
  };
  const createPlan = await postTool(port, "goods.planCreate", createInput);
  assert.equal(createPlan.ok, true);
  assert.equal(createPlan.data.action, "goods.create");
  assert.ok(createPlan.data.changes.some((change) => change.field === "name"));
  assert.ok(createPlan.data.changes.some((change) => change.field === "image"));

  const createExecute = await postTool(port, "goods.executeCreate", {
    confirm: true,
    expectedChanges: createPlan.data.changes,
    input: createPlan.data.patch,
  });
  assert.equal(createExecute.ok, true);
  assert.equal(createExecute.data.auditLogged, true);
  assert.match(String(createExecute.data.target.id), /^\d+$/);

  const createdSearch = await postTool(port, "goods.search", {
    limit: 5,
    query: "新录入",
  });
  assert.equal(createdSearch.ok, true);
  assert.equal(createdSearch.data.rows.length, 1);
  assert.equal(createdSearch.data.rows[0].bn, createInput.bn);

  const deletePlan = await postTool(port, "goods.planDelete", {
    id: createExecute.data.target.id,
  });
  assert.equal(deletePlan.ok, true);
  assert.equal(deletePlan.data.action, "goods.delete");
  assert.equal(deletePlan.data.target.bn, createInput.bn);

  const deleteExecute = await postTool(port, "goods.executeDelete", {
    confirm: true,
    expectedChanges: deletePlan.data.changes,
    expectedTarget: deletePlan.data.target,
    id: createExecute.data.target.id,
  });
  assert.equal(deleteExecute.ok, true);
  assert.equal(deleteExecute.data.auditLogged, true);

  const deletedSearch = await postTool(port, "goods.search", {
    limit: 5,
    query: "新录入",
  });
  assert.equal(deletedSearch.ok, true);
  assert.equal(deletedSearch.data.rows.length, 0);

  const batchTargets = search.data.rows.slice(0, 60);
  const batchPlan = await postTool(port, "goods.planBatchEdit", {
    operations: batchTargets.map((goods, index) => ({
      id: goods.id,
      patch: { sort: 900 + index },
    })),
  });
  assert.equal(batchPlan.ok, true);
  assert.ok(batchPlan.data.previewId);
  assert.equal(batchPlan.data.plannedCount, batchTargets.length);
  assert.equal(batchPlan.data.totalCount, batchTargets.length);
  assert.ok(batchPlan.data.items.length <= 20);
  assert.equal(batchPlan.data.items[0].target.details, undefined);
  assertNoBatchInfoWarnings(batchPlan.data.warnings);

  const batchExecute = await postTool(port, "goods.executeBatchEdit", {
    confirm: true,
    previewId: batchPlan.data.previewId,
  });
  assert.equal(batchExecute.ok, true);
  assert.equal(batchExecute.data.successCount, batchTargets.length);
  assert.equal(batchExecute.data.failureCount, 0);
  assert.ok(batchExecute.data.resultId);
  assert.ok(batchExecute.data.items.length <= 20);
  assert.equal(batchExecute.data.sampleCount, 20);

  const stalePlan = await postTool(port, "goods.planBatchEdit", {
    operations: batchTargets.slice(0, 2).map((goods, index) => ({
      id: goods.id,
      patch: { stock: 300 + index },
    })),
  });
  assert.equal(stalePlan.ok, true);
  const staleOperations = stalePlan.data.items.map((item, index) => ({
    expectedChanges:
      index === 0
        ? item.changes.map((change) =>
            change.field === "stock" ? { ...change, before: -999 } : change,
          )
        : item.changes,
    id: item.target.id,
    patch: item.patch,
  }));
  const partialExecute = await postTool(port, "goods.executeBatchEdit", {
    confirm: true,
    operations: staleOperations,
  });
  assert.equal(partialExecute.ok, true);
  assert.equal(partialExecute.data.successCount, 1);
  assert.equal(partialExecute.data.failureCount, 1);
  assert.match(
    partialExecute.data.failures[0].error,
    /商品数据已变化/,
  );

  const nativeMarketableTargets = search.data.rows
    .filter((goods) => goods.isMarketable === true)
    .slice(0, 2);
  assert.equal(nativeMarketableTargets.length, 2);
  const nativeStalePlan = await postTool(port, "goods.planBatchEdit", {
    operations: nativeMarketableTargets.map((goods) => ({
      id: goods.id,
      patch: { isMarketable: false },
    })),
  });
  assert.equal(nativeStalePlan.ok, true);
  assert.equal(nativeStalePlan.data.plannedCount, 2);

  const externallyChangedPlan = nativeStalePlan.data.items[0];
  const externalExecute = await postTool(port, "goods.executeEdit", {
    confirm: true,
    expectedChanges: externallyChangedPlan.changes,
    id: externallyChangedPlan.target.id,
    patch: externallyChangedPlan.patch,
  });
  assert.equal(externalExecute.ok, true);

  const nativeStaleExecute = await postTool(port, "goods.executeBatchEdit", {
    confirm: true,
    previewId: nativeStalePlan.data.previewId,
  });
  assert.equal(nativeStaleExecute.ok, true);
  assert.equal(nativeStaleExecute.data.successCount, 1);
  assert.equal(nativeStaleExecute.data.failureCount, 1);
  assert.match(
    nativeStaleExecute.data.failures[0].error,
    /商品数据已变化/,
  );

  const filterPlan = await postTool(port, "goods.planFilterEdit", {
    patch: { isMarketable: false },
    selector: { isMarketable: true },
  });
  assert.equal(filterPlan.ok, true);
  assert.ok(filterPlan.data.previewId);
  assert.ok(filterPlan.data.plannedCount > 20);
  assert.ok(filterPlan.data.items.length <= 20);
  assert.equal(filterPlan.data.items[0].target.details, undefined);
  assertNoBatchInfoWarnings(filterPlan.data.warnings);

  const filterExecute = await postTool(port, "goods.executeFilterEdit", {
    confirm: true,
    previewId: filterPlan.data.previewId,
  });
  assert.equal(filterExecute.ok, true);
  assert.equal(filterExecute.data.failureCount, 0);
  assert.equal(filterExecute.data.successCount, filterPlan.data.plannedCount);
  assert.ok(filterExecute.data.resultId);
  assert.ok(filterExecute.data.items.length <= 20);

  const batchCreateInputs = Array.from({ length: 25 }, (_, offset) => {
    const index = offset + 1;
    return {
      bn: `DEMO-BATCH-CREATE-${index}`,
      goodsCategoryId: 10,
      image: upload.data[0].path,
      isMarketable: false,
      name: `测试商品 批量录入 ${index}`,
      price: 1000 + index,
      stock: 10 + index,
      weight: 100,
    };
  });
  const batchCreatePlan = await postTool(port, "goods.planBatchCreate", {
    items: batchCreateInputs,
  });
  assert.equal(batchCreatePlan.ok, true);
  assert.ok(batchCreatePlan.data.previewId);
  assert.equal(batchCreatePlan.data.plannedCount, batchCreateInputs.length);
  assert.ok(batchCreatePlan.data.items.length <= 20);
  assert.equal(batchCreatePlan.data.items[0].target.details, undefined);
  assertNoBatchInfoWarnings(batchCreatePlan.data.warnings);

  const batchCreateExecute = await postTool(port, "goods.executeBatchCreate", {
    confirm: true,
    previewId: batchCreatePlan.data.previewId,
  });
  assert.equal(batchCreateExecute.ok, true);
  assert.equal(batchCreateExecute.data.successCount, batchCreateInputs.length);
  assert.equal(batchCreateExecute.data.failureCount, 0);
  assert.ok(batchCreateExecute.data.resultId);
  assert.ok(batchCreateExecute.data.items.length <= 20);

  const batchCreateRetry = await postTool(port, "goods.executeBatchCreate", {
    confirm: true,
    previewId: batchCreatePlan.data.previewId,
  });
  assert.equal(batchCreateRetry.ok, true);
  assert.equal(batchCreateRetry.data.successCount, 0);
  assert.equal(batchCreateRetry.data.skippedCount, batchCreateInputs.length);
  assert.equal(batchCreateRetry.data.failureCount, 0);

  const existingCreatePlan = await postTool(port, "goods.planBatchCreate", {
    items: batchCreateInputs,
  });
  assert.equal(existingCreatePlan.ok, true);
  assert.equal(existingCreatePlan.data.plannedCount, 0);
  assert.equal(existingCreatePlan.data.skippedCount, batchCreateInputs.length);
  assert.equal(existingCreatePlan.data.previewId, undefined);

  // Unified preview execution: a single-op edit plan executed via previewId.
  const unifiedPlan = await postTool(port, "goods.planBatchEdit", {
    operations: [{ id: first.id, patch: { stock: 555 } }],
  });
  assert.equal(unifiedPlan.ok, true);
  assert.ok(unifiedPlan.data.previewId);
  assert.equal(unifiedPlan.data.plannedCount, 1);

  const unifiedExecute = await postTool(port, "goods.executePreview", {
    confirm: true,
    previewId: unifiedPlan.data.previewId,
  });
  assert.equal(unifiedExecute.ok, true);
  assert.equal(unifiedExecute.data.successCount, 1);
  assert.equal(unifiedExecute.data.failureCount, 0);
  assert.equal(unifiedExecute.data.auditLogged, true);

  // Unknown/expired previews are rejected instead of guessing operations.
  const missingPreview = await postToolError(port, "goods.executePreview", {
    confirm: true,
    previewId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(missingPreview.status, 409);

  // Batch delete plan + unified execution.
  const createdIds = batchCreateExecute.data.items
    .slice(0, 2)
    .map((item) => item.target.id);
  assert.equal(createdIds.length, 2);
  const batchDeletePlan = await postTool(port, "goods.planBatchDelete", {
    ids: createdIds,
  });
  assert.equal(batchDeletePlan.ok, true);
  assert.equal(batchDeletePlan.data.action, "goods.batchDelete");
  assert.ok(batchDeletePlan.data.previewId);
  assert.equal(batchDeletePlan.data.plannedCount, 2);

  const batchDeleteExecute = await postTool(port, "goods.executePreview", {
    confirm: true,
    previewId: batchDeletePlan.data.previewId,
  });
  assert.equal(batchDeleteExecute.ok, true);
  assert.equal(batchDeleteExecute.data.successCount, 2);
  assert.equal(batchDeleteExecute.data.failureCount, 0);
  assert.equal(batchDeleteExecute.data.auditLogged, true);

  const deletedBatchSearch = await postTool(port, "goods.search", {
    limit: 5,
    query: "批量录入 1",
  });
  assert.equal(deletedBatchSearch.ok, true);
  assert.equal(
    deletedBatchSearch.data.rows.some((row) =>
      createdIds.map(String).includes(String(row.id)),
    ),
    false,
  );

  console.log(
    JSON.stringify({
      fixturePath,
      goods: search.data.rows.length,
      ok: true,
      port,
    }),
  );
} finally {
  child.kill("SIGTERM");
}

async function waitForHealth(targetPort) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${targetPort}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Agent did not start. Output:\n${output}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.text();
}

async function postTool(targetPort, tool, payload) {
  const response = await fetch(
    `http://127.0.0.1:${targetPort}/api/tools/${tool}`,
    {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

async function postToolError(targetPort, tool, payload) {
  const response = await fetch(
    `http://127.0.0.1:${targetPort}/api/tools/${tool}`,
    {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const body = await response.json();
  assert.equal(response.ok, false, JSON.stringify(body));
  return { body, status: response.status };
}

async function postForm(targetPort, path, body) {
  const response = await fetch(`http://127.0.0.1:${targetPort}/api/${path}`, {
    body,
    method: "POST",
  });
  const parsed = await response.json();
  assert.equal(response.ok, true, JSON.stringify(parsed));
  return parsed;
}

function assertNoBatchInfoWarnings(warnings) {
  const text = JSON.stringify(warnings ?? []);
  assert.doesNotMatch(text, /已生成 \d+ 个商品的批量/);
  assert.doesNotMatch(text, /下方仅展示前/);
}

async function createLargeFixture(sourcePath, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const fixture = JSON.parse(await readFile(sourcePath, "utf8"));
  const baseGoods = fixture.goods[0];
  const baseProduct = fixture.productsByGoodsId[String(baseGoods.id)][0];
  const goods = [];
  const productsByGoodsId = {};

  for (let index = 0; index < 120; index += 1) {
    const id = 2000 + index;
    const bn = `DEMO-LARGE-${String(index + 1).padStart(3, "0")}`;
    goods.push({
      ...baseGoods,
      bn,
      goodsCategoryId: index % 2 === 0 ? 10 : 11,
      id,
      isMarketable: index % 3 !== 0,
      isRecommend: false,
      name: `测试商品 批量样本 ${index + 1}`,
      sort: index + 1,
    });
    productsByGoodsId[String(id)] = [
      {
        ...baseProduct,
        goodsId: id,
        id: 6000 + index,
        price: 1000 + index,
        sn: `${bn}-SKU`,
        stock: 20 + index,
      },
    ];
  }

  await writeFile(
    targetPath,
    JSON.stringify(
      {
        ...fixture,
        goods,
        productsByGoodsId,
      },
      null,
      2,
    ),
  );
}

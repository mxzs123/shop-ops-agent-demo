import assert from "node:assert/strict";

import type { UIMessage } from "ai";

import {
  compactMessagesForModelRequest,
  compactMessagesForStorage,
} from "../src/message-context";

const messages = buildLargeToolHistory();
const rawLength = JSON.stringify(messages).length;
const modelMessages = compactMessagesForModelRequest(messages);
const storageMessages = compactMessagesForStorage(messages);
const modelLength = JSON.stringify(modelMessages).length;
const storageLength = JSON.stringify(storageMessages).length;

assert.equal(modelMessages.length, 8);
assert.equal(storageMessages.length, 16);
assert.ok(rawLength > 1_000_000, `rawLength ${rawLength}`);
assert.ok(modelLength < 80_000, `modelLength ${modelLength}`);
assert.ok(storageLength < 160_000, `storageLength ${storageLength}`);

const modelSearch = findLatestToolOutput(modelMessages, "goods_search");
assert.equal(modelSearch.ok, true);
assert.equal(modelSearch.data.rows.length, 3);
assert.equal(modelSearch.data.rows[0].details, undefined);

const modelBatchPlan = findLatestToolOutput(
  modelMessages,
  "goods_plan_filter_edit",
);
assert.equal(modelBatchPlan.ok, true);
assert.equal(modelBatchPlan.data.previewId, "preview-large");
assert.equal(modelBatchPlan.data.items.length, 3);
assert.equal(modelBatchPlan.data.items[0].target.details, undefined);

const modelBatchCreatePlan = findLatestToolOutput(
  modelMessages,
  "goods_plan_batch_create",
);
assert.equal(modelBatchCreatePlan.ok, true);
assert.equal(modelBatchCreatePlan.data.previewId, "create-preview-large");
assert.equal(modelBatchCreatePlan.data.items.length, 3);
assert.equal(modelBatchCreatePlan.data.items[0].target.details, undefined);

const modelBatchExecution = findLatestToolOutput(
  modelMessages,
  "goods_execute_filter_edit",
);
assert.equal(modelBatchExecution.ok, true);
assert.equal(modelBatchExecution.data.resultId, "result-large");
assert.equal(modelBatchExecution.data.items.length, 3);
assert.equal(modelBatchExecution.data.items[0].target.details, undefined);

assert.equal(
  storageMessages.some((message) =>
    message.parts.some((part) => part.type === "file"),
  ),
  false,
);

console.log(
  JSON.stringify({
    modelLength,
    ok: true,
    rawLength,
    storageLength,
  }),
);

function buildLargeToolHistory(): UIMessage[] {
  const history: UIMessage[] = [];
  for (let turn = 0; turn < 25; turn += 1) {
    history.push({
      id: `user-${turn}`,
      parts: [{ text: `查询第 ${turn} 批商品`, type: "text" }],
      role: "user",
    });
    history.push({
      id: `assistant-${turn}`,
      parts: [
        {
          state: "output-available",
          toolCallId: `search-${turn}`,
          toolName: "goods_search",
          type: "dynamic-tool",
          input: { limit: 200, query: "" },
          output: {
            data: {
              pageSize: 80,
              rows: Array.from({ length: 80 }, (_, index) =>
                buildGoods(turn * 1_000 + index),
              ),
              total: 925,
            },
            ok: true,
          },
        },
        {
          state: "output-available",
          toolCallId: `plan-${turn}`,
          toolName: "goods_plan_filter_edit",
          type: "dynamic-tool",
          input: {
            patch: { isMarketable: false },
            selector: { isMarketable: true },
          },
          output: {
            data: {
              action: "goods.batchUpdate",
              confirmRequired: true,
              items: Array.from({ length: 80 }, (_, index) => ({
                action: "goods.update",
                changes: [
                  {
                    after: false,
                    before: true,
                    field: "isMarketable",
                    label: "是否上架",
                  },
                ],
                confirmRequired: true,
                patch: { isMarketable: false },
                target: buildGoods(index),
                warnings: [],
              })),
              plannedCount: 925,
              previewId: turn === 24 ? "preview-large" : `preview-${turn}`,
              sampleCount: 20,
              skippedCount: 0,
              totalCount: 925,
              warnings: [],
            },
            ok: true,
          },
        },
        {
          state: "output-available",
          toolCallId: `create-plan-${turn}`,
          toolName: "goods_plan_batch_create",
          type: "dynamic-tool",
          input: {
            items: Array.from({ length: 80 }, (_, index) =>
              buildCreateInput(turn * 1_000 + index),
            ),
          },
          output: {
            data: {
              action: "goods.batchCreate",
              confirmRequired: true,
              items: Array.from({ length: 80 }, (_, index) => ({
                action: "goods.create",
                changes: [
                  {
                    after: `测试新商品 ${index}`,
                    before: null,
                    field: "name",
                    label: "商品名称",
                  },
                ],
                confirmRequired: true,
                patch: buildCreateInput(index),
                target: buildGoods(index),
                warnings: [],
              })),
              plannedCount: 80,
              previewId:
                turn === 24 ? "create-preview-large" : `create-preview-${turn}`,
              sampleCount: 20,
              skippedCount: 0,
              totalCount: 80,
              warnings: ["已生成 80 个商品的批量录入预览，30 分钟内有效。"],
            },
            ok: true,
          },
        },
        {
          state: "output-available",
          toolCallId: `execute-${turn}`,
          toolName: "goods_execute_filter_edit",
          type: "dynamic-tool",
          input: {
            previewId: turn === 24 ? "preview-large" : `preview-${turn}`,
          },
          output: {
            data: {
              adminMessage: "筛选批量执行完成：成功 925，跳过 0，失败 0",
              failureCount: 0,
              failures: [],
              items: Array.from({ length: 925 }, (_, index) => ({
                adminMessage: "执行成功",
                changes: [
                  {
                    after: false,
                    before: true,
                    field: "isMarketable",
                    label: "是否上架",
                  },
                ],
                target: buildGoods(index),
                warnings: [],
              })),
              resultId: turn === 24 ? "result-large" : `result-${turn}`,
              sampleCount: 20,
              skippedCount: 0,
              successCount: 925,
              totalCount: 925,
              warnings: [],
            },
            ok: true,
          },
        },
      ] as UIMessage["parts"],
      role: "assistant",
    });
  }

  history.push({
    id: "user-file",
    parts: [
      {
        filename: "huge.png",
        mediaType: "image/png",
        type: "file",
        url: `data:image/png;base64,${"A".repeat(50_000)}`,
      },
    ],
    role: "user",
  });

  return history;
}

function buildGoods(index: number) {
  return {
    bn: `BN-${index}`,
    details: {
      fields: Array.from({ length: 20 }, (_, fieldIndex) => ({
        field: `field_${fieldIndex}`,
        label: `字段 ${fieldIndex}`,
        value: "长字段值".repeat(40),
      })),
      images: Array.from(
        { length: 8 },
        (_, imageIndex) => `/upload/goods/${index}-${imageIndex}.jpg`,
      ),
      intro: "商品说明".repeat(80),
      usageGuidelines: [
        {
          body: "用法用量".repeat(80),
          title: "用法用量",
        },
      ],
    },
    goodsCategoryId: 10,
    id: index,
    image: `/upload/goods/${index}.jpg`,
    isMarketable: true,
    name: `测试商品 ${index} ${"说明".repeat(40)}`,
    price: 1000 + index,
    sn: `SN-${index}`,
    stock: 20,
  };
}

function buildCreateInput(index: number) {
  return {
    bn: `CREATE-${index}`,
    goodsCategoryId: 10,
    image: `/upload/goods/create-${index}.jpg`,
    name: `测试新商品 ${index} ${"说明".repeat(40)}`,
    price: 1000 + index,
    stock: 20,
    weight: 100,
  };
}

function findLatestToolOutput(messages: UIMessage[], toolName: string) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex] as
        | (UIMessage["parts"][number] & {
            output?: unknown;
            state?: string;
            toolName?: string;
          })
        | undefined;
      if (
        part?.type === "dynamic-tool" &&
        part.toolName === toolName &&
        part.state === "output-available"
      ) {
        return part.output as {
          data: Record<string, any>;
          ok: boolean;
        };
      }
    }
  }

  throw new Error(`Missing tool output: ${toolName}`);
}

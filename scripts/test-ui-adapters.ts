import { strict as assert } from "node:assert";

import type { UIMessage } from "ai";

import {
  collectPreviewExecutions,
  toolPartLayout,
  toolRunHeader,
  toToolChipStep,
} from "../lib/ui-adapters";

type Part = UIMessage["parts"][number];

function toolPart(
  name: string,
  state: string,
  extra: Record<string, unknown> = {},
): Part {
  return {
    toolCallId: `call-${name}-${state}`,
    type: `tool-${name}`,
    state,
    ...extra,
  } as unknown as Part;
}

function message(parts: Part[]): UIMessage {
  return { id: `m-${Math.random()}`, parts, role: "assistant" };
}

// ── layout: which parts get a card vs a chip row ─────────────
assert.equal(toolPartLayout(toolPart("goods_search", "input-available")), "chip");
assert.equal(
  toolPartLayout(
    toolPart("goods_search", "output-available", {
      output: { data: { rows: [{ id: 1, name: "a" }], total: 1 }, ok: true },
    }),
  ),
  "card",
);
assert.equal(
  toolPartLayout(
    toolPart("goods_search", "output-available", {
      output: { data: { rows: [], total: 0 }, ok: true },
    }),
  ),
  "chip",
  "empty search collapses to a chip",
);
assert.equal(
  toolPartLayout(
    toolPart("goods_plan_edit", "output-available", {
      output: { error: "boom", ok: false },
    }),
  ),
  "chip",
  "failed plan renders as an error chip",
);
assert.equal(
  toolPartLayout(toolPart("goods_execute", "input-available")),
  "card",
  "pending execute is a running task row",
);
assert.equal(
  toolPartLayout(toolPart("goods_get_editable", "output-available", { output: { ok: true } })),
  "chip",
);
console.log("ok - tool part layout");

// ── chip steps ────────────────────────────────────────────────
const running = toToolChipStep(
  toolPart("goods_search", "input-available", { input: { page: 2, query: " 胃薬 " } }),
  "k1",
);
assert.equal(running.status, "running");
assert.equal(running.icon, "search");
assert.equal(running.chip, "“胃薬” · 2 ページ目");

const failed = toToolChipStep(
  toolPart("goods_plan_delete", "output-available", {
    input: { ids: [1, 2, 3] },
    output: { error: "プレビューが存在しないか期限切れです", ok: false },
  }),
  "k2",
);
assert.equal(failed.status, "error");
assert.equal(failed.chip, "3 件");
assert.deepEqual(failed.detail, [{ text: "プレビューが存在しないか期限切れです", tone: "error" }]);

const streamError = toToolChipStep(
  toolPart("goods_get_editable", "output-error", { errorText: "timeout", input: { id: 7 } }),
  "k3",
);
assert.equal(streamError.status, "error");
assert.equal(streamError.chip, "ID 7");

const emptySearch = toToolChipStep(
  toolPart("goods_search", "output-available", {
    input: { query: "" },
    output: { data: { rows: [] }, ok: true },
  }),
  "k4",
);
assert.equal(emptySearch.status, "done");
assert.equal(emptySearch.label, "該当する商品がありません");
assert.equal(emptySearch.chip, "すべての商品");

assert.equal(toolRunHeader([running]), undefined, "single rows have no header");
assert.equal(
  toolRunHeader([running, failed, emptySearch]),
  "ツール呼び出し 3 回 · 実行中 1 件 · 失敗 1 件",
);
console.log("ok - tool chip steps");

// ── preview executions derived from the conversation ─────────
const executions = collectPreviewExecutions([
  message([
    toolPart("goods_plan_edit", "output-available", {
      output: { data: { items: [], previewId: "p-run" }, ok: true },
    }),
  ]),
  message([
    toolPart("goods_execute", "input-available", { input: { previewId: "p-run" } }),
    toolPart("goods_execute", "output-available", {
      input: { previewId: "p-done" },
      output: { data: { failureCount: 0, items: [], successCount: 2 }, ok: true },
    }),
    toolPart("goods_execute", "output-available", {
      input: { previewId: "p-partial" },
      output: { data: { failureCount: 1, items: [], successCount: 3 }, ok: true },
    }),
    toolPart("goods_execute", "output-available", {
      input: { previewId: "p-failed" },
      output: { error: "プレビューが存在しないか期限切れです。作成し直してください", ok: false },
    }),
    toolPart("goods_execute", "output-available", {
      input: { previewId: "p-all-failed" },
      output: { data: { failureCount: 2, items: [], successCount: 0 }, ok: true },
    }),
    toolPart("goods_execute", "output-error", {
      errorText: "network",
      input: { previewId: "p-stream-error" },
    }),
    toolPart("goods_search", "output-available", {
      input: { previewId: "not-an-execute" },
      output: { ok: true },
    }),
  ]),
]);
assert.deepEqual(executions, {
  "p-all-failed": "failed",
  "p-done": "done",
  "p-failed": "failed",
  "p-partial": "partial",
  "p-run": "running",
  "p-stream-error": "failed",
});

const retried = collectPreviewExecutions([
  message([
    toolPart("goods_execute", "output-error", { input: { previewId: "p" } }),
  ]),
  message([
    toolPart("goods_execute", "output-available", {
      input: { previewId: "p" },
      output: { data: { successCount: 1 }, ok: true },
    }),
  ]),
]);
assert.equal(retried.p, "done", "the latest execute call wins");
console.log("ok - preview executions");

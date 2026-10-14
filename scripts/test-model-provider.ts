import { strict as assert } from "node:assert";

import { generateText, type ModelMessage } from "ai";

import { createChatModel, MODEL_ID, MODEL_LABEL } from "../src/model-provider";

assert.equal(MODEL_LABEL, "Claude");
assert.match(MODEL_ID, /^claude-/);

const requests: {
  body: Record<string, unknown>;
  headers: Headers;
  url: string;
}[] = [];
const model = createChatModel("test-key", {
  fetch: async (input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
      url: String(input),
    });
    return Response.json({
      content: [{ text: "ok", type: "text" }],
      id: "msg_test",
      model: MODEL_ID,
      role: "assistant",
      stop_reason: "end_turn",
      stop_sequence: null,
      type: "message",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  },
});

const pngPixel = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const messages: ModelMessage[] = [
  { content: "商品を調べて", role: "user" },
  {
    content: [
      {
        input: { query: "ビタミン" },
        toolCallId: "call-1",
        toolName: "goods_search",
        type: "tool-call",
      },
    ],
    role: "assistant",
  },
  {
    content: [
      {
        output: { type: "json", value: { rows: [] } },
        toolCallId: "call-1",
        toolName: "goods_search",
        type: "tool-result",
      },
    ],
    role: "tool",
  },
  // An assistant turn produced by a direct confirm execution.
  { content: "実行しました：成功 1 件。", role: "assistant" },
  {
    content: [
      { text: "この画像を見て", type: "text" },
      { data: pngPixel, mediaType: "image/png", type: "file" },
    ],
    role: "user",
  },
];

const result = await generateText({ messages, model });
assert.equal(result.text, "ok");

const request = requests[0];
assert.equal(request?.url, "https://api.anthropic.com/v1/messages");
assert.equal(request?.headers.get("x-api-key"), "test-key");
assert.equal(request?.body.model, MODEL_ID);

const sent = request?.body.messages as {
  content: Record<string, unknown>[];
  role: string;
}[];
// The tool call and its result reach Claude as tool_use / tool_result blocks.
assert.equal(sent[1]?.content[0]?.type, "tool_use");
assert.equal(sent[2]?.content[0]?.type, "tool_result");
// Images go inline as base64 image blocks in the user message.
const lastUser = sent[sent.length - 1];
assert.equal(lastUser?.role, "user");
assert.deepEqual(
  lastUser?.content.find((block) => block.type === "image")?.source,
  {
    data: Buffer.from(pngPixel).toString("base64"),
    media_type: "image/png",
    type: "base64",
  },
);

console.log("ok - model provider");

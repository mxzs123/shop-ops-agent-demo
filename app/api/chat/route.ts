import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FileUIPart,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { AdminApiError } from "../../../src/admin-client";
import {
  createGoodsBatchCreatePlan,
  createGoodsBatchDeletePlan,
  createGoodsBatchEditPlan,
  createGoodsFilterEditPlan,
  getEditableGoods,
  searchGoods,
} from "../../../src/goods-tools";
import { executeGoodsPreviewWithAudit } from "../../../src/goods-tool-runner";
import { getAgentRuntime } from "../../../src/runtime";
import {
  createChatModel,
  IMAGE_MEDIA_TYPES,
  MODEL_ID,
  MODEL_LABEL,
} from "../../../src/model-provider";
import { hasExplicitConfirmation } from "../../../src/confirmation";
import { compactMessagesForModelRequest } from "../../../src/message-context";
import { isOriginAllowed } from "../../../src/origin-guard";
import {
  isRecord,
  readToolName,
  readToolPartOutput,
} from "../../../src/part-utils";
import type { AdminAuth, GoodsBatchEditExecution } from "../../../src/types";

export const maxDuration = 300;

const { adminClient, auditLog, config } = getAgentRuntime();
const STREAM_CHUNK_GRAPHEMES = 4;
const EXECUTE_TOOL_NAME = "goods_execute";
// Plan tools whose outputs carry a previewId. Includes legacy tool names so
// confirmations in restored sessions can still resolve their preview.
const PLAN_TOOL_NAMES = [
  "goods_plan_edit",
  "goods_plan_create",
  "goods_plan_delete",
  "goods_plan_filter_edit",
  "goods_plan_batch_edit",
  "goods_plan_batch_create",
];

const idSchema = z
  .union([z.string().min(1), z.number()])
  .describe("商品 ID。検索結果のものを使えます。");

const goodsPatchSchema = z
  .object({
    bn: z.string().optional().describe("商品コード。"),
    brief: z.string().optional().describe("商品の概要。"),
    goodsCategoryId: z.number().optional().describe("カテゴリ ID。"),
    image: z
      .string()
      .optional()
      .describe("メイン画像。アップロード済みリソースの /upload/... パスか完全な URL を指定します。"),
    images: z
      .string()
      .optional()
      .describe(
        "商品画像の一覧。複数の画像は半角カンマで区切り、並び順がそのままストアでの表示順になります。順番を変えるときは、並べ替えた完全なリストを渡します。",
      ),
    isFree: z.boolean().optional().describe("送料無料かどうか。"),
    isHot: z.boolean().optional().describe("人気商品かどうか。"),
    isMarketable: z.boolean().optional().describe("公開中かどうか。"),
    isPrescription: z.boolean().optional().describe("処方薬かどうか。"),
    isRecommend: z.boolean().optional().describe("おすすめかどうか。"),
    manufacturer: z.string().optional().describe("メーカー。"),
    mktprice: z.number().optional().describe("希望小売価格。"),
    name: z.string().optional().describe("商品名。"),
    packaging: z.string().optional().describe("包装単位。"),
    price: z.number().optional().describe("販売価格。"),
    sort: z.number().optional().describe("並び順の値。"),
    stock: z.number().optional().describe("在庫数。"),
    unit: z.string().optional().describe("単位。"),
    video: z
      .string()
      .optional()
      .describe("動画リソース。アップロード済みリソースの /upload/... パスか完全な URL を指定します。"),
    weight: z.number().optional().describe("重量。"),
  })
  .strict()
  .describe("変更する商品の項目。ユーザーが明確に変更を求めた項目だけを指定します。");

const goodsSearchSelectorSchema = z
  .object({
    goodsCategoryId: z.number().optional(),
    isMarketable: z.boolean().optional(),
    query: z
      .string()
      .optional()
      .describe("商品名のキーワード。キーワードがなければ空文字列で構いません。"),
  })
  .strict()
  .describe("一括編集の絞り込み条件。空のオブジェクトは現在のすべての商品を表します。");

const goodsCreateInputSchema = goodsPatchSchema
  .extend({
    bn: z.string().min(1).describe("商品コード。"),
    goodsCategoryId: z.number().int().positive().describe("カテゴリ ID。"),
    image: z
      .string()
      .min(1)
      .describe(
        "メイン画像。アップロード済みリソースの /upload/... パスか完全な URL を必ず指定します。",
      ),
    name: z.string().min(1).describe("商品名。"),
    price: z.number().min(0).describe("販売価格。"),
    stock: z.number().int().min(0).describe("在庫数。"),
    weight: z.number().positive().describe("重量（グラム）。"),
  })
  .strict()
  .describe("商品登録に必要な項目。現在は単一 SKU の既定品目を作成します。");

interface ConfirmationContext {
  executeToolName?: string;
  previewId?: string;
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request, config.allowedOrigins)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストボディは JSON である必要があります。" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return Response.json({ error: "リクエストボディはオブジェクトである必要があります。" }, { status: 400 });
  }

  const requestApiKey =
    typeof body.apiKey === "string" ? body.apiKey : undefined;
  const messages = body.messages;
  const apiKey =
    requestApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      {
        error: `${MODEL_LABEL} の API キーがありません。サイドバーの設定で入力するか、ローカルの環境変数に設定してください。`,
      },
      { status: 401 },
    );
  }

  if (!Array.isArray(messages)) {
    return Response.json({ error: "messages は配列である必要があります。" }, { status: 400 });
  }

  const confirmation = parseConfirmationContext(body.confirmation);
  let modelMessages: UIMessage[];
  try {
    modelMessages = prepareMessagesForModel(messages);
  } catch (error) {
    if (error instanceof AdminApiError) {
      return Response.json(
        { details: error.details, error: error.message },
        { status: error.status },
      );
    }

    throw error;
  }
  const auth: AdminAuth = {
    authorization:
      request.headers.get("authorization") ??
      config.adminAuthorization ??
      undefined,
  };
  const latestUserText = getLatestUserText(modelMessages);
  const toolContext = { adminClient, auditLog, auth, config };

  const runExecute = (inputPreviewId: string | undefined) =>
    safeToolResult(async () => {
      assertLatestUserConfirmed(
        latestUserText,
        "ユーザーは最新のメッセージで実行をまだ明確に確認していません。先にプレビューを示し、確認を待ってください。",
      );
      assertConfirmationMatchesExecuteTool(confirmation);

      const previewId = resolveExecutionPreviewId({
        confirmation,
        inputPreviewId,
        messages,
      });
      if (!previewId) {
        throw new AdminApiError(
          "確認できるプレビューが見つかりません。先にプレビューを作成してから確認してください。",
          400,
        );
      }

      return executeGoodsPreviewWithAudit(toolContext, {
        confirm: true,
        previewId,
      });
    });

  // The confirm button already names the preview, so execution is fully
  // determined: run it directly instead of asking the model to call the tool.
  if (confirmation?.previewId) {
    return createDirectExecutionResponse(
      confirmation.previewId,
      runExecute,
    );
  }

  const tools = {
    goods_search: tool({
      description:
        "商品一覧を検索します。ユーザーが商品を探したい・絞り込みたいとき、または商品 ID が必要なときに呼び出します。商品名のキーワード、カテゴリ ID、公開状態で絞り込み、ページ単位で返します（limit は最大 200）。各行には ID、商品名、商品コード、価格、在庫、公開状態が含まれます。範囲を指定した一括変更では、これでページをめくって ID を列挙せず、goods_plan_filter_edit を使ってください。",
      inputSchema: z.object({
        goodsCategoryId: z.number().optional(),
        isMarketable: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(20),
        page: z.number().int().min(1).default(1),
        query: z
          .string()
          .optional()
          .describe("商品名のキーワード。キーワードがなければ空文字列で構いません。"),
      }),
      execute: async (input) =>
        safeToolResult(() => searchGoods(adminClient, auth, input)),
    }),
    goods_get_editable: tool({
      description:
        "1 件の商品について、編集できる項目の現在値（価格、在庫、画像、公開状態など）をすべて読み取ります。ユーザーが商品の詳細を見たいとき、または変更後の値が現在値に依存するとき（「価格を 10% 上げる」「画像一覧の末尾に 1 枚追加する」など）に呼び出します。plan ツールは現在の状態を自分で読み取って差分を作るので、新しい値を直接指定する変更では、先にこのツールを呼ぶ必要はありません。",
      inputSchema: z.object({
        id: idSchema,
      }),
      execute: async (input) =>
        safeToolResult(() => getEditableGoods(adminClient, auth, input)),
    }),
    goods_plan_edit: tool({
      description:
        "商品編集のプレビューを作成し、previewId を返します。ID が分かっている商品の変更は、1 件でも複数でも、必ず先にこのツールを呼び出します。複数の商品は 1 回の呼び出しにまとめ、ユーザーが一度で確認できるようにします。",
      inputSchema: z.object({
        operations: z
          .array(z.object({ id: idSchema, patch: goodsPatchSchema }))
          .min(1)
          .max(1000),
      }),
      execute: async (input) =>
        safeToolResult(() =>
          createGoodsBatchEditPlan(adminClient, auth, input),
        ),
    }),
    goods_plan_filter_edit: tool({
      description:
        "絞り込み条件から範囲指定の一括編集プレビューを作成し、previewId を返します。ユーザーが「すべての商品」「公開中の商品すべて」「あるカテゴリの商品すべて」のように範囲で一括変更を求めたときに呼び出します。先にページをめくって商品 ID を列挙しないでください。",
      inputSchema: z.object({
        maxItems: z.number().int().min(1).max(5000).default(5000),
        patch: goodsPatchSchema,
        selector: goodsSearchSelectorSchema.default({}),
      }),
      execute: async (input) =>
        safeToolResult(() =>
          createGoodsFilterEditPlan(adminClient, auth, input),
        ),
    }),
    goods_plan_create: tool({
      description:
        "商品登録のプレビューを作成し、previewId を返します。新しい商品の登録は、1 件でも複数でも、必ず先にこのツールを呼び出します。各商品には商品名、商品コード、カテゴリ ID、メイン画像、販売価格、在庫、重量が必要です。",
      inputSchema: z.object({
        items: z.array(goodsCreateInputSchema).min(1).max(1000),
      }),
      execute: async (input) =>
        safeToolResult(() =>
          createGoodsBatchCreatePlan(adminClient, auth, input),
        ),
    }),
    goods_plan_delete: tool({
      description:
        "商品削除のプレビューを作成し、previewId を返します。商品の削除は、1 件でも複数でも、必ず先にこのツールを呼び出し、ユーザーに商品 ID、商品名、商品コードを確認してもらいます。",
      inputSchema: z.object({
        ids: z.array(idSchema).min(1).max(1000),
      }),
      execute: async (input) =>
        safeToolResult(() =>
          createGoodsBatchDeletePlan(adminClient, auth, input),
        ),
    }),
    goods_execute: tool({
      description:
        "作成済みのプレビュー（編集・登録・削除）を実行します。ユーザーが最新のメッセージで明確に確認したときだけ呼び出せます。plan ツールが返した previewId を渡し、商品データをコンテキストに書き写さないでください。",
      inputSchema: z.object({
        previewId: z
          .string()
          .optional()
          .describe("plan ツールが返した previewId。"),
      }),
      execute: async (input) => runExecute(input.previewId),
    }),
  };

  const result = streamText({
    maxRetries: 1,
    messages: await convertToModelMessages(modelMessages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    model: createChatModel(apiKey),
    experimental_transform: smoothStream({
      chunking: detectReadableStreamChunk,
      delayInMs: 18,
    }),
    stopWhen: stepCountIs(6),
    system: [
      "あなたは Admin Agent です。小さなお店の商品運営を手伝うアシスタントです（デモ環境で、商品データはすべて架空です）。",
      `現在のツールのバックエンド: ${config.backend}。商品の検索・プレビュー・実行は、提供されたツールを通じてのみ行えます。`,
      "書き込みはすべて 2 段階です。まず plan ツールでプレビューを作成します（goods_plan_edit は編集、goods_plan_create は登録、goods_plan_delete は削除、goods_plan_filter_edit は範囲指定の一括編集）。プレビューは previewId を返します。ユーザーが最新のメッセージで明確に確認したら、その previewId を渡して goods_execute を呼び出し、実行します。",
      "複数の商品を変更・登録・削除するときは、すべての対象を 1 回の plan 呼び出しにまとめて 1 つのプレビューを作り、ユーザーが一度で確認できるようにします。プレビューを何度にも分けたり、大量の商品データをコンテキストに書き写したりしないでください。",
      "ユーザーが範囲で一括変更を求めたとき（すべての商品、公開中の商品すべて、あるカテゴリの商品すべて、など）は、必ず goods_plan_filter_edit を呼び出します。goods_search をページごとに呼んだり、大量の ID を自分で列挙したりしないでください。",
      "商品登録で商品名、商品コード、カテゴリ ID、メイン画像、価格、在庫、重量のいずれかが足りないときは、先にユーザーに尋ねます。現在は単一 SKU の既定品目を作成します。",
      "一括実行は成功・スキップ・失敗の件数を返します。一部が失敗したときは全体をやり直さず、まず失敗の件数と理由を伝え、失敗した分だけ再実行することを提案します。",
      "ユーザーがアップロードした画像はメッセージに直接添付され、あなたは画像の内容を見ることができます。アップロード先のパスも添えられます。画像の項目も編集できます。image はメイン画像、images は画像一覧で、複数の画像は半角カンマで区切り、並び順がそのまま表示順になります。メイン画像の差し替えや順番の変更では、変更の全体をプレビューに反映させてください。ユーザーが提供したもの、または商品にすでにあるアップロードパス・リソース URL だけを使い、画像のアドレスを作り出さないでください。",
      "商品の候補、項目の差分、実行結果は、ツールのカードが画面に表示します。本文で Markdown の表を繰り返さず、一文の要約と次に確認したいことだけを書いてください。",
      "ユーザーが「確認して実行」とだけ言ったときは、直近のプレビューの previewId で goods_execute を呼び出し、ツールの結果が返ってから実行結果を普通に伝えます。",
      "goods_execute を呼び出すのは、ユーザーが最新のメッセージで明確に確認したとき（「確認」「実行して」「はい」「お願いします」「OK」「問題ありません」など）だけです。同じメッセージに取り消し・保留・ためらいの意味（「まだ実行しないで」「ちょっと待って」「キャンセル」「やっぱりやめる」など）が含まれていれば未確認として扱い、先に意図を確かめます。サーバー側でも同じ規則で再度検証します。",
      "実行が失敗した、またはブロックされたときは、理由をはっきり伝え、次にできることを示します。",
      "過去のターンのツール結果は、履歴を短く保つために先頭の数件だけに省略されていることがあります。件数の合計は正しいので、省略を理由に以前の回答を訂正しないでください。全件が必要なときは検索し直します。",
      "回答は日本語で、簡潔かつ率直に、業務のやり取りらしい口調で書きます。",
    ].join("\n"),
    tools,
    onFinish: ({ steps, totalUsage }) => {
      console.info("[admin-agent] usage", {
        model: MODEL_ID,
        steps: steps.length,
        usage: totalUsage,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}

type ToolResult<T> = { data?: T; error?: string; ok: boolean; status?: number };

function createDirectExecutionResponse(
  previewId: string,
  runExecute: (
    previewId: string,
  ) => Promise<ToolResult<GoodsBatchEditExecution>>,
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const toolCallId = `direct-execute-${crypto.randomUUID()}`;
      const textId = `${toolCallId}-summary`;

      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({
        input: { previewId },
        toolCallId,
        toolName: EXECUTE_TOOL_NAME,
        type: "tool-input-available",
      });

      const output = await runExecute(previewId);
      writer.write({ output, toolCallId, type: "tool-output-available" });
      writer.write({ type: "finish-step" });

      writer.write({ type: "start-step" });
      writer.write({ id: textId, type: "text-start" });
      writer.write({
        delta: summarizeExecution(output),
        id: textId,
        type: "text-delta",
      });
      writer.write({ id: textId, type: "text-end" });
      writer.write({ type: "finish-step" });
      writer.write({ finishReason: "stop", type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function summarizeExecution(
  output: ToolResult<GoodsBatchEditExecution>,
): string {
  if (!output.ok || !output.data) {
    const reason = output.error?.trim() || "ツールの呼び出しに失敗しました";
    return `実行は完了しませんでした：${/[。.！!？?]$/u.test(reason) ? reason : `${reason}。`}`;
  }

  const { failureCount = 0, skippedCount = 0, successCount } = output.data;
  const parts = [`実行しました：成功 ${successCount} 件`];
  if (skippedCount > 0) {
    parts.push(`スキップ ${skippedCount} 件`);
  }
  if (failureCount > 0) {
    parts.push(`失敗 ${failureCount} 件`);
  }

  const summary = `${parts.join("、")}。`;
  return failureCount > 0
    ? `${summary}失敗の理由は上の結果をご覧ください。必要であれば、失敗した分だけ再実行できます。`
    : summary;
}

async function safeToolResult<T>(
  run: () => Promise<T>,
): Promise<ToolResult<T>> {
  try {
    return { data: await run(), ok: true };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return {
        error: error.message,
        ok: false,
        status: error.status,
      };
    }

    console.error(error);
    return {
      error: error instanceof Error ? error.message : "ツールの呼び出しに失敗しました。",
      ok: false,
    };
  }
}

// History is trimmed and compacted before each request, and Claude rejects
// thinking blocks replayed on top of an edited history, so earlier turns are
// sent without their reasoning parts.
function prepareMessagesForModel(messages: UIMessage[]): UIMessage[] {
  return compactMessagesForModelRequest(messages).map((message) => {
    if (message.role !== "user") {
      return {
        ...message,
        parts: message.parts.filter((part) => part.type !== "reasoning"),
      };
    }

    return {
      ...message,
      parts: message.parts.flatMap((part) =>
        part.type === "file" ? prepareFilePart(part) : [part],
      ),
    };
  });
}

// The model sees supported images inline (as data URLs; upload preview URLs
// are not publicly reachable) and always gets the upload path as text so it
// can write it into image/images.
function prepareFilePart(part: FileUIPart): UIMessage["parts"] {
  const description = { text: describeFilePart(part), type: "text" as const };
  const mediaType = part.mediaType.toLowerCase();
  if (
    !IMAGE_MEDIA_TYPES.has(mediaType) ||
    !part.url.startsWith("data:")
  ) {
    return [description];
  }

  return [
    description,
    {
      filename: part.filename,
      mediaType,
      type: "file",
      url: part.url,
    },
  ];
}

function describeFilePart(part: FileUIPart): string {
  const filename =
    typeof part.filename === "string" && part.filename.trim()
      ? part.filename
      : "画像の添付";
  const mediaType = part.mediaType;
  const providerMetadata = part.providerMetadata;
  const metadata = isRecord(providerMetadata)
    ? providerMetadata["admin-agent"]
    : undefined;
  const uploadedPath =
    isRecord(metadata) && typeof metadata.uploadedPath === "string"
      ? metadata.uploadedPath
      : "";
  const uploadedUrl =
    isRecord(metadata) && typeof metadata.uploadedUrl === "string"
      ? metadata.uploadedUrl
      : "";

  if (!uploadedPath) {
    throw new AdminApiError(
      "画像のアップロードが完了していないため、モデルに送信できません。",
      400,
      {
        filename,
        mediaType,
      },
    );
  }

  return [
    `ユーザーが画像を添付しました：${filename} (${mediaType})。`,
    `商品編集ツールで使えるアップロードパス：${uploadedPath}。`,
    uploadedUrl ? `プレビュー URL：${uploadedUrl}。` : "",
    "ユーザーがメイン画像の設定を求めたら、このパスを image に使います。画像一覧への追加や順番の変更を求めたら、並べ替えた完全なリストを images に使います。",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseConfirmationContext(value: unknown): ConfirmationContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const previewId =
    typeof value.previewId === "string" && value.previewId.trim()
      ? value.previewId.trim()
      : undefined;
  const executeToolName =
    typeof value.executeToolName === "string" && value.executeToolName.trim()
      ? value.executeToolName.trim()
      : undefined;
  return previewId ? { executeToolName, previewId } : undefined;
}

function assertConfirmationMatchesExecuteTool(
  confirmation: ConfirmationContext | undefined,
): void {
  if (
    confirmation?.executeToolName &&
    confirmation.executeToolName !== EXECUTE_TOOL_NAME
  ) {
    throw new AdminApiError("確認ボタンに紐づくプレビューの種類が、実行ツールと一致しません。", 400, {
      expected: confirmation.executeToolName,
      received: EXECUTE_TOOL_NAME,
    });
  }
}

function getLatestUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    }
  }

  return "";
}

function assertLatestUserConfirmed(text: string, message: string): void {
  if (!hasExplicitConfirmation(text)) {
    throw new AdminApiError(message, 400);
  }
}

function resolveExecutionPreviewId({
  confirmation,
  inputPreviewId,
  messages,
}: {
  confirmation: ConfirmationContext | undefined;
  inputPreviewId?: string;
  messages: UIMessage[];
}): string | undefined {
  const normalizedInputPreviewId =
    typeof inputPreviewId === "string" && inputPreviewId.trim()
      ? inputPreviewId.trim()
      : undefined;

  return (
    normalizedInputPreviewId ??
    confirmation?.previewId ??
    findLatestPreviewId(messages, PLAN_TOOL_NAMES)
  );
}

function findLatestPreviewId(
  messages: UIMessage[],
  toolNames: string[],
): string | undefined {
  const allowedToolNames = new Set(toolNames);
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      const toolName = part ? readToolName(part) : undefined;
      if (!part || !toolName || !allowedToolNames.has(toolName)) {
        continue;
      }

      const output = readToolPartOutput(part);
      const data =
        isRecord(output) && isRecord(output.data) ? output.data : undefined;
      const previewId =
        data && typeof data.previewId === "string" ? data.previewId : "";
      if (previewId) {
        return previewId;
      }
    }
  }

  return undefined;
}

function detectReadableStreamChunk(buffer: string): string | undefined | null {
  if (!buffer) {
    return null;
  }

  const punctuationMatch = /[\n。！？!?；;：:，,、]\s*/u.exec(buffer);
  if (punctuationMatch) {
    return buffer.slice(0, punctuationMatch.index + punctuationMatch[0].length);
  }

  const wordMatch = /^\S+\s+/u.exec(buffer);
  if (wordMatch && wordMatch[0].length >= STREAM_CHUNK_GRAPHEMES) {
    return wordMatch[0];
  }

  const graphemes = Array.from(buffer);
  if (graphemes.length >= STREAM_CHUNK_GRAPHEMES) {
    return graphemes.slice(0, STREAM_CHUNK_GRAPHEMES).join("");
  }

  return null;
}

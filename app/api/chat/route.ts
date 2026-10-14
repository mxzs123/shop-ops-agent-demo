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
  .describe("商品 ID，可以来自检索结果。");

const goodsPatchSchema = z
  .object({
    bn: z.string().optional().describe("商品编码。"),
    brief: z.string().optional().describe("商品简介。"),
    goodsCategoryId: z.number().optional().describe("商品分类 ID。"),
    image: z
      .string()
      .optional()
      .describe("封面图。使用已上传资源的 /upload/... 路径或完整资源 URL。"),
    images: z
      .string()
      .optional()
      .describe(
        "商品图集。多个图片用英文逗号分隔，顺序就是前台展示顺序；调整顺序时传完整有序列表。",
      ),
    isFree: z.boolean().optional().describe("是否包邮。"),
    isHot: z.boolean().optional().describe("是否热门。"),
    isMarketable: z.boolean().optional().describe("是否上架。"),
    isPrescription: z.boolean().optional().describe("是否处方药。"),
    isRecommend: z.boolean().optional().describe("是否推荐。"),
    manufacturer: z.string().optional().describe("制造商。"),
    mktprice: z.number().optional().describe("市场价。"),
    name: z.string().optional().describe("商品名称。"),
    packaging: z.string().optional().describe("包装单位。"),
    price: z.number().optional().describe("销售价。"),
    sort: z.number().optional().describe("排序值。"),
    stock: z.number().optional().describe("库存。"),
    unit: z.string().optional().describe("单位。"),
    video: z
      .string()
      .optional()
      .describe("视频资源。使用已上传资源的 /upload/... 路径或完整资源 URL。"),
    weight: z.number().optional().describe("重量。"),
  })
  .strict()
  .describe("要修改的商品字段。只填写用户明确要求变更的字段。");

const goodsSearchSelectorSchema = z
  .object({
    goodsCategoryId: z.number().optional(),
    isMarketable: z.boolean().optional(),
    query: z
      .string()
      .optional()
      .describe("商品名称关键词。没有关键词时可以为空字符串。"),
  })
  .strict()
  .describe("批量编辑筛选条件。空对象表示当前所有商品。");

const goodsCreateInputSchema = goodsPatchSchema
  .extend({
    bn: z.string().min(1).describe("商品编码。"),
    goodsCategoryId: z.number().int().positive().describe("商品分类 ID。"),
    image: z
      .string()
      .min(1)
      .describe(
        "封面图。必须使用已上传资源的 /upload/... 路径或完整资源 URL。",
      ),
    name: z.string().min(1).describe("商品名称。"),
    price: z.number().min(0).describe("销售价。"),
    stock: z.number().int().min(0).describe("库存。"),
    weight: z.number().positive().describe("重量，单位克。"),
  })
  .strict()
  .describe("录入商品所需字段。目前创建单 SKU 默认货品。");

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
    return Response.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return Response.json({ error: "请求体必须是对象。" }, { status: 400 });
  }

  const requestApiKey =
    typeof body.apiKey === "string" ? body.apiKey : undefined;
  const messages = body.messages;
  const apiKey =
    requestApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      {
        error: `缺少 ${MODEL_LABEL} API Key。请在侧边栏设置中填写，或在本地环境变量中设置。`,
      },
      { status: 401 },
    );
  }

  if (!Array.isArray(messages)) {
    return Response.json({ error: "messages 必须是数组。" }, { status: 400 });
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
        "用户还没有在最新消息里明确确认执行。请先输出预览并等待确认。",
      );
      assertConfirmationMatchesExecuteTool(confirmation);

      const previewId = resolveExecutionPreviewId({
        confirmation,
        inputPreviewId,
        messages,
      });
      if (!previewId) {
        throw new AdminApiError(
          "没有找到可确认的预览。请先生成预览，再确认执行。",
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
        "检索商品列表。用户要查找、搜索、筛选商品，或需要拿到商品 ID 时调用。按名称关键词、分类 ID、上下架状态筛选，分页返回（limit 最大 200），每条包含 ID、名称、编码、价格、库存、上下架状态。范围型批量修改不要用它逐页枚举 ID，改用 goods_plan_filter_edit。",
      inputSchema: z.object({
        goodsCategoryId: z.number().optional(),
        isMarketable: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(20),
        page: z.number().int().min(1).default(1),
        query: z
          .string()
          .optional()
          .describe("商品名称关键词。没有关键词时可以为空字符串。"),
      }),
      execute: async (input) =>
        safeToolResult(() => searchGoods(adminClient, auth, input)),
    }),
    goods_get_editable: tool({
      description:
        "读取单个商品当前的完整可编辑字段（价格、库存、图片、上下架等）。用户要查看某个商品详情，或修改值依赖当前值（如“价格上调 10%”“在图集末尾追加一张”）时调用。plan 工具会自行读取当前状态并生成对比，直接指定新值的修改不需要先调用本工具。",
      inputSchema: z.object({
        id: idSchema,
      }),
      execute: async (input) =>
        safeToolResult(() => getEditableGoods(adminClient, auth, input)),
    }),
    goods_plan_edit: tool({
      description:
        "生成商品编辑预览，返回 previewId。任何已知 ID 的商品修改（单个或多个）都必须先调用这个工具；多个商品放进同一次调用，让用户一次确认。",
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
        "按筛选条件生成范围批量编辑预览，返回 previewId。用户说“所有商品”“全部上架商品”“某分类全部商品”等范围型批量修改时调用，不要先逐页枚举商品 ID。",
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
        "生成商品录入预览，返回 previewId。录入新商品（单个或多个）必须先调用这个工具；每个商品需要名称、编码、分类 ID、封面图、销售价、库存和重量。",
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
        "生成商品删除预览，返回 previewId。删除商品（单个或多个）必须先调用这个工具，让用户确认商品 ID、名称和编码。",
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
        "确认执行已生成的预览（编辑、录入或删除）。只有用户最新消息明确确认时才能调用；传入 plan 工具返回的 previewId，不要把商品数据复制回上下文。",
      inputSchema: z.object({
        previewId: z
          .string()
          .optional()
          .describe("plan 工具返回的 previewId。"),
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
      "你是 Admin Agent，一家小型店铺的商品运营助手（演示环境，商品数据均为虚构）。",
      `当前工具后端: ${config.backend}。你只能通过提供的工具检索、预览、执行商品操作。`,
      "所有写操作都是两步：先调用 plan 工具生成预览（goods_plan_edit 编辑、goods_plan_create 录入、goods_plan_delete 删除、goods_plan_filter_edit 范围批量编辑），预览会返回 previewId；用户在最新消息明确确认后，调用 goods_execute 并传入该 previewId 执行。",
      "修改、录入或删除多个商品时，把全部目标放进同一次 plan 调用生成一个合并预览，让用户一次确认；不要拆成多次预览，也不要把大量商品数据复制回上下文。",
      "用户要求范围型批量修改（例如所有商品、全部上架商品、某分类全部商品）时，必须调用 goods_plan_filter_edit，不要逐页调用 goods_search，也不要自己枚举大量 ID。",
      "录入商品缺少名称、编码、分类 ID、封面图、价格、库存或重量时先向用户索取；当前创建单 SKU 默认货品。",
      "批量执行会返回成功、跳过、失败数量。出现部分失败时不要重试整批，先说明失败数量与原因，并建议用户只重试失败项。",
      "用户上传的图片会直接附在消息里，你可以看到图片内容，并附有上传路径。图片字段也可以编辑：image 是封面图；images 是图集，多个图片用英文逗号分隔且顺序就是展示顺序；更换封面或调整顺序时必须在预览里体现完整变化。只使用用户提供或当前商品已有的上传路径/资源 URL，不要编造图片地址。",
      "商品候选、字段对比、执行结果会由工具卡在界面展示；正文不要重复输出 Markdown 表格，只做一句话摘要和下一步问题。",
      "当用户只说“确认执行”时，找到最近一条预览的 previewId 调用 goods_execute，并在工具返回后正常回复执行结果。",
      "只有用户在最新消息中明确确认（如“确认”“确定”“执行”“可以”“好的”“没问题”“同意”）时才调用 goods_execute。同一条消息里如果带有取消、暂缓或犹豫的意思（如“先别执行”“等一下”“取消”“不确定”），视为未确认，先问清楚；服务端会按同样规则再校验。",
      "执行失败或被阻止时，要把原因说清楚，并给出下一步。",
      "回答使用中文，简洁、直接、偏工作流口吻。",
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
    const reason = output.error?.trim() || "工具调用失败";
    return `执行未完成：${/[。.！!？?]$/u.test(reason) ? reason : `${reason}。`}`;
  }

  const { failureCount = 0, skippedCount = 0, successCount } = output.data;
  const parts = [`已执行：成功 ${successCount} 项`];
  if (skippedCount > 0) {
    parts.push(`跳过 ${skippedCount} 项`);
  }
  if (failureCount > 0) {
    parts.push(`失败 ${failureCount} 项`);
  }

  const summary = `${parts.join("，")}。`;
  return failureCount > 0
    ? `${summary}失败原因见上方结果，需要的话可以只重试失败项。`
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
      error: error instanceof Error ? error.message : "工具调用失败。",
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
      : "图片附件";
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
      "图片附件尚未上传成功，不能发送给模型。",
      400,
      {
        filename,
        mediaType,
      },
    );
  }

  return [
    `用户上传了图片附件：${filename} (${mediaType})。`,
    `可用于商品编辑工具的上传路径：${uploadedPath}。`,
    uploadedUrl ? `预览 URL：${uploadedUrl}。` : "",
    "如果用户要求设置封面图，请把该路径用于 image；如果用户要求加入图集或调整顺序，请把完整有序列表用于 images。",
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
    throw new AdminApiError("确认按钮绑定的预览类型与执行工具不一致。", 400, {
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

import { NextResponse } from "next/server";

import { AdminApiError } from "../../../../src/admin-client";
import { runGoodsTool } from "../../../../src/goods-tool-runner";
import { isOriginAllowed } from "../../../../src/origin-guard";
import { getAgentRuntime } from "../../../../src/runtime";
import type { AdminAuth } from "../../../../src/types";

const { adminClient, auditLog, config } = getAgentRuntime();

export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ tool: string }> },
) {
  const { tool } = await context.params;
  if (tool === "_warmup") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Method Not Allowed", ok: false },
    { status: 405 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> },
) {
  const { tool } = await context.params;
  const originError = rejectDisallowedOrigin(request);
  if (originError) {
    return originError;
  }
  const body = (await request.json().catch(() => ({}))) as unknown;
  const auth: AdminAuth = {
    authorization:
      request.headers.get("authorization") ??
      config.adminAuthorization ??
      undefined,
  };

  try {
    if (
      isExecuteTool(tool) &&
      config.backend !== "fixture" &&
      request.headers.get("x-admin-agent-direct-execute") !== "confirmed"
    ) {
      throw new AdminApiError(
        "ツールを直接呼ぶエンドポイントから shadow Admin への書き込みはできません。チャットで確認して実行するか、テスト用の fixture バックエンドでのみ呼び出してください。",
        403,
      );
    }

    const result = await runGoodsTool(
      { adminClient, auditLog, auth, config },
      tool,
      body,
    );
    return NextResponse.json({ data: result, ok: true });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json(
        { details: error.details, error: error.message, ok: false },
        { status: error.status },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Internal Server Error", ok: false },
      { status: 500 },
    );
  }
}

function isExecuteTool(tool: string): boolean {
  return tool.startsWith("goods.execute");
}

function rejectDisallowedOrigin(request: Request): NextResponse | undefined {
  if (isOriginAllowed(request, config.allowedOrigins)) {
    return undefined;
  }

  return NextResponse.json(
    { error: "Origin not allowed", ok: false },
    { status: 403 },
  );
}

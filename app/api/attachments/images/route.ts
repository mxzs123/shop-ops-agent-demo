import { NextResponse } from "next/server";

import { AdminApiError, AdminClient } from "../../../../src/admin-client";
import { assertWritesAllowed } from "../../../../src/goods-tool-runner";
import { isRecord } from "../../../../src/part-utils";
import { getAgentRuntime } from "../../../../src/runtime";
import type { AdminAuth } from "../../../../src/types";

const { adminClient, config } = getAgentRuntime();
const MAX_IMAGE_FILES = 8;

interface UploadedImage {
  filename: string;
  mediaType: string;
  path: string;
  size: number;
  url: string;
}

interface UploadResponsePayload {
  code: number;
  data?: unknown;
  msg?: string;
  status: boolean;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const entries = formData.getAll("files");

    if (entries.length === 0) {
      throw new AdminApiError("画像ファイルを選択してください", 400);
    }
    if (entries.length > MAX_IMAGE_FILES) {
      throw new AdminApiError(`一度にアップロードできる画像は最大 ${MAX_IMAGE_FILES} 枚です`, 400);
    }

    const files = entries.map((value, index) => {
      if (!(value instanceof File)) {
        throw new AdminApiError(`${index + 1} 番目の添付はファイルではありません`, 400);
      }
      if (!isImageFile(value)) {
        throw new AdminApiError(`${index + 1} 番目の添付は image/* の画像ではありません`, 400);
      }

      return value;
    });

    const data =
      config.backend === "fixture"
        ? createFixtureUploads(files)
        : await uploadToShadowAdmin(request, files);

    return NextResponse.json({ data, ok: true });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json(
        { details: error.details, error: error.message, ok: false },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "画像のアップロードに失敗しました",
        ok: false,
      },
      { status: 500 },
    );
  }
}

async function uploadToShadowAdmin(
  request: Request,
  files: File[],
): Promise<UploadedImage[]> {
  assertWritesAllowed(config);

  const auth: AdminAuth = {
    authorization:
      request.headers.get("authorization") ??
      config.adminAuthorization ??
      undefined,
  };
  if (!(adminClient instanceof AdminClient)) {
    throw new AdminApiError("Shadow Admin のアップロード転送の設定が正しくありません", 500);
  }
  const authorization = await adminClient.resolveAuthorization(auth);
  if (!authorization) {
    throw new AdminApiError("Shadow Admin の認証情報がないため、画像をアップロードできません", 401);
  }
  const endpoint = new URL("api/Common/UploadImages", config.webApiBaseUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: authorization,
  };

  return Promise.all(
    files.map(async (file) => {
      const uploadFormData = new FormData();
      uploadFormData.set("file", file, file.name);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          body: uploadFormData,
          cache: "no-store",
          headers,
          method: "POST",
        });
      } catch (error) {
        throw new AdminApiError("Shadow WebAPI への画像アップロードに失敗しました", 502, {
          cause: error instanceof Error ? error.message : String(error),
          origin: endpoint.origin,
        });
      }

      const payload = parseUploadPayload(
        await response.text(),
        endpoint.pathname,
      );
      if (!response.ok) {
        throw new AdminApiError(
          `画像アップロード API が ${response.status} を返しました`,
          response.status,
          scrubUploadDetails(payload),
        );
      }

      if (payload.status !== true || payload.code !== 0) {
        throw new AdminApiError(payload.msg ?? "画像のアップロードに失敗しました", 502, {
          response: scrubUploadDetails(payload),
        });
      }

      const path = toUploadPath(readUploadFileUrl(payload.data));
      return {
        filename: file.name,
        mediaType: file.type,
        path,
        size: file.size,
        url: toPublicUploadUrl(path),
      };
    }),
  );
}

function createFixtureUploads(files: File[]): UploadedImage[] {
  const stamp = Date.now();

  return files.map((file, index) => {
    const filename = file.name;
    const path = `/upload/admin-agent-fixture/${stamp}-${index + 1}-${sanitizeFilename(filename)}`;

    return {
      filename,
      mediaType: file.type,
      path,
      size: file.size,
      url: toPublicUploadUrl(path),
    };
  });
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function parseUploadPayload(
  text: string,
  context: string,
): UploadResponsePayload {
  const normalized = text.replace(/^\ufeff/, "").trim();
  if (!normalized) {
    throw new AdminApiError(`${context} が空のレスポンスを返しました`, 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new AdminApiError(`${context} が JSON 以外のレスポンスを返しました`, 502, {
      cause: error instanceof Error ? error.message : String(error),
      chars: normalized.length,
    });
  }

  if (!isRecord(parsed)) {
    throw new AdminApiError(`${context} のレスポンスはオブジェクトである必要があります`, 502, {
      response: describeValueShape(parsed),
    });
  }
  if (typeof parsed.status !== "boolean" || typeof parsed.code !== "number") {
    throw new AdminApiError(`${context} のレスポンスに status/code がありません`, 502, {
      response: describeValueShape(parsed),
    });
  }

  return {
    code: parsed.code,
    data: parsed.data,
    msg: typeof parsed.msg === "string" ? parsed.msg : undefined,
    status: parsed.status,
  };
}

function readUploadFileUrl(data: unknown): string {
  if (!isRecord(data)) {
    throw new AdminApiError("画像アップロードのレスポンスの data はオブジェクトである必要があります", 502, {
      response: describeValueShape(data),
    });
  }

  if (typeof data.fileUrl !== "string" || data.fileUrl.trim().length === 0) {
    throw new AdminApiError("画像アップロードのレスポンスの data.fileUrl は空でない文字列である必要があります", 502, {
      response: describeValueShape(data),
    });
  }

  return data.fileUrl;
}

function toUploadPath(value: string): string {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const normalizedPath = normalizeUploadPath(url.pathname);
    if (normalizedPath) {
      return normalizedPath;
    }

    throw new AdminApiError("画像アップロードが /upload 以外のパスを返しました", 502, {
      value: trimmed,
    });
  }

  const normalizedPath = normalizeUploadPath(trimmed);
  if (normalizedPath) {
    return normalizedPath;
  }

  throw new AdminApiError("画像アップロードが /upload 以外のパスを返しました", 502, {
    value: trimmed,
  });
}

function normalizeUploadPath(path: string): string {
  const normalized = path.replace(/^\/+upload\//i, "/upload/");
  return normalized.startsWith("/upload/") ? normalized : "";
}

function toPublicUploadUrl(path: string) {
  return new URL(
    path.replace(/^\/+/, ""),
    config.adminPublicBaseUrl,
  ).toString();
}

function sanitizeFilename(filename: string) {
  return (
    filename
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image.jpg"
  );
}

function describeValueShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { length: value.length, type: "array" };
  }

  if (isRecord(value)) {
    return { keys: Object.keys(value).slice(0, 30), type: "object" };
  }

  return { type: typeof value };
}

function scrubUploadDetails(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = /authorization|token|password|secret/i.test(key)
      ? "[redacted]"
      : item;
  }

  return clone;
}

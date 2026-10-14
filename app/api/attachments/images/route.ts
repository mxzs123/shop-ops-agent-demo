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
      throw new AdminApiError("请选择图片文件", 400);
    }
    if (entries.length > MAX_IMAGE_FILES) {
      throw new AdminApiError(`一次最多上传 ${MAX_IMAGE_FILES} 张图片`, 400);
    }

    const files = entries.map((value, index) => {
      if (!(value instanceof File)) {
        throw new AdminApiError(`第 ${index + 1} 个附件不是文件`, 400);
      }
      if (!isImageFile(value)) {
        throw new AdminApiError(`第 ${index + 1} 个附件不是 image/* 图片`, 400);
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
        error: error instanceof Error ? error.message : "图片上传失败",
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
    throw new AdminApiError("Shadow Admin 上传传输配置错误", 500);
  }
  const authorization = await adminClient.resolveAuthorization(auth);
  if (!authorization) {
    throw new AdminApiError("缺少 Shadow Admin 鉴权，无法上传图片", 401);
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
        throw new AdminApiError("Shadow WebAPI 图片上传请求失败", 502, {
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
          `图片上传接口返回 ${response.status}`,
          response.status,
          scrubUploadDetails(payload),
        );
      }

      if (payload.status !== true || payload.code !== 0) {
        throw new AdminApiError(payload.msg ?? "图片上传失败", 502, {
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
    throw new AdminApiError(`${context} 返回空响应`, 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new AdminApiError(`${context} 返回了非 JSON 响应`, 502, {
      cause: error instanceof Error ? error.message : String(error),
      chars: normalized.length,
    });
  }

  if (!isRecord(parsed)) {
    throw new AdminApiError(`${context} 响应必须是对象`, 502, {
      response: describeValueShape(parsed),
    });
  }
  if (typeof parsed.status !== "boolean" || typeof parsed.code !== "number") {
    throw new AdminApiError(`${context} 响应缺少 status/code`, 502, {
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
    throw new AdminApiError("图片上传响应 data 必须是对象", 502, {
      response: describeValueShape(data),
    });
  }

  if (typeof data.fileUrl !== "string" || data.fileUrl.trim().length === 0) {
    throw new AdminApiError("图片上传响应 data.fileUrl 必须是非空字符串", 502, {
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

    throw new AdminApiError("图片上传返回了非 /upload 路径", 502, {
      value: trimmed,
    });
  }

  const normalizedPath = normalizeUploadPath(trimmed);
  if (normalizedPath) {
    return normalizedPath;
  }

  throw new AdminApiError("图片上传返回了非 /upload 路径", 502, {
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

import { isRecord } from "./part-utils";
import type { AdminAuth, AdminEnvelope, AdminTransport } from "./types";

interface AdminClientLoginOptions {
  password?: string;
  username?: string;
}

interface AdminClientOptions {
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = parseTimeout(
  process.env.ADMIN_AGENT_ADMIN_TIMEOUT_MS,
  20_000,
);

export class AdminApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.details = details;
  }
}

export class AdminClient implements AdminTransport {
  private readonly baseUrl: string;
  private readonly login?: Required<AdminClientLoginOptions>;
  private readonly timeoutMs: number;
  private cachedAuthorization?: string;
  private cachedAuthorizationExpiresAt = 0;
  private pendingLogin?: Promise<string | undefined>;

  constructor(
    baseUrl: string,
    login?: AdminClientLoginOptions,
    options?: AdminClientOptions,
  ) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (login?.username && login.password) {
      this.login = {
        password: login.password,
        username: login.username,
      };
    }
  }

  private async fetchWithTimeout(
    url: URL,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async post<T>(
    path: string,
    payload: unknown,
    auth: AdminAuth,
  ): Promise<AdminEnvelope<T>> {
    const url = new URL(path.replace(/^\/+/, ""), this.baseUrl);
    const isFormRequest = shouldPostForm(path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": isFormRequest
        ? "application/x-www-form-urlencoded; charset=UTF-8"
        : "application/json; charset=utf-8",
    };
    const authorization =
      auth.authorization ?? (await this.getConfiguredAuthorization());

    if (authorization) {
      headers.Authorization = authorization;
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        body:
          payload === undefined
            ? undefined
            : isFormRequest
              ? toFormBody(payload)
              : JSON.stringify(payload),
        headers,
        method: "POST",
      });
    } catch (error) {
      throw new AdminApiError(
        isAbortError(error)
          ? "Shadow Admin 请求超时，请确认本地 Admin 服务可用"
          : "Shadow Admin 请求失败，请确认本地 Admin 服务已启动",
        isAbortError(error) ? 504 : 502,
        {
          cause: error instanceof Error ? error.message : String(error),
          origin: url.origin,
        },
      );
    }

    const text = await response.text();
    const parsed = parseJson(text);

    if (!response.ok) {
      throw new AdminApiError(
        `Admin API request failed with ${response.status}`,
        response.status,
        scrubAdminDetails(parsed),
      );
    }

    if (!isRecord(parsed)) {
      throw new AdminApiError("Admin API returned a non-JSON response", 502);
    }

    return parsed as AdminEnvelope<T>;
  }

  async resolveAuthorization(auth: AdminAuth): Promise<string | undefined> {
    return auth.authorization ?? (await this.getConfiguredAuthorization());
  }

  private async getConfiguredAuthorization(): Promise<string | undefined> {
    if (!this.login) {
      return undefined;
    }

    const now = Date.now();
    if (
      this.cachedAuthorization &&
      this.cachedAuthorizationExpiresAt > now + 60_000
    ) {
      return this.cachedAuthorization;
    }

    // Single-flight: when several concurrent requests find the token missing or
    // near expiry, share one login round-trip instead of stampeding the Admin.
    if (this.pendingLogin) {
      return this.pendingLogin;
    }

    this.pendingLogin = this.requestAuthorization().finally(() => {
      this.pendingLogin = undefined;
    });

    return this.pendingLogin;
  }

  private async requestAuthorization(): Promise<string | undefined> {
    const now = Date.now();
    const url = new URL("api/login/getJwtToken", this.baseUrl);
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        body: JSON.stringify(this.login),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
    } catch (error) {
      throw new AdminApiError(
        isAbortError(error)
          ? "Shadow Admin 登录请求超时"
          : "Shadow Admin 登录失败",
        isAbortError(error) ? 504 : 502,
        {
          cause: error instanceof Error ? error.message : String(error),
          origin: url.origin,
        },
      );
    }

    const parsed = parseJson(await response.text());
    if (!response.ok || !isRecord(parsed) || parsed.code !== 0) {
      throw new AdminApiError("Shadow Admin 登录失败", response.status, {
        details: scrubAdminDetails(parsed),
      });
    }

    const tokenData = isRecord(parsed.data) ? parsed.data.token : undefined;
    if (!isRecord(tokenData) || typeof tokenData.token !== "string") {
      throw new AdminApiError("Shadow Admin 登录响应缺少 token", 502);
    }

    const expiresIn =
      typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    this.cachedAuthorization = `Bearer ${tokenData.token}`;
    this.cachedAuthorizationExpiresAt = now + expiresIn * 1000;

    return this.cachedAuthorization;
  }
}

function shouldPostForm(path: string): boolean {
  return /(^|\/)Api\/Goods\/GetPageList$/i.test(
    path.replace(/^\/+/, ""),
  );
}

function toFormBody(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
    } else {
      params.set(key, String(value));
    }
  }

  return params.toString();
}

function parseJson(text: string): unknown {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function scrubAdminDetails(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/authorization|token|password|secret/i.test(key)) {
      clone[key] = "[redacted]";
    } else {
      clone[key] = item;
    }
  }

  return clone;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function parseTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

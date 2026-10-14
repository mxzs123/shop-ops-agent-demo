import path from "node:path";

export interface AgentConfig {
  adminAuthorization?: string;
  adminBaseUrl: string;
  adminPassword?: string;
  adminPublicBaseUrl: string;
  adminUsername?: string;
  webApiBaseUrl: string;
  allowedOrigins: string[];
  auditLogPath: string;
  backend: "admin" | "fixture";
  fixturePath: string;
  host: string;
  port: number;
}

export function loadConfig(): AgentConfig {
  const port = parsePort(env("ADMIN_AGENT_PORT", "18083"));

  return {
    adminAuthorization:
      process.env.ADMIN_AGENT_ADMIN_AUTHORIZATION?.trim() || undefined,
    adminBaseUrl: normalizeBaseUrl(
      env("ADMIN_AGENT_ADMIN_BASE_URL", "http://127.0.0.1:18080/"),
    ),
    adminPassword: process.env.ADMIN_AGENT_ADMIN_PASSWORD?.trim() || undefined,
    adminPublicBaseUrl: normalizeBaseUrl(
      env(
        "ADMIN_AGENT_ADMIN_PUBLIC_BASE_URL",
        env(
          "PUBLIC_ADMIN_ORIGIN",
          env("ADMIN_AGENT_ADMIN_BASE_URL", "http://127.0.0.1:18080/"),
        ),
      ),
    ),
    adminUsername: process.env.ADMIN_AGENT_ADMIN_USERNAME?.trim() || undefined,
    allowedOrigins: parseAllowedOrigins(
      env(
        "ADMIN_AGENT_ALLOWED_ORIGINS",
        "http://127.0.0.1:18083,http://localhost:18083",
      ),
    ),
    auditLogPath: path.resolve(
      process.cwd(),
      env("ADMIN_AGENT_AUDIT_LOG", "logs/audit.jsonl"),
    ),
    backend: parseBackend(env("ADMIN_AGENT_BACKEND", "fixture")),
    fixturePath: path.resolve(
      process.cwd(),
      env("ADMIN_AGENT_FIXTURE_PATH", "fixtures/goods.example.json"),
    ),
    host: env("ADMIN_AGENT_HOST", "127.0.0.1"),
    port,
    webApiBaseUrl: normalizeBaseUrl(
      env("ADMIN_AGENT_WEBAPI_BASE_URL", "http://127.0.0.1:18081/"),
    ),
  };
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ADMIN_AGENT_PORT: ${value}`);
  }

  return port;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString();
}

function parseAllowedOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseBackend(value: string): AgentConfig["backend"] {
  if (value === "admin" || value === "fixture") {
    return value;
  }

  throw new Error(`Invalid ADMIN_AGENT_BACKEND: ${value}`);
}

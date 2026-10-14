import { AdminClient } from "./admin-client";
import { AuditLog } from "./audit-log";
import { loadConfig } from "./config";
import { FixtureAdminClient } from "./fixture-admin-client";
import type { AdminTransport } from "./types";

const config = loadConfig();
const adminClient: AdminTransport =
  config.backend === "fixture"
    ? new FixtureAdminClient(config.fixturePath)
    : new AdminClient(config.adminBaseUrl, {
        password: config.adminPassword,
        username: config.adminUsername,
      });
const auditLog = new AuditLog(config.auditLogPath);

export function getAgentRuntime() {
  return {
    adminClient,
    auditLog,
    config,
  };
}

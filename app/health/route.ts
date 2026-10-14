import { NextResponse } from "next/server";

import { loadConfig } from "../../src/config";
import { MODEL_LABEL } from "../../src/model-provider";

export function GET() {
  const config = loadConfig();
  return NextResponse.json({
    adminBaseUrl: config.adminBaseUrl,
    adminPublicBaseUrl: config.adminPublicBaseUrl,
    backend: config.backend,
    modelLabel: MODEL_LABEL,
    ok: true,
    service: "admin-agent",
    webApiBaseUrl: config.webApiBaseUrl,
  });
}

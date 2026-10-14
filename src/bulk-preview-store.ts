import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isRecord } from "./part-utils";
import type {
  EditChange,
  GoodsBatchExecutionFailure,
  GoodsEditExecution,
  GoodsPatch,
  ToolWarning,
} from "./types";

export interface StoredBulkEditOperation {
  expectedChanges: EditChange[];
  id: string | number;
  patch: GoodsPatch;
}

export interface StoredBulkCreateOperation {
  expectedChanges: EditChange[];
  input: GoodsPatch;
}

export interface StoredBulkDeleteOperation {
  expectedTarget: { bn?: string; id: string | number; name?: string };
  id: string | number;
}

export interface StoredBulkEditPreview {
  createdAt: number;
  expiresAt: number;
  kind: "goods.batchEdit";
  operations: StoredBulkEditOperation[];
  patch: GoodsPatch;
  selector: Record<string, unknown>;
  totalCount: number;
}

export interface StoredBulkCreatePreview {
  createdAt: number;
  expiresAt: number;
  kind: "goods.batchCreate";
  operations: StoredBulkCreateOperation[];
  totalCount: number;
}

export interface StoredBulkDeletePreview {
  createdAt: number;
  expiresAt: number;
  kind: "goods.batchDelete";
  operations: StoredBulkDeleteOperation[];
  totalCount: number;
}

export interface StoredBulkExecutionResult {
  adminMessage: string;
  createdAt: number;
  expiresAt: number;
  failureCount?: number;
  failures?: GoodsBatchExecutionFailure[];
  items: GoodsEditExecution[];
  kind: "goods.batchExecution";
  skippedCount?: number;
  successCount: number;
  totalCount?: number;
  warnings: ToolWarning[];
}

export type StoredBulkPreview =
  | StoredBulkCreatePreview
  | StoredBulkDeletePreview
  | StoredBulkEditPreview;

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const previews = new Map<string, StoredBulkPreview>();
const results = new Map<string, StoredBulkExecutionResult>();
const previewStoreDir =
  process.env.ADMIN_AGENT_BULK_PREVIEW_STORE_DIR ??
  path.join(process.cwd(), "logs", "bulk-previews");
const resultStoreDir =
  process.env.ADMIN_AGENT_BULK_RESULT_STORE_DIR ??
  path.join(process.cwd(), "logs", "bulk-results");

export async function saveBulkEditPreview(input: {
  operations: StoredBulkEditOperation[];
  patch: GoodsPatch;
  selector: Record<string, unknown>;
  totalCount: number;
}): Promise<{ expiresAt: string; previewId: string }> {
  await cleanupExpiredPreviews();

  const now = Date.now();
  const previewId = randomUUID();
  const expiresAt = now + PREVIEW_TTL_MS;
  const preview: StoredBulkEditPreview = {
    createdAt: now,
    expiresAt,
    kind: "goods.batchEdit",
    operations: input.operations,
    patch: input.patch,
    selector: input.selector,
    totalCount: input.totalCount,
  };
  previews.set(previewId, preview);
  await writeJsonFile(previewFilePath(previewId), preview);

  return {
    expiresAt: new Date(expiresAt).toISOString(),
    previewId,
  };
}

export async function saveBulkCreatePreview(input: {
  operations: StoredBulkCreateOperation[];
  totalCount: number;
}): Promise<{ expiresAt: string; previewId: string }> {
  await cleanupExpiredPreviews();

  const now = Date.now();
  const previewId = randomUUID();
  const expiresAt = now + PREVIEW_TTL_MS;
  const preview: StoredBulkCreatePreview = {
    createdAt: now,
    expiresAt,
    kind: "goods.batchCreate",
    operations: input.operations,
    totalCount: input.totalCount,
  };
  previews.set(previewId, preview);
  await writeJsonFile(previewFilePath(previewId), preview);

  return {
    expiresAt: new Date(expiresAt).toISOString(),
    previewId,
  };
}

export async function saveBulkDeletePreview(input: {
  operations: StoredBulkDeleteOperation[];
  totalCount: number;
}): Promise<{ expiresAt: string; previewId: string }> {
  await cleanupExpiredPreviews();

  const now = Date.now();
  const previewId = randomUUID();
  const expiresAt = now + PREVIEW_TTL_MS;
  const preview: StoredBulkDeletePreview = {
    createdAt: now,
    expiresAt,
    kind: "goods.batchDelete",
    operations: input.operations,
    totalCount: input.totalCount,
  };
  previews.set(previewId, preview);
  await writeJsonFile(previewFilePath(previewId), preview);

  return {
    expiresAt: new Date(expiresAt).toISOString(),
    previewId,
  };
}

export async function readBulkEditPreview(
  previewId: string,
): Promise<StoredBulkEditPreview | undefined> {
  await cleanupExpiredPreviews();
  const preview = await readStoredPreview(previewId);
  return preview && isStoredBulkEditPreview(preview) ? preview : undefined;
}

export async function readBulkCreatePreview(
  previewId: string,
): Promise<StoredBulkCreatePreview | undefined> {
  await cleanupExpiredPreviews();
  const preview = await readStoredPreview(previewId);
  return preview && isStoredBulkCreatePreview(preview) ? preview : undefined;
}

export async function readBulkPreview(
  previewId: string,
): Promise<StoredBulkPreview | undefined> {
  await cleanupExpiredPreviews();
  return readStoredPreview(previewId);
}

/**
 * Removes a preview once it has been executed, so a single user confirmation
 * authorizes exactly one execution run and the previewId cannot be replayed.
 */
export async function consumeBulkPreview(previewId: string): Promise<void> {
  previews.delete(previewId);
  await rm(previewFilePath(previewId), { force: true });
}

/**
 * Persists the full execution detail as an operator artifact: chat responses
 * only carry counts plus a small sample, and the returned resultId points at
 * logs/bulk-results/<resultId>.json for manual inspection and audit
 * cross-reference. There is intentionally no API read path.
 */
export async function saveBulkExecutionResult(
  input: Omit<StoredBulkExecutionResult, "createdAt" | "expiresAt" | "kind">,
): Promise<{ expiresAt: string; resultId: string }> {
  await cleanupExpiredResults();

  const now = Date.now();
  const resultId = randomUUID();
  const expiresAt = now + RESULT_TTL_MS;
  const result: StoredBulkExecutionResult = {
    ...input,
    createdAt: now,
    expiresAt,
    kind: "goods.batchExecution",
  };
  results.set(resultId, result);
  await writeJsonFile(resultFilePath(resultId), result);

  return {
    expiresAt: new Date(expiresAt).toISOString(),
    resultId,
  };
}

async function cleanupExpiredPreviews(): Promise<void> {
  await sweepOrphanedFilesOnce();
  const now = Date.now();
  for (const [previewId, preview] of previews) {
    if (preview.expiresAt <= now) {
      previews.delete(previewId);
      await rm(previewFilePath(previewId), { force: true });
    }
  }
}

async function cleanupExpiredResults(): Promise<void> {
  await sweepOrphanedFilesOnce();
  const now = Date.now();
  for (const [resultId, result] of results) {
    if (result.expiresAt <= now) {
      results.delete(resultId);
      await rm(resultFilePath(resultId), { force: true });
    }
  }
}

// The in-memory maps only track files written by this process; files from
// previous runs would otherwise accumulate forever. One directory sweep per
// process removes anything already expired (or unreadable, which no read
// path could ever use).
let orphanSweep: Promise<void> | undefined;

function sweepOrphanedFilesOnce(): Promise<void> {
  // A failed sweep must not poison later saves/reads, so errors are dropped
  // rather than cached as a rejected promise.
  orphanSweep ??= Promise.all([
    sweepExpiredFiles(previewStoreDir),
    sweepExpiredFiles(resultStoreDir),
  ]).then(
    () => undefined,
    () => undefined,
  );
  return orphanSweep;
}

async function sweepExpiredFiles(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(dir, entry);
    let expiresAt = 0;
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      if (isRecord(parsed) && typeof parsed.expiresAt === "number") {
        expiresAt = parsed.expiresAt;
      }
    } catch {
      // Unreadable JSON can never be served; treat as expired.
    }

    if (expiresAt <= now) {
      await rm(filePath, { force: true });
    }
  }
}

async function readStoredPreview(
  previewId: string,
): Promise<StoredBulkPreview | undefined> {
  const cached = previews.get(previewId);
  if (cached) {
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(previewFilePath(previewId), "utf8"));
  } catch {
    return undefined;
  }

  if (!isStoredPreview(parsed)) {
    return undefined;
  }

  if (parsed.expiresAt <= Date.now()) {
    await rm(previewFilePath(previewId), { force: true });
    return undefined;
  }

  previews.set(previewId, parsed);
  return parsed;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

function previewFilePath(previewId: string): string {
  return path.join(previewStoreDir, `${previewId}.json`);
}

function resultFilePath(resultId: string): string {
  return path.join(resultStoreDir, `${resultId}.json`);
}

function isStoredPreview(value: unknown): value is StoredBulkPreview {
  return (
    isStoredBulkEditPreview(value) ||
    isStoredBulkCreatePreview(value) ||
    isStoredBulkDeletePreview(value)
  );
}

function isStoredBulkDeletePreview(
  value: unknown,
): value is StoredBulkDeletePreview {
  return (
    isRecord(value) &&
    value.kind === "goods.batchDelete" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    Array.isArray(value.operations) &&
    typeof value.totalCount === "number"
  );
}

function isStoredBulkEditPreview(value: unknown): value is StoredBulkEditPreview {
  return (
    isRecord(value) &&
    value.kind === "goods.batchEdit" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    Array.isArray(value.operations) &&
    isRecord(value.patch) &&
    isRecord(value.selector) &&
    typeof value.totalCount === "number"
  );
}

function isStoredBulkCreatePreview(
  value: unknown,
): value is StoredBulkCreatePreview {
  return (
    isRecord(value) &&
    value.kind === "goods.batchCreate" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    Array.isArray(value.operations) &&
    typeof value.totalCount === "number"
  );
}

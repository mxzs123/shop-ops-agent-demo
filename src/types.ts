export interface AdminAuth {
  authorization?: string;
}

export interface AdminEnvelope<T = unknown> {
  code?: number;
  count?: number;
  data?: T;
  msg?: string;
  [key: string]: unknown;
}

export interface AdminTransport {
  post<T>(
    path: string,
    payload: unknown,
    auth: AdminAuth,
  ): Promise<AdminEnvelope<T>>;
}

export type GoodsPatchValue = string | number | boolean;
export type GoodsPatch = Record<string, GoodsPatchValue>;

export interface GoodsSummary {
  bn?: string;
  details?: GoodsSearchDetails;
  goodsCategoryId?: number;
  id: number | string;
  image?: string;
  isMarketable?: boolean;
  name: string;
  price?: number;
  sn?: string;
  stock?: number;
}

export interface GoodsSearchDetails {
  fields: GoodsDetailField[];
  images: string[];
  intro?: string;
  usageGuidelines: GoodsUsageGuideline[];
}

export interface GoodsDetailField {
  field: string;
  label: string;
  value: string | number | boolean | null;
}

export interface GoodsUsageGuideline {
  body: string;
  title: string;
}

export interface GoodsSearchResult {
  pageSize: number;
  rows: GoodsSummary[];
  total: number;
}

export interface EditableGoodsState {
  goodsCategoryExtendIds: unknown;
  gradePrice: unknown[];
  model: Record<string, unknown>;
  products: unknown[];
}

export interface EditChange {
  after: GoodsPatchValue;
  before: string | number | boolean | null;
  field: string;
  label: string;
}

/**
 * Structured warning attached to plans and executions. `code` is a stable
 * machine-readable identifier the UI can filter on; `message` is the
 * user-facing Japanese text. Sessions restored from older clients may still
 * carry bare strings, so UI code normalizes via `unknown` at the boundary.
 */
export interface ToolWarning {
  code: string;
  message: string;
}

export interface GoodsEditPlan {
  action: "goods.create" | "goods.delete" | "goods.update";
  changes: EditChange[];
  confirmRequired: true;
  patch: GoodsPatch;
  target: GoodsSummary;
  warnings: ToolWarning[];
}

export interface GoodsBatchEditPlan {
  action: "goods.batchCreate" | "goods.batchDelete" | "goods.batchUpdate";
  confirmRequired: true;
  items: GoodsEditPlan[];
  plannedCount?: number;
  previewId?: string;
  sampleCount?: number;
  skippedCount?: number;
  totalCount?: number;
  warnings: ToolWarning[];
}

export interface GoodsEditExecution {
  adminMessage: string;
  changes: EditChange[];
  result: unknown;
  target: GoodsSummary;
  warnings: ToolWarning[];
}

export interface GoodsBatchExecutionFailure {
  error: string;
  id?: number | string;
  index: number;
  patch?: GoodsPatch;
  status?: number;
  target?: GoodsSummary;
}

export interface GoodsBatchEditExecution {
  adminMessage: string;
  failureCount?: number;
  failureSampleCount?: number;
  failures?: GoodsBatchExecutionFailure[];
  items: GoodsEditExecution[];
  resultExpiresAt?: string;
  resultId?: string;
  sampleCount?: number;
  skippedCount?: number;
  successCount: number;
  totalCount?: number;
  warnings: ToolWarning[];
}

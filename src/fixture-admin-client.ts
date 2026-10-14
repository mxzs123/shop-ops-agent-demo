import { readFile } from "node:fs/promises";

import { AdminApiError } from "./admin-client";
import { isRecord } from "./part-utils";
import type { AdminAuth, AdminEnvelope, AdminTransport } from "./types";

interface FixtureData {
  goods: Record<string, unknown>[];
  productsByGoodsId: Record<string, Record<string, unknown>[]>;
}

export class FixtureAdminClient implements AdminTransport {
  private dataPromise: Promise<FixtureData> | undefined;

  constructor(private readonly fixturePath: string) {}

  async post<T>(
    path: string,
    payload: unknown,
    _auth: AdminAuth,
  ): Promise<AdminEnvelope<T>> {
    const data = await this.load();
    const normalizedPath = path.toLowerCase();

    if (normalizedPath.includes("goods/getpagelist")) {
      return this.search(data, payload) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/getedit")) {
      return this.getEdit(data, path, payload) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/doedit")) {
      return this.doEdit(data, payload) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/dobatchmarketableup")) {
      return this.doBatchMarketable(data, payload, true) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/dobatchmarketabledown")) {
      return this.doBatchMarketable(data, payload, false) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/docreate")) {
      return this.doCreate(data, payload) as AdminEnvelope<T>;
    }

    if (normalizedPath.includes("goods/dodelete")) {
      return this.doDelete(data, payload) as AdminEnvelope<T>;
    }

    throw new AdminApiError(`Fixture backend does not implement ${path}`, 404);
  }

  private async load(): Promise<FixtureData> {
    this.dataPromise ??= readFile(this.fixturePath, "utf8").then((content) => {
      const parsed = JSON.parse(content) as Partial<FixtureData>;
      if (!Array.isArray(parsed.goods) || !parsed.productsByGoodsId) {
        throw new AdminApiError("Fixture 数据格式不正确", 500);
      }

      return {
        goods: parsed.goods.map((item) => ({ ...item })),
        productsByGoodsId: Object.fromEntries(
          Object.entries(parsed.productsByGoodsId).map(
            ([goodsId, products]) => [
              goodsId,
              Array.isArray(products)
                ? products.map((product) => ({ ...product }))
                : [],
            ],
          ),
        ),
      };
    });

    return this.dataPromise;
  }

  private search(
    data: FixtureData,
    payload: unknown,
  ): AdminEnvelope<Record<string, unknown>[]> {
    const request = isRecord(payload) ? payload : {};
    const limit = clampPositiveInt(request.limit, 10, 200);
    const page = clampPositiveInt(request.page, 1, 10_000);
    const name = typeof request.name === "string" ? request.name.trim() : "";
    const isMarketable =
      request.isMarketable === undefined || request.isMarketable === ""
        ? undefined
        : String(request.isMarketable).toLowerCase() === "true";
    const goodsCategoryId =
      request.goodsCategoryId === undefined || request.goodsCategoryId === ""
        ? undefined
        : Number(request.goodsCategoryId);

    const filtered = data.goods
      .filter((goods) =>
        name ? String(goods.name ?? "").includes(name) : true,
      )
      .filter((goods) =>
        isMarketable === undefined
          ? true
          : Boolean(goods.isMarketable) === isMarketable,
      )
      .filter((goods) =>
        goodsCategoryId === undefined || Number.isNaN(goodsCategoryId)
          ? true
          : Number(goods.goodsCategoryId) === goodsCategoryId,
      );
    const start = (page - 1) * limit;
    const rows = filtered
      .slice(start, start + limit)
      .map((goods) => this.toRow(data, goods));

    return {
      code: 0,
      count: filtered.length,
      data: rows,
      msg: "fixture search ok",
    };
  }

  private getEdit(
    data: FixtureData,
    path: string,
    payload: unknown,
  ): AdminEnvelope<Record<string, unknown>> {
    const id = extractId(path, payload);
    const goods = data.goods.find((item) => String(item.id) === String(id));
    if (!goods) {
      return { code: 1, msg: `fixture 商品不存在: ${id}` };
    }

    const products = this.productsFor(data, goods.id);
    return {
      code: 0,
      data: {
        goodsCategoryExtendIds: "",
        gradePrice: [],
        model: { ...goods },
        products,
      },
      msg: "fixture get edit ok",
    };
  }

  private doEdit(
    data: FixtureData,
    payload: unknown,
  ): AdminEnvelope<Record<string, unknown>> {
    if (!isRecord(payload) || !isRecord(payload.goods)) {
      return { code: 1, msg: "fixture payload 缺少 goods" };
    }

    const goodsId = payload.goods.id;
    const index = data.goods.findIndex(
      (item) => String(item.id) === String(goodsId),
    );
    if (index < 0) {
      return { code: 1, msg: `fixture 商品不存在: ${String(goodsId)}` };
    }

    data.goods[index] = {
      ...data.goods[index],
      ...payload.goods,
      updateTime: new Date().toISOString(),
    };

    if (Array.isArray(payload.products)) {
      data.productsByGoodsId[String(goodsId)] = payload.products
        .filter(isRecord)
        .map((product) => ({ ...product }));
    }

    return {
      code: 0,
      data: { id: goodsId },
      msg: "fixture 写入完成",
    };
  }

  private doCreate(
    data: FixtureData,
    payload: unknown,
  ): AdminEnvelope<Record<string, unknown>> {
    if (!isRecord(payload) || !isRecord(payload.goods)) {
      return { code: 1, msg: "fixture payload 缺少 goods" };
    }
    if (!Array.isArray(payload.products) || payload.products.length === 0) {
      return { code: 1, msg: "fixture payload 缺少 products" };
    }

    const goods = { ...payload.goods };
    const requiredFields = [
      "bn",
      "goodsCategoryId",
      "image",
      "name",
      "price",
      "stock",
    ];
    const missingField = requiredFields.find(
      (field) =>
        goods[field] === undefined || String(goods[field]).trim() === "",
    );
    if (missingField) {
      return { code: 1, msg: `fixture payload 缺少 ${missingField}` };
    }

    if (
      data.goods.some(
        (item) => String(item.bn ?? "") === String(goods.bn ?? ""),
      )
    ) {
      return { code: 1, msg: `fixture 商品编码已存在: ${String(goods.bn)}` };
    }

    const goodsId = nextNumericId(data.goods, 1000);
    goods.id = goodsId;
    goods.createTime = new Date().toISOString();
    goods.updateTime = goods.createTime;
    data.goods.push(goods);

    const nextProductId = nextNumericId(
      Object.values(data.productsByGoodsId).flat(),
      5000,
    );
    data.productsByGoodsId[String(goodsId)] = payload.products
      .filter(isRecord)
      .map((product, index) => ({
        ...product,
        goodsId,
        id: Number(product.id) > 0 ? product.id : nextProductId + index,
      }));

    return {
      code: 0,
      data: { id: goodsId },
      msg: "fixture 录入完成",
    };
  }

  private doBatchMarketable(
    data: FixtureData,
    payload: unknown,
    isMarketable: boolean,
  ): AdminEnvelope<Record<string, unknown>> {
    const ids = extractIds(payload);
    if (ids.length === 0) {
      return { code: 1, msg: "fixture 请求缺少 id" };
    }

    const missingIds = ids.filter(
      (id) => !data.goods.some((item) => String(item.id) === String(id)),
    );
    if (missingIds.length > 0) {
      return {
        code: 1,
        msg: `fixture 商品不存在: ${missingIds.map(String).join(",")}`,
      };
    }

    for (const id of ids) {
      const index = data.goods.findIndex(
        (item) => String(item.id) === String(id),
      );
      data.goods[index] = {
        ...data.goods[index],
        isMarketable,
        updateTime: new Date().toISOString(),
      };
    }

    return {
      code: 0,
      data: { count: ids.length },
      msg: "fixture 批量上下架完成",
    };
  }

  private doDelete(
    data: FixtureData,
    payload: unknown,
  ): AdminEnvelope<Record<string, unknown>> {
    const id = extractId("http://fixture.local", payload);
    const index = data.goods.findIndex(
      (item) => String(item.id) === String(id),
    );
    if (index < 0) {
      return { code: 1, msg: `fixture 商品不存在: ${String(id)}` };
    }

    data.goods.splice(index, 1);
    delete data.productsByGoodsId[String(id)];

    return {
      code: 0,
      data: { id },
      msg: "fixture 删除完成",
    };
  }

  private toRow(
    data: FixtureData,
    goods: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.toModel(goods, this.productsFor(data, goods.id));
  }

  private toModel(
    goods: Record<string, unknown>,
    products: Record<string, unknown>[],
  ): Record<string, unknown> {
    const product = defaultProduct(products);

    return {
      ...goods,
      costprice: product?.costprice,
      mktprice: product?.mktprice,
      price: product?.price,
      sn: product?.sn ?? goods.bn,
      stock: product?.stock,
      weight: product?.weight,
    };
  }

  private productsFor(
    data: FixtureData,
    goodsId: unknown,
  ): Record<string, unknown>[] {
    return (data.productsByGoodsId[String(goodsId)] ?? []).map((product) => ({
      ...product,
    }));
  }
}

function defaultProduct(
  products: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  return (
    products.find((product) =>
      [true, 1, "1", "true"].includes(product.isDefalut as never),
    ) ?? products[0]
  );
}

function extractId(path: string, payload: unknown): string | number {
  const url = new URL(path, "http://fixture.local");
  const queryId = url.searchParams.get("id");
  if (queryId) {
    return queryId;
  }

  if (isRecord(payload)) {
    const id = payload.id ?? payload.targetId;
    if (typeof id === "string" || typeof id === "number") {
      return id;
    }
  }

  throw new AdminApiError("fixture 请求缺少 id", 400);
}

function extractIds(payload: unknown): Array<string | number> {
  if (!isRecord(payload)) {
    return [];
  }

  const rawIds = payload.id ?? payload.ids;
  if (Array.isArray(rawIds)) {
    return rawIds.filter(
      (id): id is string | number =>
        (typeof id === "string" && id.trim().length > 0) ||
        (typeof id === "number" && Number.isFinite(id)),
    );
  }

  if (typeof rawIds === "string") {
    return rawIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (typeof rawIds === "number" && Number.isFinite(rawIds)) {
    return [rawIds];
  }

  return [];
}

function clampPositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    return fallback;
  }

  return Math.min(number, max);
}

function nextNumericId(
  items: Record<string, unknown>[],
  floor: number,
): number {
  const maxExisting = items.reduce((max, item) => {
    const id = Number(item.id);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, floor);

  return maxExisting + 1;
}

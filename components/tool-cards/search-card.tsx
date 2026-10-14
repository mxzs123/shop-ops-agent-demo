"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  SearchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Collapse } from "@/components/chat/collapse";
import { LoadingArc } from "@/components/chat/status";
import { CopyButton } from "@/components/tool-cards/copy-button";
import {
  cleanRichText,
  formatCategory,
  formatDetailValue,
  formatMoney,
  formatValue,
  getFieldValue,
  uniqueText,
} from "@/lib/format";
import { resolveDisplayImageUrl } from "@/lib/media";
import type { ToolOutput } from "@/lib/tool-parts";
import type {
  GoodsDetailField,
  GoodsSearchDetails,
  GoodsSearchResult,
  GoodsSummary,
} from "@/src/types";

type DetailLoadState = "error" | "loading";

const emptyGoodsRows: GoodsSummary[] = [];
const INITIAL_VISIBLE_ROWS = 5;
const MAX_VISIBLE_USAGE_GUIDELINES = 1;

const HIDDEN_DETAIL_FIELDS = new Set([
  "id",
  "name",
  "bn",
  "image",
  "images",
  "video",
  "intro",
  "brief",
  "note",
  "isPrescription",
  "goodsCategoryId",
  "manufacturer",
  "price",
  "stock",
  "isMarketable",
]);

function pickOtherFields(
  details: GoodsSearchDetails | undefined,
): GoodsDetailField[] {
  if (!details) {
    return [];
  }

  return details.fields.filter((field) => {
    if (HIDDEN_DETAIL_FIELDS.has(field.field)) {
      return false;
    }
    if (field.value === null || field.value === undefined) {
      return false;
    }
    if (typeof field.value === "string" && field.value.trim() === "") {
      return false;
    }
    return true;
  });
}

export const SearchResultCard = memo(function SearchResultCard({
  output,
}: {
  output: ToolOutput<GoodsSearchResult>;
}) {
  const rows = output.data?.rows ?? emptyGoodsRows;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  const visibleRows = useMemo(
    () => rows.slice(0, visibleCount),
    [rows, visibleCount],
  );
  const hiddenRowCount = rows.length - visibleRows.length;
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [detailRows, setDetailRows] = useState<Record<string, GoodsSummary>>(
    {},
  );
  const [detailStates, setDetailStates] = useState<
    Record<string, DetailLoadState>
  >({});
  // Aborts in-flight detail requests when the card unmounts; requests are
  // started from the expand/retry handlers, not from an effect, so state
  // updates cannot cancel them mid-flight.
  const abortControllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  const visibleRowsWithDetails = useMemo(
    () => visibleRows.map((item) => detailRows[String(item.id)] ?? item),
    [detailRows, visibleRows],
  );
  // Only the expanded row's gallery is worth preloading; eager preloading of
  // every visible row wasted bandwidth on rows the user never opens.
  const imageUrls = useMemo(() => {
    if (expandedId === null) {
      return [];
    }
    const expandedRow = visibleRowsWithDetails.find(
      (item) => item.id === expandedId,
    );
    if (!expandedRow) {
      return [];
    }
    return uniqueText([
      expandedRow.image ?? "",
      ...(expandedRow.details?.images ?? []),
    ]);
  }, [expandedId, visibleRowsWithDetails]);

  const loadDetail = useCallback((item: GoodsSummary) => {
    const key = String(item.id);
    const controller = new AbortController();
    abortControllersRef.current.get(key)?.abort();
    abortControllersRef.current.set(key, controller);

    setDetailStates((current) => ({ ...current, [key]: "loading" }));
    void fetch("/api/tools/goods.detail", {
      body: JSON.stringify({ id: item.id }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: ToolOutput<GoodsSummary>) => {
        if (!body.ok || !body.data) {
          throw new Error(body.error ?? "詳細の読み取りに失敗しました");
        }

        setDetailRows((current) => ({
          ...current,
          [key]: body.data as GoodsSummary,
        }));
        setDetailStates((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setDetailStates((current) => ({ ...current, [key]: "error" }));
      })
      .finally(() => {
        if (abortControllersRef.current.get(key) === controller) {
          abortControllersRef.current.delete(key);
        }
      });
  }, []);

  const handleToggleRow = useCallback(
    (item: GoodsSummary) => {
      const willExpand = expandedId !== item.id;
      setExpandedId(willExpand ? item.id : null);
      if (willExpand) {
        const key = String(item.id);
        if (!item.details && !detailRows[key] && !detailStates[key]) {
          loadDetail(item);
        }
      }
    },
    [detailRows, detailStates, expandedId, loadDetail],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const preloadedImages = imageUrls.map((url) => {
      const image = new window.Image();
      image.decoding = "async";
      image.src = url;
      return image;
    });

    return () => {
      for (const image of preloadedImages) {
        image.src = "";
      }
    };
  }, [imageUrls]);

  return (
    <div className="tool-card-enter w-full overflow-hidden rounded-card bg-surface text-sm shadow-card">
      <div className="primitive-card-bar flex items-center justify-between gap-3 border-b border-line">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <SearchIcon className="size-3.5 text-ink-3" />
          商品検索
        </div>
        <span className="text-[11.5px] tabular-nums text-ink-3">
          {output.data?.total ?? rows.length} 件が該当
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-[12.5px] text-ink-3">
          該当する商品がありません
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {visibleRowsWithDetails.map((item) => {
          const isExpanded = expandedId === item.id;
          const detailState = detailStates[String(item.id)];
          return (
            <li key={item.id}>
              <GoodsRow
                expanded={isExpanded}
                item={item}
                onToggle={() => handleToggleRow(item)}
              />
              <Collapse
                className="border-t border-line bg-inset px-3 pb-4 pt-3.5"
                open={isExpanded}
              >
                <GoodsDetailPanel
                  detailState={detailState}
                  item={item}
                  onRetry={() => loadDetail(item)}
                />
              </Collapse>
            </li>
          );
        })}
      </ul>
      {hiddenRowCount > 0 ? (
        <button
          className="flex h-10 w-full items-center justify-center gap-1 border-t border-line text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          onClick={() => setVisibleCount(rows.length)}
          type="button"
        >
          <ChevronDownIcon className="size-3.5" />
          さらに表示（残り {hiddenRowCount} 件）
        </button>
      ) : null}
    </div>
  );
});

function GoodsRow({
  expanded,
  item,
  onToggle,
}: {
  expanded: boolean;
  item: GoodsSummary;
  onToggle: () => void;
}) {
  const isPrescription = getFieldValue(item.details, "isPrescription") === true;

  return (
    <div
      aria-expanded={expanded}
      className={`group/row flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${
        expanded ? "bg-inset" : "hover:bg-hover"
      }`}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <GoodsThumb className="size-10 rounded-control" image={item.image} />
      <div className="min-w-0 flex-1">
        {/* Tags flow inline after the name so a wrapped name keeps them on
            its last line instead of pinning them to the top-right. */}
        <div className="text-[13px] font-medium leading-5 text-ink">
          {item.name}
          <GoodsInlineTags
            marketable={item.isMarketable}
            prescription={isPrescription}
          />
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
          ID {item.id}
          {item.bn ? ` · ${item.bn}` : ""}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs sm:hidden">
          <span className="font-medium tabular-nums text-ink">
            {formatMoney(item.price)}
          </span>
          <span className="text-ink-2">在庫 {formatValue(item.stock)}</span>
        </div>
      </div>
      <div className="hidden w-28 shrink-0 text-right sm:block">
        <div className="text-[13px] font-medium leading-5 tabular-nums text-ink">
          {formatMoney(item.price)}
        </div>
        <div className="text-[11.5px] tabular-nums text-ink-3">
          在庫 {formatValue(item.stock)}
        </div>
      </div>
      <ChevronDownIcon
        className={`size-4 shrink-0 text-ink-3 transition-transform ${
          expanded ? "rotate-180" : ""
        }`}
      />
    </div>
  );
}

function GoodsDetailPanel({
  detailState,
  item,
  onRetry,
}: {
  detailState?: DetailLoadState;
  item: GoodsSummary;
  onRetry: () => void;
}) {
  const [showAllFields, setShowAllFields] = useState(false);
  const details = item.details;
  const images = details?.images?.length
    ? details.images
    : item.image
      ? [item.image]
      : [];
  const intro =
    cleanRichText(details?.intro) ||
    formatDetailValue(getFieldValue(details, "brief"));
  const guidelines = details?.usageGuidelines ?? [];
  const visibleGuidelines = guidelines.slice(0, MAX_VISIBLE_USAGE_GUIDELINES);
  const otherFields = pickOtherFields(details);
  const pills = [
    { label: "カテゴリ", value: formatCategory(item) },
    {
      label: "処方区分",
      value: formatDetailValue(getFieldValue(details, "isPrescription")),
    },
    {
      label: "メーカー",
      value: formatDetailValue(getFieldValue(details, "manufacturer")),
    },
  ].filter((pill) => pill.value && pill.value !== "-");

  return (
    <div className="space-y-4">
      {detailState === "loading" ? (
        <div className="flex items-center gap-2 text-xs font-medium text-ink-2">
          <LoadingArc />
          商品詳細を読み取り中
        </div>
      ) : null}
      {detailState === "error" ? (
        <div className="flex items-center gap-2 text-xs font-medium text-red">
          詳細の読み取りに失敗しました
          <button
            className="inline-flex h-6 items-center rounded-full bg-surface px-2.5 text-[11px] font-medium text-ink shadow-btn transition hover:bg-inset"
            onClick={onRetry}
            type="button"
          >
            再試行
          </button>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        <GoodsImageGallery alt={item.name} images={images} />
        <div className="min-w-0 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs">
              {pills.map((pill) => (
                <span
                  className="inline-flex items-baseline gap-1"
                  key={pill.label}
                >
                  <span className="text-ink-2">{pill.label}</span>
                  <span className="font-medium text-ink">
                    {pill.value}
                  </span>
                </span>
              ))}
            </div>
            <CopyButton
              ariaLabel="商品名をコピー"
              className="-mr-1 -mt-0.5"
              value={item.name}
            />
          </div>

          {otherFields.length > 0 ? (
            <button
              aria-expanded={showAllFields}
              className="-ml-1 inline-flex h-7 items-center gap-1 rounded-control px-1 text-xs font-medium text-accent transition-colors hover:bg-accent-tint"
              onClick={() => setShowAllFields((current) => !current)}
              type="button"
            >
              <ChevronDownIcon
                className={`size-3.5 transition-transform duration-300 ${
                  showAllFields ? "rotate-180" : ""
                }`}
              />
              {showAllFields ? "項目を折りたたむ" : `すべての項目を表示（${otherFields.length}）`}
            </button>
          ) : null}

          {otherFields.length > 0 ? (
            <Collapse open={showAllFields}>
              <dl className="grid gap-x-6 gap-y-0.5 pb-1 sm:grid-cols-2">
                {otherFields.map((field) => (
                  <div
                    className="flex items-baseline justify-between gap-3 border-b border-dashed border-line py-1.5"
                    key={field.field}
                  >
                    <dt className="shrink-0 text-xs text-ink-2">
                      {field.label}
                    </dt>
                    <dd className="min-w-0 truncate text-right text-xs text-ink">
                      {formatDetailValue(field.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Collapse>
          ) : null}

          {intro && intro !== "-" ? (
            <DetailBlock title="商品詳細">
              <p className="line-clamp-3 whitespace-pre-line text-xs leading-5 text-ink">
                {intro}
              </p>
            </DetailBlock>
          ) : null}

          {visibleGuidelines.length > 0 ? (
            <DetailBlock title="使用上の注意">
              <dl className="space-y-2">
                {visibleGuidelines.map((section) => (
                  <div key={section.title}>
                    <dt className="text-xs font-medium text-ink">
                      {section.title}
                    </dt>
                    <dd className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs leading-5 text-ink-2">
                      {cleanRichText(section.body) || "-"}
                    </dd>
                  </div>
                ))}
              </dl>
            </DetailBlock>
          ) : null}
        </div>
      </div>

    </div>
  );
}

function GoodsThumb({
  className,
  image,
}: {
  className?: string;
  image?: string;
}) {
  const src = resolveDisplayImageUrl(image);

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface ${
        className ?? ""
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="size-full object-cover"
          decoding="async"
          loading="lazy"
          src={src}
        />
      ) : (
        <ImageIcon className="size-4 text-ink-3" />
      )}
    </div>
  );
}

function GoodsImageGallery({ alt, images }: { alt: string; images: string[] }) {
  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, Math.max(images.length - 1, 0));
  const hero = images[safeActive];
  const hasMultiple = images.length > 1;

  const goPrev = () =>
    setActive((index) => (index <= 0 ? images.length - 1 : index - 1));
  const goNext = () =>
    setActive((index) => (index >= images.length - 1 ? 0 : index + 1));

  const heroSrc = resolveDisplayImageUrl(hero);

  return (
    <div className="w-full max-w-[14rem] shrink-0 space-y-2 sm:w-44">
      <div className="group/gallery relative flex w-full items-center justify-center overflow-hidden rounded-control bg-white shadow-hairline">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={alt}
            className="block h-auto max-h-56 w-full object-contain"
            decoding="async"
            loading="lazy"
            src={heroSrc}
          />
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-inset text-xs text-ink-3">
            <ImageIcon className="size-6" />
            画像がありません
          </div>
        )}
        {hasMultiple ? (
          <>
            <button
              aria-label="前の画像"
              className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1 text-ink opacity-0 shadow-btn transition-opacity group-hover/gallery:opacity-100 hover:bg-surface focus-visible:opacity-100"
              onClick={goPrev}
              type="button"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              aria-label="次の画像"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1 text-ink opacity-0 shadow-btn transition-opacity group-hover/gallery:opacity-100 hover:bg-surface focus-visible:opacity-100"
              onClick={goNext}
              type="button"
            >
              <ChevronRightIcon className="size-4" />
            </button>
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
              {safeActive + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>
      {hasMultiple ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {images.map((url, index) => {
            const thumbSrc = resolveDisplayImageUrl(url);
            return (
              <button
                aria-label={`画像 ${index + 1}`}
                aria-pressed={index === safeActive}
                className={`size-9 shrink-0 overflow-hidden rounded-md border bg-white transition ${
                  index === safeActive
                    ? "border-accent ring-2 ring-accent/30"
                    : "border-line hover:border-line-strong"
                }`}
                key={`${url}-${index}`}
                onClick={() => setActive(index)}
                type="button"
              >
                {thumbSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="size-full object-cover"
                    decoding="async"
                    loading="lazy"
                    src={thumbSrc}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DetailBlock({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="mb-1.5 text-[11.5px] font-medium text-ink-3">
        {title}
      </div>
      {children}
    </section>
  );
}

function GoodsInlineTags({
  marketable,
  prescription,
}: {
  marketable?: boolean;
  prescription: boolean;
}) {
  const tags = [
    ...(prescription ? [{ className: "bg-orange-tint text-orange", label: "処方" }] : []),
    marketable === true
      ? { className: "bg-green-tint text-green", label: "公開中" }
      : { className: "bg-hover-2 text-ink-2", label: "非公開" },
  ];

  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-[1px]">
      {tags.map((tag) => (
        <span
          className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium ${tag.className}`}
          key={tag.label}
        >
          {tag.label}
        </span>
      ))}
    </span>
  );
}

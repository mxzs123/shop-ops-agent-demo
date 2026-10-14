import type { UIMessage } from "ai";

import { isRecord } from "@/src/part-utils";
import type { GoodsSearchDetails, GoodsSummary } from "@/src/types";

export { isRecord };

export function uniqueText(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function cleanRichText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function formatDetailValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "はい" : "いいえ";
  }

  const text = cleanRichText(value);
  return text || "-";
}

export function formatMoney(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return `JPY ${parsed.toLocaleString("ja-JP")}`;
}

export function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "はい" : "いいえ";
  }

  return String(value);
}

export function getFieldValue(
  details: GoodsSearchDetails | undefined,
  field: string,
) {
  return details?.fields.find((item) => item.field === field)?.value;
}

export function formatCategory(item: GoodsSummary) {
  const value =
    item.goodsCategoryId ?? getFieldValue(item.details, "goodsCategoryId");
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return `ID ${String(value)}`;
}

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }

  if (size < 1024 * 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!Number.isFinite(diffMs) || diffMs < minute) {
    return "たった今";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} 分前`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} 時間前`;
  }
  if (diffMs < 2 * day) {
    return "昨日";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "numeric",
  }).format(timestamp);
}

export function formatChatError(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (isRecord(parsed) && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // keep the original message
  }

  return message;
}

export function getMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

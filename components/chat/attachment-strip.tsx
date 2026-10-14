"use client";

import { XIcon } from "lucide-react";

import type { PendingImageAttachment } from "@/lib/attachments";
import { formatFileSize } from "@/lib/format";

export function AttachmentPreviewStrip({
  attachments,
  onRemove,
}: {
  attachments: PendingImageAttachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto px-0.5 pt-0.5 [scrollbar-width:thin]">
      {attachments.map((attachment) => (
        <div
          className="relative size-16 shrink-0 overflow-hidden rounded-control bg-field shadow-hairline"
          key={attachment.id}
          title={`${attachment.filename ?? "画像"} · ${formatFileSize(attachment.size)}`}
        >
          <div
            aria-label={attachment.filename ?? "送信待ちの画像"}
            className="size-full bg-cover bg-center"
            role="img"
            style={{ backgroundImage: `url(${attachment.url})` }}
          />
          <span
            className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
              attachment.uploadStatus === "uploaded"
                ? "bg-green text-white"
                : attachment.uploadStatus === "error"
                  ? "bg-red text-white"
                  : "bg-black/60 text-white"
            }`}
            title={attachment.uploadError ?? attachment.uploadedPath}
          >
            {attachment.uploadStatus === "uploaded"
              ? "アップロード済み"
              : attachment.uploadStatus === "error"
                ? "失敗"
                : "アップロード中"}
          </span>
          <button
            aria-label={`削除: ${attachment.filename ?? "画像"}`}
            className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-surface text-ink shadow-btn transition hover:bg-inset"
            onClick={() => onRemove(attachment.id)}
            title="削除"
            type="button"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

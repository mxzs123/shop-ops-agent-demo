"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { copyTextToClipboard } from "@/lib/clipboard";

export function CopyButton({
  ariaLabel,
  className,
  value,
}: {
  ariaLabel: string;
  className?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    if (!value) {
      return;
    }

    const ok = await copyTextToClipboard(value);
    if (!ok) {
      return;
    }
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={copied}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink ${className ?? ""}`}
      onClick={handleCopy}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      title={copied ? "已复制" : ariaLabel}
      type="button"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

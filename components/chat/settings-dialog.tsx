"use client";

import { KeyRoundIcon, XIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef } from "react";


export function SettingsDialog({
  apiKeyDraft,
  apiKeySaved,
  message,
  onChangeApiKeyDraft,
  onClearApiKey,
  onClose,
  onSaveApiKey,
  open,
}: {
  apiKeyDraft: string;
  apiKeySaved: boolean;
  message: string;
  onChangeApiKeyDraft: (value: string) => void;
  onClearApiKey: () => void;
  onClose: () => void;
  onSaveApiKey: (event: FormEvent<HTMLFormElement>) => void;
  open: boolean;
}) {
  const keyInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  // Standard dialog behavior: focus the key input on open, close on Escape,
  // and trap Tab focus inside the dialog by wrapping at the boundaries.
  useEffect(() => {
    if (!open) {
      return;
    }

    keyInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        return;
      }

      const active = document.activeElement;
      const inside =
        active instanceof HTMLElement && dialogRef.current.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-labelledby="settings-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <form
        className="w-full max-w-md rounded-window bg-surface p-5 shadow-overlay"
        onSubmit={onSaveApiKey}
        ref={dialogRef}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div
              className="flex items-center gap-2 text-[15px] font-semibold text-ink"
              id="settings-dialog-title"
            >
              <KeyRoundIcon className="size-[18px] text-accent" />
              模型设置
            </div>
            <div className="mt-1 text-[13px] text-ink-2">
              {apiKeySaved
                ? "Claude API Key 已保存，可输入新 key 替换。"
                : "Claude API Key 未设置。"}
            </div>
          </div>
          <button
            aria-label="关闭设置"
            className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <label
          className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
          htmlFor="model-api-key"
        >
          Claude API Key
        </label>
        <input
          autoComplete="off"
          className="h-10 w-full rounded-control bg-field px-3 text-[13.5px] text-ink shadow-inset-field outline-none transition-shadow placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-tint)]"
          id="model-api-key"
          ref={keyInputRef}
          onChange={(event) => onChangeApiKeyDraft(event.target.value)}
          placeholder={apiKeySaved ? "输入新 key 替换当前设置" : "sk-ant-..."}
          type="password"
          value={apiKeyDraft}
        />
        {message ? (
          <div className="mt-3 text-[12.5px] font-medium text-accent">
            {message}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {apiKeySaved ? (
            <button
              className="inline-flex h-[30px] items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink shadow-btn transition-[background-color,transform] hover:bg-inset active:scale-[0.96]"
              onClick={onClearApiKey}
              type="button"
            >
              清除
            </button>
          ) : null}
          <button
            className="inline-flex h-[30px] items-center rounded-full bg-accent px-3.5 text-[13px] font-medium text-white transition-[background-color,transform] hover:bg-accent-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
            disabled={!apiKeyDraft.trim()}
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

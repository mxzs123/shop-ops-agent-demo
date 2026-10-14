"use client";

// Beautiful UI `prompt-bar` (https://www.beautifului.dev/r/prompt-bar.json, MIT).
// Adapted: the self-running demo, model picker, fake dictation and glimm
// shader sweep are dropped; the + menu takes real actions from the caller,
// attachments are rendered by the caller, and send turns into stop while a
// response streams.

import type { ChatStatus } from "ai";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type DragEventHandler,
  type ReactNode,
  type Ref,
} from "react";

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export type PromptBarMenuItem = {
  key: string;
  name: string;
  desc: string;
  icon: ReactNode;
  onSelect: () => void;
};

export type PromptBarHandle = {
  /** replace the draft and focus the input, caret at the end */
  setDraft: (text: string) => void;
};

export default function PromptBar({
  apiRef,
  attachments,
  dragging = false,
  hasAttachments = false,
  menuDisabled = false,
  menuItems,
  onDragLeave,
  onDragOver,
  onDrop,
  onStop,
  onSubmit,
  placeholder,
  sendDisabled = false,
  sendTitle,
  status,
}: {
  apiRef?: Ref<PromptBarHandle>;
  /** rendered above the input (e.g. pending image thumbnails) */
  attachments?: ReactNode;
  dragging?: boolean;
  /** lets an attachment-only message be sent */
  hasAttachments?: boolean;
  menuDisabled?: boolean;
  menuItems: PromptBarMenuItem[];
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onStop: () => void;
  /** return true when the message was accepted and the draft should clear */
  onSubmit: (text: string) => boolean;
  placeholder?: string;
  sendDisabled?: boolean;
  sendTitle?: string;
  status: ChatStatus;
}) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useImperativeHandle(apiRef, () => ({
    setDraft: (text: string) => {
      setDraft(text);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(text.length, text.length);
      });
    },
  }));

  // Focus on load for pointer devices; on touch this would pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  const busy = status === "submitted" || status === "streaming";
  const canSend = !busy && !sendDisabled && (draft.trim().length > 0 || hasAttachments);

  /* a single highlight glides to the hovered row */
  useLayoutEffect(() => {
    const target = active === null ? null : rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [active, menuOpen]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const inlineInputWidth = controls.clientWidth - 32 * 2 - 4 * 2;
    const needsFullWidth = draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    const minHeight = 32;
    const maxHeight = 192;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded]);

  /* clicking anywhere outside the composer closes the menu */
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const send = () => {
    if (!canSend) return;
    if (onSubmit(draft.trim())) {
      setDraft("");
      setMenuOpen(false);
    }
  };

  return (
    <div
      data-promptbar
      className="w-full"
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="relative">
        {/* ── + menu ─────────────────────────────────────── */}
        {menuOpen && (
          <div
            onMouseLeave={() => setActive(null)}
            className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom left" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && active !== null ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {menuItems.map((item, i) => (
              <button
                key={item.key}
                type="button"
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  setMenuOpen(false);
                  item.onSelect();
                }}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
              >
                <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">{item.icon}</span>
                <span className="shrink-0 text-[12.5px] font-medium text-ink">{item.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{item.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── composer ───────────────────────────────────── */}
        <div className="relative isolate flex flex-col gap-1.5 overflow-hidden rounded-[16px] border border-line bg-surface p-2 shadow-card transition-[border-color] duration-150 focus-within:border-line-strong">
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute whitespace-pre text-[14px] leading-5"
          >
            {draft}
          </span>

          {attachments}

          <div
            ref={controlsRef}
            className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-end gap-x-1 gap-y-1.5"
          >
            <button
              type="button"
              aria-label="添付を追加"
              aria-expanded={menuOpen}
              disabled={menuDisabled}
              title={menuDisabled ? "回答の生成中は追加できません" : "追加"}
              onClick={() => {
                setMenuOpen((current) => !current);
                inputRef.current?.focus();
              }}
              className={`flex size-8 shrink-0 items-center justify-center justify-self-start rounded-[9px] text-ink-3 transition-[background-color,color,transform] duration-150 enabled:hover:bg-hover enabled:hover:text-ink enabled:active:scale-[0.94] disabled:opacity-40 ${
                menuOpen ? "bg-hover text-ink" : ""
              } ${expanded ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
            >
              <Icon size={17} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setMenuOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMenuOpen(false);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={placeholder}
              aria-label="メッセージ"
              className={`min-h-8 w-full min-w-0 resize-none bg-transparent px-1.5 py-1.5 text-[14px] leading-5 text-ink outline-none [overflow-wrap:anywhere] placeholder:truncate placeholder:text-ink-3 ${
                expanded ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1"
              }`}
            />

            {/* send — tactile square; becomes stop while a reply streams */}
            {busy ? (
              <button
                key="stop"
                type="button"
                aria-label="生成を停止"
                title="生成を停止"
                onClick={onStop}
                className={`flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-ink text-surface transition-transform duration-150 active:scale-[0.94] ${
                  expanded ? "col-start-3 row-start-2" : "col-start-3 row-start-1"
                }`}
              >
                <span className="size-2.5 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                aria-label="送信"
                title={sendTitle}
                disabled={!canSend}
                onClick={send}
                className={`flex size-8 shrink-0 items-center justify-center rounded-[9px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
                  expanded ? "col-start-3 row-start-2" : "col-start-3 row-start-1"
                }`}
                style={{
                  background: canSend ? "var(--accent)" : "var(--line-strong)",
                  color: canSend ? "var(--surface)" : "var(--ink-2)",
                }}
              >
                <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
              </button>
            )}
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] border-2 border-dashed border-accent bg-surface/90 text-[13px] font-medium text-accent">
              ドロップして画像を追加
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

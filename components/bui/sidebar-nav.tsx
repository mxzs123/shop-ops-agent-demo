"use client";

// Beautiful UI `sidebar-nav` (https://www.beautifului.dev/r/sidebar-nav.json, MIT).
// Adapted: central-icons → lucide, the demo workspace switcher → app title,
// recents → persisted chat sessions with rename / two-step delete, a mobile
// drawer mode, and a controlled collapse.

import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import GlideMenu from "@/components/bui/glide-menu";
import { formatRelativeTime } from "@/lib/format";
import type { ChatSession } from "@/lib/sessions";

const SIDEBAR_MOTION = {
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 32,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

function GlideGroup({ children }: { children: ReactNode }) {
  return (
    <GlideMenu
      rowSelector="[data-row]"
      highlightClassName="sidebar-glide-highlight rounded-[7px] bg-hover-2"
      className="group/glide flex flex-col gap-px"
    >
      {children}
    </GlideMenu>
  );
}

function RailButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      data-row
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className="sidebar-row relative z-10 mx-2 flex h-8 w-[calc(100%-16px)] items-center rounded-[8px] px-2 text-left
        transition-[width,background-color,color,transform] duration-150 enabled:active:scale-[0.98] disabled:opacity-50"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">{icon}</span>
      <span className="sidebar-copy ml-2 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">{label}</span>
    </button>
  );
}

function BackendBadge({ status }: { status: string }) {
  const tone =
    status === "Shadow"
      ? "bg-green-tint text-green"
      : status === "Fixture"
        ? "bg-orange-tint text-orange"
        : status === "確認中"
          ? "bg-hover-2 text-ink-3"
          : "bg-red-tint text-red";
  const label =
    status === "Shadow" || status === "Fixture" || status === "確認中" ? status : "オフライン";

  return (
    <span
      className={`inline-flex h-[18px] min-w-0 items-center truncate rounded-full px-1.5 text-[10.5px] font-medium ${tone}`}
      title={status === "Fixture" ? "テストデータ：書き込みはメモリ上のみ" : status}
    >
      {label}
    </span>
  );
}

export const SidebarNav = memo(function SidebarNav({
  activeSessionId,
  collapsed,
  disabled,
  onDeleteSession,
  onNewConversation,
  onOpenSettings,
  onRenameSession,
  onSelectSession,
  onToggleCollapsed,
  open,
  sessions,
  status,
}: {
  activeSessionId: string;
  collapsed: boolean;
  disabled: boolean;
  onDeleteSession: (sessionId: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggleCollapsed: () => void;
  /** mobile drawer visibility */
  open: boolean;
  sessions: ChatSession[];
  /** backend health label: "Shadow" | "Fixture" | "確認中" | an error */
  status: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmResetTimerRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = normalizedQuery
    ? sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery))
    : sessions;

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!collapsed) return;
    setSearchOpen(false);
    setQuery("");
  }, [collapsed]);

  useEffect(() => {
    return () => {
      if (confirmResetTimerRef.current !== null) {
        window.clearTimeout(confirmResetTimerRef.current);
      }
    };
  }, []);

  // Two-step delete: the first click arms the button, the second within the
  // window actually deletes. Auto-disarm keeps stale confirms from firing.
  function handleDeleteClick(sessionId: string) {
    if (confirmResetTimerRef.current !== null) {
      window.clearTimeout(confirmResetTimerRef.current);
      confirmResetTimerRef.current = null;
    }
    if (confirmingDeleteId === sessionId) {
      setConfirmingDeleteId(null);
      onDeleteSession(sessionId);
      return;
    }
    setConfirmingDeleteId(sessionId);
    confirmResetTimerRef.current = window.setTimeout(() => {
      setConfirmingDeleteId(null);
      confirmResetTimerRef.current = null;
    }, 3000);
  }

  function commitRename() {
    if (renamingId && renameDraft.trim()) {
      onRenameSession(renamingId, renameDraft);
    }
    setRenamingId(null);
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  return (
    <aside
      data-sidebar-collapsed={collapsed}
      aria-label="会話ナビゲーション"
      className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-page py-3 transition-[width,transform,box-shadow] md:static md:translate-x-0 md:shadow-none ${
        collapsed ? "md:w-[52px]" : "md:w-60"
      } ${open ? "translate-x-0 shadow-overlay" : "-translate-x-full"}`}
      style={
        {
          transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
          transitionTimingFunction: SIDEBAR_MOTION.easing,
          "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
          "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
          "--sidebar-easing": SIDEBAR_MOTION.easing,
        } as CSSProperties
      }
    >
      {/* header — app title + collapse control */}
      <div className="relative mb-2.5 flex h-9 shrink-0 items-center px-2">
        <div className="sidebar-copy flex min-w-0 flex-1 items-center gap-1.5 pl-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-accent text-[11px] font-semibold text-white">
            A
          </span>
          <span className="shrink-0 text-[14px] font-semibold whitespace-nowrap text-ink">Admin Agent</span>
          <BackendBadge status={status} />
        </div>
        <button
          type="button"
          aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
          title={collapsed ? "開く" : "閉じる"}
          onClick={onToggleCollapsed}
          className={`hidden size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink md:flex ${
            collapsed ? "md:absolute md:left-[10px]" : ""
          }`}
        >
          {collapsed ? <PanelLeftOpenIcon className="size-[18px]" /> : <PanelLeftCloseIcon className="size-[18px]" />}
        </button>
      </div>

      <GlideGroup>
        <RailButton
          disabled={disabled}
          icon={<SquarePenIcon className="size-[17px]" />}
          label="新しい会話"
          onClick={onNewConversation}
        />
      </GlideGroup>

      <div className={`mt-3 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] ${collapsed ? "md:invisible" : ""}`}>
        {/* section label ↔ search field */}
        <div className="sidebar-copy relative mx-2 mb-1 h-8">
          <div
            aria-hidden={searchOpen}
            className={`absolute inset-0 flex items-center px-2 text-[12.5px] font-medium text-ink-3 transition-[opacity,transform] ${
              searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100"
            }`}
            style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`, transitionTimingFunction: CHAT_SEARCH_MOTION.easing }}
          >
            会話履歴
          </div>

          <button
            type="button"
            aria-label="会話を検索"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}
            className={`absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color,transform] hover:bg-hover-2 hover:text-ink active:scale-[0.96] ${
              searchOpen ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
            style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms` }}
          >
            <SearchIcon className="size-4" />
          </button>

          <div
            className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${
              searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={{
              width: searchOpen ? "100%" : CHAT_SEARCH_MOTION.closedWidth,
              transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
              transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
            }}
          >
            <SearchIcon className="ml-2 size-[15px] shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
              }}
              placeholder="会話を検索"
              aria-label="会話履歴を検索"
              tabIndex={searchOpen ? 0 : -1}
              className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              aria-label="検索を閉じる"
              tabIndex={searchOpen ? 0 : -1}
              onClick={closeSearch}
              className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        <GlideGroup>
          {visibleSessions.map((session) => {
            const active = session.id === activeSessionId;
            const armed = confirmingDeleteId === session.id;

            if (renamingId === session.id) {
              return (
                <div key={session.id} className="sidebar-copy relative z-10 mx-2 px-0.5 py-0.5">
                  <input
                    aria-label="会話名を編集"
                    autoFocus
                    className="h-8 w-full rounded-[8px] bg-surface px-2 text-[13.5px] text-ink shadow-btn outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
                    onBlur={commitRename}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename();
                      } else if (event.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                    value={renameDraft}
                  />
                </div>
              );
            }

            return (
              <div
                key={session.id}
                data-row
                className={`sidebar-row group/row relative z-10 mx-2 flex h-8 w-[calc(100%-16px)] items-center rounded-[8px] transition-[width,background-color] duration-150 ${
                  active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
                }`}
              >
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => onSelectSession(session.id)}
                  title={`${session.title} · ${formatRelativeTime(session.updatedAt)}`}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left disabled:cursor-not-allowed"
                >
                  <span
                    className={`sidebar-copy min-w-0 flex-1 truncate text-[13.5px] ${
                      active ? "font-medium text-ink" : "text-ink-2"
                    }`}
                  >
                    {session.title}
                  </span>
                  <span className="sidebar-copy shrink-0 text-[11px] tabular-nums text-ink-3 group-hover/row:hidden group-focus-within/row:hidden">
                    {formatRelativeTime(session.updatedAt)}
                  </span>
                </button>
                <span
                  className={`sidebar-copy mr-0.5 shrink-0 items-center ${
                    armed ? "flex" : "flex md:hidden md:group-hover/row:flex md:group-focus-within/row:flex"
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`会話「${session.title}」の名前を変更`}
                    title="名前を変更"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRenamingId(session.id);
                      setRenameDraft(session.title);
                    }}
                    className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-line-strong hover:text-ink disabled:opacity-40"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={armed ? `もう一度クリックして会話「${session.title}」を削除` : `会話「${session.title}」を削除`}
                    title={armed ? "もう一度クリックして削除" : "削除"}
                    disabled={disabled}
                    onBlur={() => {
                      if (armed) setConfirmingDeleteId(null);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteClick(session.id);
                    }}
                    className={`flex size-7 items-center justify-center rounded-[7px] transition-colors disabled:opacity-40 ${
                      armed ? "bg-red text-white" : "text-ink-3 hover:bg-line-strong hover:text-red"
                    }`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
          {visibleSessions.length === 0 ? (
            <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">
              {normalizedQuery ? "該当する会話がありません" : "会話はまだありません"}
            </div>
          ) : null}
        </GlideGroup>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <GlideGroup>
          <RailButton
            icon={<SettingsIcon className="size-[17px]" />}
            label="設定"
            onClick={onOpenSettings}
          />
        </GlideGroup>
      </div>
    </aside>
  );
});

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { ImageIcon, MenuIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import LoadingState from "@/components/bui/loading-state";
import PromptBar, { type PromptBarHandle } from "@/components/bui/prompt-bar";
import { SidebarNav } from "@/components/bui/sidebar-nav";
import { AttachmentPreviewStrip } from "@/components/chat/attachment-strip";
import { ChatMessage } from "@/components/chat/message-parts";
import {
  PlanActionsProvider,
  type PlanActionsContextValue,
} from "@/components/chat/plan-actions-context";

// Loaded on first open so the dialog stays out of the initial bundle.
const SettingsDialog = dynamic(
  () =>
    import("@/components/chat/settings-dialog").then(
      (mod) => mod.SettingsDialog,
    ),
  { ssr: false },
);
import { toFileUIPart } from "@/lib/attachments";
import { formatChatError } from "@/lib/format";
import {
  compactConfirmationContext,
  getPlansKey,
  type PlanActionState,
  type PlanConfirmationContext,
} from "@/lib/tool-parts";
import { useAttachments } from "@/hooks/use-attachments";
import { useHealth } from "@/hooks/use-health";
import { useApiKeySettings } from "@/hooks/use-api-key-settings";
import { useSessions } from "@/hooks/use-sessions";
import { useToolsWarmup } from "@/hooks/use-tools-warmup";
import { collectPreviewExecutions } from "@/lib/ui-adapters";
import { compactMessagesForModelRequest } from "@/src/message-context";
import type { GoodsEditPlan } from "@/src/types";

// Filled into the composer (not sent), so the user can adjust before sending.
const STARTER_PROMPTS = [
  "胃腸薬を検索",
  "非公開の商品を一覧表示",
  "検索結果の最初の商品の価格を 980 円に変更",
];

export default function Home() {
  const [planActions, setPlanActions] = useState<
    Record<string, PlanActionState>
  >({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const promptBarRef = useRef<PromptBarHandle>(null);
  const conversationRef = useRef<StickToBottomContext>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          body,
          id,
          messageId,
          messages,
          trigger,
        }) => ({
          body: {
            ...body,
            id,
            messageId,
            messages: compactMessagesForModelRequest(messages),
            trigger,
          },
        }),
      }),
    [],
  );

  const {
    clearError,
    error,
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({ transport });

  const isLoading = status === "submitted" || status === "streaming";

  const attachments = useAttachments();
  const settings = useApiKeySettings({ clearError });
  const sessionStore = useSessions({
    isLoading,
    messages,
    onActivate: () => {
      setPlanActions({});
      attachments.resetAttachments();
      clearError();
      setSidebarOpen(false);
    },
    setMessages,
  });
  const { adminPublicBaseUrl, health } = useHealth();
  useToolsWarmup();

  const hasConversation = messages.length > 0;
  const latestMessage = messages[messages.length - 1];
  const showDetachedStreamingStatus =
    status === "streaming" && latestMessage?.role !== "assistant";

  const { apiKey, hasSavedApiKey } = settings;
  const buildRequestBody = useCallback(
    (extra?: Record<string, unknown>) => ({
      ...(hasSavedApiKey ? { apiKey: apiKey.trim() } : {}),
      ...(extra ?? {}),
    }),
    [apiKey, hasSavedApiKey],
  );

  function handleSubmit(text: string): boolean {

    if (
      attachments.pendingImages.some(
        (image) => image.uploadStatus !== "uploaded",
      )
    ) {
      attachments.setAttachmentError(
        "画像のアップロードが完了してから送信してください。",
      );
      return false;
    }

    const files = attachments.pendingImages.map(toFileUIPart);

    if ((!text && files.length === 0) || isLoading) {
      return false;
    }

    sessionStore.ensureActiveSession();
    clearError();
    // Sending re-attaches the view to the bottom even if the user had
    // scrolled up to read earlier results.
    void conversationRef.current?.scrollToBottom();
    void sendMessage(
      files.length > 0 ? (text ? { files, text } : { files }) : { text },
      { body: buildRequestBody() },
    );
    attachments.resetAttachments();
    return true;
  }

  const { ensureActiveSession } = sessionStore;
  const { setAttachmentError } = attachments;

  const handleConfirmPlans = useCallback(
    (plans: GoodsEditPlan[], confirmation?: PlanConfirmationContext) => {
      if (isLoading) {
        return;
      }

      const planKey = getPlansKey(plans, confirmation?.previewId);
      setPlanActions((current) => ({
        ...current,
        [planKey]: {
          plannedCount: confirmation?.plannedCount ?? plans.length,
          status: "submitted",
        },
      }));

      ensureActiveSession();
      clearError();
      setAttachmentError("");
      void conversationRef.current?.scrollToBottom();
      void sendMessage(
        { text: "確認して実行" },
        {
          body: buildRequestBody(
            confirmation?.previewId
              ? { confirmation: compactConfirmationContext(confirmation) }
              : undefined,
          ),
        },
      );
    },
    [
      buildRequestBody,
      clearError,
      ensureActiveSession,
      isLoading,
      sendMessage,
      setAttachmentError,
    ],
  );

  const handleConfirmPlan = useCallback(
    (plan: GoodsEditPlan) => {
      handleConfirmPlans([plan]);
    },
    [handleConfirmPlans],
  );

  const handleCancelPlans = useCallback(
    (plans: GoodsEditPlan[], confirmation?: PlanConfirmationContext) => {
      if (isLoading) {
        return;
      }

      setPlanActions((current) => ({
        ...current,
        [getPlansKey(plans, confirmation?.previewId)]: { status: "cancelled" },
      }));
    },
    [isLoading],
  );

  const handleCancelPlan = useCallback(
    (plan: GoodsEditPlan) => {
      handleCancelPlans([plan]);
    },
    [handleCancelPlans],
  );

  const handleToggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((value) => !value);
  }, []);

  // Recomputed per render (cheap), but only a changed outcome yields a new
  // object, so streaming tokens do not re-render every plan card.
  const previewExecutionsKey = JSON.stringify(
    collectPreviewExecutions(messages),
  );
  const previewExecutions = useMemo(
    () =>
      JSON.parse(previewExecutionsKey) as PlanActionsContextValue["previewExecutions"],
    [previewExecutionsKey],
  );

  const planActionsValue = useMemo<PlanActionsContextValue>(
    () => ({
      disabled: isLoading,
      onCancelPlan: handleCancelPlan,
      onCancelPlans: handleCancelPlans,
      onConfirmPlan: handleConfirmPlan,
      onConfirmPlans: handleConfirmPlans,
      planActions,
      previewExecutions,
    }),
    [
      handleCancelPlan,
      handleCancelPlans,
      handleConfirmPlan,
      handleConfirmPlans,
      isLoading,
      planActions,
      previewExecutions,
    ],
  );

  return (
    <main className="h-dvh overflow-hidden bg-surface text-ink">
      <div className="flex h-full w-full">
        <SidebarNav
          activeSessionId={sessionStore.activeSessionId}
          collapsed={sidebarCollapsed}
          disabled={isLoading}
          onDeleteSession={sessionStore.deleteSession}
          onNewConversation={sessionStore.newConversation}
          onOpenSettings={settings.openSettings}
          onRenameSession={sessionStore.renameSession}
          onSelectSession={sessionStore.selectSession}
          onToggleCollapsed={handleToggleSidebarCollapsed}
          open={sidebarOpen}
          sessions={sessionStore.sessions}
          status={health}
        />
        {sidebarOpen ? (
          <button
            aria-label="サイドバーを閉じる"
            className="fixed inset-0 z-30 bg-ink/20 md:hidden"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col bg-surface">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
            <button
              aria-label="サイドバーを開く"
              className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <MenuIcon className="size-[18px]" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-ink">
                Admin Agent
              </div>
              <div className="text-[11px] text-ink-3">{health}</div>
            </div>
          </header>

          <div className="flex min-h-0 w-full flex-1 flex-col py-4 sm:py-6">
            <section
              aria-label="チャット"
              className="relative flex min-h-0 flex-1 flex-col"
            >
              <Conversation
                className="min-h-0 w-full flex-1"
                contextRef={conversationRef}
              >
                {!hasConversation ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
                    <div
                      className="text-[18px] font-semibold tracking-tight text-ink"
                      style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
                    >
                      今日は何を進めますか？
                    </div>
                    <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
                      {STARTER_PROMPTS.map((prompt, index) => (
                        <button
                          className="inline-flex h-8 items-center rounded-full bg-surface px-3 text-[12.5px] text-ink-2 shadow-btn transition-[background-color,color,transform] hover:bg-inset hover:text-ink active:scale-[0.97]"
                          key={prompt}
                          onClick={() => promptBarRef.current?.setDraft(prompt)}
                          style={{
                            animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${120 + index * 60}ms both`,
                          }}
                          type="button"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-6 px-4 py-4 sm:px-0 sm:py-6">
                  <PlanActionsProvider value={planActionsValue}>
                    {hasConversation
                      ? messages.map((message) => (
                          <ChatMessage
                            key={message.id}
                            mediaBaseUrl={adminPublicBaseUrl}
                            message={message}
                          />
                        ))
                      : null}
                  </PlanActionsProvider>

                  {status === "submitted" ? (
                    <LoadingState label="考え中" />
                  ) : null}
                  {showDetachedStreamingStatus ? (
                    <LoadingState label="実行中" />
                  ) : null}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>

              <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-1 pt-3 sm:px-0">
                {error ? (
                  <ErrorBanner onDismiss={clearError}>
                    {formatChatError(error.message)}
                  </ErrorBanner>
                ) : null}
                {attachments.attachmentError ? (
                  <ErrorBanner onDismiss={() => setAttachmentError("")}>
                    {attachments.attachmentError}
                  </ErrorBanner>
                ) : null}

                <PromptBar
                  apiRef={promptBarRef}
                  attachments={
                    attachments.pendingImages.length > 0 ? (
                      <AttachmentPreviewStrip
                        attachments={attachments.pendingImages}
                        onRemove={attachments.removePendingImage}
                      />
                    ) : null
                  }
                  dragging={attachments.draggingImages}
                  hasAttachments={attachments.pendingImages.length > 0}
                  menuDisabled={isLoading}
                  menuItems={[
                    {
                      desc: "商品画像をアップロード",
                      icon: <ImageIcon className="size-[15px]" />,
                      key: "image",
                      name: "画像",
                      onSelect: () =>
                        attachments.attachmentInputRef.current?.click(),
                    },
                  ]}
                  onDragLeave={attachments.handlePromptDragLeave}
                  onDragOver={attachments.handlePromptDragOver}
                  onDrop={attachments.handlePromptDrop}
                  onStop={stop}
                  onSubmit={handleSubmit}
                  placeholder="指示を入力（例：「胃腸薬を検索」）"
                  sendDisabled={
                    attachments.isUploadingImages ||
                    attachments.hasAttachmentErrors
                  }
                  sendTitle={
                    attachments.isUploadingImages
                      ? "画像のアップロード完了後に送信できます"
                      : attachments.hasAttachmentErrors
                        ? "アップロードに失敗した画像を削除してください"
                        : undefined
                  }
                  status={status}
                />
                <input
                  accept="image/*"
                  className="hidden"
                  multiple
                  onChange={attachments.handleAttachmentInputChange}
                  ref={attachments.attachmentInputRef}
                  type="file"
                />
              </div>
            </section>
          </div>
        </div>
      </div>
      {settings.settingsOpen ? (
        <SettingsDialog
          apiKeyDraft={settings.apiKeyDraft}
          apiKeySaved={settings.hasSavedApiKey}
          message={settings.settingsMessage}
          onChangeApiKeyDraft={settings.setApiKeyDraft}
          onClearApiKey={settings.clearApiKey}
          onClose={() => settings.setSettingsOpen(false)}
          onSaveApiKey={settings.saveApiKey}
          open={settings.settingsOpen}
        />
      ) : null}
    </main>
  );
}

function ErrorBanner({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-control bg-red-tint py-2 pr-1.5 pl-3 text-[12.5px] leading-5 text-red"
      role="alert"
      style={{ animation: "fade-up 200ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <span className="min-w-0 flex-1 break-words">{children}</span>
      <button
        aria-label="通知を閉じる"
        className="-my-0.5 flex size-6 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-red/10"
        onClick={onDismiss}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

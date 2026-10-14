"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";

const API_KEY_STORAGE_KEY = "shop-ops-agent.apiKey.anthropic";

export function useApiKeySettings({
  clearError,
}: {
  clearError: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setApiKey(window.localStorage.getItem(API_KEY_STORAGE_KEY) || "");
  }, []);

  const hasSavedApiKey = apiKey.trim().length > 0;

  const openSettings = useCallback(() => {
    setApiKeyDraft("");
    setSettingsMessage("");
    setSettingsOpen(true);
  }, []);

  const saveApiKey = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextApiKey = apiKeyDraft.trim();

      if (!nextApiKey) {
        setSettingsMessage("API キーを入力してください");
        return;
      }

      window.localStorage.setItem(API_KEY_STORAGE_KEY, nextApiKey);
      setApiKey(nextApiKey);
      setApiKeyDraft("");
      setSettingsMessage("保存しました");
      clearError();
    },
    [apiKeyDraft, clearError],
  );

  const clearApiKey = useCallback(() => {
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey("");
    setApiKeyDraft("");
    setSettingsMessage("クリアしました");
    clearError();
  }, [clearError]);

  return {
    apiKey,
    apiKeyDraft,
    clearApiKey,
    hasSavedApiKey,
    openSettings,
    saveApiKey,
    setApiKeyDraft,
    setSettingsOpen,
    settingsMessage,
    settingsOpen,
  };
}

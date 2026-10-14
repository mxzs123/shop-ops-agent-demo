"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACTIVE_SESSION_STORAGE_KEY,
  createSessionId,
  getSessionTitle,
  MAX_SAVED_SESSIONS,
  readStoredSessions,
  stripTransientFileParts,
  writeStoredSessions,
  type ChatSession,
} from "@/lib/sessions";

interface UseSessionsOptions {
  isLoading: boolean;
  messages: UIMessage[];
  /** Extra UI resets to run whenever a session is activated (switch/new/delete). */
  onActivate?: () => void;
  setMessages: (messages: UIMessage[]) => void;
}

export function useSessions({
  isLoading,
  messages,
  onActivate,
  setMessages,
}: UseSessionsOptions) {
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const skipNextHistorySaveRef = useRef(false);
  // Callbacks below stay referentially stable so memoized consumers
  // (sidebar, message list) skip re-renders during streaming.
  const onActivateRef = useRef(onActivate);

  useEffect(() => {
    onActivateRef.current = onActivate;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedSessions = readStoredSessions();
    const storedActiveId = window.localStorage.getItem(
      ACTIVE_SESSION_STORAGE_KEY,
    );
    const activeId =
      storedActiveId &&
      storedSessions.some((session) => session.id === storedActiveId)
        ? storedActiveId
        : (storedSessions[0]?.id ?? createSessionId());
    const activeSession = storedSessions.find(
      (session) => session.id === activeId,
    );

    setSessions(storedSessions);
    setActiveSessionId(activeId);
    skipNextHistorySaveRef.current = Boolean(activeSession);
    setMessages(activeSession?.messages ?? []);
    setHistoryLoaded(true);
  }, [setMessages]);

  useEffect(() => {
    if (!historyLoaded || !activeSessionId || messages.length === 0) {
      return;
    }

    if (skipNextHistorySaveRef.current) {
      skipNextHistorySaveRef.current = false;
      return;
    }

    if (isLoading) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const now = Date.now();
      const storedMessages = stripTransientFileParts(messages);
      setSessions((current) => {
        const existing = current.find(
          (session) => session.id === activeSessionId,
        );
        const nextSession: ChatSession = {
          createdAt: existing?.createdAt ?? now,
          id: activeSessionId,
          messages: storedMessages,
          // Keep an existing (possibly user-renamed) title; only derive one
          // for sessions that do not have a title yet.
          title: existing?.title || getSessionTitle(messages) || "新しい会話",
          updatedAt: now,
        };
        const nextSessions = [
          nextSession,
          ...current.filter((session) => session.id !== activeSessionId),
        ].slice(0, MAX_SAVED_SESSIONS);

        writeStoredSessions(nextSessions);
        return nextSessions;
      });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [activeSessionId, historyLoaded, isLoading, messages]);

  useEffect(() => {
    if (!historyLoaded || !activeSessionId || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  }, [activeSessionId, historyLoaded]);

  const activateSession = useCallback(
    (session?: ChatSession) => {
      setActiveSessionId(session?.id ?? createSessionId());
      skipNextHistorySaveRef.current = Boolean(session);
      setMessages(session?.messages ?? []);
      onActivateRef.current?.();
    },
    [setMessages],
  );

  /** Lazily assigns a session id right before the first message is sent. */
  const ensureActiveSession = useCallback(() => {
    if (!activeSessionId) {
      setActiveSessionId(createSessionId());
    }
  }, [activeSessionId]);

  const newConversation = useCallback(() => {
    if (isLoading) {
      return;
    }

    activateSession();
  }, [activateSession, isLoading]);

  const selectSession = useCallback(
    (sessionId: string) => {
      if (isLoading || sessionId === activeSessionId) {
        return;
      }

      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return;
      }

      activateSession(session);
    },
    [activateSession, activeSessionId, isLoading, sessions],
  );

  const renameSession = useCallback((sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    setSessions((current) => {
      const next = current.map((session) =>
        session.id === sessionId ? { ...session, title: trimmed } : session,
      );
      writeStoredSessions(next);
      return next;
    });
  }, []);

  const deleteSession = useCallback(
    (sessionId: string) => {
      if (isLoading) {
        return;
      }

      const nextSessions = sessions.filter(
        (session) => session.id !== sessionId,
      );
      setSessions(nextSessions);
      writeStoredSessions(nextSessions);

      if (sessionId !== activeSessionId) {
        return;
      }

      activateSession(nextSessions[0]);
    },
    [activateSession, activeSessionId, isLoading, sessions],
  );

  return {
    activeSessionId,
    deleteSession,
    ensureActiveSession,
    newConversation,
    renameSession,
    selectSession,
    sessions,
  };
}

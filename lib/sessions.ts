import type { UIMessage } from "ai";

import { getMessageText, isRecord } from "@/lib/format";
import { compactMessagesForStorage } from "@/src/message-context";

export interface ChatSession {
  createdAt: number;
  id: string;
  messages: UIMessage[];
  title: string;
  updatedAt: number;
}

export const CHAT_SESSIONS_STORAGE_KEY = "shop-ops-agent.chatSessions";
export const ACTIVE_SESSION_STORAGE_KEY = "shop-ops-agent.activeSessionId";
export const MAX_SAVED_SESSIONS = 30;

export function stripTransientFileParts(messages: UIMessage[]): UIMessage[] {
  return compactMessagesForStorage(messages);
}

export function readStoredSessions(): ChatSession[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isChatSession)
      .map((session) => ({
        ...session,
        messages: stripTransientFileParts(session.messages),
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SAVED_SESSIONS);
  } catch {
    return [];
  }
}

export function writeStoredSessions(sessions: ChatSession[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const durableSessions = sessions.map((session) => ({
      ...session,
      messages: stripTransientFileParts(session.messages),
    }));

    window.localStorage.setItem(
      CHAT_SESSIONS_STORAGE_KEY,
      JSON.stringify(durableSessions.slice(0, MAX_SAVED_SESSIONS)),
    );
  } catch {
    // localStorage can fail in private windows or when storage is full.
  }
}

function isChatSession(value: unknown): value is ChatSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.messages)
  );
}

export function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionTitle(messages: UIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const firstUserText = firstUserMessage
    ? getMessageText(firstUserMessage)
    : "";

  if (
    !firstUserText &&
    firstUserMessage?.parts.some((part) => part.type === "file")
  ) {
    return "图片消息";
  }

  if (!firstUserText) {
    return "";
  }

  return firstUserText.length > 28
    ? `${firstUserText.slice(0, 28)}...`
    : firstUserText;
}

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const MODEL_LABEL = "Claude";
export const MODEL_ID =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

// Claude accepts these inline; anything else stays text-only.
export const IMAGE_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function createChatModel(
  apiKey: string,
  options: { fetch?: typeof globalThis.fetch } = {},
): LanguageModel {
  return createAnthropic({ apiKey, fetch: options.fetch })(MODEL_ID);
}

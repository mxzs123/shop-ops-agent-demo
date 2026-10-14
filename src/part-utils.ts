import type { UIMessage } from "ai";

/**
 * Small shared helpers for inspecting AI SDK message parts and untyped JSON,
 * so the chat route and the message-context compactor cannot drift apart.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readToolName(
  part: UIMessage["parts"][number],
): string | undefined {
  if (part.type === "dynamic-tool") {
    return part.toolName;
  }

  if (part.type.startsWith("tool-")) {
    return part.type.replace(/^tool-/, "");
  }

  return undefined;
}

export function readToolPartOutput(part: UIMessage["parts"][number]): unknown {
  if (
    "state" in part &&
    part.state === "output-available" &&
    "output" in part
  ) {
    return part.output;
  }

  return undefined;
}

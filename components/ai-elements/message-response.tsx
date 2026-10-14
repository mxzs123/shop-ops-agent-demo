"use client";

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

/**
 * Markdown renderer body. Loaded lazily (see message.tsx) so the markdown
 * pipeline (streamdown + katex/shiki/mermaid glue) stays out of the initial
 * page bundle.
 */
const MessageResponseBody = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "agent-markdown size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      controls={{
        code: true,
        mermaid: true,
        table: false,
      }}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponseBody.displayName = "MessageResponseBody";

export default MessageResponseBody;

"use client";

import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { lazy, Suspense } from "react";

import type { MessageResponseProps } from "@/components/ai-elements/message-response";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 text-sm text-ink",
      // Only the user bubble clips; assistant cards need overflow visible so
      // sticky confirm bars can pin to the conversation viewport.
      "group-[.is-user]:ml-auto group-[.is-user]:overflow-hidden group-[.is-user]:rounded-[14px] group-[.is-user]:bg-canvas group-[.is-user]:px-3.5 group-[.is-user]:py-2.5",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type { MessageResponseProps };

const LazyMessageResponseBody = lazy(
  () => import("@/components/ai-elements/message-response"),
);

/**
 * The markdown pipeline (streamdown + katex/shiki/mermaid glue) is by far
 * the heaviest client dependency, and no markdown is on screen until the
 * first assistant response arrives. Loading it on demand keeps the initial
 * page bundle small; the plain-text fallback avoids a blank flash while the
 * chunk loads mid-conversation.
 */
export const MessageResponse = (props: MessageResponseProps) => (
  <Suspense
    fallback={
      <div className="agent-markdown whitespace-pre-wrap">
        {typeof props.children === "string" ? props.children : null}
      </div>
    }
  >
    <LazyMessageResponseBody {...props} />
  </Suspense>
);

"use client";

import type { FileUIPart, UIMessage } from "ai";
import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";

import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import ThinkingState from "@/components/bui/thinking-state";
import ToolChips from "@/components/bui/tool-chips";
import { usePlanActions } from "@/components/chat/plan-actions-context";
import {
  ExecutionCard,
  PendingExecutionCard,
} from "@/components/tool-cards/execution-card";
import { BatchPlanCard, PlanCard } from "@/components/tool-cards/plan-card";
import { SearchResultCard } from "@/components/tool-cards/search-card";
import { isRecord } from "@/lib/format";
import { IMAGE_FILE_PATTERN } from "@/lib/media";
import {
  collectConsecutivePlans,
  EXECUTE_TOOL_NAMES,
  getPlanConfirmationContext,
  getPlansKey,
  isToolPart,
  PLAN_TOOL_NAMES,
  readToolOutput,
  readToolPartName,
  readToolPartState,
  toolPendingMessage,
  type PlanActionState,
  type ToolOutput,
} from "@/lib/tool-parts";
import { toolPartLayout, toolRunHeader, toToolChipStep } from "@/lib/ui-adapters";
import type {
  GoodsBatchEditExecution,
  GoodsBatchEditPlan,
  GoodsEditExecution,
  GoodsEditPlan,
  GoodsSearchResult,
} from "@/src/types";

type MessagePart = UIMessage["parts"][number];

export interface ChatMessageProps {
  mediaBaseUrl: string;
  message: UIMessage;
}

/**
 * One chat entry (bubble + tool cards). Memoized so that while a response
 * streams in, only the message being updated re-renders instead of the whole
 * conversation log. Plan confirmation state lives in PlanActionsContext, so
 * both props stay referentially stable for settled messages.
 */
export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  const { message } = props;

  return (
    <Message className="msg-enter max-w-full" from={message.role}>
      <MessageContent
        className={
          message.role === "user"
            ? "max-w-[min(36rem,88vw)]"
            : "w-full max-w-3xl"
        }
      >
        <MessageParts {...props} />
      </MessageContent>
    </Message>
  );
});

/**
 * A reasoning block is "settled" once a later part carries real content
 * (answer text, a tool call, or the next reasoning block). Computed in one
 * forward pass instead of a nested scan per reasoning part.
 */
function computeSettledFlags(parts: UIMessage["parts"]): boolean[] {
  const settled = new Array<boolean>(parts.length).fill(false);
  let lastContentIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    settled[index] = lastContentIndex > index;
    const part = parts[index];
    if (!part) {
      continue;
    }
    const isContent =
      part.type === "text" || part.type === "reasoning"
        ? part.text.trim().length > 0
        : isToolPart(part);
    if (isContent) {
      lastContentIndex = index;
    }
  }

  return settled;
}

function toolCallKey(part: MessagePart, index: number) {
  return "toolCallId" in part ? part.toolCallId : `tool-${index}`;
}

export function MessageParts({ mediaBaseUrl, message }: ChatMessageProps) {
  const nodes: ReactNode[] = [];
  const settledFlags = computeSettledFlags(message.parts);

  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index];
    if (!part) {
      continue;
    }

    if (part.type === "reasoning") {
      // Reasoning parts stay in message state (the provider replays them);
      // they are only rendered here, never filtered out.
      if (part.text.trim()) {
        nodes.push(
          <ThinkingState
            activeLabel="考え中"
            doneLabel="思考の過程"
            key={`reasoning-${index}`}
            working={!(settledFlags[index] ?? false)}
          >
            {part.text.trim()}
          </ThinkingState>,
        );
      }
      continue;
    }

    if (part.type === "text") {
      if (part.text.trim()) {
        nodes.push(
          <MessageResponse
            isAnimating={part.state === "streaming"}
            key={`text-${index}`}
          >
            {part.text}
          </MessageResponse>,
        );
      }
      continue;
    }

    if (part.type === "file") {
      nodes.push(<MessageFilePart key={`file-${index}`} part={part} />);
      continue;
    }

    if (!isToolPart(part)) {
      continue;
    }

    const groupedPlans = collectConsecutivePlans(message.parts, index);
    if (groupedPlans.plans.length > 1) {
      nodes.push(
        <BatchPlanCard
          key={`batch-plan-${index}`}
          mediaBaseUrl={mediaBaseUrl}
          plans={groupedPlans.plans}
        />,
      );
      index += groupedPlans.consumed - 1;
      continue;
    }

    if (toolPartLayout(part) === "card") {
      nodes.push(
        <ToolCard
          key={toolCallKey(part, index)}
          mediaBaseUrl={mediaBaseUrl}
          part={part}
        />,
      );
      continue;
    }

    // Consecutive lightweight tool calls (running, failed, or finished
    // without a card of their own) collapse into one ToolChips run.
    const runKey = toolCallKey(part, index);
    const steps = [toToolChipStep(part, runKey)];
    while (index + 1 < message.parts.length) {
      const next = message.parts[index + 1];
      if (!next || !isToolPart(next) || toolPartLayout(next) !== "chip") {
        break;
      }
      index += 1;
      steps.push(toToolChipStep(next, toolCallKey(next, index)));
    }
    nodes.push(
      <ToolChips
        header={toolRunHeader(steps)}
        key={`tools-${runKey}`}
        steps={steps}
      />,
    );
  }

  if (nodes.length === 0) {
    return null;
  }

  return <div className="space-y-4">{nodes}</div>;
}

function MessageFilePart({ part }: { part: FileUIPart }) {
  const isImage = IMAGE_FILE_PATTERN.test(part.mediaType);

  if (!isImage) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-chip bg-field px-2 py-1.5 text-[12px] font-medium text-ink shadow-hairline">
        <ImageIcon className="size-3.5 shrink-0 text-ink-2" />
        <span className="truncate">{part.filename ?? "添付ファイル"}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      <div
        aria-label={part.filename ?? "画像の添付"}
        className="h-72 w-[22rem] max-w-full bg-contain bg-center bg-no-repeat"
        role="img"
        style={{ backgroundImage: `url(${part.url})` }}
      />
    </div>
  );
}

/**
 * A pending execute part only carries the previewId, so the frozen target
 * count is recovered from the confirmation stored in planActions under the
 * same preview key.
 */
function readPendingPlannedCount(
  part: MessagePart,
  name: string,
  planActions: Record<string, PlanActionState>,
): number | undefined {
  if (!EXECUTE_TOOL_NAMES.has(name)) {
    return undefined;
  }

  const input = "input" in part ? part.input : undefined;
  if (!isRecord(input) || typeof input.previewId !== "string") {
    return undefined;
  }

  const action = planActions[getPlansKey([], input.previewId)];
  return action?.status === "submitted" ? action.plannedCount : undefined;
}

/** Card-layout tool parts: search results, plan diffs, execution rows. */
function ToolCard({
  mediaBaseUrl,
  part,
}: {
  mediaBaseUrl: string;
  part: MessagePart;
}) {
  const { planActions } = usePlanActions();
  const name = readToolPartName(part);

  if (!name) {
    return null;
  }

  if (readToolPartState(part) !== "output-available") {
    return (
      <PendingExecutionCard
        label={toolPendingMessage(
          name,
          readPendingPlannedCount(part, name, planActions),
        )}
      />
    );
  }

  const output = readToolOutput("output" in part ? part.output : undefined);

  if (name === "goods_search") {
    return (
      <SearchResultCard output={output as ToolOutput<GoodsSearchResult>} />
    );
  }

  if (PLAN_TOOL_NAMES.has(name)) {
    const data = output.data;
    // All plan tools now return the batch shape with items[]. Bare plans only
    // appear in restored legacy sessions and keep the single-plan card.
    if (!isRecord(data) || !Array.isArray(data.items)) {
      return (
        <PlanCard
          mediaBaseUrl={mediaBaseUrl}
          output={output as ToolOutput<GoodsEditPlan>}
        />
      );
    }

    const batchOutput = output as ToolOutput<GoodsBatchEditPlan>;
    const plans = batchOutput.data?.items ?? [];
    const confirmation = getPlanConfirmationContext(batchOutput.data);

    return (
      <BatchPlanCard
        confirmation={confirmation}
        mediaBaseUrl={mediaBaseUrl}
        plan={batchOutput.data}
        plans={plans}
      />
    );
  }

  return (
    <ExecutionCard
      output={output as ToolOutput<GoodsBatchEditExecution | GoodsEditExecution>}
    />
  );
}

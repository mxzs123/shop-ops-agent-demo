"use client";

import { createContext, useContext } from "react";

import type {
  PlanActionState,
  PlanConfirmationContext,
} from "@/lib/tool-parts";
import type { PreviewExecutionState } from "@/lib/ui-adapters";
import type { GoodsEditPlan } from "@/src/types";

/**
 * Plan confirmation state and handlers, provided once at the page level.
 * Plan cards subscribe directly, so confirming or cancelling one plan (or
 * toggling the global busy flag) re-renders only the plan cards instead of
 * invalidating the memoized message list.
 */
export interface PlanActionsContextValue {
  disabled: boolean;
  onCancelPlan: (plan: GoodsEditPlan) => void;
  onCancelPlans: (
    plans: GoodsEditPlan[],
    confirmation?: PlanConfirmationContext,
  ) => void;
  onConfirmPlan: (plan: GoodsEditPlan) => void;
  onConfirmPlans: (
    plans: GoodsEditPlan[],
    confirmation?: PlanConfirmationContext,
  ) => void;
  planActions: Record<string, PlanActionState>;
  /** execute outcome per previewId, derived from the conversation */
  previewExecutions: Record<string, PreviewExecutionState>;
}

const noop = () => {};

const PlanActionsContext = createContext<PlanActionsContextValue>({
  disabled: false,
  onCancelPlan: noop,
  onCancelPlans: noop,
  onConfirmPlan: noop,
  onConfirmPlans: noop,
  planActions: {},
  previewExecutions: {},
});

export const PlanActionsProvider = PlanActionsContext.Provider;

export function usePlanActions(): PlanActionsContextValue {
  return useContext(PlanActionsContext);
}

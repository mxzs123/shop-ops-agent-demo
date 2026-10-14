"use client";

import { useEffect } from "react";

/**
 * Pre-compiles the tool route in dev by pinging the warmup endpoint once the
 * main thread is idle. Failures are harmless.
 */
export function useToolsWarmup() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const warmToolsRoute = () => {
      if (cancelled) {
        return;
      }

      void fetch("/api/tools/_warmup", {
        cache: "no-store",
        method: "GET",
      }).catch(() => {
        // The warmup is only a dev-time latency hint; failures are harmless.
      });
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(warmToolsRoute, { timeout: 3_000 });
    } else {
      timeoutId = globalThis.setTimeout(warmToolsRoute, 1_500);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, []);
}

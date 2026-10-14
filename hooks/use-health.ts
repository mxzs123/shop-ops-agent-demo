"use client";

import { useEffect, useState } from "react";

export function useHealth() {
  const [health, setHealth] = useState("確認中");
  const [adminPublicBaseUrl, setAdminPublicBaseUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/health", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (typeof data.adminPublicBaseUrl !== "string") {
          throw new Error("health に adminPublicBaseUrl がありません");
        }

        setAdminPublicBaseUrl(data.adminPublicBaseUrl);
        setHealth(data.backend === "fixture" ? "Fixture" : "Shadow");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setAdminPublicBaseUrl("");
        setHealth(error instanceof Error ? error.message : "オフライン");
      });

    return () => controller.abort();
  }, []);

  return { adminPublicBaseUrl, health };
}

import type { Metadata } from "next";

import { cn } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Agent",
  description: "面向日常商品运营的 AI 助手。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={cn("font-sans")} lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

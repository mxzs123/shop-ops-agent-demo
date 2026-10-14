import type { Metadata } from "next";

import { cn } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Agent",
  description: "日々の商品運営を手伝う AI アシスタント。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={cn("font-sans")} lang="ja">
      <body>{children}</body>
    </html>
  );
}

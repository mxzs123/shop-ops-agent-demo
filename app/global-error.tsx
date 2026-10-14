"use client";

// global-error replaces the root layout, so it must pull in the stylesheet
// itself or the Tailwind classes below render unstyled.
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-page px-6 font-sans text-ink">
          <div className="w-full max-w-md">
            <div className="text-sm font-semibold text-accent">
              Admin Agent
            </div>
            <h1 className="mt-3 text-2xl font-semibold">システムエラー</h1>
            <p className="mt-3 text-sm leading-6 text-ink-2">
              {error.message || "アプリの初期化中にエラーが発生しました。"}
            </p>
            <button
              className="mt-6 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-white transition-[background-color,transform] hover:bg-accent-ink active:scale-[0.96]"
              onClick={reset}
              type="button"
            >
              再読み込み
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

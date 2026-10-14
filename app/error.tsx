"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-6 text-ink">
      <div className="w-full max-w-md">
        <div className="text-sm font-semibold text-accent">Admin Agent</div>
        <h1 className="mt-3 text-2xl font-semibold">页面加载失败</h1>
        <p className="mt-3 text-sm leading-6 text-ink-2">
          {error.message || "客户端渲染过程中出现错误。"}
        </p>
        <button
          className="mt-6 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-white transition-[background-color,transform] hover:bg-accent-ink active:scale-[0.96]"
          onClick={reset}
          type="button"
        >
          重新加载
        </button>
      </div>
    </main>
  );
}

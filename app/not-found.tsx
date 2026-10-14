export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-6 text-ink">
      <div className="w-full max-w-md">
        <div className="text-sm font-semibold text-accent">Admin Agent</div>
        <h1 className="mt-3 text-2xl font-semibold">ページが見つかりません</h1>
        <p className="mt-3 text-sm leading-6 text-ink-2">
          Admin Agent の画面に戻って操作を続けてください。
        </p>
      </div>
    </main>
  );
}

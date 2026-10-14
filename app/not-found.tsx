export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-6 text-ink">
      <div className="w-full max-w-md">
        <div className="text-sm font-semibold text-accent">Admin Agent</div>
        <h1 className="mt-3 text-2xl font-semibold">页面不存在</h1>
        <p className="mt-3 text-sm leading-6 text-ink-2">
          请回到 Admin Agent 工作台继续操作。
        </p>
      </div>
    </main>
  );
}

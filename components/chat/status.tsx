/** Small ring spinner matching the BUI trace rows. */
export function LoadingArc() {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
      style={{ animation: "spin 700ms linear infinite" }}
    />
  );
}

# Admin Agent Playbook

Short guide for coding agents working in this repo.

## Mission

Build a safe, chat-first assistant for a small shop's goods operations.
The core loop is: search goods -> read editable state -> preview -> user review
-> execute after explicit confirmation -> audit log.

Tool cards are review surfaces, not decorative cards.

## Red Lines

- The default backend is `fixture`; keep the demo runnable with no external system.
- Never point dev or tests at a production admin environment.
- Non-fixture writes require `ADMIN_AGENT_ALLOW_WRITES=true`.
- Mutations require preview first, then explicit user confirmation.
- Preserve audit logging and stale-preview rejection on write paths.
- Never commit real keys, cookies, auth headers, `.env` values, or real shop data.
- Do not show raw `patch`, `expectedChanges`, or tool JSON in chat bubbles.

## Tool Flow

Tools: `goods_search`, `goods_get_editable`, `goods_plan_edit`,
`goods_plan_create`, `goods_plan_delete`, `goods_plan_filter_edit`,
`goods_execute`.

- Every plan tool accepts one or many targets, freezes the operations in the
  server-side preview store, and returns a `previewId` plus a sample.
- `goods_execute` is the only write tool: it takes a `previewId`, dispatches
  by stored preview kind (edit/create/delete), and never accepts raw
  patches/items from the model.
- A preview card's confirm button executes that `previewId` directly in
  `app/api/chat/route.ts` without a model call; typed confirmations still go
  through the model and `src/confirmation.ts`.
- Single and multiple items share the same flow: one plan call, one preview
  card, one confirmation, one execute.
- Earlier turns are sent to Claude without their reasoning parts, because the
  history is trimmed and compacted before each request.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm test
```

Default URL: `http://127.0.0.1:18083`.

## Verify

- Code: `pnpm typecheck`.
- Routes/tools: also run `pnpm build` and `pnpm test`.
- Writes: test on the fixture, and confirm audit logs plus stale-preview rejection.

Done means the requested behavior works, safety gates remain, conversation/tool
ordering is preserved, and relevant checks pass or blockers are reported.

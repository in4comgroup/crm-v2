# 02 — Libraries: versions and upgrade (R7)

Checked 2026-11-16 against npm, GitHub releases and the official docs. Sources at the end.

## 1. Versions

| Package | Installed | Latest | Gap | Needed for this spec? |
|---|---|---|---|---|
| `ai` | 6.0.146 | **7.0.173** | major | Yes — upgrade (§2) |
| `@ai-sdk/react` | 3.0.148 | **4.0.177** | major | Yes, with `ai` 7 |
| `@ai-sdk/google` | 3.0.58 | **4.0.121** | major | Yes, with `ai` 7 (only inside the gateway adapter) |
| `@json-render/core`, `/react`, `/shadcn` | 0.16.0 | 0.23.1 | minor (pre-1.0) | Recommended (§3) |
| `streamdown` | 2.5.0 | 2.7.1 | minor | Recommended (§4) |
| `@streamdown/code` | 1.1.1 | **2.0.0** | major (Shiki 3 → 4) | Optional, with streamdown |
| `@streamdown/math`, `/mermaid`, `/cjk` | 1.0.2–1.0.3 | 1.0.3–1.0.4 | patch | Yes, with streamdown |
| ai-elements (copied, `src/components/ai-elements/`) | copied code | 1.9.1, **deprecated end of Nov 2026 → moved into shadcn/ui** | — | Keep the copied files; take new parts from shadcn (§5) |
| `recharts` | 3.8.0 | 3.10.1 | minor | Optional (§6) |
| `@tanstack/react-table` | 8.21.3 | **9.3.1** | major | Yes — in CH0 if safe (Q18, §6) |
| `next` / `react` | 16.2.6 / 19.2.4 | 16.4.6 / 19.3.1 | minor | Not for this spec |

Runtime: local Node is 24.22; AI SDK 7 needs Node ≥ 22 and is ESM only. The Vercel project must run Node 22+ (Node 24 is the Vercel default). `package.json` has no `"type": "module"`; Next.js bundles ESM packages, so app code is fine — check `scripts/*` run by `tsx` that import `ai`.

## 2. AI SDK 6 → 7

Can the current version (6) do everything this spec needs? **Yes** — tools, `toModelOutput`, data parts, transient parts, `prepareStep` all exist in v6. **We still upgrade first**, because: v6 is now the `ai-v6` legacy line; the gateway web-search tools (§5 of the spec) and new docs / examples target v7; json-render, ai-elements → shadcn and the `@ai-sdk/otel` telemetry move to v7; doing the upgrade before the chat rewrite means the new code is written once.

Codemod: `npx @ai-sdk/codemod v7` (then review). Touch points in this repo: 39 files import from `ai`, 5 use `stepCountIs`; the main work is in `src/server/ai/runtime.ts`, `types.ts` and the gateway adapter.

Breaking changes that matter here:

| v6 | v7 | Where it hits |
|---|---|---|
| `stepCountIs(n)` | `isStepCount(n)` | 5 files (chat, web search, analytics assistant, …) |
| `system:` | `instructions:` (old still accepted); system messages inside `messages` are rejected by default | runtime pass-through, every caller |
| `experimental_output` / `result.experimental_output` | `output` / `result.output` (`Output.object` unchanged) | parsers, topics |
| `onFinish` / `onStepFinish` | `onEnd` / `onStepEnd` (aliases kept) | runtime wraps these for the usage ledger — **must be re-tested** |
| top-level `result.usage` = last step; `totalUsage` | `usage` = all steps; `finalStep.usage` = last step | `src/server/ai/usage.ts` token counts — risk of double counting |
| top-level `providerMetadata`, `response`, `reasoning` | deprecated → `finalStep.*` / per `steps[]` | adapter `readResult` (gateway cost, generation id, model attempts) |
| `usage.cachedInputTokens`, `reasoningTokens` | `inputTokenDetails.cacheReadTokens`, `outputTokenDetails.reasoningTokens` | usage ledger |
| `result.toUIMessageStreamResponse()` | `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` (old deprecated) | chat + analytics routes |
| `result.fullStream` | `result.stream` (alias kept) | — |
| `needsApproval` | `toolApproval` | not used |
| `experimental_context` | `context` / `runtimeContext` / `toolsContext` | not used today; useful for binding the org id |
| `experimental_telemetry` | `telemetry` + `@ai-sdk/otel` | not used |
| `@ai-sdk/google` `createGoogleGenerativeAI` | `createGoogle` (old alias kept) | gateway adapter |
| UI: new part type `reasoning-file`; `{ type: "image" }` → `{ type: "file" }` | | part switch in `ai-chat.tsx` |

Not confirmed from docs (verify by type-check + test in CH0): `useChat` / `DefaultChatTransport` changes in `@ai-sdk/react` 4; data-part `id` reconcile and `transient` unchanged; `providerMetadata.gateway.cost` still inline (the usage ledger depends on it — fallback is `getGenerationInfo`, already used by `reconcileUsageCosts`).

Useful in v7 for this spec: `ToolLoopAgent` (optional; `streamText` with tools is enough), `runtimeContext` / `toolsContext` (bind the org id to tools without closures), `prepareStep` (per-step model downshift), `toolApproval` (if write actions come later, Q17), stateless stream helpers.

## 3. json-render 0.16 → 0.23

- No breaking change for us: the only breaking item (0.20) is for custom renderer bridges; we use `@json-render/react`. Every API we use (`defineCatalog`, `defineRegistry`, `pipeJsonRender`, `useJsonRenderMessage`, `Renderer`, `JSONUIProvider`) is still exported. No change to the spec / patch format.
- Useful fixes: spec replay without duplicate state / children, unfinished spec fences reset at text block boundaries (prose after a broken fence is no longer lost), streaming stability, Zod 4 prompt generation fix.
- Useful new features: `@json-render/directives` (`$format`, `$count`, `$pluralize`, `$join` — format money / dates without model math), devtools (dev only), nested `repeat`, named slots.
- No chart components in `@json-render/shadcn` (we keep our own Recharts entries); no `@json-render/ai-sdk` package; not formally tied to an AI SDK version (it works on the UI message stream).
- **Role in v2:** smaller. CRM lists, details and statistics are app-rendered from tool data (spec §7–8). json-render stays only for model-composed views of non-CRM content (Q6). The catalog shrinks to Markdown, KeyValue, DataTable, Grid / Stack, Badge, Text — no charts with model-typed numbers.

## 4. Streamdown 2.5 → 2.7.1, `@streamdown/code` 2.0

- **Breaking:** `codeDownload` prop removed in 2.6 (replaced by `controls`) — not used in our code. `@streamdown/code` 2 = Shiki 4 (we already have `shiki` 4 installed).
- Useful: `controls.table` copy / download with `csvSeparator` (use `";"` / `"auto"` for Russian Excel), `tableMaxHeight` / `codeBlockMaxHeight` with streaming auto-scroll, faster incremental rendering, `fallbackComponent`, `portal` for the link-safety modal, loading skeleton for images.
- **Security note (2.7.1):** remote images in Markdown are allowed by default. In the chat, restrict image origins (or block remote images in model text) — a prompt-injected mail could otherwise make the answer load a tracking image.

## 5. ai-elements → shadcn

- `ai-elements` is deprecated at the end of November 2026; its components moved into shadcn/ui as "AI Elements" patterns (same export names / props, copied into the project). Our components are already copied files, so nothing breaks.
- For v2 we need: `Conversation`, `Message`, `PromptInput`, `Shimmer` (status line), `Sources` (web sources), `Suggestion`, `ModelSelector`, optionally `ChainOfThought` / `Task` (if admins get «Показать шаги»). We stop rendering `Tool` and `Reasoning` for users.
- New UI parts come from the shadcn registry (`pnpm dlx shadcn@latest add …`), not from `npx ai-elements`. Unused copied components (canvas, node, edge, sandbox, terminal, …) can be deleted in CH5.

## 6. Recharts, TanStack Table

- Recharts 3.10: no breaking changes found; Legend gets `position` / `offset`. Upgrade is optional; check `src/components/ui/chart.tsx` Legend use if we do.
- TanStack Table 9 is stable and shadcn's data-table moved to it; v9 changes `useTable` (features, row models, store; ESM only). Used in ONE file: `src/components/data-table.tsx` (the json-render `DataTable`; other tables in the app are plain shadcn `<Table>`). **Upgrade in CH0 (Q18)**: port that file with `tableFeatures()` / the migration guide (`useLegacyTable` is the fallback bridge); the chat's stats table (CH3) is written on v9 from the start. Safe = lint + build pass and the DataTable sorts / paginates as before; if not, keep v8 and report.

## 7. Upgrade order (phase CH0 of the plan)

1. `ai` 7 + `@ai-sdk/react` 4 + `@ai-sdk/google` 4 with the codemod; fix runtime / usage / adapter; `pnpm lint`, `pnpm test`, `pnpm build`; check one call per process kind on the test DB: usage rows (tokens not doubled, cost present), streaming chat, analytics assistant, a parser, a topics extraction.
2. json-render 0.23 + streamdown 2.7.1 + `@streamdown/*` latest; chat smoke test (Markdown, code, mermaid, tables).
3. Recharts 3.10 + TanStack Table 9 (Q18); check `src/components/ui/chart.tsx` Legend and `src/components/data-table.tsx`.

Note (Q2): web search stays on Google grounding, so the gateway search tools are not needed now; they remain the known way to search with non-Google models later.

## Sources

- https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
- https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
- https://vercel.com/docs/ai-gateway/models-and-providers/web-search
- https://github.com/vercel-labs/json-render/releases
- https://github.com/vercel/streamdown/releases
- https://elements.ai-sdk.dev/ · https://ui.shadcn.com/docs/changelog/2026-10-ai-elements
- https://github.com/recharts/recharts/releases · https://github.com/TanStack/table/blob/main/docs/framework/react/guide/migrating.md

## 8. CH0 result (built 2026-11-16)

Installed: `ai` 7.0.173, `@ai-sdk/react` 4.0.177, `@ai-sdk/google` 4.0.121, `@json-render/*` **0.22.0**, `streamdown` 2.7.1, `@streamdown/code` 2.0.0, `@streamdown/math|mermaid` 1.0.3, `@streamdown/cjk` 1.0.4, `recharts` 3.10.1, `@tanstack/react-table` 9.3.1, and **`workflow` 4.2.4 → 4.8.16** (needed, see below).

Differences from the plan above:
- **json-render 0.22.0, not 0.23.x.** 0.23.0 / 0.23.1 were published less than a day before the upgrade; pnpm's minimum-release-age rule refuses them and the install added an exception to `pnpm-workspace.yaml`. The exception was removed and 0.22.0 (12 days old) installed. Move to 0.23 in a later update (the only gains are the spec-replay and unfinished-fence fixes).
- **`workflow` had to move to 4.8.16.** With AI SDK 7 the `next build` failed in «Collecting page data for /.well-known/workflow/v1/step» (`dynamic usage of require is not supported` in `@vercel/oidc`): AI SDK 7 packages carry Workflow serialization markers, so the 4.2 builder pulled `@ai-sdk/gateway` and its CommonJS dependency `@vercel/oidc` into the step bundle. 4.8.16 (same major) builds clean. Workflow 5 was not needed.
- **The AI SDK codemod was NOT used.** `npx @ai-sdk/codemod v7` also rewrote our own names (a role-label map, the extraction prompt builder's return field, a DB column in `run-store.ts`) and broke `usage.ts`; it was reverted and the migration done by hand: runtime generics (`RUNTIME_CONTEXT`), `onFinish` → `onEnd`, `totalUsage` → `usage`, `system` → `instructions` (23 model calls only), `stepCountIs` → `isStepCount`, stateless `toUIMessageStream` / `createUIMessageStreamResponse` in the chat + analytics routes, adapter reads `finalStep`.
- **Streamdown 2.6+ caps tables at 300 px and code blocks at 400 px.** To keep the look, every render site (`MessageResponse`, `Reasoning`, registry `Markdown`, `parsed-source-ui.tsx`, `source-message-dialog.tsx`) passes `tableMaxHeight={0}` and `codeBlockMaxHeight={0}`. New table buttons «Download» / «Fullscreen» are kept.
- TanStack Table 9: `src/components/data-table.tsx` ported to `useTable` + explicit features (sorting with registered sort functions, global filter, pagination); `getAllCells()` instead of `getVisibleCells()` (no column-visibility feature). The unused `size: col.width` mapping was dropped (it had no effect on render).

Checks (all on the test DB, org IN4COM):
- `tsc` 0 errors; `pnpm test` 740 / 740; `pnpm lint` 0 errors (3 old warnings); `pnpm build` OK. Before the `workflow` update the build failed; the original code was built in a separate worktree to prove the failure came from the upgrade.
- Live AI calls through `src/server/ai/runtime.ts` (7 tests): structured output (`chat.session_analysis`), Google-grounded web search (`chat.web_search`, sources + `web_search_count`), streaming tool loop + UI stream (`chat.assistant`, tool parts in the stream), json-render `data-spec` parts from `pipeJsonRender`, abort → `aborted` row, real email parser (`parsing.email`), analytics assistant tool (`analytics.assistant`). Usage rows: tokens equal the SDK totals and are NOT doubled for multi-step calls; the gateway's inline cost (`providerMetadata.gateway.cost`) still arrives in v7 (`cost_actual_usd` filled); one `response_id` per step.
- Render tests (5): `DataTableComponent` pages on TanStack 9; v9 sort + global filter with the same features; json-render `Renderer` with KeyValue, DataTable from `$state`, Bar / Line / Pie charts (Recharts) and Markdown without console errors; Streamdown 2.7 markup (and the same markup compared with 2.5); `useJsonRenderMessage` rebuilds a spec from `data-spec` parts.
- Dev server: sign-in pages 200, protected pages redirect, `/api/chat` and `/api/analytics/assistant` 401 without a session.
- **Not checked:** the chat panel in a signed-in browser (no browser session available to the agent). Check by hand: open «ИИ чат», ask one CRM question and one web question, ask for a chart; open «Аналитика» → «ИИ ассистент».

# 00 — Current state (2026-11-16)

What existed BEFORE the build that the chat actions could build on, and what was missing. Kept as the starting point; what was built is in [03-development-plan.md](03-development-plan.md) § «T0–T6 result».

## 1. The chat (docs/specs/ai-chat/, built CH0–CH8)

| Part | Where | State |
|---|---|---|
| Route | `src/app/api/chat/route.ts` | Read-only tools only: `searchRecords`, `listRecords`, `getRecord`, `readSource`, `queryStats`, `searchWeb`. Org + user from the session. History from the DB (`ai_chat_thread` / `ai_chat_message`); the browser sends only the new message |
| Stream | `src/server/chat/stream.ts` | Drops every `tool-*` / `reasoning-*` chunk for all users, **including `tool-approval-request`** — AI SDK tool approval would need a change here |
| Data parts | `src/lib/chat/turn.ts` | `data-status`, `data-records`, `data-stats`, `data-evidence`, `data-turn`, `data-debug`, `data-spec`. Stored parts: `partsForStorage` (`src/lib/chat/thread.ts`) keeps a fixed list — new part types must be added there |
| Files in the chat | `ai-chat.tsx`, `parseUserMessage` | Only images (png, jpeg, gif, webp) and text files (txt, md, csv, json); ≤ 10 MB in the browser, ≤ 5 per message; sent as **data URLs inside the JSON request**; stored in the history only up to 700 k characters, else name only. The chat model sees images directly (`chat.assistant` requires `image_input`); PDFs, Office files, audio and video are not accepted |
| Voice | `speech-input.tsx` | Browser dictation (Web Speech API) → text in the input. No recorded voice message |
| Chat as a source | `src/server/chat/ingest.ts` (CH6) | 30 minutes after the last message, a chat segment becomes a source item of the «AI Chat» source; a gate model (`chat.session_analysis`) marks segments without new business information `skipped`; others go through signal extraction → topics → the deal bridge. Files the user attached are parsed then (drop-off parsers), as child items — **after** the conversation, not during it |
| Eval | `pnpm chat:eval` (CH7) | 42 read-only questions; no action cases |
| Prompt | `src/lib/chat/prompt.ts` | «You cannot change any data … say where in the CRM the user can do it» |

## 2. Writing records today

| Record | Server function | Rules that a chat action must keep |
|---|---|---|
| Company | `createClient` (`src/server/clients.ts`, `"use server"`, session-bound) | Name required. «Ответственный» = the creator. Web enrichment after create when the org setting `clients.enrichOnCreate` is on. Custom values via `api/custom-values`. Profile («Профиль компании»: industry, role, size) via `api/clients/[id]/profile` |
| Contact | `createContact` (`src/server/contacts.ts`) | Name required; optional `nameNative`, `aliases` (incl. Telegram «@handle»), phone, email, `position`, `clientId` (checked in the org). Company links over time: `contact_company_link`, extra addresses `contact_address` (`src/server/contact-links.ts`) |
| Deal | `createDeal` (`src/server/deals.ts`) | Name, company and funnel stage required; contacts, value, deal type optional (`resolveDealTypeId` default). Currency = the company's. A `deal_activity` row by the user. Funnel = `getOrgFunnel` (`src/server/deal-engine.ts`; stage meaning by `role` area0 / active / won / lost). The go / no-go entry gate (`deals.entryGate`) applies to the AUTOMATIC deal bridge, not to a person |
| Task | `createTask` (`src/server/tasks.ts`) | Name required; type `meet` / `call` / `email` / `offer` / `docs` / `support` / `other`; priority low / medium / high; assignee default = the creator (must be a member; another assignee gets the `task.assigned` notification); due date default = now (!); links to company / contact / deal checked in the org |
| Document link | `uploadDocuments` / `addDocumentLink` (`src/server/documents.ts`) | A file stored as a source item with its original (`file_key`), linked to a company / contact / deal / task / order |
| Order request | `createAndParseOrderRequest` (`src/server/order-requests.ts`) | «Заказ из запроса»: one LLM split of a client's message into items, then the order wizard |

All four create functions take the org from the session — chat actions can run them as the signed-in user (same permissions as the UI: any org member).

## 3. Reading people and companies from files

| Input | Parser | What it extracts |
|---|---|---|
| Photo / scan (jpeg, png ≤ 5 MB) | `parseImageBytes` (`parsing.image`) | OCR text as markdown + summary, companies, `mentionedPeople { name, email, organization, phone, confidence }`. **A business card's own person is put into `senders` (the «author»), not into `mentionedPeople`** — the parsers are tuned for mail, not for contact cards |
| PDF ≤ 20 MB, DOCX / PPTX ≤ 20 MB | `parsePdfBytes`, `parseOfficeBytes` | Text + the same metadata |
| Audio mp3 / m4a / aac / ogg / opus ≤ 10 MB | `parseAudioBytes` (`parsing.audio`) | Transcript with speakers + metadata. **WebM (what Chrome records) is not accepted** |
| Video mp4 ≤ 50 MB | `parseVideoBytes` | Visual summary + transcript |
| Dispatch | `parseDropoffFile` (`src/server/parsers/dropoff.ts`) | Picks the parser by type; typed «too large» / «unsupported» errors |

## 4. Finding duplicates and «us»

| Check | Where |
|---|---|
| Name match keys (Cyrillic ↔ Latin, legal forms stripped) | `companyMatchKey`, `personMatchKey` (`src/lib/translit-ru.ts`) |
| SQL text search (Search V2) | `src/server/search/normalise.ts`, records engine `src/server/chat/records/` |
| Own organisation (never a client / contact) | `getOwnOrgContext` → `ownOrgIdentityFromContext` (`isOwnCompanyKey`, `isOwnDomain`, `isOwnEmail`) |
| Discovery blocklist (companies / people / domains / emails) | `loadOrgBlocklist` (`src/server/blocklist.ts`) |
| Discovery from sources (creates clients / contacts from parsed items) | `previewDiscovery` / `applyDiscovery` (`src/server/discovery.ts`) — same collision keys |

## 5. Signals → actions today

- The signal extractor (`topics.signal_extraction`) runs on source items in the hourly topics run; the deal bridge (`src/server/topics/deals/`) turns counted signals into deals (auto-create, proposal cards, links to the client's open deal of the same type).
- Topic cards carry a suggested `taskTitle`; accepting a card creates a task.
- For chat notes this happens only after the CH6 ingest (≥ 30 minutes later), and in topics mode `on` only with the switch «Чат в сигналах».

## 6. Gaps against the request

| Request | Gap |
|---|---|
| 1. Company / contact from a message, a card photo, a voice message | No write tools; no structured «contact card» extraction; no recorded voice; files > 4.5 MB cannot reach a Vercel function as JSON |
| 2. Deal from meeting notes | No write tools; PDFs / DOCX not accepted in the chat; no in-turn signal reading |
| 3. Task from the same inputs | No write tools; the task due date defaults to «now» |
| All source types via the chat | Files are parsed only at ingest (30 min later) |
| Clarification questions | The model can ask in prose, but there is no structured question and no «missing field» logic |

# Topics — Telegram bots and the topics / signals logic

Status: **reference for later development, 2026-11-14.** Nothing in this file is built yet unless it is marked **built**. The Telegram work is postponed: the bot cannot be tested in the current environment (no public HTTPS URL for the webhook). Use this file as the starting point when the work begins.

Related: source details in `src/app/AGENTS.md` § "Telegram Bot (Sources)" · spec [01-specification.md](01-specification.md) §1.2, §5.3, §6.1 · delivery [06-attention-engine.md](06-attention-engine.md) §7.3 · decisions [02-open-questions.md](02-open-questions.md) Q11, Q15, Q32 · plan [03-development-plan.md](03-development-plan.md) phase 7.

---

## 1. One bot, two directions

Each org has **its own Telegram bot** (created by the org admin in @BotFather; token in `source.credentials_ref`). The bot **is** the tenant: there is no shared platform bot. The same bot does two jobs:

| Direction | What | Topics role | State |
|---|---|---|---|
| **Inbound** (source) | Messages people send to the bot (or, later, write in groups where the bot is a member) become `source_item` rows | Input of the signals → topics flow, like mail | **Built: private chats, text only** |
| **Outbound** (delivery) | The bot sends messages to the org's **staff**: urgent topic pushes, later digests | Output of the attention engine (phase 7) | **Stub** (`telegram` channel in `src/server/topics/delivery/channels.ts` always returns `skipped`) |

The two directions share one webhook (`/api/webhooks/telegram/<sourceId>`) and one token. This is the main design constraint: **every update that reaches the webhook must first be classified** (a command / button press of a staff member, or a message to ingest), before anything is stored.

```
Telegram ──► webhook /api/webhooks/telegram/<sourceId>
               │  verify secret (built)
               ▼
           classify update (TO BUILD)
     ┌─────────┼──────────────────────────┬─────────────────────────┐
     ▼         ▼                          ▼                         ▼
 /start <code> callback_query        message from a client     message from a staff
 (bind staff)  (button on a push)    / forwarded by staff      member (own text / voice)
     │         │                          │                         │
 topic_delivery_pref  topic action   persistTelegramMessage    internal note → source item
 .telegram_chat_id    (done, snooze, (built) → parse →          (direction internal) or
                      open link)     signals → topics           ignore (decide, §4.3)
```

## 2. Inbound: how Telegram messages reach topics (built parts)

| Step | Code | Notes |
|---|---|---|
| Webhook → `persistTelegramMessage` | `src/server/ingest/telegram.ts` | Private chat **text only**. `source_item` kind `chat_message`, `external_id = <chat_id>:<message_id>`, raw text in `metadata_json.rawText`, `metadata_json.telegram` = { chatId, chatType, from, forwardOrigin, … } |
| Thread key = chat window | `src/lib/thread-key.ts` (`telegramThreadKey`, `decideTelegramWindow`) | `tg:<chat_id>:<first message id of the window>`; a new window after a gap > 1 h or > 100 messages (Q11). The window is the "thread" the topic resolver uses (§6.1) |
| Parse | `src/server/parsers/telegram.ts` | Same pipeline as mail; own-org attribution decides inbound / outbound / internal |
| Exclusions | `analysis_exclusion` kind `chat` | An excluded chat is not stored at all |
| Forwarded messages | `src/server/topics/signals/item-input.ts` (`telegramForwardAuthor`) | Staff forward a client's message to the bot → the **original author** (the client) is the author for signals; the staff member is `forwardedBy`. A hidden sender = «скрыт» |
| Counterparty | `src/server/topics/counterparty.ts` | A contact whose alias is «@username» matches the Telegram sender |
| Signals → topics → attention → cards → deals | `src/server/topics/**` | No Telegram special cases downstream |

So today a Telegram message gives signals and topics exactly like an email, within ≤ 1 hour (hourly run). Telegram is **push**: it is not in the hourly «intake» sync. Only parse + upload of its items run there.

## 3. Inbound: open work (separate tasks, before the agency pilot)

| # | Task | Why it matters for topics | Notes for the developer |
|---|---|---|---|
| I1 | **Group chats** with the bot (Telegram source phase 3, Q32) | Most client talk in Telegram is in groups. Each group message = an item; the window rule makes the thread; the author is the group member | `allowed_updates` must include group messages; privacy mode of the bot (BotFather `/setprivacy` off, or the bot as admin) decides whether it sees all messages; `chat_type` group / supergroup; map members to contacts by «@username»; an excluded group = `analysis_exclusion` kind chat |
| I2 | **Files** (documents, images) — Q11 | A file can start a topic (an order list, a contract) or bring client / contact data | Store as child items of the window's root item (spec §2: children are evidence of the root). Extraction today reads only the root body (go-live O5) — decide whether files are read by extraction |
| I3 | **Voice notes / dictated call notes** — Q11, Q32 | Staff dictate a call summary to the bot → it must become an item with the CLIENT as the counterparty, not the staff member | Transcribe (AI process, through the AI layer, with `ref`), then treat as an internal note about a client: the counterparty comes from the text («звонил Иванову из Альфы…»), direction `internal`. Needs a rule in extraction for «notes about a client» (today internal-only blocks are limited) |
| I4 | Media groups, edits, deletions, rate limits, a re-register button, webhook health on the Sources page | Correctness of the item stream | Listed as deferred in `src/app/AGENTS.md` |

## 4. Outbound: Telegram delivery to staff (open part of phase 7)

### 4.1 What is ready

- Channel interface `DeliveryChannel` { key, available(), address(), send() } in `src/server/topics/delivery/channels.ts`; the email channel is built, `telegram` is a stub.
- Per-user settings table `topic_delivery_pref` with `telegram_enabled` (default false) and `telegram_chat_id` (null). /account → «Уведомления» shows the Telegram row as «Скоро».
- Delivery log `topic_delivery` already has `channel` (email | telegram) and kind `push`.
- Parameter `telegramMaxPerCard7d` = 2 (Q24-5: incl. the first delivery) in `delivery.params`.

### 4.2 What to build

| # | Step | Detail |
|---|---|---|
| T1 | **Bind a staff member's chat** | /account → «Уведомления» → «Подключить Telegram» shows a one-time code / deep link `https://t.me/<bot>?start=<code>` (code: random, ≤ 15 min, stored hashed, bound to user + org). The user presses Start → the webhook gets `/start <code>` → classify as a command → write `topic_delivery_pref.telegram_chat_id` + `telegram_enabled = true`, reply «Уведомления подключены». The bot never stores this message as a source item |
| T2 | **Push of urgent topics** | Kind `push`: a topic that ENTERS «Сейчас» (P8 at once; P6 after the daily limit, 06 §7.3), routed like email (assignee → deal owner → all members, `src/lib/topics/delivery-routing.ts`), only inside working hours (attention params), ≤ `telegramMaxPerCard7d` per card in 7 days, idempotent via `topic_delivery` |
| T3 | **Buttons** (optional, second step) | Inline keyboard: «Открыть» (URL to `/dashboard?topic=<id>`), «Готово», «Отложить до завтра». Needs `callback_query` in `allowed_updates`; the webhook calls the same server actions as the topic drawer (`markTopicDone`, `snoozeTopic`) as the bound user — check that the chat id belongs to an org member |
| T4 | **Digests by Telegram** (optional) | The morning / evening texts of `src/lib/topics/delivery-render.ts` as plain text (Telegram limit 4,096 characters per message) |
| T5 | **Unbind** | /account «Отключить», or the user blocks the bot (Telegram returns 403 → set `telegram_enabled = false`, log `skipped: blocked`) |
| T6 | **Admin** | «Темы» → «Рассылка»: per-org switch for Telegram (like `topics.delivery.email`), the list of bound users, a test push to the current admin |

### 4.3 Rules that tie the two directions together

1. **Classify before storing.** A webhook update is (a) a command (`/start`, `/stop`), (b) a callback query, (c) a message in a chat bound to a staff member, or (d) any other message. Only (d), and the forwarded messages inside (c), are ingested as source items. Today every private text is ingested — this must change when T1 ships.
2. **A staff chat is not a client conversation.** Staff text typed to the bot (not forwarded) must not create signals as if a client wrote it. Decide one of: ignore it; store it as an internal note (direction `internal`, author = the staff member) — this is also the entry point of dictated call notes (I3).
3. **Forwarded client messages stay signals** (built): the original author is the client, so a staff member who forwards a client's message to the bot creates the same signals as the client's own message.
4. **Bot replies are never items.** Messages the bot sends (pushes, acks «✅ Received», binding confirmations) do not come back as updates, but keep the ack text out of any thread logic.
5. **One webhook mode.** The local «Fetch» (`getUpdates`) and the webhook exclude each other (Telegram 409). Delivery needs the webhook (public HTTPS `NEXT_PUBLIC_APP_URL`), so Telegram delivery can be tested only on a deployed environment.
6. **Exclusions apply to ingestion only.** An excluded chat is never analysed, but a staff member can still receive pushes in their own bound chat.
7. **Multi-org users.** One person can be a member of two orgs, each with its own bot → two bindings (`topic_delivery_pref` is per user + org). No cross-org data in a push.

## 5. Suggested order

1. T1 bind + T2 push + T5 unbind + T6 admin (≈ 3–4 days), with the classification rule §4.3-1 / -2. This closes phase 7.
2. I1 groups (Telegram source phase 3).
3. I3 voice notes + I2 files (one task: media download, transcription, child items).
4. T3 buttons, T4 digests if users ask for them.

## 6. Test checklist (deployed environment only)

| # | Check |
|---|---|
| 1 | Save the bot credentials → `getWebhookInfo` shows `/api/webhooks/telegram/<sourceId>`, no `last_error_message` |
| 2 | A client writes to the bot → a `source_item` appears; the next hourly run gives signals / a topic |
| 3 | A staff member binds via /account → `/start <code>` is NOT a source item; `topic_delivery_pref.telegram_chat_id` is set |
| 4 | A P8 topic appears → the bound user gets one push within the hour, inside working hours; a third push for the same card in 7 days is `skipped` |
| 5 | The user blocks the bot → the next push is logged `skipped: blocked`, the binding is off |
| 6 | A staff member forwards a client message → signals with the client as the author |

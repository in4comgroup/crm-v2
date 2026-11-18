# Telegram — finalization tasks (after the business answers)

Status: **plan 2026-11-18; F1 + F2 built 2026-11-18 (not deployed); next: F3 set-up, F4 real-phone check.** Covers [04-identity-and-chats.md](04-identity-and-chats.md) (identity of people and chats, two-way bot) and [ai-chat-telegram](../ai-chat-telegram/README.md) (AI chat over Telegram). Both are built and tested on the test DB (Telegram eval `tg01`–`tg23`); nothing was tested with a real Telegram account yet.

## 1. Business answers (2026-11-18)

| # | Answer | Effect |
|---|---|---|
| Q17 | **Telegram Business is not used for now** → set-up A only: one org bot | TI7 dropped from the plan (postponed: `docs/todo/README.md` TG7). A rep's private chat with a client reaches the CRM only through a group with the bot or a forward to the bot (04 §9.5) |
| Q32 | **Channels are out of scope for now** | No `channel_post`. A channel the bot is added to needs a guard (F1). Postponed: `docs/todo/README.md` TG8 |

Nothing that is built depends on Business or channels. Nothing is removed.

## 2. Tasks

| # | Task | Who | Size | Done when |
|---|---|---|---|---|
| F1 | **Channel guard** (code) — **built 2026-11-18** | developer | 0.25 day | See §3.1 |
| F2 | **Guide for staff: how client chats reach the CRM** (UI text) — **built 2026-11-18** | developer | 0.25 day | See §3.2 |
| F3 | **Test deployment set-up** | product owner | — | See §3.3 |
| F4 | **Real-phone check** of both specs | product owner (phone) + developer (DB and logs) | 0.5 day | Every row of §3.4 passed or has a fix task |
| F5 | **Fixes from F4 + close-out** | developer | 0.5–1 day (buffer) | Fixes done; `pnpm test`, `pnpm lint`, typecheck pass; `pnpm chat:eval` (`CHAT_EVAL_ONLY=tg`, and the full set when a prompt or a tool changed) passes; statuses in 04, ai-chat-telegram, `docs/specs/README.md` = «built and checked»; done deployment items D1, D2, D4, D6, D7 deleted from `docs/todo/README.md` |

Order: F1 + F2 (one change set) → F3 → F4 → F5. Total ≈ 1.5–2 days of developer time.

Not needed for the release (they stay in `docs/todo/README.md`): TG1 forum topics, TG2 discovery of Telegram authors, TG3 phone request, TG4 records engine by `resolved` ids, TG5 warning for check 3, TG6 Telegram digests, A3 AI chat round 2. Recommendation: decide them after 2–4 weeks of real use. TG1 is the exception: do it earlier only if clients use groups with forum topics.

## 3. Details

### 3.1 F1 — channel guard

Today, when someone makes the bot an admin of a channel, `recordTelegramChatMembership` (`src/server/telegram/chats.ts`) creates a `telegram_chat` row (type `channel`), lists it in «Группы» and sends the owners «Сообщения этого чата сохраняются в CRM …». Posts never arrive (`channel_post` is not asked for), so this notice is wrong.

Change:
- For a channel, `my_chat_member`: no title suggestion, no «Группы» row shown. The owners get one notice (04 §7.6): «Бот добавлен в канал «<название>». Каналы не поддерживаются: посты канала не сохраняются в CRM.»
- The list in «Группы» (and the company card block «Telegram») leaves out rows of type `channel`. Rows that exist stay in the DB (no migration).
- `allowed_updates` stays as it is (no `channel_post`).
- A channel post forwarded to the bot works as today (a normal forward, author unknown).
- Eval case `tg24` (04 §12 check 18); `src/app/AGENTS.md` § "Telegram Bot (Sources)" gets the rule.

Built: `recordTelegramChatMembership` returns early for a channel (notice kind `telegram.channel_unsupported`, registry `src/lib/notifications/kinds.ts`); `listTelegramChats` and `getClientTelegramView` filter `type <> 'channel'`.

### 3.2 F2 — guide for staff

Without Business, client talk reaches the CRM only when staff do S1 or S2 (04 §9.5). Staff must know this.
- /profile → «Telegram» (`profile-telegram.tsx`), a short block «Как переписка с клиентами попадает в CRM» (How client chats reach the CRM):
  - «Создайте группу с клиентом и добавьте в неё бота — владелец или ответственный привяжет группу к компании.» (Make a group with the client and add the bot. The owner or the responsible person links the group to the company.)
  - «Важное сообщение из личного чата перешлите боту — оно сохранится как сообщение клиента.» (Forward an important message from a private chat to the bot. It is saved as the client's message.)
  - «Личные чаты бот не видит.» (The bot does not see private chats.)
- The same two lines in the bot's `/help` (`src/lib/telegram/texts.ts`).

Built: the block on /profile → «Telegram» (shown when the org has a bot) and a section «Переписка с клиентами в CRM» at the end of `/help`.

### 3.3 F3 — test deployment set-up (product owner)

1. Deploy the code with F1 + F2. `NEXT_PUBLIC_APP_URL` = the public HTTPS origin of the deployment (else the webhook is not registered). `CRON_SECRET` set. **Test deployment on Vercel Hobby (2026-11-18):** Hobby allows one run per day per cron, so `vercel.ts` + `src/server/orchestration/config.ts` run `/api/cron/topics` daily at 08:00 UTC and `/api/cron/notifications` daily at 09:00 UTC (was hourly; set back to `0 * * * *` / `15 * * * *` on Pro). For F4, do not wait for the cron: start a run by hand — topics: /settings → «Темы» → run now; both: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/topics` (or `/api/cron/notifications`). Each «next hourly run» in §3.4 then means «the next run».
2. DB: migrations `0044`–`0047` are already applied to the `.env` DB. If the deployment uses another DB, run `pnpm db:migrate` against it before the deploy (`docs/todo/README.md` D6).
3. @BotFather: `/setprivacy` → the test bot → **Disable** (D1).
4. Sources → the Telegram source → save the bot credentials again (D2, D6). The webhook is then registered with `message`, `my_chat_member`, `callback_query`, `edited_message`, and the bot gets its commands. Check: «Группы» shows «Бот читает все сообщения групп».
5. For pushes: the test org's topics mode = `on`, and the check runs inside the org's working hours (default 08:00–18:00 Europe/Vienna).

### 3.4 F4 — real-phone check

Two Telegram accounts: M = a member (staff), C = a «client» (a second account with a contact in the CRM that has C's @name in «Адреса»). The developer checks each step in the DB and the logs (test DB = the `.env` DB).

| # | Step | Expected | Spec |
|---|---|---|---|
| 1 | M: /profile → «Telegram» → «Подключить Telegram» → «Start». Open the same link again | «Telegram привязан»; notices to M and the owners; the second use fails; `/start` is not a source item | 04 #1, #14 |
| 2 | AI chat OFF. M sends a note «Звонил Петру из Альфы, просит КП до пятницы» | Bot ack; item = relayed note; signals in the next hourly run | 04 TI6, §9.5 S5 |
| 3 | Owner: source → «Настройки провайдера» → «ИИ-чат в Telegram» ON. M asks «Сколько открытых сделок?» | Waiting preview, then the answer in HTML; links open the CRM | ai-chat-telegram §17 |
| 4 | M: a long pasted text; an album of photos with a caption; a business card photo → «Создать» (press twice); a voice question; «Выручка по месяцам» → «📎 CSV»; a reply to an answer; `/new`; `/help`; `/stop` then bind again | One merged turn; the card creates the records once and shows «✅ Создано …»; voice answered; CSV file; the reply uses that answer; new thread; help text with the F2 lines | ai-chat-telegram §17, D7 |
| 5 | C writes to M in a private chat; M forwards it to the bot with «что ответить?» | Answer in the chat AND an item with C's contact as the author (Q8, §9.5 S2) | 04 §9.5 S2 |
| 6 | On the phone: an answer with a table and a long answer (> 4,096 chars) | `<pre>` table readable (or a list when too wide); split into parts, nothing lost | ai-chat-telegram §7, 04 #16 |
| 7 | Make a group «<Компания> / Мы», add M, C and the bot | Owners' notice «Бот добавлен …»; a suggestion for the company; bind it in «Группы» | 04 #10, §7 |
| 8 | In the group: C writes; a third account with no CRM contact writes; M writes; edit one message | C → C's contact + company, numeric id learned; unknown → «Новый контакт в …?» in the company card; M → ours; the edit updates the item; the bot never answers in the group | 04 #5, #7, Q30 |
| 9 | C changes their @name and writes again | Still C's contact (`via = contact_id`) | 04 #5 |
| 10 | Files in the DM and in the group: a PDF with and without caption, a photo, a file > 20 MB, a voice note | «Документы» of the company / contact; the 20 MB file listed as «больше 20 МБ»; text in the next hourly signals | telegram/01, D4 |
| 11 | A topic of M enters «Сейчас» (working hours) | One push with «Открыть» / «✅ Готово» / «⏰ Отложить до завтра»; each button changes the topic and edits the message | 04 #4, topics/08 T2 |
| 12 | A task of M becomes overdue (important) | Copy «❗ …» in Telegram; outside working hours it arrives in the first working-hour run; /account → «Уведомления» → the Telegram switch stops it | 04 TI3, Q21 |
| 13 | M blocks the bot; the next push is due | Push `skipped: blocked`; binding `blocked`; /profile shows «Вы заблокировали бота …» | 04 #4 |
| 14 | Make the bot admin of a test channel | F1 notice to the owners; the channel is not listed in «Группы»; no post saved | 04 #18 |
| 15 | Logs after the check | No item saved twice (`telegram_update_seen`); no unhandled error in the webhook or the worker | 04 #15 |

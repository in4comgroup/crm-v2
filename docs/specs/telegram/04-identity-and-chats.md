# Telegram — identity of people and chats, two-way bot

Status: **business answers received 2026-11-18 — Telegram Business is not used for now (Q17 = A only), channels are out of scope (Q32 = a).** Built and tested on the test DB (not deployed, no real-phone test yet): TI1–TI6 (TI4 for groups and company accounts), together with [ai-chat-telegram](../ai-chat-telegram/README.md). TI7 (Business) and channels are dropped from this plan (postponed: `docs/todo/README.md` TG7, TG8). What works without Business: **§9.5**. Left: the finalization tasks in [05-finalization.md](05-finalization.md) (channel guard, guide for staff, real-phone check). Completion status: **§13**. Questions: §10 (Q16–Q33, all decided). Plan: §11.

Related: [01-telegram-files.md](01-telegram-files.md) (files, groups — built) · [topics/08-telegram-and-topics.md](../topics/08-telegram-and-topics.md) (bot delivery to staff: T1–T3, T5, T6 built 2026-11-17; T4 digests not built) · [identity/](../identity/README.md) (the «us» registry) · [clients-contacts/04](../clients-contacts/README.md) (contact addresses, `contact_address`) · `src/app/AGENTS.md` § "Telegram Bot (Sources)".

---

## 1. Goal

The system must know **who wrote each Telegram message and which company it is about**, and it must be able to **send messages to our own staff** through the same bot. Five parts (product owner, 2026-11-17):

| # | Part | Short form |
|---|---|---|
| P1 | **Staff identity, two-way** | Link an org member (user of the system) with their Telegram account. Inbound: the system knows that a message (in a DM to the bot or in a group) is from our member. Outbound: the bot can send this member information from the system |
| P2 | **Contact / company identity** | A message in a group where the bot is a member, or a DM to the bot, is linked to a contact (and its company) when the contact or the company has a Telegram name in its profile |
| P3 | **Org bot vs. user bot** | Options for a generic org-level bot with no link to one member, and for a bot linked to one member. Logic of the second = to decide; this spec gives recommendations |
| P4 | **Chat ↔ company** | A group (or channel) where the bot is a member can be linked to one or more companies, so that everything from this chat is about only these companies — also when the authors have no Telegram name in the CRM |
| P5 | **AI chat over Telegram** (added 2026-11-17) | A bound member talks to the AI chat through the org bot (a transport / a special UI). What the chat does there and its limits = a separate spec; THIS spec gives the capacity (§5.5) |

**Business answers (2026-11-18):** P3 = one org bot, **no Telegram Business for now** (§9.2, Q17); P4 = groups and companies' own accounts, **channels out of scope** (§7.7, Q32). A sales rep's private chat with a client reaches the CRM only through the ways of §9.5.

## 2. Telegram facts that drive the design

| # | Fact | Effect on us |
|---|---|---|
| F1 | Every Telegram user has a **numeric id** (`from.id`) that never changes. The **username** («@name») is optional and the user can change it at any time. Many users have no username | Matching only by «@name» (today) misses people without a username and breaks when a person renames. We must store and match the numeric id |
| F2 | A bot **cannot see the phone number** of a user. It gets it only when the user shares it (a «Поделиться номером» (Share number) button in a DM, `request_contact`) or when someone sends a contact card (`message.contact`, has `user_id` + phone) | Phone matching is possible only in these two cases |
| F3 | A bot **cannot write first**. It can send to a user only after the user pressed «Start» in a DM with the bot. A user can block the bot (send → error 403) | Outbound to staff needs a binding step started by the staff member |
| F4 | Deep link `https://t.me/<bot>?start=<payload>` opens the bot and sends `/start <payload>` (≤ 64 chars) | Safe one-time binding code |
| F5 | In a private chat, `chat.id` = the user's id | A DM chat and the person are the same key |
| F6 | A bot **cannot list the members** of a group (only admins and the member count). It learns members only when they write (or from `chat_member` updates, only when the bot is an admin) | Group members are learned from messages |
| F7 | **Groups: the bot reads AND sends.** Read: with privacy mode on, the bot gets only commands to it, replies to its own messages and service messages; it gets ALL messages when privacy mode is off in BotFather (then add the bot to the group again) or when it is a group admin (built check, 01 §6 G1, `can_read_all_group_messages`). No history from before the bot joined. Messages of other bots are never delivered. Send: like any member, when the group lets members send (else the bot must be admin); Telegram flood limits apply (not published; keep group sends rare) | Reading is built. Sending into a client group = outbound to clients (Q31) |
| F8 | **Channels** (broadcast): a bot can join a channel **only as an admin** (a bot cannot be a plain subscriber), so «read without admin» is not possible. An admin bot gets every post (`channel_post`, edits = `edited_channel_post`). To POST into the channel it needs the right «Публикация сообщений» (Post messages, `can_post_messages`). A post has no person as author (`sender_chat` = the channel; `author_signature` = a name as text only when signatures are on). Comments live in the channel's linked discussion group = a separate supergroup; the bot reads them only when it is a member there (normal group rules, F7) | The channel owner must make our bot an admin. Today `allowed_updates` = `message`, `my_chat_member` → add `channel_post`, `edited_channel_post`. **Not used: channels are out of scope (Q32 = a, 2026-11-18)** |
| F9 | Supergroups can have **forum topics** (`message_thread_id`) | One group can hold several projects |
| F10 | **Telegram Business** (Bot API 7.2+; the rights object changed in 9.0 — check at build time): a user with **Telegram Premium** can connect a bot to their PERSONAL account (Settings → Telegram Business → Chatbots) and choose which private chats it sees. The bot then gets `business_connection` (who connected, rights, on / off) and `business_message` / `edited_business_message` / `deleted_business_messages` for those chats. Private chats only, no groups. Business Mode must be on for the bot in BotFather. Reply on behalf of the account (`can_reply`) only in chats with an incoming message in the last 24 hours. Docs do not say (a) that the owner's OWN messages arrive too and (b) that old history arrives — **check both in a live test before TI7**; plan assumes (a) yes, (b) no | The only legal way for a bot to read a sales rep's real 1:1 chats with clients. See P3. **Not used for now (Q17 = A only, 2026-11-18)** |
| F11 | A webhook is per bot token. The same token cannot serve two sources | One bot = one source = one org |

## 3. What exists today (code check of 2026-11-17)

| Area | Today | Code | Gap |
|---|---|---|---|
| Staff Telegram | Member types «@name» on /profile «Мои рабочие адреса» (My work addresses) or the owner types it for any member → `org_identity_entry` kind `person`, channel `telegram`, `match_key` = lower-case handle. Attribution rule 1d `sender_staff_telegram` → `own_org` | `src/lib/identity/registry.ts`, `own-org-sets.ts`, `src/server/parsers/org-attribution.ts` | Handle only (F1). **Not verified**: anyone with rights can enter any handle, e.g. a client's handle → the client's messages become «ours» and give no signals |
| Outbound to staff | `topic_delivery_pref.telegram_enabled` / `telegram_chat_id` exist, never written. Delivery channel `telegram` = stub (`skipped: telegram not configured`). /account shows «Скоро» (Soon). `/start` and every «/…» text are DROPPED as bot commands | `src/server/topics/delivery/channels.ts`, `src/server/ingest/telegram.ts` | No binding flow, no send. The `notification` engine has no Telegram channel |
| Staff DM to the bot | Stored like any message. Forward → the original author is the author (built). Own text → `own_org` item | `persistTelegramMessage`, `item-input.ts` | Open since topics/08 §4.3-2: is a staff text a note about a client, a command, or noise? |
| Contact Telegram | Contact «Адреса» (Addresses) → kind `telegram` (`contact_address.value` = handle) + old alias «@name» on `contact.aliases`. Read by: topics counterparty (`contactsByHandle`), document auto link A1 (`contactByTelegramHandle`), AI chat draft-card duplicate check | `src/server/topics/topic-store.ts`, `counterparty.ts`, `src/server/documents.ts`, `src/server/chat/actions/checks.ts` | Handle only, no numeric id (F1). Unique hit only. The «us» registry report-only match (`org-identity-registry.ts`) reads aliases, not «Адреса» |
| Company Telegram | No field | — | A company account (@company_sales), a company group or channel cannot be named |
| Group ↔ company | `provider_config.telegramGroups[chatId] = { title, status, at }` (bot joined / left). For OUR message in a group: `telegram.groupPeer` = the latest non-own author of the chat in the last 7 days → counterparty | `recordChatMembership`, `stampTelegramGroupPeer` | No link group → company. An unknown author in a group gives no company. The `groupPeer` guess is wrong in a group with two client people from two companies, or after a quiet week |
| Company activity | «Последняя активность» (Last activity) reads mail participants (from / to / cc / participants e-mail) and cards | `src/server/client-activity.ts` | Telegram messages never count |
| Discovery | Reads e-mail participants only | `src/server/discovery.ts` | Unknown Telegram authors are never proposed as contacts |
| Exclusions | Kind `chat`: `telegram:<chat id>` or `telegram:@name` (author / forward origin) | `src/lib/analysis-exclusion-match.ts` | Works; keep |
| Bots per org | One Telegram source = one bot; credentials per source | `src/server/providers/handlers.ts` | No check that one token is not saved on two sources (F11) |

## 4. Concepts

| Term | Meaning |
|---|---|
| **Telegram account** | One Telegram user, key = numeric id (`tg_user_id`). Username and display name are attributes that change |
| **Telegram chat** | A private chat, group, supergroup or channel the bot sees, key = `chat_id` (+ the source / bot) |
| **Staff binding** | A VERIFIED link member ↔ Telegram account, made by the member through the bot (§5.2). Gives inbound identity AND the outbound address |
| **Handle entry** | An UNVERIFIED Telegram name typed in the CRM (staff on /profile, contact «Адреса»). Used for matching until the numeric id is known |
| **Chat binding** | A link Telegram chat → one or more companies (or «внутренний» (internal) / «не анализировать» (do not analyse)), §7 |
| **Resolution** | The ONE answer per message: who is the author (member / contact / company account / unknown), which company is the counterparty, how we know it (`via`). Stored on the item, read by every consumer (§8) |

## 5. P1 — staff identity, two-way

### 5.1 Model

New table `telegram_binding` (one row per org × member × bot):

| Column | Meaning |
|---|---|
| `organization_id`, `source_id` | The org and its bot |
| `user_id` | The member |
| `tg_user_id` | Numeric Telegram id (F1) |
| `tg_username`, `tg_name` | Last seen username / display name (updated on every message) |
| `chat_id` | Private chat id for sending (= `tg_user_id`, F5; kept for clarity) |
| `status` | `active` · `blocked` (the user blocked the bot, F3) · `unbound` |
| `bound_at`, `unbound_at`, `last_seen_at` | — |

Unique: one ACTIVE binding per (org, `tg_user_id`) and per (org, source, `user_id`). A binding also writes / updates the «us» registry entry (kind `person`, channel `telegram`) with the numeric id, so attribution has one list. `topic_delivery_pref.telegram_chat_id` becomes unused (read from the binding).

### 5.2 Binding flow (verified)

1. /account → «Уведомления» (Notifications) → «Подключить Telegram» (Connect Telegram). The server makes a one-time code (random, ≥ 128 bits, stored hashed, bound to user + org + source, valid 15 min, single use) and shows the deep link `t.me/<bot>?start=<code>` + a QR code.
2. The member opens it and presses «Start». The webhook gets `/start <code>` — a **command**: it is classified BEFORE storage (topics/08 §4.3-1) and never becomes a source item.
3. Valid code → binding `active`; the bot replies «Готово: уведомления CRM будут приходить сюда» (Done: CRM notifications will come here). Invalid / expired → «Ссылка устарела — откройте её снова в CRM» (Link expired — open it again in the CRM).
4. Conflict checks: the same Telegram account is already bound to another member of this org → refuse, tell the owner. The account is a CONTACT's known Telegram (§6) → bind, staff wins, the contact address gets status `old` + a notification to the owner.

Unbind: /account «Отключить» (Disconnect); `/stop` in the bot; the user blocks the bot (next send → 403 → `blocked`); the member leaves the org (`afterRemoveMember` hook → `unbound`).

The handle typed on /profile stays possible (members who do not bind, or before binding) and is shown as «не подтверждён» (not verified). Once a binding exists, the numeric id wins; a renamed username still matches.

### 5.3 Inbound from a bound member

| Where | What the message is | Result |
|---|---|---|
| Any chat | `/start`, `/stop`, `/help`, button press (`callback_query`) | Command, not stored |
| DM with the bot | Forward of a client's message | Stored; author = the original author (built) |
| DM with the bot | Own text / voice / file | Q20 (decided): internal note about a client — author = the member, direction `internal`, counterparty from the text. When the AI chat over Telegram ships, the target may change (§5.5 C2, Q33) |
| Group | Own message | `own_org` by the numeric id (rule 1d becomes id-first, then handle) |

### 5.4 Outbound to a bound member

One delivery channel `telegram` for two producers (the AI chat answers use the same sender, §5.5 C6):

| Producer | What | Rules |
|---|---|---|
| Topics delivery (topics/08 T2) | Push when a topic ENTERS «Сейчас» (Now); later digests (T4) | As in topics/08: routing, working hours, ≤ `telegramMaxPerCard7d` per card, log in `topic_delivery` |
| Notifications engine (`notify()`) | Notifications of priority `important` (task due / overdue, new deal risk ≥ 7, client confirmed an order, …) | Per-user choice per category (Q21); the in-app row stays the master; the Telegram copy is best effort |

Message: Russian plain text ≤ 4,096 chars + a button «Открыть в CRM» (Open in CRM). Action buttons («Готово», «Отложить») = later (topics/08 T3). No client data of another org (one bot = one org). A send error 403 → binding `blocked`, log `skipped: blocked`.

### 5.5 Capacity for the AI chat over Telegram (P5)

A bound member will use the org bot as a transport for the AI chat (`docs/specs/ai-chat/`). What the chat does in Telegram and how it differs from the web chat = a **separate spec**: [ai-chat-telegram/](../ai-chat-telegram/README.md) (draft 2026-11-17). This spec only makes sure nothing must be rebuilt for it:

| # | Capacity | What this spec builds | Left to the AI-chat-over-Telegram spec |
|---|---|---|---|
| C1 | **Who** | Only an ACTIVE staff binding may talk to the chat. User + org come from the binding (one bot = one org → no org switch; a member of two orgs binds to each org's bot). Same rights and the same AI limits as the web (monthly limit → a Russian text, not an error) | — |
| C2 | **One router** | One webhook per bot (F11) → one classification step BEFORE storage, as a table of handlers: `command` → command handler · `callback_query` (button press) → button handler · DM of a bound member → `memberDmTarget` = `note` (Q20, today) or `ai_chat` · everything else → ingest (source items). New targets plug in without touching ingest. `allowed_updates` gets `callback_query` (+ `edited_message`, Q30) | Which target a member's DM takes (Q33) |
| C3 | **Thread** | Column `telegram_binding.ai_chat_thread_id` (nullable) = the member's current chat thread in Telegram; `ai_chat_thread.channel` (`web` · `telegram`) so the web history shows Telegram threads too | `/new`, thread titles, switching threads |
| C4 | **Turn runner** | — (named here so the chat spec plans it) | Move the turn logic out of `src/app/api/chat/route.ts` (session, history load, context, tools, answer storage, stopped answer) into a server function `runChatTurn({ orgId, userId, threadId, message, channel })` with two output adapters: the web UI stream and Telegram. Telegram has no «page» context |
| C5 | **Async** | The webhook answers 200 at once (built: fast ack); slow work runs after the response (`after()` from `next/server`, or a workflow for long turns, ≤ 120 s like `/api/chat`). Telegram re-sends an update that got no answer → store handled `update_id`s per bot (dedupe). «печатает…» (typing) = `sendChatAction`, repeated every ~5 s | Whether the answer is one message or a message edited while it streams |
| C6 | **One sender** | ONE Telegram sender for all producers (binding replies, topic pushes, notifications, chat answers): split > 4,096 chars, Telegram HTML with escaping (Markdown → the Telegram HTML subset; tables → plain text), inline buttons (`callback_data` ≤ 64 bytes → a short opaque id stored on our side that maps to the server action + user + expiry), files (bot upload ≤ 50 MB), `429 retry_after` respected, ≤ ~1 message per second per chat, 403 → binding `blocked`, a send log | Which chat blocks become text, buttons or a link «Открыть в CRM» |
| C7 | **Inputs** | Built: text, voice download, files ≤ 20 MB (bot download limit), forwards (`forwardOrigin`). The router passes them to the target unchanged | How the chat uses them (voice → transcription, files → chat files `src/server/chat/files.ts`, a forward = context or a client message) |
| C8 | **Buttons** | `callback_query` router + short ids (C6), `answerCallbackQuery` at once | Draft cards (`ai-chat-tools`): «Создать» / «Отменить» call the same server logic as `api/chat/actions`; a card that needs edits → «Открыть в CRM» |
| C9 | **No double storage** | A member DM routed to `ai_chat` is NOT also a Telegram source item. The chat thread's own ingest (`ingestDueChatThreads`, «Не передавать в источники») makes «AI Chat» source items as for the web chat — so a note told to the chat still reaches signals | — |

**Q33** (moved to [ai-chat-telegram](../ai-chat-telegram/01-specification.md) Q13): how a member's own DM chooses between «note» (Q20) and «AI chat». Options: (a) a mode per member (`/mode`, «Заметки» / «ИИ-чат»); (b) everything goes to the AI chat, and notes reach signals through the chat ingest (C9) — one path, the chat can answer «Записал»; (c) a command per message (`/note …`). Recommendation: **(b)** once the chat over Telegram ships; until then = note (Q20).

## 6. P2 — contact and company identity

### 6.1 Model

- **Contact**: keep «Адреса» → Telegram (`contact_address` kind `telegram`, decided Q14). Add columns `external_id` (numeric `tg_user_id`) and `verified_at`. Statuses `active` / `old` as today. The alias «@name» stays readable (old data) but new input goes to «Адреса».
- **Company account / group / channel** (a company's shared account @company_sales, or the client's group): no new company field — a **chat binding** (§7) of that account's private chat (F5) or of that group / channel. The company card shows them in one block «Telegram» (Q18).

### 6.2 Learning the numeric id

| Event | Action |
|---|---|
| A message whose author handle matches ONE active contact Telegram address with no `external_id` | Store the author's id on that address (`source = learned`) |
| A contact address with an `external_id` sees a new username for that id | The new username becomes the active value; the old one gets status `old` (history) |
| A person presses «Связать с контактом» (Link to contact) on a message (source items table, topic drawer, document) and picks a contact | Store id + handle on the contact (`source = manual`, `verified_at`). Also offered for an author with no username |
| Someone sends a contact card (`message.contact` with `user_id` + phone) | Phone = a contact's phone (unique) → store the id on that contact (`source = contact_card`). The card itself is not ingested as text (Q1 unchanged) |
| A user shares their number in a DM (`request_contact`) | Same as above. The bot asks only when Q22 says so |

### 6.3 Conflicts

- The same handle / id on two contacts → no match (unique hit rule, as today); the data-quality list «Дубли Telegram» (Telegram duplicates) proposes a merge (`mergeContacts` exists).
- A handle / id on a contact AND a member → the member wins (attribution), the contact address is marked.
- The registry match report (`org-identity-registry.ts`) must also read «Адреса» → Telegram (bug-level fix, §3).

## 7. P4 — chat ↔ company

### 7.1 Model

New table `telegram_chat` (one row per org × bot × chat; replaces `provider_config.telegramGroups`, data moved by a migration):

| Column | Meaning |
|---|---|
| `organization_id`, `source_id`, `chat_id` | Key |
| `type` | `private` · `group` · `supergroup` · `channel` |
| `title`, `username` | Last seen |
| `bot_status` | `member` · `admin` · `left` · `kicked` (from `my_chat_member`) |
| `migrated_from_chat_id` | Group → supergroup (built logic moves here) |
| `mode` | `auto` (default: no binding, identity per author) · `clients` (bound to companies) · `internal` (staff only) · `ignored` (= exclusion, kept in sync with `analysis_exclusion` kind chat) |
| `deal_id` | Optional (Q26) |
| `first_seen_at`, `last_message_at`, `bound_by_user_id`, `bound_at` | — |

`telegram_chat_client` (chat, client, `is_primary`): one or more companies, exactly one primary when `mode = clients`.

A row can be created **before** the bot sees the chat, by username only (`t.me/<name>`, «@name») — status «ждём первое сообщение» (waiting for the first message); the first message fills `chat_id`. This is how a person types a company's Telegram name (P2) in the company card.

### 7.2 Where a person binds

- Source settings → «Группы» (Groups) (built list) → per chat: «Компании» (Companies) picker, mode, «Не анализировать».
- Company card → block «Telegram»: the chats / accounts bound to this company; «Добавить» (Add) by @name or from the list of the bot's chats.
- Who may change a binding: Q24.
- Every change → a row in a change log (who, when, from → to).

### 7.3 Suggestions (no automatic binding)

A suggestion is shown in «Группы» and as a notification to the org owner (kind new, category `clients`):
- the chat title contains a company name (`companyMatchKey`, unique hit);
- ≥ 2 known non-staff authors of the chat and ≥ 80 % of them belong to one company.

A person accepts or rejects. Rejected = not suggested again for that pair.

### 7.4 Effect of a binding

| Mode | Counterparty of a message | Author | Extra |
|---|---|---|---|
| `clients`, one company | That company | Resolved per author (§8); unknown author = «неизвестный участник» (unknown member) of that company | Unknown author → proposal «Новый контакт в <Компания>?» (New contact in <Company>?) (Q25) |
| `clients`, several companies | The author contact's company when it is in the set; else the company the text names, chosen ONLY from the set (topics counterparty string matched inside the set); else the primary | As above | Q19 |
| `clients`, staff author | The primary company (replaces the `groupPeer` guess) | Member | — |
| `internal` | None | Member(s) | Direction `internal`; a message from a non-member is logged as a data-quality warning (Q28) |
| `ignored` | — | — | Not stored (built exclusion) |
| `auto` | Per author (today's logic, `groupPeer` kept as a fallback for our messages) | Per author | Suggestions §7.3 |

Precedence (Q19): a chat binding decides the COMPANY of the conversation; the author identity decides the PERSON. A known contact of another company who writes in a group bound to company A: counterparty = A, the contact is linked as a participant (documents, activity), and a contact-link proposal «Работает с обеими?» (Works with both?) is NOT made automatically (one message is too weak).

### 7.5 Forum topics (F9)

Thread key includes the forum topic: `tg:<chat>:<topic>:<window>`. Binding stays per chat (Q27).

### 7.6 Notices to our people (Q23, decided)

No message to clients and no text in groups. The CRM tells our own people, as in-app notifications (registry `src/lib/notifications/kinds.ts`, category `organization`, priority info):

| Event | Recipients | Text (Russian UI) |
|---|---|---|
| The bot joined a group (`my_chat_member`) | Org owners | «Бот добавлен в «<название>». Сообщения этого чата сохраняются в CRM и анализируются.» (The bot was added to «…». Messages of this chat are saved in the CRM and analysed.) |
| A member bound their Telegram (§5.2) | That member + org owners | «Telegram <@name> привязан к <участник>. Личные сообщения боту сохраняются в CRM.» |
| The bot was made admin of a CHANNEL (finalization F1, [05](05-finalization.md)) | Org owners | «Бот добавлен в канал «<название>». Каналы не поддерживаются: посты канала не сохраняются в CRM.» (The bot was added to the channel «…». Channels are not supported: posts are not saved in the CRM.) |

The /account page («Telegram») and the source settings show the same text next to the bind / connect action.

### 7.7 Channels — out of scope (Q32 = a, 2026-11-18)

**Not built.** The rules below are kept for a later decision (`docs/todo/README.md` TG8). Today: a bot joins a channel only as an admin (F8); `channel_post` is not in `allowed_updates`, so posts never arrive. After finalization task F1 ([05](05-finalization.md)) a channel is not listed in «Группы» and the owners get the notice of §7.6. A channel post that a person FORWARDS to the bot is saved as a normal forward (author unknown, `via = chat_forward`).

Kept for later:

- Only channels where the bot is an admin (F8). A row in `telegram_chat` with `type = channel`; same modes and bindings as a group.
- A post = one source item, `externalType = chat_message`, `external_id = <chat>:<msg>`; an edit updates the item and re-parses (Q30).
- Author: no person. Our own channel (mode `internal`, or the chat is in the «us» registry) → `own_org`, a post of ours (a broadcast). A channel bound to companies → author kind `company_account` of the primary company, counterparty = the bound companies. `auto` (no binding) → counterparty unknown; the channel is offered for binding (§7.3, by title).
- Comments: the linked discussion group is a separate group (F7); a person binds it to the same companies.
- Posting from the CRM into a channel = Q31 (not in this task).

## 8. Resolution — the one rule per message

At parse (and again on re-parse; a change of bindings applies to new messages only, §8.3), a pure function `resolveTelegramMessage(input, directory)` returns:

```
{ author: { kind: "member" | "contact" | "company_account" | "unknown",
            userId?, contactId?, clientId?, tgUserId?, username?, name?, via },
  counterpartyClientIds: string[],        // ordered, first = main
  chatMode, chatId, verified: boolean }
```

stored as `metadata_json.telegram.resolved`. It replaces the ad-hoc readers (`itemPeer` Telegram branch, `groupPeer`, `contactByTelegramHandle`, rule 1d).

### 8.1 Author (for a forward: the ORIGINAL author; hidden forward → unknown)

| Step | Match | `via` |
|---|---|---|
| 1 | `tg_user_id` = an active staff binding | `staff_binding` |
| 2 | handle = a staff handle entry («us» registry) | `staff_handle` |
| 3 | `tg_user_id` = a contact Telegram address `external_id` (one contact) | `contact_id` |
| 4 | handle = an active contact Telegram address or alias (one contact) → also learn the id (§6.2) | `contact_handle` |
| 5 | `tg_user_id` / handle = a private chat bound to a company (company account) | `company_account` |
| 6 | Nothing | `unknown` (name, handle, id kept) |

A unique hit is required at steps 3–5 (as today).

### 8.2 Counterparty company

1. Chat `mode = clients` → §7.4.
2. Chat `mode = internal` → none, direction `internal`.
3. Author = contact → the contact's current companies (several → the existing rule of `counterparty.ts`).
4. Author = company account → that company.
5. Author = member in a group with `mode = auto` → the `groupPeer` guess (built) as a fallback.
6. Else none (topics may still find a company from the text, as today).

### 8.3 Who reads `resolved`

| Consumer | Change |
|---|---|
| Own-org attribution | Steps 1–2 = `own_org`; direction as today |
| Topics counterparty (`itemPeer`, `resolveCounterparty`) | Use `resolved` first; old logic only when it is absent |
| Document auto link A1 | Author contact + counterparty company from `resolved` |
| Company «Последняя активность» | Telegram items with a counterparty company count (new) |
| Contact / company «Источники» and the AI chat records engine | Messages of a contact / company found by `resolved` ids (fast filter instead of JSON name search) |
| Discovery | Unknown authors with a company from a chat binding → contact candidates (Q25) |

**When data changes** (a binding, a contact address, a learned id): only NEW messages use the new data (Q29 = a, decided). Items already stored keep their `resolved` and their topics. A person who wants an old message moved uses the existing manual actions (re-parse of an item, «Отвязать» / link in the topic drawer).

## 9. P3 — org bot vs. member bot

### 9.1 Options

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. One org bot (today)** | One bot per org. Clients write to it, it sits in groups, staff bind to it for notifications (§5) | One setup, one token, one webhook; clear tenant | Clients rarely write to a company bot in B2B; real talk is in personal chats and groups |
| **B. Org bot + Telegram Business** (F10) | The SAME org bot. A sales rep with Telegram Premium connects it to their personal account and chooses the client chats. The bot gets those chats as `business_message` | Captures the rep's REAL 1:1 chats; the connection itself names the member (`business_connection.user` → staff binding), so the member is known without typing; direction is clear (rep = outbound, client = inbound) | Premium per rep; the rep chooses the chats (may switch off); private chats only; consent / legal (Q23); needs Business Mode in BotFather |
| **C. Personal bot per member** | Each member creates their own bot (a second Telegram source with `owner_user_id`). Clients write to «@ivan_sales_bot» | A client sees «the bot of my manager»; default owner of new topics = that member | N bots to create, N tokens, N webhooks; the member is still not the author (the bot is); clients must be asked to use it |
| **D. User account access («userbot», MTProto)** | The system logs in as the member's Telegram account | Sees everything | **Not recommended**: against Telegram terms for this use, account ban risk, the stored session = full access to a personal account |

### 9.2 Recommendation

**Decision (business, 2026-11-18): set-up A only — one org bot, no Telegram Business for now.** The switch «Telegram Business» below is NOT built; nothing in the code asks Telegram for `business_*` updates. The rest of §9.2–§9.4 is kept for a later decision (`docs/todo/README.md` TG7). What works without Business: §9.5.

Earlier text: **One bot per org** (product owner, 2026-11-17: "one bot per org, as long as it supports all the use cases"). **Option C is dropped, D never.** Each org chooses its set-up in the Telegram source settings — switch «Telegram Business» (`provider_config.businessEnabled`, org owner, default off):

| Set-up | What works | Org needs |
|---|---|---|
| «Бот» (A) — **the only set-up (2026-11-18)** | DMs to the bot, groups, staff binding, pushes, notifications, AI chat over Telegram | One bot from BotFather (built) |
| «Бот + Telegram Business» (A + B) — not built | All of A + the reps' private client chats (§9.3, §9.4) | Business Mode on for the bot in BotFather; Premium for each rep who connects |

Switch on → `allowed_updates` adds `business_connection`, `business_message`, `edited_business_message`, `deleted_business_messages` (the webhook is registered again, as on a credentials save). Switch off → those updates are no longer asked for; a connection that still arrives is not ingested. A connection is accepted only from a member with an active staff binding (§5) — matched by the numeric id; Business stays optional per rep. Q17 for business = only whether reps will use it; the build supports both set-ups either way.

Earlier text (kept for the reasoning): **A + B.** One org bot stays the only bot per org. «Linked to a member» is done in two ways that do not need a second bot: the staff binding (§5, notifications + DM notes) and the Business connection (B, the rep's client chats). Option C only if business names a concrete use case (Q17); the model allows it later: `source.owner_user_id` (nullable) and the rules «default owner of topics / responsible for new contacts = the bot owner; delivery to that member may use their bot».

### 9.3 Logic for B — not built (Q17 = A only; kept for later)

| Event | Action |
|---|---|
| `business_connection` (enabled) | Find the member: `tg_user_id` = a staff binding; none → store the connection as «ждёт привязки» (waiting for binding) and ask the member (if known by handle) to bind; never ingest chats of an unknown connected account |
| `business_message` | One source item, like a DM: `externalType = chat_message`, `external_id = b:<connection>:<chat>:<msg>`, `metadata_json.telegram.business = { connectionId, ownerUserId }`. Author = the rep (outbound, `own_org`) or the other side (inbound, resolved by §8.1). Chat = the private chat with the client → can be bound to a company (§7) |
| `edited_business_message` | Update the item text, re-parse |
| `deleted_business_messages` | Q30 (recommend: keep the item, mark «удалено в Telegram» (deleted in Telegram)) |
| Connection disabled / rights removed | Stop; keep old items |
| Replies from the CRM through the connection | Out of scope (Q31) |

### 9.4 What Telegram Business gives (use cases for Q17; kept for later)

Without Business, the org bot sees only two things: messages that people send TO THE BOT, and groups / channels where the bot is a member. In B2B, clients rarely write to a company bot. Most talk is in the rep's own private chat with the client («Иван (менеджер) ↔ Пётр (закупщик)»). The bot does not see these chats. Business is the only allowed way to let the bot see them (option D, logging in as the rep, is against Telegram terms).

| # | Use case | Example | Without Business |
|---|---|---|---|
| B1 | **Client chats become source items** — like a mailbox connected through Nylas, but for Telegram | Пётр writes to Иван: «Пришлите КП на 200 штук до пятницы». The message arrives as an item → signal «запрос КП», deadline Friday, topic «Альфа — КП на 200 шт», card for Иван | Invisible. Only if Иван forwards it to the bot by hand |
| B2 | **Both directions** → «ждём нас» / «ждём их» (waiting on us / on them) work for Telegram | Иван answers «Отправлю в четверг» → the topic shows our promise; no answer for 2 working days → reminder | We see only what the rep forwards |
| B3 | **Automatic identity** — the connection names the rep; each chat names the client by numeric id | The rep needs no `/start` code; Пётр's id is learned and linked to his contact once | Staff binding by hand (§5), client by «@name» only |
| B4 | **Company activity and history** | «Последняя активность» of «Альфа» moves; the deal card shows the Telegram talk | Telegram talk is missing from the company |
| B5 | **The rep controls privacy** | In Telegram, the rep chooses which chats the bot sees (e.g. only new chats, or excludes personal contacts) and can switch it off at any time | — |
| B6 | Later (Q31): **answer from the CRM** in the rep's name | A card «Ответить Петру» sends the drafted reply in Иван's chat (only chats with an incoming message in the last 24 h) | Not possible |

What it costs and limits: Telegram Premium for each rep who connects; private chats only (groups still need the bot as a member, F7); no history before the connection (check, F10); the rep may exclude a chat, so the CRM is not complete by force. Business question: do reps already talk to clients in personal Telegram chats? If yes, B is the feature that makes Telegram useful in the CRM; if clients mostly talk in groups, A is enough and B can wait.

### 9.5 What works without Business (set-up A, decided 2026-11-18)

The bot never sees a rep's private Telegram chat with a client: a private chat has exactly two people, and nobody can add a bot to it. Client talk reaches the CRM in these ways:

| # | Scenario | How it works | Built |
|---|---|---|---|
| S1 | **Group with the client** | A rep makes a group with the client's people (or the client has one) and adds the org bot. The owner or the company's «Ответственный» binds the group to the company (§7). Every message is an item; authors are found by §8.1; unknown authors → «Новый контакт в …?» | TI4 |
| S2 | **Forward from a private chat** | A rep forwards a client's message from their private chat to the bot. It is saved as the CLIENT's message (original author, §8.1) and feeds signals and topics. With the AI chat on, it is also the context of a question in the same turn (ai-chat-telegram Q8) | TI1, TC3 |
| S3 | **The client writes to the org bot** | A DM to the bot is an item from that person; a company's own account bound to a company → that company (§7.2, §8.1 step 5) | TI1, TI4 |
| S4 | **Internal group** | Our staff group with the bot, mode `internal` → internal items, no company (Q28) | TI4 |
| S5 | **Rep's own note** | A rep types or dictates a note to the bot. AI chat on → the chat answers, the chat → sources ingest keeps the business facts; AI chat off → a relayed note in signal extraction (TI6) | TI6, TC1–TC7 |
| S6 | **Bot → our staff** | Topic pushes, important notifications, the AI chat (§5.4, §5.5) | TI2, TI3 |

Limits: a private chat that is not forwarded is not in the CRM; a forward from a person who hides forwards in their privacy settings has no author (`hidden_forward`) — the company then comes only from the text (topics); no history before the bot joined a group (F7); the CRM never writes to clients (Q31). Staff learn S1 / S2 from a short guide on /profile → «Telegram» and in the bot's `/help` (finalization F2, built 2026-11-18).

## 10. Questions (for the product owner and business) — answers of 2026-11-17 and 2026-11-18

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q16 | How do we identify our members in Telegram | (a) verified binding through the bot (§5.2) + keep the typed handle as «не подтверждён»; (b) typed handle only (today); (c) binding only, remove typed handles | **Decided** (as recommended): **(a)** — verification protects against a client's handle being typed as staff; typed handles keep working for members who do not bind |
| Q17 | Which bot model | A only · A + B (Business) · A + C (personal bots) · all | **Decided: A only** (business, 2026-11-18): one org bot, no Telegram Business for now (§9.2, §9.5). Business set-up postponed (`docs/todo/README.md` TG7). C dropped, D never |
| Q18 | Where a company's Telegram (shared account, group, channel) is kept | (a) as a chat binding (§7), shown in the company card block «Telegram»; (b) a new company field «Telegram» (list of @names) | **Decided** (as recommended): **(a)** — one model for «the company in Telegram»; a field would be a second place that drifts |
| Q19 | Group bound to company A, a known contact of company B writes | (a) counterparty = A, B's contact = participant only; (b) counterparty = B for that message; (c) counterparty = both | **Decided** (as recommended): **(a)** — the group is about A; mixing makes topics jump between companies |
| Q20 | A member's own text / voice in a DM with the bot (not a forward) | (a) internal note about a client: stored, direction `internal`, counterparty from the text, feeds signals (closes topics/08 I3); (b) ignore; (c) a question to the AI chat (the bot as a mobile AI chat) | **Decided** (as recommended): **(a)** now; (c) as a separate spec later (buttons of draft cards in Telegram need more work) |
| Q21 | What the bot sends to a bound member | (a) topic pushes only (topics/08 T2); (b) (a) + important notifications; (c) (b) + daily digests | **Decided (b)** (product owner, 2026-11-17): topic pushes + important notifications, per-user on / off per category on /account; plus the AI chat over Telegram (§5.5) |
| Q22 | Should the bot ask an UNKNOWN DM sender to share a phone number (`request_contact`) | (a) never; (b) once, with a polite text; (c) only when the org switches it on | **Decided** (as recommended): **(c)**, default off — a client may find it pushy |
| Q23 | Consent and notice | (a) the bot description and a first message in a new group say that messages are saved in the CRM of <org>; Business connection only after the rep confirms a text in the CRM; legal check of the texts; (b) no notice; (c) notices inside the CRM only, to our members and the org owner | **Decided (c)** (product owner, 2026-11-17): in-app notifications only (§7.6); no message to clients, no legal step |
| Q24 | Who may bind a chat to a company | (a) org owner only; (b) owner + the company's «Ответственный» (Responsible); (c) any member, with a log | **Decided** (as recommended): **(b)** |
| Q25 | Unknown author in a group bound to a company | (a) proposal «Новый контакт в <Компания>?» (a person confirms); (b) create the contact automatically; (c) nothing | **Decided** (as recommended): **(a)** — same idea as discovery for mail |
| Q26 | Bind a group to a DEAL too (a group per project) | (a) no, company only; (b) optional deal: new topics of that chat link to the deal | **Decided** (as recommended): **(a)** now — the deal auto-link (topics/10) already links topics of the client's only open deal; revisit when a client has many deals in parallel |
| Q27 | Supergroup forum topics | (a) binding per chat, forum topic only in the thread key; (b) binding per forum topic | **Decided** (as recommended): **(a)** |
| Q28 | `internal` group: a non-member writes | (a) store as internal, show a data-quality warning; (b) drop | **Decided** (as recommended): **(a)** |
| Q29 | When a binding / identity changes, how far back to apply | (a) new messages only; (b) re-resolve 90 days (no AI) + re-run topics for changed items in the signal window; (c) everything | **Decided (a)**: new messages only (§8.3) |
| Q30 | Deleted / edited messages | (a) edits update the item and re-parse; Business deletions mark the item, never delete; (b) ignore edits and deletions | **Decided** (as recommended): **(a)**. Note: for normal chats Telegram tells a bot about edits (`edited_message`) but NOT about deletions |
| Q31 | Should the CRM send messages to CLIENTS through the bot (reply in a group, in a Business chat) | (a) no — outbound only to our members; (b) later, separate spec | **Decided** (as recommended): **(a)** in this task; (b) needs rules for who may send what, templates, and a log |
| Q32 | Client Telegram CHANNELS (broadcast) | (a) out of scope; (b) support `channel_post` from channels where the bot is admin (F8), bound to companies like groups | **Decided: (a)** (business, 2026-11-18): out of scope for now (§7.7; postponed: `docs/todo/README.md` TG8). A channel the bot is added to gets the guard of finalization F1. Posting into a channel / group = Q31 |
| Q33 | A member's own DM: note or AI chat | (a) a mode per member; (b) all to the AI chat, notes via the chat ingest; (c) a command per message | **Decided (b)** in [ai-chat-telegram](../ai-chat-telegram/01-specification.md) Q13 (2026-11-17) |

## 11. Plan (after the decisions)

One developer with AI assistance, working days. Migrations: `telegram_binding` (+ `ai_chat_thread_id`), `ai_chat_thread.channel`, handled updates + button ids (small tables), `telegram_chat`, `telegram_chat_client`, `contact_address.external_id` / `verified_at` (+ data move of `provider_config.telegramGroups`).

| Phase | Name | Days | Output |
|---|---|---|---|
| TI1 | Resolver — **built 2026-11-17** | 2 | Pure `resolveTelegramMessage` + unit tests (every row of §8); directory loader; `resolved` stamped at parse; consumers switched: attribution (id-first), topics counterparty, A1, company activity; registry report reads «Адреса» |
| TI2 | Staff binding + router — **built 2026-11-17** | 2 | Router of §5.5 C2 (command / button / member DM target / ingest) before storage, handled-`update_id` dedupe (C5); `/start <code>`, `/stop`; /account UI with deep link + QR; unbind paths; conflict checks |
| TI3 | Outbound — **built 2026-11-17** (sender; topic pushes with «Готово» / «Отложить до завтра»; important-notification copies; per-category choice; org switch `topics.delivery.telegram`) | 2 | ONE sender (§5.5 C6: split, HTML, buttons with short ids, 429, log); delivery channel `telegram` (topic push T2) + important notifications (Q21) + per-category choice; 403 → `blocked`; log; topics/08 T6 admin switch |
| TI4 | Chats — **built 2026-11-17 for groups and company accounts** (channels out of scope, Q32 = a) | 2 | `telegram_chat` + data move; binding UI in «Группы» and the company card; modes; change log; suggestions §7.3; notices §7.6 |
| TI5 | Contacts — **built 2026-11-17** (unknown-author proposals → TI4) | 1.5 | Learned ids, «Связать с контактом», contact cards (F2), duplicates list, unknown-author proposals (Q25) |
| TI6 | Member DM notes — **built 2026-11-17** | 1 | Q20 (a): internal note rule in extraction + eval cases |
| TI7 | Business set-up — **dropped for now** (Q17 = A only, 2026-11-18; postponed: todo TG7) | — | — |
| TI8 | Docs + live check — **docs done 2026-11-17; live check = [05-finalization.md](05-finalization.md) F3** | 0.5 | `src/app/AGENTS.md`, this folder, topics/08 status; live check on a deployed bot (webhook needed) |

Total ≈ 11.5 days (without TI7 and channels, 2026-11-18). **Done 2026-11-17: TI1–TI6 + the docs part of TI8 (≈ 11 days).** Left: the finalization tasks F1–F5 of [05-finalization.md](05-finalization.md) (≈ 1.5–2 days incl. the live check and its fixes). Not in this plan: the AI chat over Telegram itself (turn runner C4, chat rules in Telegram) — its own spec.

## 12. Acceptance checks

1. A member binds through the deep link → `/start <code>` is not a source item; the binding is `active`; a second use of the code fails.
2. The bound member renames their username → their group message is still `own_org` (`via = staff_binding`).
3. A typed staff handle that equals a contact's handle → warning on both cards; the contact's messages are not hidden without the owner seeing it.
4. A P8 topic of the bound member → one Telegram push with «Открыть в CRM»; the member blocks the bot → next push `skipped: blocked`, binding `blocked`.
5. A contact with «Адреса» → Telegram «@ivan» writes in a group → item linked to the contact and its company; the numeric id is learned; after a rename the next message still links.
6. A person with no username writes; a member uses «Связать с контактом» → later messages link by id.
7. A group bound to company A: an unknown author → counterparty A + proposal «Новый контакт в A?»; our member's message → counterparty A (no `groupPeer` guess).
8. A group bound to A and B: a contact of B writes → counterparty B; an unknown author → the primary.
9. A binding is added to a group with 2 weeks of history → only messages after the binding use it; old items are unchanged (Q29 = a).
10. A group titled «Альфа / Мы» with company «Альфа» → a suggestion, not a binding.
11. Company «Последняя активность» moves after a Telegram message of its contact.
12. (Business — not in scope, Q17 = A only) A rep connects the org bot; a client writes in the rep's chat → inbound item, author = the client contact; the rep's reply → outbound `own_org`; the rep switches the connection off → nothing new arrives.
13. (Channel — not in scope, Q32 = a) The bot is made admin of a channel bound to company A → a post becomes an item, author `company_account` of A; an edit updates it; the org owners got the notice «Бот добавлен в …».
14. (Notices) A member binds Telegram → the member and the owners get the notice; no message is sent to any group.
15. (Router) The same update delivered twice → handled once. A button press → `answerCallbackQuery` at once, the action runs once; an expired button id → «Кнопка устарела» (Button expired).
16. (Sender) A 9,000-char answer → 3 messages; HTML special chars escaped; a 429 → sent again after `retry_after`.
17. (Set-up — not in scope, Q17 = A only) Business switch off → `allowed_updates` has no `business_*`; switch on → the webhook is registered again with them.
18. (Channel guard, finalization F1) The bot is made admin of a channel → the owners get «Бот добавлен в канал … Каналы не поддерживаются …»; the channel is not listed in «Группы»; no post is saved.

## 13. Completion status (2026-11-17)

**Business answers received 2026-11-18** (Q17 = A only, Q32 = a); finalization: [05-finalization.md](05-finalization.md). Everything below runs on the test DB; nothing was tested with a real Telegram account yet (needs the deployed webhook).

### 13.1 Built

| Phase | What | Where |
|---|---|---|
| TI1 | ONE rule per message: author (binding id → staff name → contact id → contact name / legacy alias → company account → unknown; forward = original author) + company (§8.2 / §7.4), stored as `metadata_json.telegram.resolved` at every parse; readers: attribution (rule 1d0 `sender_staff_binding`), topics counterparty, document link A1, company «Последняя активность», registry match report | `src/lib/telegram/resolve.ts`, `src/server/telegram/directory.ts`, `parse-source-item.ts` |
| TI2 | Staff binding (`/start <code>`, 15 min, single use; /profile «Telegram»), router before storage, handled-update dedupe, `/stop` `/new` `/help`, member wins over a contact | `src/server/telegram/{bindings,router}.ts`, `profile-telegram.tsx` |
| TI3 | One sender; topic pushes with «Открыть» / «✅ Готово» / «⏰ Отложить до завтра» (working hours, ≤ 2 per topic in 7 days); Telegram copies of important notifications (per category); org switch `topics.delivery.telegram`; retention of the bot's rows | `src/server/telegram/{sender,delivery,retention}.ts`, `src/server/topics/delivery/telegram-push.ts` |
| TI4 | Chats ↔ companies for groups and companies' own accounts: `telegram_chat` (+ move of `provider_config.telegramGroups`), modes auto / clients / internal, companies with a primary, change log, suggestions (title / authors), «Новый контакт в …?» proposals, «Группы» settings, company card block «Telegram» | `src/server/telegram/chats.ts`, `telegram-chats-settings.tsx`, `client-telegram-block.tsx` |
| TI5 | Learned ids + renames, «Связать с контактом» (sources table, topic drawer), contact cards (phone → id), «Дубли Telegram» on /contacts, «id» badge on contact addresses | `directory.ts`, `telegram-link-contact-dialog.tsx`, `telegram-duplicates-button.tsx` |
| TI6 | A member's own message to the bot (AI chat off) = a relayed note about a client in signal extraction | `src/server/topics/signals/item-input.ts`, `prompt/extraction.ts` |
| TI8 (docs) | `src/app/AGENTS.md` § "Telegram Bot (Sources)", root `AGENTS.md`, topics/08, this folder | — |

Migrations (applied to the `.env` test DB): `0044_telegram_bot_and_chat`, `0045_telegram_pushes_notifications`, `0046_contact_telegram_ids`, `0047_telegram_chats`. Deployed DB: `docs/todo/README.md` D6.

### 13.2 Differences from the text above

- Binding UI on **/profile → «Telegram»** (not /account); no QR code (no library) — link + «Открыть Telegram» + copy.
- AI chat switch = `provider_config.aiChatEnabled` of the Telegram source (not an org setting).
- One send log table `telegram_out_message` (every bot message; also the reply context).
- Topic pushes: org switch `topics.delivery.telegram` default **on** (the member opts in by binding); `topic_delivery_pref.telegram_enabled` default on (migration `0045`); `telegram_chat_id` is not used — the address is the binding.
- A person with no username is stored as the address value «tg:<id>» (shown «Telegram id …»).
- «Новый контакт в …?» proposals live in the company card block «Telegram», not in discovery.
- TI6 reuses the AI chat note rule (relayed note, attribution `unknown`, the client from the text) instead of a new «internal note» direction.
- «Не анализировать» stays the chat exclusion (no `ignored` mode value).

### 13.3 Acceptance checks (§12) — how they are covered today

Automated: `src/server/chat/eval/telegram.eval.ts` (`pnpm chat:eval`, `CHAT_EVAL_ONLY=tg`; real router / worker / parse / model on the test DB, only the Bot API mocked) + unit tests.

| # | Coverage |
|---|---|
| 1 binding | tg01 |
| 2 member renamed | tg16 (member found by binding id, not by name) |
| 3 typed staff handle = contact handle | **partly**: the registry match report lists the contact; no warning on the cards (todo TG5) |
| 4 push + blocked | tg10, tg11 (push, limit); the 403 → `blocked` path only in code — real-phone check |
| 5 contact by name, id learned, rename | tg12, tg13 |
| 6 «Связать с контактом» | tg14 |
| 7 bound group, unknown author, our member | tg19, tg20 |
| 8 two companies | `resolve.test.ts` |
| 9 only new messages | by design (resolution only at parse) |
| 10 title suggestion | tg18 + unit `titleKeys` |
| 11 company activity | tg12 |
| 12, 17 Business | not in scope (Q17 = A only) |
| 13 channel | not in scope (Q32 = a) |
| 18 channel guard | tg24 (F1 built 2026-11-18) |
| 14 notices | tg01 (bound), tg18 (bot added) |
| 15 router dedupe / buttons | buttons tg04, tg06, tg10, tg11; dedupe in code — real-phone check |
| 16 sender | split + escaping in `render.test.ts` / `html.test.ts`; 429 only in code |

### 13.4 Left

| What | Blocked by | Size |
|---|---|---|
| Finalization F3–F5 ([05-finalization.md](05-finalization.md); F1 channel guard + F2 guide built 2026-11-18): set-up, real-phone check, fixes + close-out | — | ≈ 1–1.5 days |
| Postponed by the business answers: TI7 Telegram Business, channels | Q17 = A only, Q32 = a (2026-11-18) | `docs/todo/README.md` TG7, TG8 |
| Decided, not scheduled: forum topics in the thread key (§7.5), discovery of Telegram authors, the bot asking an unknown sender for the phone (Q22), the records-engine filter by `resolved` ids, the card warning of check 3, topic digests by Telegram (topics/08 T4) | — | `docs/todo/README.md` TG1–TG6 |

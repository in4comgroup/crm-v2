# AI chat over Telegram — specification

Status: **built 2026-11-17 (TC1–TC7, not deployed)** — all questions Q1–Q14 decided as recommended (product owner). What differs from the text below: §18. Live check with a real Telegram account: open (needs a deployed webhook, §18). Plan: §16. Acceptance checks: §17.

Related: [ai-chat/](../ai-chat/README.md) (the web AI chat v2 — built) · [ai-chat-tools/](../ai-chat-tools/README.md) (draft cards, files, voice — built) · [telegram/04-identity-and-chats.md](../telegram/04-identity-and-chats.md) (staff binding, router, one sender — draft; §5.5 = the capacity this spec uses) · `src/lib/AGENTS.md` § "AI Chat".

---

## 1. Goal and scope

A member of the org talks to the AI chat **in a private chat with the org's Telegram bot**, as in the web chat panel:

- asks the same types of questions (search and lists of records, one record, statistics, mail / source content, web search);
- sends files, photos and voice messages; the system reads them in the standard way (the same parsers as the web chat);
- gets an answer with the related information, in a form that suits Telegram (mostly text on a phone screen);
- can prepare records through draft cards and confirm simple ones in Telegram.

**One engine, two channels.** The Telegram chat uses the SAME turn logic, tools, prompt, history, limits and storage as the web chat. Only the input adapter (Telegram updates → a chat message) and the output adapter (chat parts → Telegram messages) are new. The answer quality is the same; only the presentation is reduced.

**First iteration (TC) = a useful minimum** (§14 lists what comes later): text in → text out, records as short lists with links, statistics as a short text table + a CSV file, sources as a short list, files / photos / voice in, draft cards with «Создать» / «Отменить» for simple cases, clarification questions as buttons, `/new` and `/help`.

## 2. What exists today

| Part | State | Where |
|---|---|---|
| Web AI chat v2 — tools `searchRecords`, `listRecords`, `getRecord`, `readSource`, `queryStats`, `searchWeb` + 10 draft-card tools + `readSignals` + `askUser` | Built 2026-11-16 | `src/app/api/chat/route.ts`, `src/server/chat/` |
| Answer = prose + data parts: `data-records` (results block), `data-stats` (chart + table + CSV), `data-evidence` (sources), `data-turn` («CRM · интернет · 7 с»), `data-spec` (composed view, non-CRM content only), `data-draft` (card), `data-question` (buttons), `data-attachment` (file read status), `data-debug` (platform admins) | Built | `src/lib/chat/turn.ts` |
| History: `ai_chat_thread` / `ai_chat_message`, last 60 messages to the model, 90-day retention, chat → «AI Chat» source items (`ingestMode`) | Built | `src/server/chat/threads.ts`, `ingest.ts` |
| Files: each file = an «AI Chat» source item with its stored original; parsed at send; the model gets TEXT only (Q22 of ai-chat-tools). Limits per kind: image 5 MB, audio 10 MB, PDF / office 20 MB, video 50 MB, text 2 MB; ≤ 5 files per message | Built | `src/server/chat/files.ts`, `src/lib/chat/files.ts` |
| Turn logic | **Inside the HTTP route**, bound to the browser session and the UI stream | `src/app/api/chat/route.ts` (272 lines) |
| Telegram bot per org, webhook, voice / file download (≤ 20 MB), forwards, albums (`media_group_id`) | Built (ingest) | `src/server/ingest/telegram.ts` |
| Staff binding, update router, one sender, button ids, handled-update dedupe | **Draft** (telegram/04 §5, §5.5 C1–C9) | — |

## 3. Telegram limits that shape the design

| # | Limit (Bot API 10.4, checked 2026-11-17) | Effect |
|---|---|---|
| L1 | Message text ≤ **4,096** chars; a caption ≤ 1,024 | Long answers are split; a file caption is short |
| L2 | Formatting = a small HTML set: `b`, `i`, `u`, `s`, `a`, `code`, `pre` (+ language), `blockquote` (+ `expandable`), `tg-spoiler`. **No tables, no headings, no images in text** | Markdown → this subset; tables → monospace `pre` or lists; long lists → an expandable quote |
| L3 | A phone screen ≈ 30–40 monospace chars per line | `pre` tables only for 2–3 narrow columns |
| L4 | Buttons: inline keyboard, `callback_data` ≤ **64 bytes**; URL buttons; a `web_app` button (Mini App) only in private chats | Server-side short ids for actions (telegram/04 C6) |
| L5 | `answerCallbackQuery` must be called for every button press (else the client shows a progress bar) | Answer at once, then work |
| L6 | **`sendMessageDraft`** (private chats only): a temporary preview of a message that is being generated (≈ 30 s, then `sendMessage` makes it final); empty text shows «Thinking…» | Status / partial answer while the turn runs (Q6) |
| L7 | `sendChatAction` «typing» lasts ≤ 5 s | Repeat every ~4 s while working |
| L8 | Bot download ≤ **20 MB** per file (`getFile`); upload ≤ 50 MB (`sendDocument`), photo ≤ 10 MB | Video in Telegram ≤ 20 MB (web: 50 MB) |
| L9 | Voice = OGG / Opus; video note = MP4 ≤ 1 min; a photo arrives in several sizes (compressed JPEG) | All three are accepted kinds of the chat parsers |
| L10 | A long pasted text is split by the Telegram app into several messages; an album = several updates with one `media_group_id` | Merge messages that arrive close together into ONE turn (§6.1) |
| L11 | ≤ ~1 message / second per chat (429 + `retry_after` on bursts) | The sender paces (telegram/04 C6) |
| L12 | Reactions (`message_reaction`) need the bot to be an admin → not usable in a private chat | Feedback by buttons (Q11) |
| L13 | Telegram chats are cloud chats: not end-to-end encrypted, stored on Telegram servers, visible on every device of the account | Business decision on CRM data in Telegram (Q1) |
| L14 | `setMyCommands` per scope (e.g. only private chats) | `/new`, `/help` shown only in the private chat |

## 4. How a member uses it

1. The org owner switches on «ИИ-чат в Telegram» (Q1, Q2).
2. The member links Telegram on /account (telegram/04 §5.2: deep link, `/start <code>`). The bot answers: «Готово. Задавайте вопросы о клиентах, сделках, задачах — текстом, голосом или файлом. /new — новый разговор, /help — что я умею.»
3. The member writes or speaks; the bot shows «Думаю…» → «Ищу в CRM…» (the web status lines) and then sends the answer.

Examples (the same questions as the web chat eval):

| Member sends | Bot answers |
|---|---|
| «Что у нас с Альфой?» | Short summary + «Компании: 1 · Сделки: 2 · Задачи: 1» with the rows and «открыть» links |
| «Выручка по месяцам за этот год» | 1–2 sentences + a text table (12 rows) + button «📎 CSV» |
| Voice: «Встретился с Петровым из Альфы, договорились прислать КП до пятницы» | Transcript line + card «Задача: Отправить КП Альфе — до пт 18:00» with [Создать] [Отменить] |
| Photo of a business card | Card «Компания + контакт» with the read values, [Создать] [Отменить], or «Изменить в CRM» |
| PDF + caption «О чём договор?» | Summary of the PDF |

## 5. Architecture

```
Telegram ──webhook──▶ router (telegram/04 C2) ──member DM, target ai_chat──▶ inbox row
                                                                         │ after() + merge window (§6.1)
                                                                         ▼
                                      runChatTurn({ orgId, userId, threadId, message, channel: "telegram" })
                                      (the SAME turn as /api/chat: history, tools, prompt, storage, limits)
                                                                         │ status chunks ──▶ sendMessageDraft / typing
                                                                         ▼ final stored parts
                                      renderTelegramAnswer(parts)  (pure) ──▶ one sender (telegram/04 C6) ──▶ Telegram
```

| Piece | What | New / reused |
|---|---|---|
| **Turn runner** | Move the turn out of `src/app/api/chat/route.ts` into `src/server/chat/turn.ts` `runChatTurn(input)`: thread ensure, user message storage, history, org card, context line, tools, `aiStreamText`, stream filter, answer storage (also a stopped answer), errors. Returns the filtered UI-message stream. The web route keeps only session, body checks and `createUIMessageStreamResponse`. The web behaviour stays the same (eval 78 / 78 must still pass) | New (refactor) |
| **Inbox** | Table `telegram_chat_inbox` (binding, Telegram message id, kind, payload, `media_group_id`, status `pending` · `processing` · `done` · `failed`, created_at). The router writes one row per update and returns 200 at once | New |
| **Worker** | `after()` (Next.js) of the webhook call: wait the merge window, claim this member's `pending` rows in one statement (only one turn per member at a time; a second worker finds nothing), build ONE chat message, run the turn, render, send; loop while new rows are pending. Turn ≤ 110 s (as the web), the webhook route already has `maxDuration` 300 | New |
| **Input adapter** | Inbox rows → `UIMessage` (text + file parts) through the existing chat-file path (§6) | New, reuses `src/server/chat/files.ts` |
| **Renderer** | PURE `renderTelegramAnswer(parts, ctx)` → `TgOutMessage[]` (HTML text chunks ≤ 4,096, inline keyboards, documents) — §7. Unit-tested | New |
| **Buttons** | `callback_query` → button id (telegram/04 C6) → handler: confirm / cancel a card, pick an option, CSV, retry, feedback | New (on the telegram/04 router) |
| **Storage** | `ai_chat_thread.channel` (`web` · `telegram`), `telegram_binding.ai_chat_thread_id` (telegram/04 C3), table `telegram_chat_message` (Telegram message id ↔ `ai_chat_message` id + part id, for replies, card edits and retries) | New columns / table |

Everything is org-explicit and `server-only`; user + org come from the binding, never from the update text.

## 6. Inputs

### 6.1 Merging and order

- **Merge window**: the worker waits **2 s** after the LAST pending message of the member (max 10 s from the first) and makes ONE chat message from all of them: texts joined in order, files as file parts, an album as one message with its caption. So a long paste split by Telegram and an album with a caption become one question.
- **One turn at a time per member.** Messages that arrive while a turn runs wait and become the NEXT turn (merged). The bot does not answer them separately.
- **Edits** of a message that is still pending update it; after the turn started, an edit is ignored (no re-run).
- **Order** of answers = order of turns.

### 6.2 Kinds

| Telegram input | Chat input | Notes |
|---|---|---|
| Text | User text | ≤ 4,096 per Telegram message; merged (6.1) |
| Voice (`voice`, OGG) | File part kind `audio` → transcript (existing audio parser) | Q3: without text, the transcript IS the user's message text; the bot shows it back as «🎤 …» (first 300 chars, rest in an expandable quote). Limit: the chat audio limit 10 MB, ≤ 10 min |
| Audio file (MP3, M4A, …) | File part kind `audio` | Attachment, as in the web |
| Photo | The largest size ≤ 5 MB → kind `image` | A business card → draft card (ai-chat-tools T1) |
| Image as a document (uncompressed) | JPEG / PNG → `image`; HEIC / WebP / other → refused: «Отправьте как фото (не файлом)» | The web converts in the browser; the server does not convert |
| Document (PDF, DOCX, PPTX, TXT, MD, CSV, JSON) | Kind by type, chat limits | > 20 MB: «Файл больше 20 МБ — Telegram не даёт боту его скачать. Загрузите его в CRM» |
| Video, video note | Kind `video` (≤ 20 MB, L8) | |
| Caption of a file | User text | |
| Forward of a client's message | Q8 | |
| Contact card (`contact`) | Text «Контакт: <имя>, <телефон>» as user input | Can become a contact draft; also feeds identity (telegram/04 §6.2) |
| Reply to a bot message | The quoted message as context — Q9 | |
| Location, sticker, poll, GIF, dice | Not read: «Этот тип сообщения я пока не понимаю. Напишите текстом или голосом.» | |
| `/new`, `/help`, `/start`, `/stop` | Commands (telegram/04 router) | §9 |

Files are stored and parsed exactly as web chat files: an «AI Chat» source item per file with the stored original (`createChatUpload` / `putChatUploadPart` / `completeChatUpload` called on the server with the downloaded bytes), then `prepareChatAttachments` at turn start. A file message is NOT also a Telegram source item (telegram/04 C9). ≤ 5 files per turn; more → the first 5 + «Принял первые 5 файлов».

## 7. Answer rendering

One pure renderer, from the STORED parts of the answer (the same parts the web shows). Russian. Order: text → records → statistics → composed view → cards / questions → sources.

| Part | In Telegram (TC) | Later |
|---|---|---|
| **Prose** (markdown) | Markdown → Telegram HTML: bold / italic / links / code; headings → bold line; lists → «• »; a markdown table → rule of the `pre` table below, else lines «label — value». Split at paragraph borders ≤ 4,096 | — |
| **Results block** `data-records` | Header «Нашёл: компании 1 · контакты 2 · сделки 1»; per type a bold label and ≤ 5 rows «• <b>Title</b> — subtitle · facts · <a>открыть</a>» (absolute `recordHref`); more → «…ещё N — открыть в CRM» (link to the web chat thread, §13); applied filters as one line «Фильтр: …» | Button per row → record detail inside Telegram |
| **Statistics** `data-stats` | Title + period + filter chips as one line; ≤ 12 rows: a `pre` table when ≤ 3 columns and the label ≤ 18 chars (values right-aligned, money in short form «1,2 млн ₽»), else «• label — value»; more rows → «…ещё N строк — в CSV»; warnings as a line; button **«📎 CSV»** → `sendDocument` of `statsCsv` (on press, not always) | Chart as a PNG image (Q7) |
| **Sources** `data-evidence` | «Источники (N)» in an expandable quote: CRM items «Письмо от <кого> · 12.11.2026 — открыть», web sources «<сайт> — ссылка» | — |
| **Turn line** `data-turn` | Only when the web was used: «🌐 с данными из интернета» at the end | — |
| **Composed view** `data-spec` | KeyValue → «Label: value» lines; DataTable → as statistics; Markdown → as prose; Stack / Grid flattened; Badge → «[текст]» | — |
| **Draft card** `data-draft` | §8 | — |
| **Question** `data-question` | Question text + option buttons (≤ 2 questions per answer, as the web) | — |
| **Attachment status** `data-attachment` | A file that was not read: «⚠️ Не удалось прочитать «имя»: причина». Read files: nothing (the answer covers them) | — |
| **Debug** `data-debug` | Never in Telegram, also not for platform admins | — |

Absolute links = `NEXT_PUBLIC_APP_URL` + the web path. A link opens the CRM in the phone browser; the member must be signed in there (OTP). A Mini App would avoid that (Q10, later).

Example of one answer (rendered):

```
<b>Альфа ООО</b> — клиент, 2 открытые сделки, последний заказ 03.11.2026 на 1,2 млн ₽.

Нашёл: компании 1 · сделки 2 · задачи 1
<b>Сделки</b>
• <b>Альфа — поставка Q1</b> — «КП отправлено» · 2,4 млн ₽ · открыть
• <b>Альфа — сервис</b> — «Переговоры» · открыть
<b>Задачи</b>
• <b>Позвонить Петрову</b> — до 19.11 · открыть
```

## 8. Draft cards and questions

### 8.1 Card message

```
📝 Черновик: компания и контакт
Компания: Альфа ООО · alfa.ru
Контакт: Пётр Иванов, закупщик · +7 916 123-45-67
📎 Файл будет прикреплён к записи
[✅ Создать] [✖️ Отменить]
[✏️ Изменить в CRM]
```

| Card state | Buttons | Press → |
|---|---|---|
| `draft`, every item has one clear decision (no duplicate choice, no missing required field) | «Создать», «Отменить», «Изменить в CRM» | `confirmChatAction` as the member with the card's default values and decisions (the same function as `POST /api/chat/actions`; same checks, ≤ 30 creates / hour, duplicate 409) → the card message is edited to «✅ Создано: Компания «Альфа» (открыть) · Контакт …»; error → the Russian message of `ChatActionError` |
| ONE item with an exact duplicate | «Использовать существующий», «Создать новый», «Дополнить существующий» (when a fill exists), «Отменить» | The decision for that item, then confirm |
| `needs_input` (missing required field) | «Изменить в CRM», «Отменить» + the line «Не хватает: срок задачи. Ответьте сообщением» | The member's text answer is a new turn; the model makes a new card (as in the web, `followsDraft`) |
| Several items with choices, or editing values | «Изменить в CRM» | Opens the web chat on this thread with the card (§13) |
| `created` / `cancelled` / `expired` | None | — |

A card is changed in Telegram only by the buttons; values are never edited in Telegram in TC (Q5). The stored assistant message gets the new card state and `data-action-result`, exactly as from the web.

### 8.2 Questions (`askUser`)

Option buttons; a press sends the option text as the next user message (merged into the next turn) and edits the question message to «Ответ: <вариант>» (buttons removed). A typed answer works too.

## 9. Threads, commands, history

- **Thread rule (Q4)**: a member's Telegram messages go to their CURRENT thread (`telegram_binding.ai_chat_thread_id`). A new thread starts after `/new` or after **6 h** without messages. Thread title = the first question (as the web).
- The web chat list shows Telegram threads with a small «Telegram» mark (`ai_chat_thread.channel`). A member may continue a Telegram thread in the web; Telegram keeps writing into its current thread.
- Commands (private chat scope, L14): `/new` — «Новый разговор. Спрашивайте.»; `/help` — what the bot can do + limits (files ≤ 20 MB, Russian); `/start <code>`, `/stop` — telegram/04 §5.2.
- «Не передавать в источники» (`ingestMode`) works per thread as in the web; default = the web default. In Telegram there is no switch in TC; the member changes it in the web list.
- Retention = the web rule (90 days without messages).

## 10. Waiting, errors, limits

| Situation | Bot |
|---|---|
| Turn starts | `sendMessageDraft` with «Думаю…», then the web status lines («Ищу в CRM…», «Считаю статистику…», «Ищу в интернете…», «Читаю файл…»); fallback `sendChatAction typing` every 4 s (Q6) |
| Answer ready | Final messages (§7). The draft preview disappears |
| Model error / timeout | `chatErrorText` (Russian, by class) + button «Повторить» (regenerate of the stored turn, as the web) |
| Monthly AI limit (100 %) | «Лимит ИИ на этот месяц исчерпан. Обратитесь к владельцу организации.» — no button |
| Org switch off / binding not active | «ИИ-чат в Telegram выключен в вашей организации» / «Привяжите Telegram в CRM: Профиль → Уведомления» |
| Too many turns (Q12) | «Слишком много вопросов подряд. Подождите минуту.» |
| Empty answer | `EMPTY_ANSWER_FALLBACK` (existing) |
| Telegram 403 (the member blocked the bot) | Binding `blocked` (telegram/04); nothing sent |

## 11. Security and privacy

- Only a **private chat** with the bot. The bot NEVER runs the AI chat in a group or a channel (also when mentioned): groups contain clients.
- User + org = the active staff binding (telegram/04 C1). Same rights as the web (the records engine filters by org; topics / cards only in topics mode `on`). Removing a member from the org unbinds them (telegram/04 §5.2).
- **Data leaves the CRM into Telegram** (L13) — client names, amounts, phones, mail text. Business decision Q1. The org switch is OFF by default; the owner switches it on with a notice text.
- Account takeover: whoever controls the member's Telegram account can ask the CRM. Mitigation: the member and the owner can unbind at any time (/account, member list); optional re-confirmation (Q15).
- Prompt injection: forwarded / file / mail text stays «данные, а не инструкции» (existing prompt rules and the grounding of draft values).
- No technical data in Telegram: no ids, no tool names, no debug, no model name (the existing stream filter and `cleanIdLinks` apply before rendering).

## 12. Prompt and model

- Same process `chat.assistant`, same model (no model picker in Telegram), same tools, `actions: true`.
- A **channel block** at the END of the system prompt, only for `channel = telegram` (the web prompt stays byte-identical, prompt cache kept): «Ответ читают в Telegram на телефоне: короткие абзацы или список, без таблиц и заголовков, обычно ≤ 1 500 знаков. Найденные записи, статистику и источники приложение покажет само — не перечисляй их. Ссылок не пиши.» No page line (Telegram has no page); a reply to a push / an answer may give a context line (Q9).
- Eval: the chat eval gets `CHAT_EVAL_CHANNEL=telegram` (calls `runChatTurn` with the channel, then the renderer) on a subset (≈ 20 cases: questions, stats, files, voice, cards) + renderer checks: only allowed tags, every message ≤ 4,096, no ids / refs / tool names, buttons ≤ 64-byte ids. Gate = the web gate.

## 13. CRM side (web)

- **Org setting** `telegram.aiChat` (owner; default off) in the Telegram source settings: «ИИ-чат в Telegram» + the notice text (Q1).
- /account → «Telegram» (telegram/04): status of the binding, «Отвязать», a line «ИИ-чат: доступен / выключен в организации».
- **Deep link to a web chat thread**: `?chat=<threadId>` on any page opens the chat panel on that thread (own thread only; else the normal panel). Used by «Изменить в CRM» and «ещё N — открыть в CRM». Small change in `src/components/blocks/ai-chat.tsx`.
- Chat list: «Telegram» mark on Telegram threads.

## 14. Not in the first iteration

| Item | Why later |
|---|---|
| Charts as images (PNG) | Needs a server-side chart renderer (Q7) |
| Record detail inside Telegram (button per row), paging of long lists | TC answers + links first; measure what members open |
| Mini App (CRM views inside Telegram, Telegram sign-in) | Separate spec: auth bridge `initData` → session (Q10) |
| Editing card values in Telegram, cards with several choices | Dialog state in Telegram; «Изменить в CRM» covers it |
| Streaming the answer text itself (`sendMessageDraft` with text) | Partial markdown → HTML; status preview first (Q6) |
| Voice answers (text-to-speech) | New AI process + cost |
| Business chats (telegram/04 B), groups, inline mode | Other channels; groups are client-visible |
| Model choice, «Не передавать в источники» switch in Telegram | Web only |

## 15. Questions — decided 2026-11-17

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | May CRM data be shown in Telegram (cloud chat, not end-to-end encrypted, L13)? | (a) yes, all data the member sees in the CRM; org switch by the owner, default off, with a notice; (b) yes, but mask phones / e-mails / amounts; (c) no | **Decided** (as recommended, 2026-11-17): **(a)** — the member already sees this data in the CRM on the phone; masking would break the main questions («телефон Петрова?») |
| Q2 | Who may use it when the org switch is on | (a) every member with an active binding; (b) members chosen by the owner; (c) only owners / admins | **Decided** (as recommended, 2026-11-17): **(a)** — simple; the owner can unbind anyone |
| Q3 | A voice message without text | (a) the transcript is the member's message (a question or a note) + the bot shows the transcript; (b) an attachment, as in the web | **Decided** (as recommended, 2026-11-17): **(a)** — in Telegram voice is the main input; the transcript lets the member see a wrong recognition |
| Q4 | When does a new conversation (thread) start | (a) `/new` or 6 h without messages; (b) only `/new`; (c) one per day | **Decided** (as recommended, 2026-11-17): **(a)** — old context does not confuse new questions; `/new` for a fast switch |
| Q5 | Draft cards in Telegram | (a) «Создать» / «Отменить» for simple cards, else «Изменить в CRM» (§8); (b) always finish in the CRM; (c) full editing in Telegram | **Decided** (as recommended, 2026-11-17): **(a)** — most voice / business-card cards are simple |
| Q6 | What the member sees while waiting | (a) a draft preview with status lines, final answer at the end; (b) (a) + the answer text streams in the preview; (c) «печатает…» only | **Decided** (as recommended, 2026-11-17): **(a)** in TC; (b) after a live test |
| Q7 | Statistics | (a) short text table + «📎 CSV»; (b) (a) + a chart image | **Decided** (as recommended, 2026-11-17): **(a)** in TC; (b) later if members ask |
| Q8 | A forwarded client message in the private chat | (a) it is ALSO saved as the client's Telegram message (as today: source item with the original author → signals) and is context for a question that comes with it; (b) chat context only; (c) source item only, no answer | **Decided** (as recommended, 2026-11-17): **(a)** — keeps today's capture of client messages and lets the member ask «что ответить?» |
| Q9 | A reply to a bot message (a topic push, an earlier answer) | (a) the record of that message (topic, deal, …) becomes the context line, like the web «page» context; (b) only the quoted text | **Decided** (as recommended, 2026-11-17): **(a)** — «Что там по этой теме?» as a reply to a push works without names |
| Q10 | Mini App later (CRM screens inside Telegram, no separate sign-in) | (a) yes, a separate spec after TC; (b) no, links to the web are enough | **Decided** (as recommended, 2026-11-17): **(a)** — decide after TC usage |
| Q11 | Feedback 👍 / 👎 (reactions do not work, L12) | (a) two buttons under the LATEST answer only (removed when the next answer comes); (b) none | **Decided** (as recommended, 2026-11-17): **(a)** — the new channel needs quality data; the web feedback store is reused |
| Q12 | Turn limit per member | (a) ≤ 20 turns / 10 min + the monthly AI limit; (b) only the monthly limit | **Decided** (as recommended, 2026-11-17): **(a)** — protects against loops and a stolen account |
| Q13 | = telegram Q33: a member's own message — note or AI chat | (a) a mode per member; (b) everything goes to the AI chat; notes reach signals through the chat ingest (`ingestMode`, and in topics mode `on` only with «Чат в сигналах» `topics.chatSignals`); (c) a command per message | **Decided** (as recommended, 2026-11-17): **(b)** — one path; the chat answers and still saves the note. Check «Чат в сигналах» for orgs in mode `on` |
| Q14 | Re-confirm the Telegram binding periodically | (a) no — unbind on demand + on removal from the org; (b) every 90 days a new `/start` code from the CRM | **Decided** (as recommended, 2026-11-17): **(a)** now |

## 16. Plan (after the decisions)

Depends on telegram/04: **TI2** (binding + router) and **TI3** (one sender). Working days, one developer with AI assistance.

| Phase | Name | Days | Output |
|---|---|---|---|
| TC1 | Turn runner | 1.5 | `runChatTurn` in `src/server/chat/turn.ts`; web route = thin wrapper; channel in thread + prompt block; web eval 78 / 78 again |
| TC2 | Inbox + worker | 1.5 | `telegram_chat_inbox`, merge window, one turn per member, thread rule (Q4), commands `/new` `/help`, turn limit (Q12), org switch |
| TC3 | Inputs | 1.5 | Download → chat files on the server, voice as text (Q3), photos, documents, video, contact cards, forwards (Q8), replies (Q9), refusals |
| TC4 | Renderer | 2 | Pure `renderTelegramAnswer` (prose, records, stats + CSV button, sources, composed view, errors) + unit tests; status preview (Q6) |
| TC5 | Cards + questions + feedback | 2 | §8 buttons over `confirmChatAction` / `cancelChatAction`, card message edits, `askUser` buttons, 👍 / 👎 (Q11), «Повторить» |
| TC6 | Web side + eval | 1.5 | `?chat=` deep link, «Telegram» mark in the list, /account line, Telegram eval subset + renderer checks |
| TC7 | Docs + live check | 0.5 | `src/lib/AGENTS.md`, this folder, live check with a deployed bot (webhook needed) |

Total ≈ **10.5 days** after telegram/04 TI2 + TI3. Migrations: `ai_chat_thread.channel`, `telegram_chat_inbox`, `telegram_chat_message` (+ `telegram_binding.ai_chat_thread_id` from telegram/04).

## 17. Acceptance checks

1. A bound member asks «Что у нас с <компания>?» → one answer: summary + records list with working «открыть» links; no ids, no tool names.
2. «Выручка по месяцам за этот год» → text table ≤ 12 rows; «📎 CSV» sends a CSV file equal to the web CSV.
3. A text of 9,000 chars pasted (Telegram splits it in 3) → ONE turn, one answer.
4. An album of 3 photos with a caption → one turn with 3 files.
5. A voice question «сколько у нас открытых сделок?» → transcript shown, the number answered (Q3 = a).
6. A business card photo → card; «Создать» → company + contact created as the member; the card message shows «✅ Создано …»; a second press does nothing.
7. A card with an exact duplicate → three decision buttons; «Использовать существующий» → no new record.
8. A missing due date → «Не хватает: срок…»; the member answers «завтра» → a new card with the date.
9. A PDF of 25 MB → the 20 MB message, no turn error.
10. Two questions sent while a turn runs → answered as one next turn, in order.
11. Org switch off → the «выключен» message; a non-bound Telegram user → «Привяжите Telegram…»; nothing reaches the model.
12. In a group, «@bot сколько сделок?» → no answer, nothing logged as a chat turn.
13. Monthly limit at 100 % → the limit text, no model call.
14. The web chat list shows the Telegram thread with the mark; `?chat=<id>` opens it; another user's id opens the normal panel.
15. Web eval 78 / 78 after TC1; the Telegram eval subset passes the same gate.

## 18. Build notes (2026-11-17)

Built together with the parts of [telegram/04](../telegram/04-identity-and-chats.md) it needs: TI2 (staff binding + router) and the sender of TI3 (topic pushes and important notifications through it are still open). Migration `0044_telegram_bot_and_chat` (applied to the test DB). Code: `src/server/chat/turn.ts`, `src/server/telegram/` (router, bindings, sender, source, account, `chat/` inbox · worker · inputs · buttons · threads), `src/server/acting-member.ts`, `src/lib/telegram/` (inbox, html, render, voice, texts), APIs `api/account/telegram`, `api/sources/telegram/settings`. Details: `src/app/AGENTS.md` § "Telegram Bot (Sources)", `src/lib/AGENTS.md` § "AI Chat".

**Differences from the text above**

| Where | Spec | Built | Why |
|---|---|---|---|
| §13 org switch | `org_setting` `telegram.aiChat` | `provider_config.aiChatEnabled` of the Telegram source (server-managed key), switch in the source's «Настройки провайдера» | One bot per org; the setting belongs to the bot, next to its other server-managed keys |
| §13 / §4 binding UI | /account | **/profile → «Telegram»** | The binding is personal (like «Мои адреса для работы») |
| §4 QR code | link + QR | link + «Открыть Telegram» + copy | No QR library in the project; no new dependency |
| §5 storage | table `telegram_chat_message` | `telegram_out_message` = the log of EVERY bot message (kind, Telegram id, chat thread + answer ids, the record it is about) | One table serves the sender log, replies (Q9), card edits and feedback |
| §8 card confirm | «the same function as `POST /api/chat/actions`» | the same `confirmChatAction` / `cancelChatAction`, run inside `runAsMember` | The record functions read the browser session; `runAsMember` gives them a scoped session of the verified member (AsyncLocalStorage, read first by `getServerSession`) — no change to the record code |
| §12 eval | `CHAT_EVAL_CHANNEL=telegram` on ≈ 20 web cases | `src/server/chat/eval/telegram.eval.ts`, 8 cases `tg01`–`tg08` through the REAL router / worker / turn / model, only the Bot API mocked; part of `pnpm chat:eval` (`CHAT_EVAL_ONLY=tg`) | Tests the whole Telegram path (binding, merge, voice, buttons, group, `/stop`), not only the answer text |
| §10 waiting | status lines in the preview | as specified; Telegram's preview (`sendMessageDraft`) shows the status, «печатает…» when refused | — |

**Checks run**: unit tests (renderer, HTML, voice, inbox, prompt) — all pass; `telegram.eval.ts` 8 / 8 on the test DB with the real model; the full `pnpm chat:eval` after the turn refactor: web 78 / 78 (gate passed, 0 adversarial failures, 0 ungrounded values) + Telegram 8 / 8; the test DB was clean afterwards.

**Open (needs a deployed environment)**: the live check with a real Telegram account (§17 with a real bot: save the bot credentials again so the webhook gets `callback_query` / `edited_message` and the commands; `sendMessageDraft` and the HTML of real answers on a phone; the width of `<pre>` tables, `fitsPreTable` in `src/lib/telegram/html.ts`).

**Fixed 2026-11-17 (found in the build)**: the draft card sent a deal amount without its decimal point («1500000.50» → «150000050», `draft-card.tsx` `toValues` used `replace(/\D/g, "")`). Now ONE helper `normalizeDealValue` (`src/lib/chat/actions.ts`, unit-tested) is used by the web card and the Telegram card: spaces / «'» = digit groups, «,» or «.» + 3 digits = a digit group, + other digits = decimals (≤ 2, rounded); the amount field accepts «,» «.» and spaces.

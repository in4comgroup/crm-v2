# Telegram files — specification

Status: **built 2026-11-15** (Q1–Q15 decided; no migration; not deployed). §7 = what was built and the differences from the text above. Questions: [02-open-questions.md](02-open-questions.md). Plan: [03-development-plan.md](03-development-plan.md).

## 1. Goal (product owner, 2026-11-15)

Files that a user sends to the org's Telegram bot (PDF, office files, photos, video, audio) are parsed as **attachments**, with the SAME parsers, limits and document handling the other sources use (mail, Google Chat, drop-off). Nothing new is invented for the parsing itself; the work is to read the files Telegram delivers and hand them to the existing attachment path, inside the limits Telegram allows a bot.

This closes item I2 (files) of [topics/08-telegram-and-topics.md](../topics/08-telegram-and-topics.md) §3. Voice notes are already built (§2: the bot receives a dictated message as an OGG / Opus file and we transcribe it; Telegram gives bots no transcript). Files must feed the topics story (Q8, §4.6). Group chats (I1): §6, Q15.

## 2. What exists today (check of 2026-11-15)

| Area | Today | Code |
|---|---|---|
| Updates read | `allowed_updates = ["message"]`, private chats only (groups ignored), service messages and bot commands («/…») dropped | `src/lib/telegram.ts`, `src/server/ingest/telegram.ts` |
| Text message | → one `source_item` (`chat_message`, external id `<chat_id>:<message_id>`), body in `metadata_json.rawText` | `persistTelegramMessage` |
| Voice note (`message.voice`) and audio file (`message.audio`) | → one `source_item`; the Telegram `file_id` stored in `metadata_json.telegram.media`; at parse the bytes are downloaded (`getFile`) and transcribed by the audio parser; the transcript becomes the message text (caption first). The audio original is NOT stored | `extractTelegramAudio`, `parseTelegramVoiceItem` |
| Document, photo, video, video note, animation, sticker | **Ignored** — the message has no `text`, so it is dropped; its **caption is lost** too | `persistTelegramMessage` (`if (!text) return ignored`) |
| Parse after ingest | Webhook: `after()` runs parse + upload at once (`maxDuration = 60` s); the «Fetch» button (local dev, `getUpdates`) does the same (120 s) | `parseAndUploadTelegramItem` |
| Bot replies | English acks («✅ Received — added to your business OS sources…», «🎙️ Voice message received…») | `ackMessage` |
| Documents | A child `attachment` row of mail / Google Chat is parsed by `runAttachmentParser` (PDF, images, audio, video, docx / pptx) and its original is stored (`storeChildOriginal` → `org_<id>/files/<itemId>/<name>`, ≤ 50 MB); unsupported types and files over a parser cap are stored and marked `skipped` with the reason; auto links A1 (message participants by EMAIL), A2 (topics), A3 (content), A5; the file route re-fetches a missing original from nylas / gchat / gdrive / imap | `src/server/parse-source-item.ts`, `src/server/documents*.ts`, spec [attachments](../attachments/README.md) |
| Topics | Signal extraction reads only the ROOT item's own text (also for mail); children (attachments) are evidence for documents, not for signals | `src/server/topics/signals/` |

## 3. Limits

| Limit | Value | Effect |
|---|---|---|
| Telegram Bot API download (`getFile`) | **20 MB** per file (cloud Bot API; a self-hosted Bot API server would lift it — out of scope) | A file > 20 MB cannot be fetched at all. Telegram sends `file_size` in the update, so this is known at ingest |
| Our document store | 50 MB (`DOCUMENT_MAX_BYTES`) | Never the binding limit for Telegram |
| Parser caps (`src/lib/parser-config.ts`) | PDF 20 MB, docx / pptx 20 MB, video 50 MB, **image 5 MB**, **audio 10 MB** | PDF / office / video: Telegram's 20 MB is the binding limit. **Images 5–20 MB and audio 10–20 MB** reach us but are above the parser cap → stored and listed, marked «слишком большой», not parsed (same as for mail). See Q5 |
| Parser types | images: JPEG / PNG; audio: mp3 / m4a / aac / ogg; video: mp4; office: docx / pptx; PDF | Anything else (xlsx, zip, HEIC, webp, …) → stored, «формат не поддерживается» |

## 4. Model

### 4.1 Ingest (one message = one item, files = children)

The Telegram message stays ONE root `source_item` (`chat_message`, same external id, same thread window). New: `metadata_json.telegram.attachments: TelegramFileRef[]`, where

| Field | From |
|---|---|
| `kind` | `document` / `photo` / `video` / `video_note` / `audio` (Q1, Q3) |
| `fileId`, `fileUniqueId` | the Telegram object (`file_id` is valid for this bot and can be fetched again later) |
| `fileName` | `document.file_name` / `audio.file_name` / `video.file_name`; else built: `photo-<message_id>.jpg`, `video-<message_id>.mp4`, `video-note-<message_id>.mp4` |
| `mimeType` | the object's `mime_type`; photo = `image/jpeg`; video note = `video/mp4` |
| `fileSize` | `file_size` (may be absent — then checked after `getFile`) |
| `mediaGroupId` | `message.media_group_id` (albums, Q9) |

- **Photo**: Telegram sends several sizes; take the LARGEST that is ≤ 20 MB.
- **Caption** (`message.caption`) becomes the message text (`rawText` / `text`), exactly as `message.text` does for a text message. A file with no caption → empty text.
- **Voice note**: unchanged (§2). **Audio file** per Q3.
- Not ingested (no business content): sticker, animation (GIF), dice, poll, location, venue, contact card, game (Q1). A message that has ONLY those and no text stays ignored.
- Exclusions, forwards (`forwardOrigin`), private-chat-only and command rules apply as today.

### 4.2 Parse

`parseTelegramItem` (src/server/parse-source-item.ts):

1. **Children first** (so the hourly signal run never sees a complete root whose files are not parsed yet). For each `attachments[i]`: external id `tg-att:<chat_id>:<message_id>:<i>`, `externalType = "attachment"`.
   - `fileSize > 20 MB` → `insertSkippedChild` reason «больше 20 МБ — Telegram не отдаёт такие файлы боту», `file_status = too_large`, no download.
   - Otherwise `downloadTelegramFile(botToken, fileId)` → `detectAttachmentKind` → **`runAttachmentParser`** (the same function as mail / Google Chat): parsed child + stored original; an unsupported type or a file above a parser cap → stored + `skipped` with the reason; a download error → `insertFailedChild` (retried on re-parse).
2. Then the root: text (caption) → `parseTelegramMessage`; an empty text gives a short markdown («Файл: <name>»). `markParsed`; `ParseResult.childInserted / childSkipped / childFailed` as for mail.

Re-parse (`reparseSourceItem`) works unchanged (children deleted, `carryDocumentLinksForReparse` keeps a person's links); the bytes are fetched again by `file_id`.

### 4.3 Documents

- Telegram children are documents like any attachment: «Документы» tab, filters (source «Telegram» already has a label), open / download, «Привязать ещё», «Отвязать».
- **Lazy re-fetch**: the file route also re-fetches a Telegram original by `file_id` when it is not stored (add `telegram` to `providerRefetch` in `src/server/documents.ts` and to `fetchOriginal` in `documents-ingest.ts`).
- **Auto link A1 for Telegram** (Q11): the author = `telegram.from.username`; for a forwarded message the ORIGINAL author (`forwardOrigin` user) — the same author rule as signals. **Our member** (the «us» registry, kind `person`, channel telegram → attribution `own_org`) is never linked as a participant (as for mail). **A contact**: the contact's Telegram name (Q14 decided: «Адреса» → Telegram = `contact_address` kind telegram, plus the old alias «@username») → unique hit → link the contact and its company. The topics counterparty index (`contactsByHandle`) also reads the Telegram addresses. Today A1 reads e-mail addresses only, so Telegram files get no participant link.
- A2 (topic of the root), A3 (companies / people named in the file) and A5 work unchanged.

### 4.4 Bot replies

- Ack per message kind (Q7 — Russian): text «✅ Получено», voice «🎙️ Голосовое получено — расшифровываем», file «📎 Файл получен — разбираем» (N files for an album, Q9).
- File > 20 MB: «Файл больше 20 МБ — Telegram не передаёт боту такие файлы. Отправьте его другим способом.» (Q6). Unsupported type: no special reply (the file is stored and listed).

### 4.5 Timing

The post-ingest parse (`after()` in the webhook) gets the time a 20 MB PDF / video needs (Q10). A parse that does not finish is picked up by the hourly topics intake / the daily pipeline, as today.

### 4.6 Topics — files feed signal extraction (Q8 = yes; Q13 = EVERY source)

Today extraction reads only the root item's own text (`messageContent` of the root markdown), for every source. New, for every source with attachment children (mail via Nylas / IMAP, Google Chat, Telegram; drop-off files are roots and already analysed):

1. **Input.** `extractSignalsForItem` loads the root's parsed attachment children (`parse_status = complete`, not decorative images; a `derived_audio` row never on its own — a video's block = its transcript (the `derived_audio` row), else the video's visual text) and appends to the item text, after the message, one block per file:
   ```
   ### Вложение: <file name>
   <the child's `## Content`, trimmed>
   ```
   Caps: ≤ 6,000 characters per file, ≤ 15,000 for all files of one item (first files first), cut at a paragraph end with «[…сокращено]». An audio / video file = its transcript.
2. **Author.** The text of an attachment counts as the AUTHOR's own text (the sender sent the file): evidence quotes may come from it, and the evidence check (`evidence.ts`) searches the message + the attachment blocks. Quoted history of the message stays excluded as today.
3. **Empty text gate.** «no_text» only when the message text AND every attachment block are empty — a file-only message is analysed.
4. **Prompt.** One line in the extraction rules: «Блоки «Вложение» — файлы, которые прислал автор; сигналы из них считаются сигналами автора; ссылайся на текст файла в evidence». The system prompt stays per-org static (cache).
5. **Re-parse / timing.** Children are parsed before the root is complete (§4.2). A re-parse resets the item's signals as today (`reparseSourceItem`), so new attachment text is read again.
6. **Topics.** Nothing else changes: the topic resolver, references (a contract / invoice number in the file becomes a reference), deal rules and cards work from the instances as for any item. A file-only message can open a topic («<Компания> — <matter>» from the file).
7. **Golden set / eval.** Golden items of messages with attachments get the same input (`item-input.ts` is shared with the golden set). One extraction eval run before / after on items with attachments (mostly mail today) before the change goes on for all orgs.
8. **Cost.** Only items with parsed attachments get more input tokens (≤ 15,000 characters ≈ 4–5 k tokens).
9. **Unreadable text in images** (later, 2026-11-16, [ai-chat-tools](../ai-chat-tools/README.md) T1 / Q23): the image parser (`parsing.image`, every source — mail, chat, Telegram, drop-off, AI chat) writes «[неразборчиво]» for text it cannot read instead of guessing a name, phone, e-mail, website or amount. On a heavily blurred image it can still invent a value now and then (Q23 there: accepted). AI chat files: since 2026-11-16 the files a user attaches in the AI chat are children of the chat segment item too, so they join this input the same way.

## 5. Acceptance checks

1. A client sends a PDF (≤ 20 MB) with a caption → one root item (text = caption) + one parsed child; the original is stored; «Документы» of the client's contact (and company) lists it (A1 by «@username»).
2. A photo without caption → root «Файл: photo-….jpg» + parsed image child; the largest size ≤ 20 MB was taken.
3. A 30 MB video → child `skipped` «больше 20 МБ…», `file_status = too_large`, no download; the bot replies about the limit.
4. An xlsx file → child stored, «формат не поддерживается», downloadable.
5. An image of 8 MB → stored, «слишком большой» (parser cap 5 MB), downloadable.
6. An album of 3 photos → 3 root items (one per message) with one child each; one ack (Q9).
7. A voice note → unchanged (transcript = text). A sticker / GIF → ignored.
8. Re-parse of a Telegram item with a file → child re-created from `file_id`; a person's manual document links kept.
9. A message from an excluded chat → nothing stored, no download.
10. A forwarded file from a client → A1 links it to the ORIGINAL author's contact.
11. Locally testable with the «Fetch» button (`getUpdates`); the webhook path needs a deployed environment.
12. A client sends ONLY a PDF order list (no caption) → the item is analysed: an order signal with evidence from the file text, a topic «<Компания> — заказ…» (Q8).
13. A member's message (Telegram name in the «us» registry) with a file → attribution `own_org`, no participant link to a contact; a contact's file → linked to that contact (Q11).

## 6. Group chats (Q12 / Q15)

Parsing and attribution are the SAME as for a DM: each group message is one item (text / caption + files as children), the author of each message is matched exactly like a DM author (member by the «us» registry → ours; contact by Telegram name; forward → original author), the window rule (`tg:<chat_id>:<first message id>`, gap > 1 h or > 100 messages) makes the thread, exclusions by chat id apply. The topic resolver already handles several authors in one thread (mail threads have them).

What is different is only at ingest, and it is why the topics plan kept groups apart (not a parsing reason):

| # | Difference | What to do |
|---|---|---|
| G1 | **Bot privacy mode.** By default a bot in a group receives only commands, replies to the bot and @mentions — not the normal messages | The org admin turns privacy off in BotFather (`/setprivacy` → Disable) BEFORE adding the bot to the group (or makes the bot a group admin). Show this in the Telegram source settings («Как подключить группу») and check it: `getMe().can_read_all_group_messages` |
| G2 | **Code filter.** `persistTelegramMessage` drops every non-private chat | Accept `group` / `supergroup`; keep channels out |
| G3 | **No acks in groups.** A reply to each message would spam the client's group | Acks only in a private chat; in groups only the > 20 MB reply as a reply to that message (or none — decide in Q15 answer) |
| G4 | **Many authors, mixed sides.** Staff and client people write in one group | Per message: author → member (ours: outbound / internal) or contact; an unknown author with a Telegram name → discovery candidate (as an unknown mail sender) |
| G5 | **Group ↔ company.** A group is usually «<Client> + us» | Store `chat.title`; the counterparty of a staff message in the group = the company of the group's contacts (unique), so our replies get the client as counterparty (as the first recipient of an outbound mail does) |
| G6 | **Volume / cost.** Groups produce many more messages | Same gates as today (bounce / auto / empty), the org AI budget and exclusions (kind chat) apply; the immediate parse stays per message |
| G7 | **Bot added / removed, migrations** (`my_chat_member`, group → supergroup changes the chat id) | Add `my_chat_member` to `allowed_updates` to log join / leave; on `migrate_to_chat_id` keep one thread key per chat (store both ids) |

Estimate ≈ 1 day on top of the files work (TF5 in the plan).

## 7. Built (2026-11-15)

| Part | Where |
|---|---|
| Pure: file refs of a message, 20 MB limit, chat kinds, Russian replies, child external ids | `src/lib/telegram-files.ts` + `telegram-files.test.ts` |
| Ingest: private + group chats, files, voice unchanged, `my_chat_member`, chat id migration (exclusion copied), no replies in groups, one reply per album, the 20 MB notice | `src/server/ingest/telegram.ts`, `src/lib/telegram.ts` (`allowed_updates` + `getTelegramBotInfo`) |
| Parse: root → attribution primed → file children (`runAttachmentParser`) → root complete; `groupPeer` for our group messages | `src/server/parse-source-item.ts` (`parseTelegramItem`, `parseTelegramFile`, `stampTelegramGroupPeer`, `primeOrgAttribution`) |
| Same order for mail (Nylas, IMAP) and Google Chat: attachments before the root is complete | `src/server/parse-source-item.ts` |
| Documents: re-fetch by `file_id`; A1 by Telegram name | `src/server/documents-ingest.ts` (`fetchOriginal`), `src/server/documents.ts` (`contactByTelegramHandle`) |
| Topics: attachment blocks in extraction (every source); counterparty reads «Адреса» → Telegram; outbound group peer | `src/server/topics/signals/attachment-blocks.ts`, `item-input.ts`, `extract-item.ts`, `prompt/extraction.ts` (rule 11), golden set / evals; `topic-store.ts` |
| Source settings: «Группы» — privacy check result + the bot's groups (since telegram/04 TI4: the `telegram_chat` list with bindings); a settings save keeps the server-managed keys | `src/components/forms/form-source-provider-config.tsx`, `src/server/providers/handlers.ts` (`mergeServerManagedConfig`) |
| Time: webhook and «Fetch» routes `maxDuration` 300 s | `src/app/api/webhooks/telegram/[sourceId]/route.ts`, `src/app/api/sources/telegram/fetch/route.ts` |

Notes and differences:
- **Video text** (§4.6.1): a video child keeps only the visual description; the transcript is its `derived_audio` row — the block uses the transcript first.
- A file is left out of the extraction input when < 200 characters of the item budget remain (no cut-off fragments). The message part is cut at 24,000 characters; the prompt cap is 40,000 (message + blocks).
- **G3**: no reply at all in groups (not even the 20 MB notice); the file row «больше 20 МБ» shows in «Документы».
- **G4**: an unknown group author is NOT a discovery candidate — discovery reads e-mail participants only, for DMs too (unchanged). Follow-up if needed.
- **Deployed bots**: `allowed_updates` now includes `my_chat_member`; a running webhook gets it only after the credentials are saved again (re-registration).
- **Live check (test DB, 2026-11-15)** with the test bot source, Telegram download mocked: group membership stored; a group message with a PDF → parsed + stored child; a 30 MB video → `too_large` child, no download; sticker ignored; no reply in the group; a private-chat file → «📎 Файл получен — разбираем.»; the extraction input of the PDF message = caption + «### Вложение: spec.pdf» with the file text. All test rows removed. Not checked yet: a real file from a real chat (needs a person to send it), privacy mode in a real group, own users by the «us» registry (Q11) on live data.

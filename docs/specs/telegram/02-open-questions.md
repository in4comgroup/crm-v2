# Telegram files — open questions

Status: **decided 2026-11-15** (Q1–Q15).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Which Telegram message types are files for us | (a) `document` (any file), `photo`, `video`, `video_note` (round video), `audio`; NOT sticker, GIF (animation), poll, location, contact card, dice; (b) also GIFs / stickers | **(a)** — no business content in stickers / GIFs |
| Q2 | Item shape | (a) the message = root item (caption = text), each file = child `attachment` parsed by the existing `runAttachmentParser` (same as mail / Google Chat); (b) the file itself = the root item (like a drop-off upload) | **(a)** — reuses the attachment path, documents, re-parse, A1 / A2 links; the caption stays the message |
| Q3 | Audio FILE (`message.audio`: an mp3 / m4a sent as music / a recording), not a voice note | (a) a child document like any attachment (transcribed by the audio parser, original stored, in «Документы»); the message text = caption only; (b) keep today's behaviour (transcript = the message text, original not stored) | **(a)** — it is a file; voice notes keep (b) |
| Q4 | Voice notes (`message.voice`) | (a) unchanged: transcript = message text, original not stored; (b) also store the voice original as a document (playable / downloadable) | **(a)** |
| Q5 | Parser caps below Telegram's 20 MB | (a) keep them: images > 5 MB and audio > 10 MB are stored and listed but «слишком большой» (not parsed) — same as for mail; (b) raise the image and audio caps to 20 MB for every source (more AI cost per file) | **(a)** — phone photos sent as photos are compressed by Telegram (< 1 MB); raise later if real files hit the cap |
| Q6 | A file > 20 MB (Telegram does not let the bot fetch it) | (a) a child row «больше 20 МБ» (listed, not downloadable) + a bot reply about the limit; (b) the child row only, no reply | **(a)** |
| Q7 | Language of the bot replies | (a) Russian (product UI language): «✅ Получено», «🎙️ Голосовое получено — расшифровываем», «📎 Файл получен — разбираем»; (b) keep English | **(a)** |
| Q8 | Do files feed the topics engine (signals) | (a) as mail today: signals only from the message text (caption); the file is a document linked to the sender and the message's topic; a file-only message gives no topic; (b) put the parsed file text (≤ N characters, as a quoted block «Вложение: <name>») into the extraction input — for Telegram only, or for every source together | **(a)** now; (b) as a separate cross-source decision — mail attachments have the same gap, and an evidence quote must come from real text, not a parser summary |
| Q9 | Albums (several photos / files sent together, `media_group_id`) | (a) each message = its own root item with its file (Telegram sends them as separate messages; the caption is usually on the first); store `media_group_id`; one ack per album; (b) merge the album into one item (needs waiting for all parts) | **(a)** — the chat window already groups them for topics |
| Q10 | Time limit of the immediate parse | (a) raise the webhook route `maxDuration` 60 → 300 s (a 20 MB PDF / video needs more than 60 s); (b) leave 60 s — what does not finish is parsed by the hourly / daily run | **(a)** |
| Q11 | Auto link A1 for Telegram files | (a) author «@username» → contact alias / `contact_address` telegram; forwarded → the original author; (b) no participant link (only A2 / A3) | **(a)** — without it a Telegram file reaches the contact only through a topic |
| Q12 | Group chats | (a) out of scope — files from groups come with the group-chat task (topics/08 I1); (b) include now | **(a)** |

## Decisions

| # | Decision (2026-11-15, product owner) |
|---|---|
| Q1 | (a). Dictated audio messages: the Bot API delivers a voice message as `message.voice` = an OGG / Opus FILE (`file_id`); Telegram gives a bot NO transcript. We download and transcribe it ourselves — this is built (`parseTelegramVoiceItem`, audio parser accepts `audio/ogg`). The 10 MB audio cap ≈ 40–80 min of Telegram voice (Opus ≈ 16–32 kbit/s), so dictated notes always fit |
| Q2–Q7 | As recommended |
| Q8 | **(b) — files MUST feed the topics engine** («very important»): the parsed text of each attachment goes into the extraction input as a quoted block «Вложение: <name>»; a file-only message can start a topic. Scope (Telegram only or every source) = Q13 |
| Q9, Q10 | As recommended |
| Q11 | Own users: by the association member ↔ Telegram name (the «us» registry, kind `person`, channel telegram — built in identity I1, entered on /profile «Мои рабочие адреса»; attribution rule 1d `sender_staff_telegram`); to be checked live. Contacts: «by the contact's Telegram name kept on the contact» — WHERE it is kept = Q14 |
| Q12 | Product owner: parsing and attribution must be the same for DMs and groups. Explanation and the proposal = Q15 |
| Q13 | **(a) every source** (mail, IMAP, Google Chat, Telegram): attachment text goes into signal extraction through one rule (§4.6); eval run on the golden set before / after |
| Q15 | **(a) include group chats now** (spec §6) |
| Q14 | **(a)** the contact's «Адреса» → Telegram (`contact_address` kind telegram) + the old alias «@username» (still read); matching (topics counterparty, document A1, contact-link rules) reads both |

### Follow-up questions (2026-11-15)

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q13 | Attachment text in signal extraction — for which sources | (a) every source with attachments (mail, IMAP, Google Chat, Telegram) — one rule in the extraction input; (b) Telegram only | **(a)** — the same gap exists for mail (an order list or a contract in a PDF gives no signal today); one mechanism. Cost: more input tokens only for items with parsed attachments (capped, §4.6). Before switching on for all orgs: one eval run on the golden set |
| Q14 | Where the contact's Telegram name lives | (a) the contact's «Адреса» → kind Telegram (`contact_address`, built 2026-11-15 in the contact drawer «Адреса»; matching reads its emails today, Telegram entries to be added) + the old alias «@username» still read; (b) an org custom field marked as the Telegram field (`config.systemKey = "telegram"`, like «Тип клиента») | **(a)** — it is a system field every org needs, has history (active / old) and is shared by matching, documents and attribution; a custom field would be a third place (aliases, addresses, custom field) and each org would have to create it |
| Q15 | Group chats in this task | (a) include now (+≈ 1 day, §6); (b) separate task | **(a)** — see §6: parsing and attribution ARE the same; the work is at ingest (bot settings, no acks in groups, one item per message author) |

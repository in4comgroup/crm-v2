# Telegram

Specs for the Telegram bot source (inbound messages to the org's bot) and the identity of people and chats in Telegram. Delivery to staff by Telegram and group chats are described in [topics/08-telegram-and-topics.md](../topics/08-telegram-and-topics.md).

Status: files + groups **built 2026-11-15** (not deployed). Identity of people and chats + two-way bot (04): **spec 2026-11-17; TI2 + the sender of TI3 built 2026-11-17 (not deployed)**, decisions recorded (open: Q17 business, Q32 business, Q33 decided in ai-chat-telegram).

Files 01–03: files sent to the bot in private chats and groups, parsed as attachments; attachment text feeds signal extraction for every source; group chats read. Spec §7 = what was built.

| File | Content |
|---|---|
| [01-telegram-files.md](01-telegram-files.md) | Files sent to the bot (PDF, office, photos, video, audio) parsed as attachments with the existing parsers and document handling: what exists, limits (Telegram 20 MB vs our parser caps), ingest, parse, documents, bot replies, files in signal extraction (§4.6), group chats (§6), acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log; follow-ups Q13–Q15 |
| [03-development-plan.md](03-development-plan.md) | Phases TF1–TF5, ≈ 3 days (+ 1 day with groups) |
| [04-identity-and-chats.md](04-identity-and-chats.md) | Draft 2026-11-17: who wrote a Telegram message and which company it is about. Staff ↔ Telegram binding (verified, two-way: notifications out, notes in), contact identity by numeric id (not only «@name»), chat ↔ company binding, one resolution rule per message, one bot per org with an optional Telegram Business set-up, capacity for the AI chat over Telegram, questions Q16–Q33, plan TI1–TI8 |

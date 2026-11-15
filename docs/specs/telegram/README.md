# Telegram

Specs for the Telegram bot source (inbound messages to the org's bot). Delivery to staff by Telegram and group chats are described in [topics/08-telegram-and-topics.md](../topics/08-telegram-and-topics.md).

Status: **built 2026-11-15** (not deployed) — files sent to the bot in private chats and groups, parsed as attachments; attachment text feeds signal extraction for every source; group chats read. Spec §7 = what was built.

| File | Content |
|---|---|
| [01-telegram-files.md](01-telegram-files.md) | Files sent to the bot (PDF, office, photos, video, audio) parsed as attachments with the existing parsers and document handling: what exists, limits (Telegram 20 MB vs our parser caps), ingest, parse, documents, bot replies, files in signal extraction (§4.6), group chats (§6), acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log; follow-ups Q13–Q15 |
| [03-development-plan.md](03-development-plan.md) | Phases TF1–TF5, ≈ 3 days (+ 1 day with groups) |

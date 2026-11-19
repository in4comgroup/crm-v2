# Telegram

Specs for the Telegram bot source (inbound messages to the org's bot) and the identity of people and chats in Telegram. Delivery to staff by Telegram and group chats are described in [topics/08-telegram-and-topics.md](../topics/08-telegram-and-topics.md).

Status: **business answers received 2026-11-18 — no Telegram Business for now (Q17 = A only), no channels (Q32 = a); finalization: F1 channel guard + F2 guide for staff built 2026-11-18, next = the real-phone check ([05-finalization.md](05-finalization.md)).** Files + groups built 2026-11-15; identity of people and chats + two-way bot (04): TI1–TI6 built 2026-11-17 (TI4 for groups and company accounts), with the AI chat over Telegram ([ai-chat-telegram](../ai-chat-telegram/README.md)). TI7 (Business) and channels postponed (`docs/todo/README.md` TG7, TG8). Not tested with a real phone yet (05 F4). Completion status: 04 §13.

Files 01–03: files sent to the bot in private chats and groups, parsed as attachments; attachment text feeds signal extraction for every source; group chats read. Spec §7 = what was built.

| File | Content |
|---|---|
| [01-telegram-files.md](01-telegram-files.md) | Files sent to the bot (PDF, office, photos, video, audio) parsed as attachments with the existing parsers and document handling: what exists, limits (Telegram 20 MB vs our parser caps), ingest, parse, documents, bot replies, files in signal extraction (§4.6), group chats (§6), acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log; follow-ups Q13–Q15 |
| [03-development-plan.md](03-development-plan.md) | Phases TF1–TF5, ≈ 3 days (+ 1 day with groups) |
| [04-identity-and-chats.md](04-identity-and-chats.md) | Spec 2026-11-17 (TI1–TI6 built; no Business, no channels — 2026-11-18): who wrote a Telegram message and which company it is about. Staff ↔ Telegram binding (verified, two-way: notifications out, notes in), contact identity by numeric id (not only «@name»), chat ↔ company binding, one resolution rule per message, one bot per org (Telegram Business kept as a later option, §9.2–§9.4), what works without Business (§9.5), capacity for the AI chat over Telegram, questions Q16–Q33 (all decided), plan TI1–TI8 |
| [05-finalization.md](05-finalization.md) | Plan 2026-11-18 after the business answers, for 04 and [ai-chat-telegram](../ai-chat-telegram/README.md): F1 channel guard, F2 guide for staff, F3 test deployment set-up, F4 real-phone check (15 steps), F5 fixes + close-out |
| [06-test-guide.md](06-test-guide.md) | Guide for testers (2026-11-19): connect a Telegram account to a CRM user; main use cases of the bot and the AI chat in Telegram with 25 short tests; what is not in scope |

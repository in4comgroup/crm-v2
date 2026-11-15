# Telegram files — development plan

Status: **built 2026-11-15** (TF1–TF5; see spec §7; decisions in [02-open-questions.md](02-open-questions.md)). One developer with AI assistance, working days. No migration (the file columns of `source_item` and `document_link` exist since the documents work).

| Phase | Name | Days | Output |
|---|---|---|---|
| TF1 | Ingest | 0.5 | `persistTelegramMessage`: read `document` / `photo` (largest ≤ 20 MB) / `video` / `video_note` / `audio` (Q1, Q3); caption = text; `metadata_json.telegram.attachments[]` + `mediaGroupId`; acks in Russian (Q7), one per album (Q9), the > 20 MB reply (Q6); unit tests of the pure extraction of file refs |
| TF2 | Parse | 0.5 | `parseTelegramItem`: root text (or «Файл: <name>»), children via `downloadTelegramFile` → `runAttachmentParser`; > 20 MB → skipped child `too_large`; download error → failed child; webhook `maxDuration` 300 (Q10) |
| TF3 | Documents | 0.5 | Lazy re-fetch by `file_id` (`providerRefetch`, `fetchOriginal`); A1 by «@username» alias / `contact_address` telegram / forward origin (Q11, Q14); topics `contactsByHandle` also reads telegram addresses + tests of the planner input |
| TF3b | Files in signal extraction (Q8) | 1 | attachment blocks in the extraction input (`item-input.ts`, shared with the golden set), caps, evidence check over the blocks, the «no_text» gate, one prompt line; unit tests; eval run before / after — for EVERY source with attachments (Q13) |
| TF5 | Group chats (Q15, if yes) | 1 | §6 G1–G7: accept group / supergroup, privacy check + source hint, no acks in groups, per-author attribution, group title + counterparty of staff messages, `my_chat_member`, chat id migration |
| TF4 | Check + docs | 0.5 | Live check with the «Fetch» button on the test bot (acceptance 1–10); `src/app/AGENTS.md` § "Telegram Bot (Sources)", attachments spec, topics/08 I2 → built |

Total ≈ 3 days (+ 1 day with groups).

# Eval fixtures: business cards
Six synthetic business-card images in `cards/` for the AI chat eval (spec `docs/specs/ai-chat-tools/01-specification.md` §16, Q20).
All names, companies, phones, e-mails and domains are invented (`.example` / `-test.ru`, phones 000-xx-xx). No real person's data.
`cards.json` holds the exact strings printed on each card (the expected extraction result); `card-blurred.png` is unreadable on purpose.
Sources are the SVG files in `cards/`; the PNGs are rendered from them.
Regenerate (macOS only, uses `qlmanage`): `sh src/server/chat/eval/fixtures/make-cards.sh`.

# Eval fixtures: meeting notes
`notes/meeting-notes.txt` (source), `notes/meeting-notes.docx` and `notes/meeting-notes.pdf` — invented meeting notes with 4 action items for the task cases (`e02` DOCX, `n01` PDF).
Regenerate (macOS only, uses `textutil` + `cupsfilter`): `sh src/server/chat/eval/fixtures/notes/make-notes.sh`.

# Eval fixtures: voice message
`voice/*.txt` (sources) and `voice/*.wav` — synthetic Russian voice notes (TTS): `meeting-vector` (deal case `f01`), `reminder-vector` (`v01`), `new-contact` (`v02`).
Regenerate (macOS only, uses `say -v Milena`): `sh src/server/chat/eval/fixtures/voice/make-voice.sh`.

# Eval fixtures: mail with a prompt injection
`mail/mail-injection.txt` (source) and `mail/mail-injection.pdf` — an invented client mail that also tells the AI to create a deal on 10 mln and a task (cases `i01`, `i02`; spec acceptance 7).
Regenerate (macOS only, uses `cupsfilter`): `sh src/server/chat/eval/fixtures/mail/make-mail.sh`.

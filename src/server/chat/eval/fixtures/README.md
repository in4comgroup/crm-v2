# Eval fixtures: business cards
Six synthetic business-card images in `cards/` for the AI chat eval (spec `docs/specs/ai-chat-tools/01-specification.md` §16, Q20).
All names, companies, phones, e-mails and domains are invented (`.example` / `-test.ru`, phones 000-xx-xx). No real person's data.
`cards.json` holds the exact strings printed on each card (the expected extraction result); `card-blurred.png` is unreadable on purpose.
Sources are the SVG files in `cards/`; the PNGs are rendered from them.
Regenerate (macOS only, uses `qlmanage`): `sh src/server/chat/eval/fixtures/make-cards.sh`.

# Eval fixtures: meeting notes
`notes/meeting-notes.txt` (source) and `notes/meeting-notes.docx` — invented meeting notes with 4 action items for the task cases (`e02`, T2).
Regenerate the DOCX (macOS only, uses `textutil`): `sh src/server/chat/eval/fixtures/notes/make-notes.sh`.

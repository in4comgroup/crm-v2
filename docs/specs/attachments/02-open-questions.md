# Attachments — open questions

Status: **answered 2026-11-15** (product owner).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Store original files? | (a) store every document's bytes in storage when parsed / uploaded; (b) uploads only, source files fetched from the provider on each download; (c) (b) + store on the first download | **(a)** — preview / download work for every source (drop-off, WhatsApp, IMAP have no other copy), survive provider deletes, fast previews. Cost: storage of the files (the bucket today holds only markdown) |
| Q2 | What is a «document» | (a) files only: attachments, Drive files, drop-off files, uploads (+ the audio track under its video); not mail / chat bodies, not skipped decorative images; (b) every source item incl. messages | **(a)** — messages stay in «Материалы» / topics |
| Q3 | Automatic links | (a) written at once, badge «авто» + reason, a person can remove (removal is final for that link); (b) only suggestions a person confirms | **(a)** — rules A1 / A2 are exact; A3 / A5 marked «medium» |
| Q4 | Automatic deal link when the file has no topic | (a) only through topics (A2); (b) + the company's ONLY open deal (A5, as topics/10) | **(b)** — same rule the topics engine uses; several open deals → no automatic deal link |
| Q5 | Tasks and orders | (a) manual only (upload / «Привязать ещё»); (b) + a task / order created from a topic card inherits the topic's documents | **(a)** now, (b) later |
| Q6 | Where an upload lives | (a) the org's «Files Drop Off» source (`dropoff_file`, parsed, searchable, AI-readable) + the link; (b) a separate attachments table outside sources | **(a)** — one pipeline for every file |
| Q7 | Preview | (a) PDF + images inline, audio / video player, Office / other = parsed text + download; (b) + Office converted to PDF for a real preview | **(a)** now; (b) later (needs a converter service) |
| Q8 | Who may do what | (a) any member: upload, link, unlink; delete an uploaded file: its uploader or the org owner; source files cannot be deleted from the entity view; (b) only the responsible / owner | **(a)** |
| Q9 | Size limits | (a) store up to 100 MB per file, analyse within the parser caps; (b) other numbers | **(a)** |
| Q10 | «Материалы компании» (today's text-match list of all messages) | (a) keep it next to the new «Документы»; (b) replace it by «Документы»; (c) rebuild it later on topics links | **(a)** now — different purpose (messages); (c) later |
| Q11 | Company view: also show documents of its contacts and deals | (a) a switch «Включая контакты и сделки» (default on); (b) only direct company links | **(a)** |
| Q12 | Existing data | (a) one-time backfill: automatic links for existing documents + store their bytes where the provider still has them (mail / Drive / Chat); drop-off / WhatsApp originals are lost; (b) new files only | **(a)** |
| Q13 | Telegram / WhatsApp files | (a) WhatsApp: start storing the bytes (they are uploaded anyway); Telegram file ingestion stays in topics T2 (separate work); (b) both now | **(a)** |

## Decisions

| # | Decision (2026-11-15) |
|---|---|
| Q1 | (a) store every document's bytes when parsed / uploaded |
| Q2 | (a) files only |
| Q3 | (a) automatic links at once, badge «авто» + reason, removal final |
| Q4 | (b) + the company's only open deal |
| Q5 | (a) tasks / orders manual only |
| Q6 | (a) uploads go to the org's «Files Drop Off» source + a link |
| Q7 | **Changed: no preview code and no libraries.** «Открыть» opens the file in a new browser tab (`disposition=inline` — the browser / OS shows PDF, images, audio, video itself); everything else = «Скачать» |
| Q8 | (a) any member uploads / links / unlinks; uploader or owner deletes an uploaded file |
| Q9 | **Changed: 50 MB** max per stored / uploaded file; analysis within the parser caps |
| Q10 | (a) keep «Материалы компании» |
| Q11 | (a) switch «Включая контакты и сделки» (default on) |
| Q12 | (a) one-time backfill of links + bytes where the provider still has them |
| Q13 | **Changed:** WhatsApp unchanged (no bytes stored — its files are listed, download unavailable); Telegram files = the separate Telegram task later (built 2026-11-15: [telegram/](../telegram/README.md), originals stored, re-fetch by `file_id`) (Telegram is a future file source; the model already covers it) |

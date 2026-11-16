# AI chat actions

The «ИИ чат» panel gets actions: from what the user types, dictates, records or attaches (a business card photo, a voice message, meeting notes, a client's mail) it prepares new CRM records — companies, contacts, deals, tasks, later more — as editable **draft cards**, checks every value against the input and against existing records, asks when something important is missing, and creates the records after the user clicks «Создать». Attachments are detached from the chat and processed like mail attachments the moment they are sent (stored + parsed by the parser of their type); the chat model gets only the text — so the chat is a full source type; signals and the org's funnel rules can drive the proposed deal and tasks.

Status: **spec 2026-11-16, all questions decided** (Q1–Q22: as recommended, except Q10 «no undo for now» and Q15 «no new column — creator + action row + document link»; Q22 = attachments as text only) ([02-open-questions.md](02-open-questions.md)). **T0 (inputs) built 2026-11-16** — files, camera, voice recorder, text-only model input ([03-development-plan.md](03-development-plan.md) § «T0 result»); T1–T6 not started. Follows [ai-chat/](../ai-chat/README.md) (read-only chat v2, decision Q17 there: write actions = this separate spec).

| File | Content |
|---|---|
| [00-current-state.md](00-current-state.md) | What the chat, the create functions, the parsers, the duplicate checks and the signals do today; gaps against the request |
| [01-specification.md](01-specification.md) | Design: action catalog, inputs (direct upload, voice recorder, attachment = source item), turn pipeline, draft tools + draft card + confirm endpoint, checks (grounding, duplicates, «us», blocklist, defaults), deals, tasks, signals in the turn, clarification questions, data model, safety, evals, budgets |
| [02-open-questions.md](02-open-questions.md) | Questions and decisions Q1–Q22 |
| [03-development-plan.md](03-development-plan.md) | Phases T0–T6 (≈ 19.5 days), acceptance checks |

Related: [ai-chat/](../ai-chat/README.md) (chat v2, history, chat as a source, eval), [clients-contacts/](../clients-contacts/README.md), [attachments/](../attachments/README.md) (documents), [topics/](../topics/README.md) (signals, deal bridge), [funnel/](../funnel/README.md) (stages, types, rules).

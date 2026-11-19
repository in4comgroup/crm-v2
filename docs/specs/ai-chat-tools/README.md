# AI chat actions

The «ИИ чат» panel gets actions: from what the user types, dictates, records or attaches (a business card photo, a voice message, meeting notes, a client's mail) it prepares new CRM records — companies, contacts, deals, tasks, later more — as editable **draft cards**, checks every value against the input and against existing records, asks when something important is missing, and creates the records after the user clicks «Создать». Attachments are detached from the chat and processed like mail attachments the moment they are sent (stored + parsed by the parser of their type); the chat model gets only the text — so the chat is a full source type; signals and the org's funnel rules can drive the proposed deal and tasks.

Status: **built 2026-11-16 (T0–T6); T7 «company of a new contact» (Q25) built 2026-11-19** — T0 inputs, T1 company / contact cards, T2 task cards, T3 deal cards + signals in the turn, T4 questions, «Дополнить», links, logged meetings, T5 order request, deal move, task update, T6 eval + docs ([03-development-plan.md](03-development-plan.md) § «T0–T6 result», acceptance table). Final eval: 78 / 78 cases, 0 ungrounded contact values. All questions decided ([02-open-questions.md](02-open-questions.md)): Q1–Q22 as recommended, except Q10 «no undo for now» and Q15 «no new column — creator + action row + document link»; Q22 = attachments reach the model as text only; Q23 = A (blurred photos: accept, unclear values stay out); Q24 = the chat keeps Gemini 3.1 Flash Lite. Follows [ai-chat/](../ai-chat/README.md) (chat v2; decision Q17 there: write actions = this separate spec).

| File | Content |
|---|---|
| [00-current-state.md](00-current-state.md) | Before the build (2026-11-16): what the chat, the create functions, the parsers, the duplicate checks and the signals do today; gaps against the request |
| [01-specification.md](01-specification.md) | Design: action catalog, inputs (direct upload, voice recorder, attachment = source item), turn pipeline, draft tools + draft card + confirm endpoint, checks (grounding, duplicates, «us», blocklist, defaults), deals, tasks, signals in the turn, clarification questions, data model, safety, evals, budgets |
| [02-open-questions.md](02-open-questions.md) | Questions and decisions Q1–Q25 |
| [03-development-plan.md](03-development-plan.md) | Phases T0–T6 (≈ 19.5 days), acceptance checks |

Related: [ai-chat/](../ai-chat/README.md) (chat v2, history, chat as a source, eval), [clients-contacts/](../clients-contacts/README.md), [attachments/](../attachments/README.md) (documents), [topics/](../topics/README.md) (signals, deal bridge), [funnel/](../funnel/README.md) (stages, types, rules).

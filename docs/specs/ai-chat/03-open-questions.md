# 03 — Questions and decisions

All questions are decided. New questions found during the build are added here as Q25+.

## 1. Decisions (2026-11-16, product owner)

| # | Question | Decision | Where in the spec |
|---|---|---|---|
| Q1 | Model picker for users | Show only when the admin allowed > 1 model | 01 §4 |
| Q2 | Web-search back-end | **Keep Google grounding as today** (`chat.web_search` on a Google model); no gateway / OpenAI / Anthropic search now | 01 §5 |
| Q3 | Privacy of web queries | Only company / public-person / product / place names; code refuses queries with e-mails or phones | 01 §5 |
| Q4 | Export of stats tables | «Скачать CSV» per stats block (`;` separator) | 01 §8 |
| Q5 | Debug view for platform admins | Yes, platform admins only | 01 §9 |
| Q6 | Model-composed json-render | Small catalog for non-CRM content only (Markdown, KeyValue, DataTable, Grid / Stack, Badge); no charts | 01 §3, 02 §3 |
| Q7 | Data access | Same as the UI: what any org member sees | 01 §6.1 |
| Q8 | Product link target | `/products?q=<name>` | 01 §6.1 |
| Q9 | Full message-body search | Not now; the model reads bodies with `readSource`. Full-text column = next step if eval cases fail | 01 §6.2 |
| Q10 | «CRM · интернет · N с» line after an answer | Yes | 01 §9 |
| Q11 | Reasoning text | **Never to users. Platform admins: a collapsed block «Ход рассуждений» with the reasoning steps** (and tool steps, Q5) | 01 §9 |
| Q12 | Page context | Yes, the current page record, checked in the org | 01 §10 |
| Q13 | Eval set in the repo | Yes (test DB data) | 01 §12, §14 |
| Q14 | Thumbs up / down | Yes, stored on the message; down-voted turns feed the eval set | 01 §12, §16.1 |
| Q15 | Monthly AI limit | **B — the chat stops at 100 % with a message** | 01 §4 |
| Q16 | Chat history | **Yes. And the chat is one of the org's sources: chat sessions become source items for topics and deals** | 01 §16 |
| Q17 | Write actions | Separate spec / task (in `docs/todo/README.md`); the only automatic action is Q16 | 01 §2 |
| Q18 | TanStack Table 9 | **Yes, if safe for the code** — in the preparation phase with the other library updates | 02 §6, 04 CH0 |
| Q19 | Stats subjects in the first release | **All 7** | 01 §8 |
| Q20 | Rollout | **Replace v1 directly for every org**, no version switch | 01 §15 |
| Q21 | Chat content: private or business? | **Business data, not private — same as integrated e-mails.** Ingest by default; a per-chat switch «Не передавать в источники» for a conversation that is not business (e.g. a test); a one-line note in the empty chat «Беседы с ИИ попадают в источники организации» | 01 §16.1, §16.3 |
| Q22 | How topics read a user's statement about a counterparty | Like a relayed message: reuse the forward model of the extractor (`forwardedBy` = the user, original author = the counterparty), so inbound codes can fire; golden-set check before topics mode `on` uses it | 01 §16.3 |
| Q23 | A user deletes a chat | Source items already made from it stay (org data) | 01 §16.3 |
| Q24 | The «Сохранить чат» button | Replaced by a small menu item «Передать в источники сейчас» (ingest now, no dialog) | 01 §16.1 |

# AI chat over Telegram

The org's Telegram bot as a second interface to the AI chat: a member asks the same questions as in the web chat panel, sends files, photos and voice messages, and gets answers formatted for Telegram (mostly text). One engine (the web chat turn, tools, history, limits), two channels.

Status: **built 2026-11-17 (TC1–TC7), not deployed** — Q1–Q14 decided as recommended; full `pnpm chat:eval` after the turn refactor: web 78 / 78 + Telegram 8 / 8 on the test DB; live check with a real Telegram account open (needs the deployed webhook). Build notes and differences: §18 of the specification. Depends on [telegram/04-identity-and-chats.md](../telegram/04-identity-and-chats.md) (staff binding, router, one sender — draft).

| File | Content |
|---|---|
| [01-specification.md](01-specification.md) | Goal and first-iteration scope, Telegram limits, architecture (turn runner out of `/api/chat`, inbox + worker, renderer), inputs, answer rendering per data part, draft cards and questions, threads, errors, security, prompt, web side, questions Q1–Q14, plan TC1–TC7 (≈ 10.5 days), acceptance checks |

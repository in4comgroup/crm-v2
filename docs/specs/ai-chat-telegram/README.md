# AI chat over Telegram

The org's Telegram bot as a second interface to the AI chat: a member asks the same questions as in the web chat panel, sends files, photos and voice messages, and gets answers formatted for Telegram (mostly text). One engine (the web chat turn, tools, history, limits), two channels.

Status: **built 2026-11-17 (TC1–TC7); next = the finalization of [telegram/05](../telegram/05-finalization.md)** (F2 guide in `/help`, F3 set-up, F4 real-phone check steps 1–6, F5 fixes) — Q1–Q14 decided; full `pnpm chat:eval` after the turn refactor: web 78 / 78 + Telegram cases pass on the test DB. The business answers of 2026-11-18 (no Telegram Business, no channels) change nothing here: the AI chat runs only in a member's private chat with the org bot. Later items: §14 (todo A3). Build notes and differences: §18 of the specification.

| File | Content |
|---|---|
| [01-specification.md](01-specification.md) | Goal and first-iteration scope, Telegram limits, architecture (turn runner out of `/api/chat`, inbox + worker, renderer), inputs, answer rendering per data part, draft cards and questions, threads, errors, security, prompt, web side, questions Q1–Q14, plan TC1–TC7 (≈ 10.5 days), acceptance checks |

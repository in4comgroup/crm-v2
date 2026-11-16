# System documentation — salesdaily CRM

Last updated: 2026-11-16

## Purpose

salesdaily (UI name «SALES DAILY», package name `truffalo.ai`) is a multi-tenant,
AI-assisted sales CRM. It pulls a company's raw communication — email, chat,
Drive files, Telegram messages, uploaded files — into one store, turns each item
into structured Markdown with an LLM, and uses that material to find companies
and contacts, raise short action signals («карточки», cards), move deals through
a sales funnel, assemble orders from free-text client requests, and report on
sales. Every business record belongs to exactly one organization (tenant).

This folder is the general system documentation. It is written for an engineer
or product person who is new to the project and must understand the system
before the planned large refactor ("transformation") starts. It describes the
code as it is today, in the "design" branch of
`https://github.com/in4comgroup/crm-v2`.

## Documents

| File | What it covers |
| --- | --- |
| [overview.md](./overview.md) | What the product does, who uses it, the end-to-end business flow, list of modules, glossary with Russian UI names |
| [architecture.md](./architecture.md) | Tech stack, route groups, layering rule, multi-tenancy, auth summary, background pipeline, external services, component diagram |
| [data-model.md](./data-model.md) | Every database table grouped by domain, key relations, enums, data conventions |
| [modules.md](./modules.md) | One section per feature module: purpose, pages, API routes, server modules, key rules |
| [operations.md](./operations.md) | Local setup, commands, environment variables, database change procedure, deployment, R2, encryption key, known gaps |

Related material:

- Change specs, one folder per topic: [../specs/README.md](../specs/README.md)
  (auth, billing, db-migrations, …). This documentation only summarises them.
- Team-maintained engineering notes (more detail, sometimes older):
  `AGENTS.md` (root), `src/app/AGENTS.md`, `src/lib/AGENTS.md`
  (each `CLAUDE.md` only imports its `AGENTS.md`).

## How to read this set

1. Start with [overview.md](./overview.md) for the business picture and the vocabulary.
2. Read [architecture.md](./architecture.md) for how the parts fit together.
3. Use [data-model.md](./data-model.md) and [modules.md](./modules.md) as reference.
4. Use [operations.md](./operations.md) when you run, change or deploy the system.

## Source of truth

When this documentation and the code disagree, the code wins. The documents
were checked against `src/db/schema.ts`, `src/app/**`, `src/server/**`,
`src/lib/auth.ts`, `src/components/blocks/app-sidebar.tsx`, `package.json`,
`next.config.ts` and `vercel.ts` on the date above (2026-11-15 update: contact ↔ company links, Telegram files and groups, attachment text in signal extraction, notifications, «Проверка эталона» on `/account`, remembered sidebar / tabs; 2026-11-16 update: AI chat v2 with history and the chat as a source, chat files / voice and draft cards (`ai_chat_action`), AI SDK v7, Nylas-only email, `interactive` AI calls, layering rule now fully met, 93 tables, migrations up to `0043`). Items that could not be
checked are marked "to verify".

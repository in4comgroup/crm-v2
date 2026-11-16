# AI chat

The global AI chat panel «ИИ чат» (AI chat), opened from the header of every page: answers on the model the admin set for the process, web search for any model, one read-only search over all CRM records of the org (clients, contacts, deals, products, tasks, orders, source items, topics, cards), app-rendered lists, record details and statistics (chart + table), a status line instead of internal steps, chat history, the chat as a source of the org (user statements → topics and deals), and the library upgrade it needs (AI SDK 7, json-render 0.22, Streamdown 2.7, TanStack Table 9).

Status: **built 2026-11-16 — all phases CH0–CH8 done** (spec + decisions Q1–Q25; [04-development-plan.md](04-development-plan.md) § CH1–CH8 result, acceptance 1–11 met; open follow-ups in § CH8 result). [00-current-state.md](00-current-state.md) is the historical v1 state.

| File | Content |
|---|---|
| [00-current-state.md](00-current-state.md) | Historical: chat v1 before this spec; gap against requirements R1–R7 |
| [01-specification.md](01-specification.md) | Target design: output contract, model selection + monthly limit stop, web search, records engine + tools, list / detail views, statistics, status line, pipeline, guardrails, evals, budgets, data handling, rollout, chat history + chat as a source (§16) |
| [02-libraries.md](02-libraries.md) | Installed vs latest versions, breaking changes (AI SDK 6 → 7, json-render, Streamdown, ai-elements → shadcn, TanStack Table 9), upgrade order, CH0 result, §9 cleanup |
| [03-open-questions.md](03-open-questions.md) | Decisions Q1–Q24 + build decision Q25 |
| [04-development-plan.md](04-development-plan.md) | Phases CH0–CH8 (all built) with a result section per phase, acceptance checks |

Related: [models/](../models/README.md) (AI processes, model choice, usage, limits), [identity/](../identity/README.md) (org card in prompts), [topics/](../topics/README.md) (topics / cards visibility).

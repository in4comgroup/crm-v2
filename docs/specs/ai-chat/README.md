# AI chat

The global AI chat panel «ИИ чат» (AI chat), opened from the header of every page: answers on the model the admin set for the process, web search for any model, one read-only search over all CRM records of the org (clients, contacts, deals, products, tasks, orders, source items, topics, cards), app-rendered lists, record details and statistics (chart + table), a status line instead of internal steps, chat history, the chat as a source of the org (user statements → topics and deals), and the library upgrade it needs (AI SDK 7, json-render 0.23, Streamdown 2.7, TanStack Table 9).

Status: **spec 2026-11-16** — all questions Q1–Q24 decided. **CH0 (library upgrade), CH1 (records engine), CH2 (web-search privacy, monthly limit stop), CH3 (statistics, records + stats views) CH4 (chat v2 route + UI, replaces v1) CH5 (chat history: migration `0042`, chat list, thumbs) CH6 (the chat as a source of the org) and CH7 (eval `pnpm chat:eval`: 42 questions, gate passed 100 %) built 2026-11-16** ([02-libraries.md](02-libraries.md) §8, [04-development-plan.md](04-development-plan.md) § CH1–CH7 result; build decision Q25 in [03](03-open-questions.md) §2); CH8 (docs + v1 cleanup) open.

| File | Content |
|---|---|
| [00-current-state.md](00-current-state.md) | What exists today; gap against requirements R1–R7; other weak points |
| [01-specification.md](01-specification.md) | Target design: output contract, model selection + monthly limit stop, web search, records engine + tools, list / detail views, statistics, status line, pipeline, guardrails, evals, budgets, data handling, rollout, chat history + chat as a source (§16) |
| [02-libraries.md](02-libraries.md) | Installed vs latest versions, breaking changes (AI SDK 6 → 7, json-render, Streamdown, ai-elements → shadcn, TanStack Table 9), upgrade order |
| [03-open-questions.md](03-open-questions.md) | Decisions Q1–Q24 |
| [04-development-plan.md](04-development-plan.md) | Phases CH0–CH8 (≈ 24 days), acceptance checks |

Related: [models/](../models/README.md) (AI processes, model choice, usage, limits), [identity/](../identity/README.md) (org card in prompts), [topics/](../topics/README.md) (topics / cards visibility).

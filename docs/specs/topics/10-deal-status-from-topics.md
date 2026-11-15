# Deal status from topics

Status: **built 2026-11-15** (product owner: «connect the deal status to topics and deals, updated from recent source items»). Related: spec [01 §9.2–§9.3](01-specification.md) (deal bridge, deal state), plan phase 5 / 5a ([03](03-development-plan.md)).

## 1. Problem

The deal field «Текущее состояние» (`deal.state_text`, ≤ 3 sentences / 50 words) is written by phase 5a (`deals.state_summary`) **only from topics linked to the deal** (`topic.deal_id`). The text is updated when a new source item lands on a linked topic (R16 trigger → `deal.state_dirty_at` → hourly phase «dealState» after the debounce).

Check of the test DB (2026-11-15, IN4COM, mode `on`): 15 active deals, **1** linked to a topic. The other 14 showed the frozen `deal.reasoning` / `deal.changes` of the old deal discovery (removed in phase 12) as «Состояние сделки» — never updated.

Why: a topic got a deal only (a) when the agent created the deal, (b) when a person accepted a `deal_proposal`, (c) by the stage rules — the client's open deal of the same type, and only for codes with a `create_deal` rule — or (d) by hand in the topic drawer. A deal made by hand (or an old one) never received the client's new topics.

## 2. Decisions (A + B + C)

| # | Decision |
|---|---|
| A | **Auto-link** of business topics to the client's open deal in the hourly phase «deals»: exactly one open deal → link automatically; two or more → a card «К какой сделке относится тема?» (kind `deal_link`), a person picks one |
| B | The deal UI never shows the old discovery text as the status. A deal with no linked topic says «Нет связанных тем — состояние сделки не обновляется из источников» and offers «Связать тему» |
| C | One-time: active deals that already have linked topics are marked dirty so their text is computed (done on the test DB 2026-11-15) |

## 3. Auto-link rule (A)

Step after the stage rules in phase «deals» (`src/server/topics/deals/auto-link.ts`; PURE decision `decideDealLink` in `link-rules.ts`, unit-tested). It also runs for orgs without stage rules. Deterministic, no AI cost.

**Candidates** (≤ 100 per org per run, newest activity first): topics of the org with
- a client and **no deal**;
- family in `offer, order, invoice, contract, complaint, meeting, contact, pitch, delivery` (work with the client; `account`, `market`, `competitor`, `supplier`, `team`, `internal` are never linked);
- status `open`, `dormant` or `resolved`, activity in the last 30 days;
- ≥ 1 counted signal instance;
- no unlink of a deal by a person (`topic_event` `deal_unlinked`, actor `user`) — a person's unlink is final;
- no open `deal_proposal` card (the stage rules want a NEW deal — a person decides first).

**Targets**: the client's open deals (`active` / `paused`), never at the won / lost stage.

| Open deals | Mode `on` | Mode `shadow` |
|---|---|---|
| 0 | nothing (re-checked when a deal appears) | nothing |
| 1 | link as «Агент» (`linkTopicToDeal`: deal activity, deal state dirty) + journal `deal_linked` `{ auto: true, reason: "single_open_deal" }` + attention recompute | dry-run marker only |
| ≥ 2 | `deal_link` card (an older open one is `superseded`) | the same card, hidden like every deal card in `shadow` |

**Marker** (idempotency): one `topic_event` `deal_link_decision` `{ result: linked | card | dry_run, dealIds, dealId?, cardId?, dryRun }` per decision. A topic is decided again only when the SET of the client's open deals changes (a new deal, a closed one) or when the last marker was a dry run and the org is now `on`.

**Card `deal_link`** (`src/lib/topics/cards.ts`, action `link`, `proposal.dealOptions` = `{ id, name, stageLabelRu, status }[]`): «Связать» with the chosen deal → `PUT /api/cards { id, action: "deal_execute", dealId }` → `acceptDealLinkCard` (deal still open and of the topic's client, topic still without a deal) → `setTopicDeal` (journal `deal_linked`, deal dirty, attention) + card `accepted` + journal `deal_link_accepted`. «Ни к одной» = reject with reason (`no_matching_deal`, `wrong_counterparty`, `not_relevant`, `other`) → journal `deal_link_rejected`; the marker keeps the topic from a new card until the deal set changes. Open `deal_link` cards whose topic got a deal (any path) or stopped being live are `closed` at the start of the step. Visible only in mode `on` (`userCardFilter`), in the same places as the other deal cards.

## 4. Deal UI (B)

- `getDealState` (`GET /api/deals?stateFor=`) also returns `linkedTopics`, `topicsOn` (org mode `on`) and `linkableTopics` (live topics of the deal's client without a deal, ≤ 20).
- Drawer block «Текущее состояние»: linked topics → the state text, sources, history, «Обновить», and the line «Темы: …» (links to the topic drawer). No linked topic → «Нет связанных тем — состояние сделки не обновляется из источников» + «Связать тему» (select + button → `POST /api/topics { action: "link_deal" }`) in mode `on`; otherwise a short reason. `deal.reasoning` / `deal.changes` are no longer shown as the status (they stay in the DB as history).
- Kanban card: shows `deal.state_text` only (no fallback to the old text).

## 5. Not in scope

- Matching a topic to one of several deals by content (deal type, products) — a person picks for now; later the stage-rule deal types or the LLM matcher may pre-select.
- Topics without a client (contact only): never linked automatically.
- Deals in orgs with topics `off`: no state updates (unchanged).

## 6. Tests

- Unit: `link-rules.test.ts` (one deal → link, 2+ → card with sorted options, won / lost not a target, paused is a target, every skip reason, decided once per deal set, shadow marker re-decided in `on`).
- Live (test DB, 2026-11-15, IN4COM, mode `on`): 1 candidate («maslov.agency — правки к договору») → linked to the client's only open deal; marker + journal written; a second run = 0 candidates. Step C: the deal marked dirty.

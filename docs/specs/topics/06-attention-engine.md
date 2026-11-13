# Topics — attention engine (full specification)

Status: draft for review · 2026-11-11 · no code changes
Replaces the short rules in [01-specification.md](01-specification.md) §7.2 (topic score) and §8 (attention engine). Where this file and §7.2 / §8 differ, this file wins after review. Signal parameters: [05-signals-registry.md](05-signals-registry.md).

Items marked **[new]** are not in the decided spec. They have a recommended default and are listed in §15 for confirmation. Everything else restates decided rules (Q13, Q24, Maslov §5) with exact values.

---

## 1. Purpose

The attention engine answers three questions for every open topic, at any moment:

1. **How important is it?** → topic score, band, class, lead code.
2. **How urgent is it now?** → deadlines, waiting time, snooze, waiting on whom.
3. **Where and when does a person see it?** → list («Сейчас» / «Сводка» / «Неделя» / none), rank inside the list, reminder cycle, expiry.

The engine is **deterministic**. It uses no LLM. The same inputs and the same parameters always give the same result. Every result has a stored explanation (§11).

Importance and urgency are two separate axes:

- **Importance** comes only from signals (weights, attributes, boosts). It does not change with time, except when a signal stops being active.
- **Urgency** comes only from time (deadlines, waiting age, snooze, expiry). It never changes the score. It only moves the topic between lists.

---

## 2. Inputs

| Input | Source | Used for |
|---|---|---|
| Signal instances of the topic | `signal_instance` (+ `source_item_signal` facts) | score, class, lead code, deadlines |
| Code parameters | registry (`signal_category` + org override) | weight, class, kind, profile, effort, asks us, closes, relevance window |
| Item attributes | `source_item` attribute instances | ±2 modifier |
| Topic state | `topic` | status, sub-state, snooze, deal link, last activity |
| Items on the topic | `topic_item` + `source_item` (direction, date) | waiting on us / them, reminders |
| Deadlines | `facts.deadlines[]` of the topic's items (owner, date, precision), `proposedMeetingDate`, code date gates | escalation |
| Calendar | `work_calendar_day` (Russian production calendar), org time zone | working days, working hours |
| Parameters | settings ladder user → org → platform → built-in (§13) | all thresholds |
| Clock | server time | time rules |

---

## 3. Pipeline overview

```
 signal instances ─▶ A. instance score ─▶ B. instance activity ─▶ C. topic base score (MAX) + lead code
                                                                          │
                                                                          ▼
                    D. boosts (bounded, [new]) ─▶ E. caps (trend ceiling) ─▶ F. band + class
                                                                          │
                                                                          ▼
 topic state ──────▶ G. base profile ─▶ H. state adjustments (snooze, waiting on them, dampeners)
                                                                          │
 deadlines, clock ─▶ I. urgency escalation (up only) ─▶ J. list + timing ─▶ K. rank ─▶ L. cycle, reminders, expiry
                                                                          │
                                                                          ▼
                                                     topic.attention (stored result + explanation)
```

Steps A–F give the **importance**. Steps G–L give the **placement**. Each step is a pure function. The full algorithm is in §12.

---

## 4. Importance

### 4.1 Step A — instance score

For each signal instance `i` of code `c` on item `m`:

```
weight(c)      = org override weight ?? pack weight                         (0…9)
attrAdj(m)     = clamp( Σ weights of message attributes of m , −2, +2 )     (one attribute per group)
instanceScore  = 0                                  if c is state (score rule = state)
               = 0                                  if confidence = low
               = 0                                  if outranked on the same item (relation outranks)
               = max(0, weight(c) + attrAdj(m))     if i is the dominant instance of item m
               = weight(c)                          otherwise
```

- **Dominant instance** of an item = its strongest counted instance (highest weight; tie: risk > chance > fyi, then dictionary order). The attribute modifier applies **only to the dominant instance** of the item **[new: clarifies Truffalo "modifier on the dominant category"]**. Reason: one email can carry an angry invoice dispute and a calm price question; the anger belongs to one matter.
- Confidence `medium` counts in full. Confidence `low` is stored and shown in the drawer, but scores 0.
- `inherited` codes (`MAILERDEMON_RECEIVED`): instance score = the current score of the topic it attaches to; fallback weight 5 when it has no topic (Maslov §5.1).
- A stored instance score is never re-computed when weights change. Only an explicit re-run of extraction does that (spec §5.4 rule 7).

### 4.2 Step B — instance activity

An instance is **active** when all of these are true:

| # | Condition | Inactive reason |
|---|---|---|
| B1 | Instance score > 0 | `not_counted` |
| B2 | No later `state` / S1 instance on the **same topic** lists its code in `closes_codes` | `closed` (+ closing instance id) |
| B3 | Age ≤ relevance window of the code, **or** the instance has an open deadline in the future | `stale` |
| B4 | Not marked by a user «Не относится» (unlink / dismiss of this signal) | `dismissed_by_user` |
| B5 | For `watchdog` / `trend` codes: the trigger condition is still true at the last check | `condition_cleared` |

**Relevance window [new values]** — field `relevance_days` on the code; default by kind and effort:

| Kind / effort | Default relevance window |
|---|---|
| event, effort quick | 14 calendar days |
| event, effort medium or none | 30 calendar days |
| event, effort complex | 45 calendar days |
| watchdog, derived | while the condition is true (B5) |
| trend | 90 calendar days (= trend cooldown) |
| state | not applicable (never scores) |

A closed or stale instance stays in history and in the drawer. It never scores again. A **new** instance of the same code (a new item) starts its own window.

### 4.3 Step C — topic base score and lead code

```
baseScore = max( instanceScore of active instances )      — 0 when no active instance
lead      = the active instance with baseScore
```

Tie-break for the lead (in this order):

1. class: risk > chance > fyi;
2. the newer instance (later item date);
3. dictionary order of the code.

**Signals do not add up** (Maslov §5.1, spec §5.4). A topic with codes 7 + 6 + 5 has base score 7. The weaker codes stay as context on the card («Ещё» list, §9.1 order). Only the bounded boosts in §4.4 can add points.

The card writer may choose another detected code as the wording lead. That choice never changes the score, the class or the list.

### 4.4 Step D — topic boosts [new]

Boosts make a topic climb when the **situation** gets worse, not when one more code is found. Each boost is a separate rule with its own switch (setting `attention.boost.<name>.enabled`). The total of all boosts is capped at `attention.boostMax` = **+2**.

| Boost | Rule | Points |
|---|---|---|
| **R — client chases (reminder)** | The topic is `waiting_on_us`, and after the first `asks_us` instance a **later inbound item** on the same topic repeats the request (the same `asks_us` code again, or any counted code of the same family), with **no outbound item between them**. Example: «Ну что, когда будет КП?» | +1 per reminder, max +2 |
| **O — overdue reaction** | The topic is `waiting_on_us` longer than the reaction time of the lead code's effort: quick 1, medium 2, complex 3 working days (no effort → 2). Time counts in working hours of the org. | +1 |
| **C — corroboration** | ≥ 2 **distinct** active codes of class `risk`, each with instance score ≥ 6, from ≥ 2 **different items** on the topic. Codes merged by a `merges_into` relation count as one. | +1 |

Rules:

- `topicScore = baseScore + min(boostMax, R + O + C)`.
- Boosts never change the class or the lead code.
- Boosts do not apply when the lead is a `trend` code (the ceiling in §4.5 would remove them anyway).
- Boosts are re-evaluated on every recompute. Boost R ends when we reply (an outbound item), boost O ends when the sub-state is no longer `waiting_on_us`.
- With all boosts off, the engine is the pure MAX model of Truffalo / Maslov.

### 4.5 Step E — caps

- **Trend ceiling** (Q24-6): when the lead code is `kind = trend`, `topicScore = min(topicScore, 5)` (band `normal`, list «Сводка»). The ceiling also applies after escalation (§6): a trend topic never enters «Сейчас».
- **Floor**: `topicScore ≥ 0`.
- No upper cap: scores ≥ 10 are band `critical`.

### 4.6 Step F — band and class

| Band | Topic score | Default profile | Default list |
|---|---|---|---|
| none | 0 | — | none (topic stays, no list) |
| low | 1–3 | W1 | «Неделя» |
| normal | 4–5 | D4 | «Сводка» |
| high | 6–7 | P6 | «Сейчас» (daily limit; off in MVP) |
| very_high | 8–9 | P8 | «Сейчас» |
| critical | ≥ 10 | P8 | «Сейчас» |

- `class` = class of the lead code.
- For `class_by_relation` codes: class by the client relation — active client → `risk`; prospect or dormant client → `chance`. Relation source: `client` status + order history (IN4COM) or the deal link.

---

## 5. Placement: base profile and state adjustments

### 5.1 Step G — base profile

Profiles are ordered: `W1 < D4 < P6 < P8`. One **level** = one step on this scale.

```
bandProfile(score) = profile of the band of score (table §4.6)
if lead code has an explicit display_profile (e.g. D4 for a weight-7 code):
    shift       = bandIndex(topicScore) − bandIndex(weight(lead))      — attributes and boosts move it
    baseProfile = clampLevel( explicitProfile + shift , W1 … P8 )
else:
    baseProfile = bandProfile(topicScore)
```

Example: `PITCH_DECISION_DELAYED_BY_CLIENT` has weight 7 but an explicit profile D4. With an angry attribute (+2 → 9, band very_high, one band above high) its base profile becomes P6.

`S0` / `S1` profiles belong to state codes. State codes never score, so they are never the lead. Their effect is in §8.

### 5.2 Step H — state adjustments

Applied in this order. Each adjustment is recorded in the explanation.

| # | State | Effect |
|---|---|---|
| H1 | Topic status ≠ `open` (resolved, done, dismissed, merged, expired, archived) | List = none. Stop. |
| H2 | `snoozed_until` > now (user «Отложить до…», `PITCH_PAUSED_BY_CLIENT`, deal status `paused`) | List = none; shown only in «Все темы» with «Отложено до …». Stop. At `snoozed_until` the topic returns and a new cycle starts (§7.1). A **new material fact** (§7.1) ends the snooze early. |
| H3 | Sub-state `waiting_on_them` (our item is the last one and no `asks_us` instance is open) **[new]** | Profile −1 level (P8 → P6 → D4 → W1), never below W1. No evening reminders while waiting. Reason: the ball is with the client; the topic must leave «Сейчас» but stay visible. |
| H4 | **Dampener** active **[new]**: a later instance of a code with relation `dampens` on the lead code, with a date fact in the future. Seed: `PAYMENT_PROMISE` dampens `INVOICE_OVERDUE` until the promised date + 1 working day. | Profile −1 level until that date. After the date, if the lead is still active: the dampener ends and a new cycle starts. |
| H5 | Topic status `dormant` (no activity `topicDormantDays` = 21) | Shown once in the next «Неделя» snapshot as «Тема затихла», then list = none until new activity. Deadline rules (§6) still apply. |

H3 and H4 do not stack: the maximum total lowering from H3 + H4 is one level.

---

## 6. Step I — urgency escalation (up only)

Escalation uses the **next open deadline** of the topic:

```
nextDeadline = earliest date in facts.deadlines[] of the topic's active instances
               with owner ∈ { us, unknown } and date ≥ today,
               plus a meeting date (proposedMeetingDate / calendar) when the lead family is meeting
```

A deadline with a date only (no time) means the end of working hours on that day (18:00 org time).

Deadlines with owner `them` (the client promised something) are **not** used for escalation. They are kept for the follow-up watchdogs of phase 8.

| Rule | Condition | Effect |
|---|---|---|
| **I1 Immediate** | `nextDeadline − now ≤ deadlineImmediateHours` (24 h) | List «Сейчас», behaves like P8 (no daily limit). Ends the H2 snooze only when the deadline was added after the snooze. Overrides H3 / H4. |
| **I2 Before the next list point** | the deadline is earlier than the next display point of the current list + `digestActionBufferHours` (3 h) | Up one level: W1 → D4, D4 → P6, P6 → P8 (Maslov §5.2: score 1–3 → «Сводка», 4–5 → «Сейчас», 6–7 → «Сейчас» without the limit). |
| **I3 Lead days** | `nextDeadline` is ≤ `deadlineLeadDays[effort of lead]` working days away (complex 5, medium 3, quick 2) | At least D4 («Сводка»); starts a new cycle once (the topic «returns before the deadline»). |
| **I4 Overdue** | an owner-`us` deadline has passed and the lead is still active | Badge «Просрочено»; at least D4 until expiry (§7.3). |

- Escalation **never lowers** a profile.
- The **trend ceiling** (§4.5) still applies after escalation.
- Escalation does not change the score or the band. The explanation records it as `escalation`.
- Working hours: «Сейчас» for a new cycle is shown at once in working hours; outside working hours it is marked new at the start of the next working window (matters for delivery in phase 7; in-app lists show the topic at once).

---

## 7. Step J–L — lists, cycles, reminders, expiry

### 7.1 Display cycle

A **cycle** is one period in which the topic asks for a person's attention. It drives the «Новое» / «Обновлено» marker, the evening reminders, expiry and (phase 7) delivery.

A new cycle starts on:

- the first placement in a list (topic creation);
- a **material change**:
  - a new counted instance that is the new lead, or raises the topic band;
  - a new or changed deadline (owner us / unknown);
  - a reminder from the client (boost R increments);
  - a reopen (resolved / done / dormant → open);
  - the end of a snooze or a dampener;
  - a new active deal risk on the topic's deal;
  - escalation I3 (once per deadline).

**Not** material: `NOOP` items («Спасибо, получили»), `context` items, a repeat of the same code with no new fact, a background recompute, an engine restart.

Fields on the topic: `cycle_started_at`, `cycle_reminders` (count), `cycle_reason`.

### 7.2 Lists

| List | Members (open topics, after steps G–I) | Snapshot | Visible items |
|---|---|---|---|
| **«Сейчас»** | profile P8 or P6 (P6 daily limit off in MVP, Q13); I1 escalations | continuous | all |
| **«Сводка»** | profile D4; P6 overflow when the daily limit is on | morning snapshot at `morningDigestTime` 07:30 (org time) + «Новое с утра» section for later D4 topics | `digestVisibleItems` = 5, rest under «Ещё» |
| **«Неделя»** | profile W1; dormant topics (once); expired cards of the week (7-day grace, §7.3) | snapshot `weeklyReview` Friday 12:00 | all |
| **«Все темы»** | every topic incl. snoozed, waiting, resolved (filters) | continuous | all |

The lists are the same for every org member in the MVP (Q13). The filter «Мои» keeps topics whose `owner_user_id` is the current user (= the client's «Ответственный»).

**P6 daily limit** (when routing switches on): ≤ `dailyPushLimit` (3) distinct P6 topics per recipient per local day enter «Сейчас»; the others go to «Сводка». The limit applies to distinct topics, never to the reminder of an already shown topic; I1 overrides it.

### 7.3 Reminders and expiry

**Evening reminders (P6 / P8):** at `eveningDigestTime` 17:00 (org time), a topic with an open action (`waiting_on_us`, lead active) gets a reminder entry («Не закрыто сегодня»). Maximum `p6RepeatMax` = **3 evenings per cycle** (Q24-5). The same cap applies to P8. After the last reminder the cycle stops reminding; the topic stays in its list. End of reminders ≠ issue resolved.

**D4 / W1:** no evening reminders. An info fact is not repeated without a material change.

**Expiry** (attention ends, the topic stays open):

| Band at cycle start | Expiry after | Counted from |
|---|---|---|
| very_high / critical (P8) | 10 working days | the deadline if any, else the cycle start |
| high (P6) | 7 working days | same |
| normal (D4) | 5 working days | same |
| low (W1) | 10 working days, not before the first weekly display (Q24-4) | same |

After expiry: the card status is `expired`; the topic is in the «Неделя» section «Истекло» for `weeklyGraceDays` (7) more calendar days, then only in «Все темы». Expiry never resolves the business question, never clears a deal risk and never closes a signal (spec §2.1 rule 8). A new material change starts a new cycle and brings the topic back.

### 7.4 Rank inside a list

Sort keys, in order:

| List | Keys |
|---|---|
| «Сейчас» | 1) I1 / overdue first; 2) `topicScore` desc; 3) class risk > chance > fyi; 4) waiting-on-us age desc; 5) `last_activity_at` desc |
| «Сводка» | 1) `nextDeadline` asc (topics with a deadline inside the lead days first); 2) `topicScore` desc; 3) class; 4) new in this cycle first; 5) `last_activity_at` desc |
| «Неделя» | 1) `topicScore` desc; 2) class; 3) `last_activity_at` desc; «Истекло» and «Тема затихла» as separate sections at the end |

The rank key is stored (`attention.rankKey`) so a list is one indexed query.

---

## 8. How signal types act on attention

| Signal type | Effect |
|---|---|
| `event` (counted) | Scores while active (§4.2); may become the lead. |
| `state` (S0) | Closes the instances in its `closes_codes` on the **same topic**. If no active instance remains → topic `resolved`, list none. Never creates a topic or a card (spec §6.2 rule 6). |
| S1 (closing fact with history) | Same as S0, plus a history line and a card UPDATE «Вопрос закрыт: …». With no linked topic → a W1 info entry. |
| `watchdog` / `derived` (phase 8) | Scores while its condition is true (B5). Emitted by a process. |
| `trend` (phase 8) | Scores with the D4 ceiling. 90-day cooldown per client + code. |
| Outcome codes (`PITCH_EXCLUDED`, `PITCH_CANCELLED_BY_CLIENT`, `CONTRACT_TERMINATED` …) | The outcome is shown **once** (one cycle, no evening reminders), then the topic is `resolved` with `closed_reason` = outcome. Earlier reminders of the topic stop. |
| `PITCH_PAUSED_BY_CLIENT` | H2 snooze until the return date / condition. |
| Dampener (`dampens` relation) | H4. |
| Praise on a complaint topic | Scores on its own (e.g. 3) but never closes the complaint (spec §2.1 rule 7). The topic score stays at the complaint level. |
| Low confidence | Stored, shown, scores 0. |
| `asks_us` | Drives the sub-state `waiting_on_us`, boosts R and O, evening reminders. |

**Partial closing:** a topic may hold several active codes. A state code closes only the codes in its list. Example: `INVOICE_DISPUTE_RESOLVED` closes `INVOICE_DISPUTE_RAISED` but not `INVOICE_OVERDUE`; the topic stays open with base score 7 from the overdue invoice.

**Sub-state rules** (spec §7.1, exact):

- `waiting_on_us`: the newest active `asks_us` instance is later than the newest outbound item on the topic.
- `waiting_on_them`: the newest item on the topic is outbound (ours), and no `asks_us` instance is newer than it.
- `none`: otherwise.
- A holding reply from us («Принято, вернёмся завтра») is outbound: the sub-state becomes `waiting_on_them`, but the `asks_us` instance stays active (it is not closed). The I-rules still apply to our own deadline («завтра» = owner us).

---

## 9. Deals and risks

- A **deal risk** does not change the topic score. The trigger code already scores on its topic (spec §9.4). A new active risk starts a new cycle on that topic (§7.1).
- Deal-level display (badge «Есть риски», tooltip) is separate: risk order = `severity × trigger instance score`, then the newest (spec §9.4).
- Deal stage, deal amount and the owner's win estimate never change attention.
- A topic linked to a deal inherits nothing from other topics of the deal. Each topic has its own score.

---

## 10. When the engine runs

| Trigger | What runs |
|---|---|
| Item attached to a topic (any role) | full recompute of that topic |
| State code closes instances | full recompute |
| User action: Готово, Не относится, Отложить, Объединить, Отвязать сообщение, signal dismissed | full recompute |
| Deal change: outcome, status `paused`, new / cleared risk | recompute of the deal's topics |
| Timer tick, every 15 min (`attention.tickMinutes`) | topics with `next_attention_check_at ≤ now` only |
| List snapshots: 07:30 (morning), 17:00 (evening reminders), Friday 12:00 (weekly) — org time | snapshot + cycle counters |
| Parameter change (org / platform) | recompute of all open topics of the org, in batches |
| Taxonomy weight change | **no** re-score of stored instance scores (spec §5.4); boosts, profiles and lists recompute |

`next_attention_check_at` = the earliest of: next I1 / I2 / I3 threshold, overdue moment, boost O threshold, snooze end, dampener end, relevance-window end of the lead, dormant moment (`last_activity_at` + 21 d), expiry moment, next snapshot.

Every run is idempotent. A run writes `topic.attention` and, when the list changes, one `topic_event` of type `attention_changed` (old list → new list, reason).

---

## 11. Explanation («Почему в этом списке»)

`topic.attention` (jsonb) stores the full result:

```jsonc
{
  "computedAt": "2026-11-11T09:15:00Z",
  "paramsVersion": 3,                 // settings snapshot id
  "taxonomyVersion": 1,
  "lead": { "instanceId": "…", "code": "SALES_OFFER_REQUESTED", "weight": 7, "attrAdj": 0 },
  "baseScore": 7,
  "boosts": [ { "rule": "R", "points": 1, "itemId": "…" } ],
  "caps": [],
  "topicScore": 8, "band": "very_high", "class": "chance",
  "baseProfile": "P8",
  "adjustments": [],                  // H-rules: { rule, levels, until }
  "escalations": [],                  // I-rules: { rule, deadline }
  "profile": "P8", "list": "now",
  "rankKey": "…",
  "cycle": { "startedAt": "…", "reason": "reminder", "reminders": 0, "expiresAt": "…" },
  "nextCheckAt": "…",
  "inactive": [ { "instanceId": "…", "reason": "closed", "by": "…" } ]
}
```

The topic drawer shows it in Russian, for example:

> **Почему «Сейчас»:** запрошено коммерческое предложение (вес 7); клиент напомнил в Telegram (+1); ждёт нашего ответа 1 рабочий день.

This text is built by code from the fields (no LLM). The evaluation harness (spec §12) compares the stored explanation with the expected one for each golden-set case.

---

## 12. Algorithm (pseudocode)

```ts
function computeAttention(topic, now, p /* params */): Attention {
  // H1
  if (topic.status !== "open") return none("status");

  // A + B
  const inst = topic.instances.map(i => ({ ...i, score: instanceScore(i, p) }))
  const active = inst.filter(i => isActive(i, topic, now, p))          // B1–B5

  // C
  if (active.length === 0) return none("no_active_signal")             // band none
  const lead = maxBy(active, [i => i.score, classRank, i => i.itemDate, dictOrder])
  const base = lead.score

  // D
  let boost = 0
  if (p.boost.R && topic.subState === "waiting_on_us") boost += Math.min(2, countReminders(topic))
  if (p.boost.O && topic.subState === "waiting_on_us" &&
      workingHoursSince(topic.waitingSince, p.cal) > reactionHours(lead.effort, p)) boost += 1
  if (p.boost.C && corroborated(active)) boost += 1
  let score = base + (lead.kind === "trend" ? 0 : Math.min(p.boostMax, boost))

  // E
  if (lead.kind === "trend") score = Math.min(score, 5)
  score = Math.max(0, score)

  // F
  const band = bandOf(score)
  const cls = lead.classByRelation ? classByRelation(topic.client) : lead.class

  // G
  let profile = lead.displayProfile
    ? shiftLevel(lead.displayProfile, bandIndex(score) - bandIndex(lead.weight))
    : bandProfile(band)

  // H2
  if (topic.snoozedUntil && topic.snoozedUntil > now && !materialSince(topic.snoozedAt)) return hidden("snoozed")
  // H3 / H4 (max one level total)
  if (topic.subState === "waiting_on_them" || activeDampener(topic, lead, now)) profile = lowerLevel(profile, 1)
  // H5
  if (topic.dormant) return weeklyOnce("dormant")

  // I (up only)
  const d = nextDeadline(active, ["us", "unknown"])
  if (d && hoursUntil(d, now) <= p.deadlineImmediateHours) profile = "P8"                       // I1
  else if (d && d < nextListPoint(profile, now) + p.digestActionBufferHours) profile = raise(profile, 1) // I2
  else if (d && workingDaysUntil(d, p.cal) <= p.deadlineLeadDays[lead.effort ?? "medium"]) profile = atLeast(profile, "D4") // I3
  if (overdue(active, now)) profile = atLeast(profile, "D4")                                    // I4
  if (lead.kind === "trend") profile = atMost(profile, "D4")

  // J–L
  return place(topic, { score, band, cls, lead, profile, deadline: d }, now, p)  // list, rank, cycle, expiry, nextCheckAt
}
```

---

## 13. Parameters

Settings ladder: user → org → platform → built-in (spec §8.4). The org owner cannot change them in the MVP (Q3: platform admin only). Values in **bold** are new.

| Key | Default | Source |
|---|---|---|
| `cards.workingHours` | Mon–Fri 08:00–18:00 | Maslov §5.2 |
| `cards.timeZone` | org: Europe/Moscow | spec §8.4 |
| `cards.morningDigestTime` | 07:30 | Maslov §5.2 |
| `cards.eveningDigestTime` | 17:00 | Maslov §5.2 |
| `cards.weeklyReview` | Friday 12:00 | Maslov §5.2 |
| `cards.dailyPushLimit` | 3 (0–20); off in MVP | Q13, Maslov |
| `cards.digestVisibleItems` | 5 (1–20) | Maslov §5.2 |
| `cards.deadlineImmediateHours` | 24 | Maslov §5.2 |
| `cards.digestActionBufferHours` | 3 | Maslov §5.2 |
| `cards.deadlineLeadDays` | complex 5 · medium 3 · quick 2 working days | Maslov §5.2 |
| `cards.expiryDays` | P8 10 · P6 7 · D4 5 · W1 10 working days | Maslov §5.2, Q24-4 |
| `cards.weeklyGraceDays` | 7 calendar days | Q24-4 |
| `cards.p6RepeatMax` | 3 evenings per cycle (also P8) | Q24-5 |
| `cards.telegramMaxPerCard7d` | 2 (phase 7) | Q24-5 |
| `cards.noResponseDefaultDays` | 7 (phase 8) | Q24-11 |
| `topics.reopenDays` · `dormantDays` · `expireDays` | 14 · 21 · 60 | spec §8.4 |
| **`attention.boostMax`** | **2** | §4.4 |
| **`attention.boost.reminder.enabled`** | **true** | §4.4 R |
| **`attention.boost.overdueReaction.enabled`** | **true** | §4.4 O |
| **`attention.reactionWorkingDays`** | **quick 1 · medium 2 · complex 3** | §4.4 O |
| **`attention.boost.corroboration.enabled`** | **true** | §4.4 C |
| **`attention.waitingOnThemLowersLevel`** | **true** | §5.2 H3 |
| **`attention.relevanceDays`** | **quick 14 · medium 30 · complex 45 · trend 90** (per-code override `relevance_days`) | §4.2 |
| **`attention.tickMinutes`** | **15** | §10 |

---

## 14. Worked examples

All examples: IN4COM, org time Moscow, boosts on.

**E1 — offer request with a reminder (spec §2.1 example 1)**

| Time | Item | Effect | Score | List |
|---|---|---|---|---|
| Mon 10:00 | Email «Пришлите КП на корпоратив на 40 человек» | `SALES_OFFER_REQUESTED` 7, asks us → `waiting_on_us` | 7 | «Сейчас» (P6) |
| Tue 15:00 | Telegram «Ну что, когда будет КП?» | same topic. The new instance of `SALES_OFFER_REQUESTED` gets `ATTR_EMOTION_IMPATIENT` +1 → 8 and becomes the lead (base 8). It is an inbound repeat with no outbound between → boost R +1 | 8 + 1 = 9 | «Сейчас» (P8), new cycle |
| Wed 09:00 | Our email «Направляем КП» | `SALES_OFFER_SENT` (S0) closes `SALES_OFFER_REQUESTED` → no active instance | — | resolved, none |

Explanation at Tue 15:00: «запрошено КП (вес 7, нетерпение +1); клиент напомнил (+1)».

**E2 — overdue invoice, promise, payment**

| Item | Effect | Score | List |
|---|---|---|---|
| Client, answer to our payment reminder for invoice 124: «Это неприемлемо, счёт 124 мы оспариваем» | `INVOICE_OVERDUE` 7 (overdue or disputed) + `ATTR_EMOTION_ANGRY` +2 | 9 | «Сейчас» (P8) |
| Client: «Оплатим до 20.11» | `PAYMENT_PROMISE` 3 dampens the overdue invoice until 21.11 → −1 level | 9 | «Сейчас» (P6) |
| 21.11, no payment | dampener ends, new cycle | 9 | «Сейчас» (P8) |
| «Платёжка во вложении» | `INVOICE_PAID` closes `INVOICE_OVERDUE` | — | resolved |

**E3 — delivery discrepancy (spec §2.1 IN4COM example)**

| Item | Effect | Score | List |
|---|---|---|---|
| «В поставке от 05.11 бой 3 бутылки, акт приложили» | `DELIVERY_DISCREPANCY` 7, asks us | 7 | «Сейчас» (P6) |
| (2 working days, no reply; effort medium) | boost O +1 | 8 | «Сейчас» (P8) |
| «Когда замените?» | boost R +1 (total boosts 2 = cap) | 9 | «Сейчас» (P8), new cycle |
| Mon: our reply «Замена в четверг» | `waiting_on_them`: boosts R and O end; H3 lowers P6 → D4; our deadline Thursday (owner us, 3 working days = lead days of effort medium → I3 keeps at least D4) | 7 | «Сводка» (D4) |
| Wed 18:00 | the Thursday deadline (date only = Thu 18:00) is ≤ 24 h away → I1 | 7 | «Сейчас» |
| «Замену получили, всё в порядке» | `DELIVERY_DISCREPANCY_RESOLVED` (S1) closes it | — | resolved; card UPDATE «Вопрос закрыт» |

**E4 — complaint plus praise, then escalation**

| Item | Effect | Score | List |
|---|---|---|---|
| «Опять пробковое вино в партии» | `COMPLAINT_QUALITY` 7 + `ATTR_TONE_NEGATIVE` +1 | 8 | «Сейчас» (P8) |
| «Кстати, гостям очень понравилось новое просекко» | other matter → its own topic (`FEEDBACK_QUALITY_PRAISE` 3, «Неделя»). Praise never closes the complaint. | 8 | unchanged |
| «Подключаю нашего управляющего, вопрос надо решать» | `COMPLAINT_ESCALATED` 8 (base 8); an inbound repeat of the same family with no outbound between → R +1; two risk codes ≥ 6 from two items → C +1 | 8 + 2 = 10 | «Сейчас» (P8, band critical), new cycle |

**E5 — low-weight request with an urgent deadline**

«Пришлите каталог по Бургундии до завтра, 10:00» → `SALES_CATALOG_REQUESTED` 5 (D4). The deadline (owner us) is < 24 h away → I1 → «Сейчас», no daily limit. Score stays 5; the explanation says «срок < 24 ч».

**E6 — trend ceiling**

System-of-record check (phase 8): revenue of «Винотека» −35 % YoY → `ACCOUNT_REVENUE_DECLINE_YOY` (trend, weight 6). Score capped at 5 → «Сводка». No escalation can move it to «Сейчас».

**E7 — partial closing**

Topic «Ромашка — заказ на пятницу»: `ORDER_REQUESTED` 7 and `ORDER_CHANGE_REQUESTED` 6. Our «Заказ подтверждён, счёт во вложении» → `ORDER_CONFIRMED` closes both → resolved. If the client later writes «Уберите из заказа Шабли» → reopen (≤ 14 days), `ORDER_CHANGE_REQUESTED` 6 → «Сейчас» (P6), new cycle.

**E8 — stale signal**

`SALES_PRICE_REQUEST` 6 (quick, window 14 days), we never replied, no deadline, boosts O +1 (score 7). After 14 days the instance is `stale` → no active instance → band none, list none; topic later becomes `dormant` (21 days). It shows once in «Неделя» as «Тема затихла». The phase-8 no-response watchdog covers such cases later.

**E9 — snooze**

User sets «Отложить до 01.12» on a P6 topic. It leaves «Сейчас». On 25.11 the client sends a new counted code → material change → the snooze ends and a new cycle starts.

---

## 15. Decisions to confirm

| # | Question | Recommendation |
|---|---|---|
| A1 | Boosts R (client chases), O (overdue reaction), C (corroboration), total cap +2 (§4.4) — accept? | **Yes, all three on.** Without them a reminder or a slow reply never raises attention, because signals do not add up. Each one can be switched off. |
| A2 | Attributes apply only to the dominant instance of an item (§4.1) | **Yes.** Same as Truffalo; stops one angry phrase from raising an unrelated topic. |
| A3 | Relevance windows 14 / 30 / 45 days by effort, trend 90 (§4.2) | **Yes**, plus per-code overrides in the registry files (05a–05d). |
| A4 | `waiting_on_them` lowers the profile by one level (§5.2 H3) | **Yes.** Our reply moves the topic out of «Сейчас»; our own deadlines still escalate it. |
| A5 | New relation kind `dampens` (seed: `PAYMENT_PROMISE` → `INVOICE_OVERDUE`) (§5.2 H4) | **Yes.** Other candidates for review: `PROSPECT_FOLLOWUP_AGREED` (agency). |
| A6 | Expiry for P8 / P6 / D4 = 10 / 7 / 5 working days (Maslov values; Q24 decided only W1) | **Yes** (Maslov §5.2). |
| A7 | Evening reminder cap 3 also for P8 (Q24-5 named P6) | **Yes.** Maslov: «защита от повторов одной карточки» for P8. |
| A8 | `card.score` = snapshot at the last NEW / UPDATE; lists use the live topic score (§1) | **Yes.** Clarifies spec §7.2 «the card keeps the score it was born with». |

## 16. Acceptance tests (unit, no LLM)

1. MAX: codes 7 + 6 + 5 on one topic, boosts off → 7.
2. Attribute +2 on the dominant instance → 9; the same attribute on a second subject of the same item → no change there.
3. Low confidence only → band none, list none.
4. State code closes only its `closes_codes` on the same topic; another topic of the same client is unchanged.
5. Reminder: request + inbound repeat with no outbound between → +1; with an outbound between → +0.
6. Boost cap: R2 + O1 + C1 → +2.
7. Trend lead with attribute +2 and an immediate deadline → score 5, list «Сводка».
8. Explicit profile D4 on a weight-7 code + attribute +2 → P6.
9. `waiting_on_them` P8 → P6; plus dampener → still P6 (no stacking).
10. Deadline < 24 h on a D4 topic → «Сейчас»; deadline owner `them` → no escalation.
11. I3 return: medium effort, deadline in 3 working days → at least D4 and one new cycle; the Russian production calendar moves a holiday correctly.
12. Evening reminders stop after 3 per cycle; a material change resets the counter; a NOOP item does not.
13. Expiry: P6 cycle, 7 working days → card `expired`, topic still `open`, in «Неделя / Истекло» for 7 days, then only «Все темы».
14. Snooze hides the topic; a new counted code ends it.
15. Weight change in the registry does not change stored instance scores; boosts and lists recompute.
16. Same inputs twice → identical `topic.attention` (determinism).

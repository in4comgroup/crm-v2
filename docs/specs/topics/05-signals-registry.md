# Topics — signals registry (full specification)

Status: reviewed 2026-11-13 (decisions R1–R20 in [02-open-questions.md](02-open-questions.md) § F applied); updated 2026-11-14 for **R22** (one generic signal set, migration `0016`) and **R23** (all `onHold` codes `active`, retired codes deleted, migration `0017`) · seed data, no code changes; 2026-11-26: process code `CONTACT_BIRTHDAY` added (migration `0055`, block G, weight 8; check `contact_birthday`)
Extends [01-specification.md](01-specification.md) §4 (taxonomy) and §10 (Russian language). Attention rules that use these fields: [06-attention-engine.md](06-attention-engine.md).

The registry is the full list of signal codes with all parameters, Russian texts and Russian cues. It is **data** (DB tables with all parameters and settings: codes, packs, per-org activation and overrides, stage rules, risk types, relations), managed by the platform admin in Settings → «Сигналы» (Q3) with a **full editor** in the MVP. These files are the **source of version 1**: after review, version 1 is written into a Drizzle **custom migration** (`pnpm db:custom --name signals_registry_v1`) as platform reference data with fixed ids and `ON CONFLICT DO NOTHING` (root `AGENTS.md` rule 3). After that the DB is the master; these files are not loaded again (no `db/seeds/*.json`, no scripts). The «Экспорт в Markdown» of the tab writes the same format back (spec §4.1).

Only the packs `base` and `distribution` were seeded (R5); since migration `0014` (R21) they are **one pack, `base`**. Since migration `0016` (R22) this pack is **one generic set for every org**: no vertical (wine / alcohol) content, no org-specific signals or rules, neutral pack description. The `agency` pack (05d) stays a document until phase 9 (second pilot).

Items marked **[new]** were not in the 2026-11-10 spec; they are listed in §10 and were accepted on 2026-11-13.

---

## 1. Files

| File | Content | Codes |
|---|---|---|
| [05a-signals-base-a-g.md](05a-signals-base-a-g.md) | `base` pack, blocks A Продажи · B Договоры · C Исполнение · D Счета · E Обратная связь · F Встречи · G Контакты | 55 (45 active) |
| [05b-signals-base-h-n.md](05b-signals-base-h-n.md) | `base` pack, blocks H Рынок · I Недоставка · J Команда · K Аккаунт · L Конкуренты · M Внутреннее · N Поставщики; **attributes**; **relations** | 79 + 26 attributes + 22 relations |
| ~~05c-signals-distribution.md~~ | **Deleted (R22).** Was the seed source of the former distribution codes, risk types and stage-rule templates. Git history keeps it. Today these codes live only in the DB (blocks O–U, see below) | — |
| [05d-signals-agency.md](05d-signals-agency.md) | `agency` pack (Maslov N1–N4); agency overrides of base codes; funnel stage-rule template; 26 deal-risk types. **Phase 9 / agency: not seeded in the MVP.** | 62 (N1 19 · N2 10 · N3 15 · N4 18); 26 risk types; stage rules R0–R37 |

05a / 05b are the **historical** seed source. The DB is the master; R22 (`0016`) cleaned the DB texts, and 05a / 05b are not updated.

**Blocks O–U** (former distribution blocks DS1–DS7, renamed and made generic by `0016`; 24 codes, DB only): O «Заказы» · P «Наличие, образцы, промо» · Q «Ассортимент клиента и новые точки» · R «Доставка и возвраты» · S «Документы» · T «Оплата и взаиморасчёты» · U «Предложено дополнительно». The 9 deal-risk types and the stage-rule templates (deal types `listing`, `new_location`, `tender`, `supply_agreement`, `renewal`) also live in the DB.

Every code has the same entry format: a parameter table, then Russian definition, boundary, prompt cues, full synonym list, anti-cues, example, counter-example and card note (§4).

---

## 2. Data model

Tables from spec §4.1 (full list in spec §11: packs, blocks, codes, attributes, relations, pack overrides, per-org activation and overrides, stage rules, risk types and their per-org stage guards), with the columns this registry needs (accepted, R1 of §10):

| Table | Columns added **[new]** | Why |
|---|---|---|
| `signal_category` | `family` (spec §6.2 already names it), `relevance_days` (int, null = default by kind / effort, 06 §4.2), `cues_prompt_ru` text[] (≤ 8), `synonyms_ru` jsonb (groups, §4.2), `anti_cues_ru` jsonb (`[{ text, code \| null }]`), `example_ru` text, `counter_example_ru` text, `trigger_rule` jsonb (process codes only, §3.6) | full Russian cue model; process-code rules as data; attention windows |
| `signal_relation` | new kind `dampens` + `setting_key` / `fact` (06 §5.2 H4) | payment promise lowers an overdue invoice until the date |
| `signal_attribute` | `cues_ru` text[], `anti_cues_ru` text[] | Russian attribute cues |

`cues_ru` from spec §4.2 = `cues_prompt_ru` (the prompt list). The prompt builder never sends `synonyms_ru`; they are for people, tests and the synthetic golden set.

---

## 3. Field reference

### 3.1 Identity

| Field | Values | Rules |
|---|---|---|
| `code` | `UPPER_SNAKE`, ≤ 48 chars | Stable forever. A retired code keeps its row (`retired_at`, `successor_code`); the 11 retired codes of the seed were deleted by R23 (`0017`). |
| `pack` | `base` \| `agency` \| … | One pack per code. Today only `base` exists (R21, R22). |
| `block` | `A`…`N`, `O`…`U` (generic trade blocks, ex-`DS1`…`DS7`, R22), `N1`…`N4` (agency) | Groups codes in UI, prompt and export. |
| `family` | `offer` · `order` · `invoice` · `contract` · `complaint` · `meeting` · `contact` · `pitch` · `delivery` · `account` · `market` · `supplier` · `team` · `internal` · `competitor` | Exactly one. Used by the topic matcher (spec §6.2) and by boost R (06 §4.4). |
| `label_ru` | ≤ 60 chars | UI and card. Says what the **counterparty** did, not what we must do. |

### 3.2 Scoring

| Field | Values | Rules |
|---|---|---|
| `weight` | 0–9 | See the scale in §3.3. `state` codes = 0. |
| `score_rule` | `fixed` \| `state` \| `inherited` | `state` never scores, it closes. `inherited` takes the score of the topic it attaches to (fallback = weight). |
| `class` | `risk` \| `chance` \| `fyi` \| null | null only for `state`. |
| `class_by_relation` | bool | Class by client relation: active → risk, prospect / dormant → chance. |
| `kind` | `event` \| `watchdog` \| `derived` \| `trend` \| `state` | `trend` has the D4 ceiling (Q24-6). `watchdog` / `derived` / `trend` are emitted by a process. |
| `effort` | `quick` \| `medium` \| `complex` \| null | Lead days (quick 2 / medium 3 / complex 5, as in 06 and v204), reaction time for boost O, relevance window. null = medium. |
| `carries_amount` | bool | The prompt asks for `facts.amounts`. |

### 3.3 Weight scale (how to set a weight)

Use this scale for new codes and for org overrides. The band and the default list follow from the weight (06 §4.6).

| Weight | Meaning | Typical examples | Default list |
|---|---|---|---|
| 9 | Existential or a large one-time result: the relationship or a big sum is decided now | tender invitation, contract terminated, client insolvency | «Сейчас» P8 |
| 8 | Act today: money or the relationship is at risk, or a binding win | escalated complaint, contract expiry < 8 weeks, binding order, budget cut | «Сейчас» P8 |
| 7 | Act today or tomorrow: the client asked for work of value, or a concrete risk appeared | offer requested, overdue invoice, complaint, order received, delivery problem | «Сейчас» P6 |
| 6 | Act in 1–2 days | price list requested, offer declined, return requested | «Сейчас» P6 |
| 5 | Act this week | catalog requested, samples, referral, new stakeholder | «Сводка» D4 |
| 4 | Know this week; small action | budget mentioned, out-of-office, reconciliation requested | «Сводка» D4 |
| 3 | Useful context | praise, payment promise, supplier price change | «Неделя» W1 |
| 2 | Weak context | NDA signed, meeting protocol | «Неделя» W1 |
| 1 | Trace only | — (avoid) | «Неделя» W1 |
| 0 | State (closes, no card) | offer sent, invoice paid, order confirmed | — |

Rules: a code that **asks us** for work is ≥ 4. A `risk` that can lose a client or money is ≥ 7. Praise and pure information are ≤ 3. Do not raise a weight to fix the list placement of one case; use deadlines, boosts or an explicit profile.

### 3.4 Behaviour

| Field | Values | Rules |
|---|---|---|
| `asks_us` | bool | Maslov «REQ». Sets `waiting_on_us`; enables boosts R and O and (phase 7) evening reminders. A repeat of the same asks-us code on the same topic counts once via boost R; the impatience attribute is not added to it (R19, 06 §4.4). |
| `inbound_only` | bool | Dropped on items authored by us (spec §5.4 rule 2). |
| `emitted_by` | `parser` \| `process` \| `both` | `process` codes are never in the extraction prompt. |
| `stage` | `active` \| `onHold` \| `parked` \| `gated` | Pack default. Only `active` acts. `gated` = waits for a date gate or a feature. |
| `display_profile` | `W1` \| `D4` \| `P6` \| `P8` \| `S0` \| `S1` \| null | null = from the score. An explicit profile shifts with attributes and boosts (06 §5.1). |
| `recipient_role` | `relationship` · `opportunity` · `account` · `finance` · `accounting` · `logistics` · `team` · `new_biz` · `events` | Stored now, used when functional roles ship (Q33). |
| `closes_codes` | text[] | For `state` / S1 codes **and for event codes** (R12): e.g. `INVOICE_PAID` closes `PAYMENT_PROMISE`; `ORDER_CANCELLED` closes `ORDER_REQUESTED`, `ORDER_CHANGE_REQUESTED`. Closes these codes **on the same topic**. A pack may change `closes_codes` of a base code (§5). An event code that closes still scores by its own weight. |
| `date_gate` | `{ fact, test: within \| beyond, settingKey, days }` | Server keeps the code only when the fact date passes the test against the item date. |
| `relevance_days` | int \| null | **[new]** null = default (quick 14 / medium 30 / complex 45 / trend 90). |
| `card_note_ru` | text | Guidance for the card writer. Roles, not names. |

### 3.5 Russian texts and cues

| Field | Content | Used by |
|---|---|---|
| `definition_ru` | 1–3 sentences: what the **author** does or says | prompt, UI, export |
| `boundary_ru` | «Граница»: what looks similar but does not count, and which code it is instead. **Mandatory** for every active code | prompt, UI |
| `cues_prompt_ru` | ≤ 8 strongest cues | prompt |
| `synonyms_ru` | full list in groups: `business` (деловая переписка), `chat` (мессенджеры, разговорный стиль), `terms` (сокращения и термины), `patterns` (устойчивые конструкции) | people, golden-set generator, eval, future cheap pre-filter |
| `anti_cues_ru` | look-alike phrases and the right code (or «нет сигнала») | prompt (as part of the boundary), eval |
| `example_ru` / `counter_example_ru` | one sentence that must give the code / one that must not | prompt few-shot (optional), unit eval |

### 3.6 Process codes (`trigger_rule`)

`watchdog`, `derived` and `trend` codes have no prompt cues. Their rule is data:

```jsonc
{
  "source": "orders",              // orders | revenue | topic | mailbox
  "window": "P90D",                // observation window
  "baseline": "same_window_last_year" | "client_rhythm" | "previous_window",
  "minData": { "orders": 3, "months": 6 },
  "threshold": { "metric": "revenue_change_pct", "op": "<=", "value": -20 },
  "cooldownDays": 90,
  "clearWhen": "metric back above threshold"
}
```

Too little data → no instance (spec §5.6: insufficient data never produces a definitive warning).

---

## 4. Russian cues — writing rules

1. **Write, do not translate.** Cues are phrases Russian clients really use. German / English hints from Truffalo v204 are only a starting point.
2. **Cover both registers.** Formal email («Просим направить коммерческое предложение») and chat («скиньте КП плиз», «ну что там по КП?»).
3. **Terms and abbreviations** belong to `terms`: КП, ТЗ, ДС, УПД, ТТН, ТОРГ-12, ТОРГ-2, НМЦК, 44-ФЗ, 223-ФЗ, акт сверки.
4. **Inflection:** cues are hints for the model, not regexes. Where a stem matters, write it with variants: «просрочк(а/и/у)», «оплатил(и)». The model handles case and aspect.
5. **Prompt cues ≤ 8** per code: the most frequent and the least ambiguous. The full synonym list may hold 10–25 items.
6. **Every look-alike gets an anti-cue** with the right code: «есть ли в наличии?» → `STOCK_AVAILABILITY_REQUEST`, not `ORDER_REQUESTED`.
7. **Author rule in the cue:** a cue describes what the counterparty writes. Our own phrases appear only for `state` codes we emit on our own items («направляем КП» → `SALES_OFFER_SENT`).
8. **Negation and hedging** are anti-cues: «пока не планируем тендер», «может быть, когда-нибудь» do not give the code.
9. **Quoted history never counts** (spec §5.3): a cue in a quoted block is context only.
10. **Industry cues** that make sense only in one pack are marked «(агентство)» in base entries. There are no vertical trade cues since R22; generic trade cues need no mark.
11. **Foreign-language mail (R20).** Producers write in English, French or Italian. Extraction works on any language; the prompt says so. Supplier / producer codes (block N, family `supplier`, e.g. `SUPPLIER_*`) also get **English cue phrases** in `cues_prompt_ru` / `synonyms_ru`, marked «(EN)» (e.g. «shipment delayed», «new price list», «price increase from»). Other codes may get them where producers use them. The English cues are added in the IN4COM text review; 05a–05d do not hold them.

---

## 5. Effective parameters per org

```
effective(code, org) =
    pack of code is active for org                                  (organization_signal_setting.packs)
AND stage(code) = active  after overrides                           (org override → pack override → base value)
AND (code not in a block parked for this pack, e.g. agency: H, J)
→ weight, display_profile, recipient_role, stage = org override ?? pack override ?? base value
→ closes_codes                                  = pack override ?? base value          (R12)
→ all other fields = base / pack value (not overridable in the MVP)
```

- Base codes used by a vertical pack carry the **vertical override** in that pack file (agency overrides in 05d). ~~IN4COM switches in the «IN4COM» column of 05a / 05b~~ — not used since R22. A pack override may change `closes_codes` of a base code (R12); an org override may not.
- Overrides are rows in the registry tables (`signal_pack_override`, `organization_signal_setting`), edited in «Сигналы».
- `signal_stage_rule` and the stage guards of risk types are per org (spec §9.2, §9.4). One model: the risk type is platform data (`deal_risk_type`); the org's stages where it applies are rows in `deal_risk_stage_guard` (risk type × org × allowed stage ids). No guard row = the risk applies at every stage. The pack files give templates; the admin copies them to the org.

> **R21 (2026-11-13): one pack.** After phase 1 the «Дистрибуция» pack was merged into `base` (migration `0014`). The pack / pack-override model below stays in the schema, but today there is one pack.
>
> **R22 (2026-11-14): one generic set.** Migration `0016` deleted the 7 alcohol-only codes and renamed blocks DS1–DS7 to O–U; no code, text or rule is specific to one org.

### 5.1 Org activation (pilot IN4COM)

There are **no presets** now. The preset «Пилот дистрибуции (IN4COM)» (`distribution-pilot`) is removed (R22); the preset mechanism stays in the code for later use.

An org gets signals by switching the `base` pack on in «Сигналы». No org overrides are needed: every code whose **own** stage is `active` acts: 144 codes, of which 123 go into the live extraction prompt (the other 21 are process codes; phase 8 emits 14 of them, `CHECKS_NOT_BUILT` lists the rest). Later additions: 7 parser codes of the custom funnel (`0038`) and the process code `CONTACT_BIRTHDAY` (`0055`, 2026-11-26). Codes with stage `parked` (8) / `gated` (6) stay out. Since R23 (`0017`) no code is `onHold` and no retired code exists. IN4COM on the dev DB: `base` on, all its earlier org overrides deleted.

| Pack | State | Notes |
|---|---|---|
| `base` | on for IN4COM, 144 active codes (123 in the prompt) | generic for every org (R22, R23) |
| `agency` | not seeded | phase 9, second pilot (Q29, R5) |

~~R6: only codes marked "on" for IN4COM (~50) in the live prompt; "review" codes in an offline eval batch.~~ Superseded by R22. Org overrides stay possible (e.g. for test specifics, R22: "if necessary for the tests we will add specifics later").

---

## 6. Prompt building from the registry

For one org the extraction prompt (spec §5.3) gets, per **effective** parser-emittable code, in this order:

```
CODE — label_ru
  Определение: definition_ru
  Не считается: boundary_ru (+ anti-cues as «→ OTHER_CODE»)
  Признаки: cues_prompt_ru (≤ 8)
```

- Process codes, `state` codes emitted only by the CRM, parked / onHold / off codes are not sent. With the `base` pack on and no overrides this means every `active` non-process code (123, §5.1).
- The prompt states that the item may be in any language (Russian, English, French, Italian …); cues are hints, not a language filter (R20).
- Codes are grouped by block; blocks are ordered by the org's active-code count.
- Size budget (Q5): if the prompt exceeds the model's budget, two passes — (1) block classifier with block labels and 3 cues per code, (2) full entries of the chosen blocks only.
- `example_ru` few-shot lines are off by default; the eval decides per code (prompt cost vs precision).

---

## 7. Validation on save (Settings → «Сигналы»)

The registry editor rejects a save when:

1. an active code has an empty `boundary_ru`, `definition_ru` or `cues_prompt_ru`;
2. `cues_prompt_ru` has > 8 items, or a cue is longer than 60 chars;
3. `score_rule = state` and `weight ≠ 0`, or `class ≠ null`;
4. `closes_codes` names a code that does not exist or names the code itself; a cross-family close is a warning only (e.g. `INVOICE_PAID` → `PAYMENT_PROMISE` is same family; `ORDER_CANCELLED` → `ORDER_REQUESTED` is same family). `closes_codes` is allowed on `state` and `event` codes (R12), not on `watchdog` / `derived` / `trend` codes;
4a. an org override tries to change `closes_codes` (only a pack override may);
5. `kind ∈ {watchdog, derived, trend}` and `emitted_by ≠ process`, or `trigger_rule` is empty;
6. a `trend` code has an explicit profile above D4;
7. `family` is empty;
8. a relation refers to a retired code.

The editor validates on save (all rules above) and refuses the save with the list of errors. Every accepted save increments `signal_taxonomy_version`. Stored instances keep their version (spec §5.4).

---

## 8. How the registry is checked

- **Golden set** (spec §12): every active P6 / P8 code needs ≥ 5 real or synthetic positive items and ≥ 3 counter-examples (from `counter_example_ru` and `anti_cues_ru`).
- **Synthetic generator** (phase 0 spike, Q17): builds test messages from `synonyms_ru` (both registers) and `anti_cues_ru`; synthetic items are marked and reported separately.
- **Per-code metrics:** precision / recall per code; confusion pairs (code A predicted where B expected) feed boundary fixes.

---

## 9. Change process

1. Change in Settings → «Сигналы» (platform admin) → new taxonomy version. The DB is the master; no seed file or migration is needed for an edit.
2. Eval harness on the golden set (recorded responses + a live sample). A new code starts as `onHold` and runs only in the offline eval batch.
3. For an org with `topics.enabled = shadow` (org flag in `org_setting`), compare lists before / after. For an org that is `on`, switch the code on after the eval.
4. Export to Markdown and keep it next to the release notes.
5. A change that every DB needs on a fresh install (new platform code for all orgs) also goes into a new custom migration (reference data, fixed ids, `ON CONFLICT DO NOTHING`).

---

## 10. Decisions (accepted 2026-11-13 as recommended)

| # | Question | Decision |
|---|---|---|
| R1 | New columns: `family`, `relevance_days`, `cues_prompt_ru`, `synonyms_ru`, `anti_cues_ru`, `example_ru`, `counter_example_ru`, `trigger_rule` (§2) | **Yes.** Without them the full cue model and the process rules stay in documents, not in data. |
| R2 | New relation kind `dampens` (06 §5.2 H4) | **Yes**, seed one rule (`PAYMENT_PROMISE` → `INVOICE_OVERDUE`). |
| R3 | Weight scale §3.3 as the rule for new codes and overrides | **Yes.** |
| R4 | Open points listed at the end of 05a–05d | Review with the pack owners (IN4COM users for the generic `base` set; agency later). |

# Identity — own organization profile and client business profiles

Status: **decided 2026-11-14 (Q1–Q12 answered, see [02-open-questions.md](02-open-questions.md) § Decisions); I1–I6 built 2026-11-14 / 15; I7 later.** Plan: [03-development-plan.md](03-development-plan.md).

Related: topics spec [../topics/01-specification.md](../topics/01-specification.md) (§5 extraction, gates, «we are the buyer» rule), go-live runbook [../topics/07-signals-go-live.md](../topics/07-signals-go-live.md) (T8 / B5: identity filled by the owner before switch-on), `src/app/AGENTS.md` §§ "Own-org attribution of source items", "Own-organisation identity registry", "Batch web enrichment", "«Ответственный» (Responsible) on companies".

---

## 1. Goal

Two kinds of knowledge are missing from the system today. Without them the AI cannot reliably tell **internal** from **external** communication, and it reasons about business messages with no idea what the business is.

| # | What | Who fills it | Why |
|---|---|---|---|
| G1 | **Own organization profile** («Профиль организации»): who «we» are (names, domains, mailboxes, staff addresses) and what we do (description, business domain, role in the market, products and services, target customers, typical suppliers) | Org owner. **Mandatory minimum** before the topics engine runs for the org | Separate internal from external; separate our business from the user's private matters; tell the AI who sells to whom; give every prompt the business context |
| G2 | **Client business profile** («Профиль компании»): what the client does, its business domain, role, products / services, size, geography, what it needs from us | The responsible KAM («Ответственный») manually, **or** automatically from web data (later also from our own communication), with the source of each value | Better cards, deal state texts and topic decisions; segmentation; cross-sell later |

Non-goals (separate work): functional roles and rights (Q33 of topics), contact-level profiles (role, decision maker), ICP scoring of unknown companies, finance data from 1С.

## 2. What exists today (inventory 2026-11-14)

| Area | Today | Gap |
|---|---|---|
| Org record | `organization`: name, slug, logo, `web_url`, address, email, phone, `metadata` (`{ taxId }` = ИНН). Edited on `/account` → «Информация об организации» (owner in the UI; the server uses the better-auth default update permission) | **No business data** at all (description, domain, products, customers). No server-side owner check |
| Identity registry | `org_identity_entry` kinds `name` / `website` / `address` (owner-only, report-only retroactive matches) | No email domains without a website, no shared mailboxes, no staff personal addresses (gmail, bk.ru), no Telegram handles |
| «Us» loaders | Two: `loadOwnOrgIdentity` (discovery + parse-time company stripping; uncached; **no member emails**; `org.email` domain **not** freemail-guarded) and `getOrgIdentity` (attribution; 5-min cache; member emails; freemail-guarded with the BASE list only, not the RU list in `src/lib/ru-mail/senders.ts`). Profile edits do not invalidate the cache | Inconsistent «us»: staff on freemail become contacts (discovery), `@bk.ru` staff add `bk.ru` as «our» domain |
| Internal vs external | `org_attribution` (own_org / external / unknown) = who AUTHORED the item. `direction` internal / outbound is then left to the extraction model | Nothing checks that ALL participants are ours → internal mail is classified by the model alone |
| AI context | Signal extraction gets only «Наша компания: <name>» + the attribution hint. Card writer, deal state, topic matcher: no org name at all. Email parser: none. AI chat: none. Order split: **hard-coded «wine & spirits distributor»** (`src/server/order-requests.ts`) | The model guesses what we sell, so «we are the buyer» and «vendor marketing is never demand» depend on luck |
| Clients | `client`: name, aliases, web_url, email, phone, address, comment, `custom_fields` (`type` for one org, `discount`, `companyKind` supplier / partner), responsible. Web enrichment fills only web_url / email / phone / address | **No description, business domain, role, products, size**. `comment` is the only free text |
| Gate | Topics mode `shadow` / `on` is set by a platform admin with no precondition. Runbook T8 / B5 is a manual checklist | An org can run the engine with an empty identity |

## 3. Own organization profile

### 3.1 Data

Four groups. **Bold** = part of the mandatory minimum (§3.3).

**A. Identity — who «we» are** (deterministic matching, no AI)

| Field | UI label | Notes |
|---|---|---|
| **Legal name** + other names | «Название», «Другие названия» | Existing `organization.name` + registry kind `name` |
| ИНН | «ИНН» | Existing `metadata.taxId` (identity only; no ОКВЭД or registry lookup — Q2) |
| **Websites / own domains** | «Сайты и домены» | Existing `web_url` + registry kind `website`. **New:** registry kind `email_domain` for a mail domain with no website. An org with no own domain ticks «Нет своего домена (почта на общих сервисах)» — then staff addresses (below) are mandatory |
| Shared mailboxes | «Общие ящики» | **New** registry kind `mailbox`: `sales@`, `info@`, `zakaz@` — our addresses that are not users. Exact address match |
| **Staff addresses** | «Адреса сотрудников» | Members' sign-in emails (derived, read-only; **count as «us» only when on an own domain** — or every member when «Нет своего домена»; decided 2026-11-14) + **new** per-member extra addresses (registry kind `person`, with `user_id`): personal email (gmail, bk.ru, …), Telegram `@handle`, phone. Each member can add their own on `/profile`; the owner can add for anyone |
| Addresses | «Адреса» | Existing registry kind `address` |

**B. Business — what we do** (Russian text, read by the AI)

| Field | UI label | Limits |
|---|---|---|
| **Description** | «Чем занимается компания» | 1–3 sentences, ≤ 500 characters |
| **Business domain** | «Отрасль» | One value from the platform category list (§3.2) + optional comment «Комментарий к отрасли» |
| **Role in the market** | «Роль на рынке» | One or more of: производитель, импортёр, дистрибьютор / оптовик, розница, интернет-магазин, агентство, услуги / консалтинг, ИТ / SaaS, другое |
| **Products and services** | «Продукты и услуги» | List of lines `{ name, short description ≤ 200 }`, 1–30 lines; optional link of a line to catalogue categories (`product.category`) |
| **Target customers** | «Наши клиенты» | List of segments `{ name, short description }`, 1–10 (e.g. «рестораны и бары», «сети супермаркетов», «маркетинговые отделы крупных брендов») |
| Typical suppliers | «Кто продаёт нам» | List of supplier categories (e.g. «винодельни и производители», «логистика», «подрядчики-продакшн»). Feeds the «we are the buyer» rule |
| Geography | «География» | Free text ≤ 200 |
| Terms and abbreviations | «Наши термины» | Optional glossary `{ term, meaning }` ≤ 30 (product nicknames, internal abbreviations) |

**C. Working context** — time zone and working hours (`attention.params`), currency. ~~Read-only with a link.~~ **Changed 2026-11-19 (product owner): the org owner edits the time zone and the working hours here** (stored as the org override of `attention.params`; other members read only). There was no UI for them before.

**D. Meta** — `updated_at`, `updated_by`, version; every save writes a change log row (who, when, before / after).

### 3.2 Business domain list («Отрасль»)

A short platform category list, the same for orgs and clients (Q2: categories + comment only, **no ОКВЭД** in any form): e.g. «Продукты питания и напитки», «Розничная торговля», «Дистрибуция и логистика», «Производство», «Строительство и недвижимость», «Маркетинг и реклама», «Медиа и развлечения», «ИТ и программное обеспечение», «Финансы и страхование», «Образование», «Здравоохранение и фармацевтика», «Туризм и гостиничный бизнес», «Профессиональные услуги», «Государственный сектор», «Другое». Kept as data (a platform-reference table filled by a migration, `ON CONFLICT DO NOTHING`), editable later by a platform admin. Each org / client also has a free-text comment «Комментарий к отрасли». «Алкоголь» and «HoReCa» were removed 2026-11-15 (migration `0033`, product owner: no vertical content); the role «HoReCa» too — 15 categories remain.

### 3.3 Mandatory minimum and the gate

The profile is **complete enough** when:

1. a legal name;
2. at least one own domain **or** the box «Нет своего домена» (then «us» = the members' sign-in emails + their extra addresses in «Мои адреса для работы» + shared mailboxes; the profile shows a hint to add them);
3. «Чем занимается компания»;
4. «Отрасль» and «Роль на рынке»;
5. at least one line of «Продукты и услуги»;
6. at least one line of «Наши клиенты».

Completeness is computed (pure function, unit-tested), shown as «Профиль заполнен на N из 6» with the missing items listed.

**Gate:** switching the topics mode of an org to `shadow` or `on` is refused (409 with the missing items) until the minimum is complete. A platform admin may override with a written reason (logged in `org_setting_log`) — for tests. An org already in `shadow` / `on` keeps running; the owner sees a red banner until the minimum is complete (Q4).

The owner sees a banner on `/dashboard` and `/account` («Заполните профиль организации — без него ИИ не отличает внутреннюю переписку от внешней») until complete.

### 3.4 Who edits

- Org **owner**: everything (server-side check — fixes the missing owner check of the org update).
- Any member: read; adds / removes **their own** extra addresses in `/profile` → «Мои адреса для работы».
- Platform admin: everything (support).

### 3.5 One «us» resolver

Replace the two loaders with ONE org-explicit module `src/server/identity/own-org.ts`:

`getOwnOrgContext(orgId)` → `{ identity, profile, completeness, promptCard }`

- `identity`: names (match keys), own domains (website + `email_domain` + `org.email` domain when not freemail), mailboxes (exact), member emails (only those on an own domain; all when «Нет своего домена»; members' domains never become own domains), member extra addresses (email / Telegram / phone), addresses — **one** freemail list (merge `src/lib/email-domain.ts` and `src/lib/ru-mail/senders.ts`).
- `profile`: group B fields.
- `promptCard`: the Russian text block for prompts (§3.6), ≤ 1,500 characters, deterministic (same input → same text, so it can sit in a cached prompt prefix).
- Cache 5 min per org, **invalidated** on every profile / registry / member change (`invalidateOwnOrgContext(orgId)`).
- `loadOwnOrgIdentity` and `getOrgIdentity` become thin wrappers (same return shapes) during the move, then are deleted (done 2026-11-15).

### 3.6 How the profile is used in reasoning

**Deterministic (no AI):**

| Consumer | Change |
|---|---|
| Org attribution (parse) | Author ∈ member emails ∪ extra addresses ∪ mailboxes ∪ own domains → `own_org`. Telegram: sender `@handle` ∈ staff handles → `own_org` |
| **Internal detection (new)** | An item is **internal** when the author is ours AND every recipient (to / cc / chat members) is ours. Stored as a fact next to `org_attribution` (`metadata_json.orgAttribution.allInternal`); the extraction direction becomes deterministic for these items (no model guess). Internal items keep only internal codes (existing `internal_only` blocks) |
| Discovery | Staff addresses / handles never become contacts; our names / domains never become clients (fixes the freemail-staff gap) |
| Gates | Gate «own-org-only internal noise» (topics spec §5.2 gate 3) uses `allInternal` |

**AI prompts** (through the AI layer as today; the org block is static per org):

| Process | What it gets | Effect |
|---|---|---|
| `topics.signal_extraction` | «О нашей компании» block (promptCard): name, other names, role, description, products / services (names only), target customers, typical suppliers, terms | «We are the buyer» decided from «Кто продаёт нам»; demand only for OUR products / services; vendor marketing recognised; internal jargon understood |
| `topics.topic_match` | org name + role (1 line) | «Our» vs «their» side of a question |
| `topics.card_writer` | org name, role, products (names) + the counterparty's client profile summary (§4.5) | Steps like «предложить <наш продукт>», correct direction of work |
| `deals.state_summary` | org name + role + the client profile summary | Who must act; no invented offers |
| `parsing.email` / chat parsers | org name + other names + own domains (1–2 lines) | Companies list without ourselves (today stripped only after the LLM) |
| `parsing.org_attribution` (judge) | as today + mailboxes + staff names | Fewer `unknown` documents |
| AI chat (`/api/chat`) | promptCard in the system prompt | Answers know the business |
| `order_request` split | profile role + products instead of the hard-coded «wine & spirits distributor» | Works for any org |

Prompt cost: + ≈ 1,000–1,500 characters per call; in `topics.signal_extraction` it sits in the static part (cache-friendly, per org). **Every prompt change ships with an eval run on the golden set** (topics working rule).

## 4. Client business profile

### 4.1 Data

| Field | UI label | Type |
|---|---|---|
| Description | «Чем занимается» | text ≤ 500 |
| Business domain | «Отрасль» | same list as §3.2 + «Комментарий к отрасли» |
| Role in the market | «Роль на рынке» | same list as §3.1 B |
| Their products / services | «Продукты и услуги клиента» | list of short lines ≤ 15 |
| Needs / interests | «Что им интересно у нас» | links to OUR product / service lines (§3.1 B) + free text |
| Size | «Размер» | band: микро / малый / средний / крупный / сеть (N точек) — free number for points of sale |
| Geography | «География» | text ≤ 200 |
| Websites | — | existing `web_url` + aliases |
| Notes | «Заметки» | existing `comment` |
| Segment A / B / C | «Сегмент» | **derived**, read-only (12-month revenue, topics phase 8 `meeting_overdue` rule) |
| Relation | «Отношения» | **derived**, read-only (active / dormant / prospect — topics 06 §4.6) |

Every stored field carries **provenance**: `{ source: manual | web | communications | import, byUserId?, at, confidence?: high | medium | low, evidenceUrl?, verified: boolean }`.

### 4.2 Who edits

- The **responsible** member of the client («Ответственный», `client.responsible_user_id`) and the org **owner**: edit every field (manual values are `verified: true`).
- Other members: read only, plus «Предложить правку» is out of scope for now (Q3).

### 4.3 Automatic enrichment from the web

Extends the existing web lookup (`lookupClientOnWeb` / `enrichClientFromWeb`, AI processes `clients.enrichment_research` + `clients.enrichment_extract`, web search capability):

- The extract step also returns description, business domain (from the list), role, products / services, size band, geography — each with a confidence and the source URL.
- **Rule: automatic data never overwrites a manual value.** An empty field is filled with `source: web, verified: false` (shown with a badge «Из интернета — проверьте»). A field that already has a manual value gets a **proposal** instead (review list).
- Built rule (I6, 2026-11-15): automatic data never overwrites ANY stored value — also an earlier unverified web value gets a proposal, not a replacement. A value with confidence `low` (field confidence, capped by the company-match confidence) is **never** written into an empty field — it is a proposal only. An identical value or an identical pending proposal → nothing; a newer proposal for the same field supersedes the older pending one.
- The responsible KAM confirms (→ `verified: true`), edits, or rejects a proposal.
- Triggers: button «Заполнить из интернета» in the company drawer; the existing batch enrichment (now also for profile fields); optional «on create» for new clients (org setting, default off — Q6). Refresh: a profile older than 180 days can be re-enriched (proposals only).
- Cost: under the org's daily AI budget like every background process.

### 4.4 From our own communication (later phase)

A summary of what the client told us (from the topics engine: products in topics, orders, signals) → proposals with `source: communications` and the cited items. Same review rules. Not in the first release.

### 4.5 How the client profile is used

| Consumer | Uses | Notes |
|---|---|---|
| Card writer, deal state | «Профиль клиента» summary: name, отрасль, роль, 1-sentence description, size, segment, needs (≤ 400 characters) | Verified values first; unverified ones marked «(не проверено)» in the prompt |
| Signal extraction | counterparty line «Контрагент: <name> — <отрасль>, <роль>» when the sender's client is known | Helps supplier vs client, «we are the buyer». Short, per item |
| Topic matcher | — | not needed |
| AI chat tools | client detail includes the profile | |
| Companies page | filters «Отрасль», «Роль», «Размер»; columns | |
| Later | ICP fit of potential clients (target customers × client profile), cross-sell (`ACCOUNT_CROSS_SELL_GAP`, parked: needs needs × our products), analytics by industry | separate phases |

## 5. Data model (proposal)

| Change | Kind |
|---|---|
| `org_profile` (PK `organization_id`): `description`, `industry_code`, `industry_note`, `market_roles text[]`, `products jsonb` ([{ name, description, categories[] }]), `target_customers jsonb`, `supplier_types jsonb`, `geography`, `glossary jsonb`, `no_own_domain bool`, `updated_at`, `updated_by_user_id` | new table (schema migration) |
| `org_profile_log` (who, when, before, after) | new table |
| `org_identity_kind` + `email_domain`, `mailbox`, `person`; `org_identity_entry.user_id` (FK user, set null), `channel` (email / telegram / phone) for `person` | enum values + column (migration) |
| `industry` reference (code, label_ru, sort) | platform reference data (migration with fixed codes) |
| `client_profile` (PK `client_id`): `description`, `industry_code`, `industry_note`, `market_roles text[]`, `products jsonb`, `needs jsonb`, `size_band`, `points_of_sale int`, `geography`, `field_meta jsonb` (provenance per field), `updated_at` | new table |
| `client_profile_proposal` (client, field, value jsonb, source, confidence, evidence_url, status pending / accepted / rejected, decided_by, decided_at) | new table |

Value lists are text columns validated in code (as in topics). Tenant data never goes into migrations.

## 6. UI

- `/account` → new tab **«Профиль организации»** (owner edits, members read): the four groups, completeness «N из 6» with the missing items, change history. The existing «Своя организация» dialog (identity registry) moves into group A of this tab.
- `/profile` → block **«Мои адреса для работы»** (each member: extra emails, Telegram, phone).
- Banner for the owner on `/dashboard` and `/account` while the minimum is incomplete.
- `/settings` → «Организации»: column «Профиль» (complete / N из 6); «Темы» → mode switch shows the gate error.
- Company drawer / page → block **«Профиль компании»** with source badges («Вручную · <имя> · дата», «Из интернета — проверьте»), «Заполнить из интернета», proposals («Принять» / «Отклонить»).
- Companies page: filters «Отрасль» / «Роль» / «Размер».

## 7. Acceptance checks

1. An org with an incomplete minimum cannot be switched to `shadow` / `on` (409 lists the missing items); a platform admin override is logged.
2. A member with a personal gmail address added in «Мои адреса для работы» never becomes a contact; mail from that address is `own_org`.
3. Mail where the author and every recipient are ours is internal without a model call deciding the direction.
4. The extraction prompt contains the org block; the golden-set eval shows no drop in precision and fewer «we are the buyer» errors (supplier offers marked as demand).
5. Order-from-request works for an org outside wine & spirits (no hard-coded vertical).
6. Web enrichment fills an empty client description with «Из интернета — проверьте» and never overwrites a manual value (a proposal instead).
7. Card / deal-state prompts contain the client profile summary; unverified values are marked.

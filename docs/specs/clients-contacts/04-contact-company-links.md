# Contact ↔ company links over time — specification

Status: **built 2026-11-15** (L1–L5; migration `0039_contact_company_links`, applied on the test DB). Questions decided: [05-contact-company-links-questions.md](05-contact-company-links-questions.md). Plan: [06-contact-company-links-plan.md](06-contact-company-links-plan.md). §10 = what was built.

## 1. Goal (product owner, 2026-11-15)

| # | Requirement |
|---|---|
| R1 | A contact can change company over time (works for X, then moves to Y; both X and Y are clients). Recognise the change from the sources and relink the contact to the new company |
| R2 | Keep the information on BOTH companies: X shows the person as a former contact («теперь в Y»), Y shows him as current («ранее в X») |
| R3 | Tell a historical move from a person who works with two companies AT THE SAME TIME (consultant, contractor, part-time); a person decides the type of relinking and which link is current (the new one or both) |

## 2. What exists today (check of 2026-11-15)

| Area | Today | Gap |
|---|---|---|
| Model | `contact.client_id` — ONE company or none; `contact.email` — ONE address; `contact.aliases` (names, Telegram «@handle»); `contact.position` | No second company, no history, no second address of the same person |
| Discovery | Contacts de-duplicated by email (a native-name match only at the SAME email domain) | A person who moved writes from a NEW address at Y → discovery creates a SECOND contact; X still shows the old one as current |
| Merge | None («no client / contact merge exists in the CRM») | Duplicates of one person cannot be joined |
| Topics | Counterparty: contact by email / Telegram alias / unique name key; the contact's `client_id` gives the company | A two-company person always resolves to one company |
| Signals | `CONTACT_LEAVING` (farewell / «последний рабочий день»), `CONTACT_NEW_KNOWN_ORG` (new contact at an existing client), `CONTACT_NEW_DECISION_MAKER`, `MAILERDEMON_RECEIVED` (bounce), `CONTACT_OOO`; deal risk «ЛПР ушёл без передачи дел» (`deal_contact_lost_without_handover`) | Signals are seen but never change the contact's links |
| Deals | `deal_contact` (many-to-many) | — |

## 3. Model

### 3.1 Links (R2, R3)

New table `contact_company_link`:

| Column | Meaning |
|---|---|
| `contact_id`, `client_id`, `organization_id` | the pair (tenant-checked) |
| `relation` | `employee` («Сотрудник») / `consultant` («Консультант / подрядчик») / `representative` («Партнёр / представитель») / `other` (Q3) |
| `status` | `current` / `former` |
| `is_primary` | exactly one primary among the CURRENT links of a contact (when it has any) |
| `position` | role at THAT company («Директор по закупкам») |
| `started_at`, `ended_at` | dates (day precision; may be approximate, editable) |
| `source` | `manual` / `proposal` / `implicit` (the old `client_id`, written on the first change) / `merge` |
| `evidence_source_item_id` | the message that showed the change (optional) |
| `end_reason` | «Перешёл в <Y>», «Больше не работает», free text |
| `created_by_user_id`, `ended_by_user_id`, timestamps | audit |

`contact.client_id` STAYS and always equals the client of the **primary current** link (or null) — every existing reader (lists, discovery, topics, deals, search, AI) keeps working; the link table adds the rest. One write path (`src/server/contact-links.ts`) changes both in one `db.batch`. **No backfill (Q12):** a `client_id` without a current row = ONE implicit current primary `employee` link (since the contact's `created_at`); the first change that touches it writes the row (`source = implicit`). Sources: `manual` / `proposal` / `implicit` / `merge`.

### 3.2 Addresses of one person (Q2)

New table `contact_address`: `contact_id`, `kind` (`email` / `phone` / `telegram`), `value` (normalised), `status` (`active` / `old`), `client_id` (the company the address belongs to, when known), `source`, `first_seen_at`, `last_seen_at`. `contact.email` / `phone` stay = the primary active ones. Discovery, topics counterparty matching and document attribution match a person by ANY of their addresses — so mail from the old X address still maps to the same person, now marked «бывший сотрудник X».

### 3.3 Merge of two contacts (Q7)

`mergeContacts(orgId, keepId, mergeId, userId)`: addresses, company links, aliases, `deal_contact`, tasks, `topic.contact_id`, card / document links, custom field values (keep the kept contact's values, fill empty ones) move to the kept contact; the merged row becomes `status = 'deleted'` with `merged_into_contact_id` (new column) so old references resolve; one journal row. Used by «Это тот же человек» (§4) and by hand in the contact drawer («Объединить с…»).

## 4. Recognition from the sources (R1, R3)

A deterministic step after parsing / signal extraction (no extra AI call) writes **proposals**, never silent changes (Q4). Each proposal = `contact_link_proposal`: `contact_id` (the known person), `candidate_contact_id` (a second record of the same person, when found), `from_client_id`, `to_client_id`, `kind` (`moved` / `second_company` / `same_person`), `confidence`, `rule`, evidence items, `status` (`pending` / `accepted` / `rejected` / `superseded`), decision (`moved` / `both` / `other_person` / `dismissed`), `decided_by` / `at`.

| # | Rule | What it sees | Proposal |
|---|---|---|---|
| P1 | **Farewell / new address** | `CONTACT_LEAVING` (or an auto-reply «больше не работаю», bounce `MAILERDEMON_RECEIVED` of the contact's address) from contact C of company X; the same message names a new address or company | `moved` X → Y when the new address / company belongs to a known client Y (domain / exact company key), else «уходит из X» (end the X link, company unknown) |
| P2 | **Same person, new address** | a new sender / participant whose NAME key equals an existing contact C (unique) and who writes from a domain of ANOTHER client Y (or discovery is about to create him at Y); stronger with the same phone / Telegram / signature position | `same_person` + `moved` X → Y (or `second_company` when C still writes from X in the last 60 days) |
| P3 | **Same address, other company** | C writes from a personal address (free mail) and the parser's company / signature for the author is client Y ≠ X | `second_company` or `moved` (the person decides) |
| P4 | **Parallel activity** | C exchanges mail from addresses of X AND Y within 60 days | `second_company` (consultant / part-time) |
| P5 | **Discovery** | the discovery preview would create a contact whose name key matches an existing contact of another client | shows «Возможно, это <C> из <X>» in the preview with the same three choices instead of a silent duplicate |

Confidence: `high` = exact address evidence (P1 with a new address of client Y; P2 with the same phone / Telegram); `medium` = name + other client's domain; name alone never proposes. A rejected «Это другой человек» is remembered for the pair (no new proposal for those two records).

## 5. User decision (R3)

Shown as a block «Контакт сменил компанию?» in the contact drawer and the company drawer of X and Y, and as a bell notification to the responsible members (Q5, Q6). Evidence: the message(s) with a quote, the addresses, the dates.

| Choice | Effect |
|---|---|
| **«Перешёл в Y»** | X link → `former` (`ended_at` = the evidence date, `end_reason` «Перешёл в Y»); Y link → `current`, primary, relation (default `employee`), `started_at`; if a second record of the same person exists → merge (§3.3); the X address → `old` |
| **«Работает с обеими»** | both links `current`; relation of the Y link (`consultant` default, editable); the person picks the primary |
| **«Это другой человек»** | nothing changes; the pair is remembered |
| **«Не сейчас»** | stays pending |

Manual at any time in the contact drawer, block «Компании»: «Добавить компанию» (company, relation, since), «Больше не работает здесь» (date, reason), «Сделать основной», edit dates / position.

## 6. Display (R2)

- **Contact drawer**: block «Компании» — current links (primary first, relation, position, since) and «Ранее» (company, period, «перешёл в …»). Badge «Перешёл из X» for 90 days.
- **Company drawer → «Контакты»**: current contacts; group «Бывшие» (period, «теперь в Y» as a link); a two-company contact shows «также: Y (консультант)».
- **Contacts list**: the company column = primary («+1» when more current links); the company filter matches every CURRENT link; toggle «Включая бывших» (Q11).
- **AI chat**: the contact detail includes the link history.

## 7. Effects on the engine

- **Topics**: a contact with several current links → the company is chosen by the message's address (domain of Y vs X) or signature; old topics stay where they are (history is not rewritten).
- **Deals**: accepted «Перешёл» → open deals of X with this `deal_contact` get the existing risk check (DM lost without handover) and a line «Контакт перешёл в Y» in the deal journal; the drawer offers «Заменить контакт в сделках X» (Q9). No automatic change of deals.
- **New company Y**: when Y is a client, an accepted move creates a topic «<Y> — знакомый контакт: перешёл из <X>» (relationship chance, no deal; Q10). When Y is not a client yet, the proposal offers «Создать компанию Y» (potential).
- **Attribution, documents, custom fields**: unchanged; they follow `contact.client_id` (primary) unless they need history.

## 8. API

`GET /api/contacts/[id]/links` (links + addresses + pending proposals + journal; former links carry their company's open deals with this person); `POST /api/contacts/[id]/links` (add / end / primary / edit — `linkId: "implicit"` for the implicit link / addAddress / removeAddress / addressStatus / replaceInDeals); `GET /api/clients/[id]/contact-links` (current / former / proposals); `GET /api/contacts?clientId=&includeFormer=1`; `POST /api/contact-link-proposals/[id] { decision: moved | both | other_person | dismissed, relation?, primary? }`; `POST /api/contacts/merge { keepId, mergeId }`. Any member of the org (Q5). Server `src/server/contact-links.ts` (org-explicit + session gate), pure rules `src/lib/contact-links.ts` (unit-tested).

## 9. Acceptance checks

1. A contact of X sends a farewell with a new address at client Y → proposal «Перешёл в Y» with the quote; «Перешёл» makes X former and Y current-primary; both companies show it (former / current).
2. The same person writes later from the new address → no duplicate contact; the topic resolves to Y.
3. A consultant writes from X and Y addresses within a month → proposal «Работает с обеими»; accepted → two current links, the chosen primary; the contacts list shows «+1».
4. «Это другой человек» → no new proposal for that pair.
5. Merge moves addresses, links, deal contacts, tasks, topics, documents and custom values; old references to the merged id resolve to the kept contact.
6. Another org's contact / company ids → 404.
7. Existing contacts (no backfill): one implicit current primary link each; every list and the engine behave as before; no row is written until a change.

## 10. Built (2026-11-15)

| Part | Where |
|---|---|
| Tables `contact_company_link`, `contact_address`, `contact_link_proposal` (unique `pair_key` per org = one proposal per pair ever; «Это другой человек» stays as `rejected`), `contact_link_event` (journal), column `contact.merged_into_contact_id` | `src/db/schema.ts`, migration `0039_contact_company_links` |
| Pure: value lists + labels, `effectiveLinks` (implicit link), `planDecision`, `detectFarewell`, rules `evaluateItemRules` (P1–P4), API types | `src/lib/contact-links.ts` + `contact-links.test.ts` |
| Server: views, manual actions, `decideProposal`, `mergeContacts`, `resolveMergedContactId`, `scanItemForContactLinks`, `proposeFromDiscovery` (P5), indexes for matching, bell list | `src/server/contact-links.ts` |
| Topic for Y (Q10): process instance of `CONTACT_NEW_KNOWN_ORG` through the phase 8 store, key `contact:<id>:moved_to:<clientId>`, topics mode `shadow` / `on` only | `src/server/topics/contact-moved.ts` |
| API | `GET/POST /api/contacts/[id]/links`, `GET /api/clients/[id]/contact-links`, `POST /api/contact-link-proposals/[id]`, `POST /api/contacts/merge`; `GET /api/contacts?includeFormer=1`; rows carry `otherCompanies` |
| UI | contact drawer block «Компании» (`contact-companies-block.tsx`: proposals, links, «Ранее», addresses, «История», «Объединить с…»); company drawer / page «Контакты» (`client-contact-links.tsx`: proposals, «также: …», «Также работают с компанией», «Бывшие»); `/contacts` «+N» + «Включая бывших»; bell type `contact_link`; discovery hint «Возможно, это … из …» (also skipped by the «магия» auto-select) |

Implementation notes:
- **Rules run** after a successful parse of a ROOT item (`parseSourceItem`, every org) and again after signal extraction when the item has `CONTACT_LEAVING`. Text = the author's own part of `## Content` (quotes removed). Bounce / auto-reply items only feed P1. Never throws.
- **P1** new address = an email in the author's text that is not ours and not a known contact; its client by address row, else by a unique non-free-mail domain (client website / email, contacts' addresses). **P2 / P4** = a participant (not ours) at client Y's domain whose name key (or native name) matches exactly ONE other contact C with a company ≠ Y; `same_person` when the address is already a second record at Y (or without company); P4 when C wrote from an X address in the last 60 days (search of item metadata). **P3** = a free-mail author C; the item's `organizations` resolve to exactly one known client, not C's. **P5** = discovery candidate with the same name as a contact of another company AND a domain of a known client Y; left unchecked → proposal; checked → a new contact.
- **«Перешёл»**: X links → former (date of the evidence, «Перешёл в Y» / «Больше не работает»), Y → current primary (or a former Y link reopened); X addresses → old; a new email becomes `contact.email` (the old one → address `old` at X); a candidate record is merged in; open deals of X with this contact get a `deal_activity` note and `state_dirty` (the existing risk check runs). **«Работает с обеими»**: Y added (default «Консультант / подрядчик»), primary as chosen. **«Не сейчас»** hides for 7 days. «Создать компанию Y» creates a client (status `initial`, website from the address domain).
- **Contact edit form**: a company change of a contact WITH link rows corrects the primary link in place (not a move); without rows it only writes `client_id` as before.
- **Matching** (topics counterparty, discovery, rules, document auto-link A1) also reads `contact_address`; a contact with several current companies resolves to the company of the message's address (address row, else domain), else the primary.
- **Merge** moves addresses (+ the merged primary email / phone), links, aliases + names, empty custom values, `deal_contact`, `card_contact`, tasks, topics, `source_item_subject`, document links, proposals and journal; the merged row → `deleted` + `merged_into_contact_id`; `GET /api/contacts?id=<merged>` returns the kept contact.
- **Discovery «магия»** (auto-select) skips P5 candidates like the dialog does, so it never creates the duplicate silently.
- **«Заменить в сделках»** (Q9): a former link shows the open deals of that company where the person is still a deal contact; the action `replaceInDeals` puts a current contact of that company in (same role) or removes the person, with a `deal_activity` note and `state_dirty`.
- Limit: the topics counterparty matches extra addresses by EMAIL only (Telegram / phone addresses are stored and shown, used by P2 for the phone check).

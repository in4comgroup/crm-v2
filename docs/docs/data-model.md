# Data model

[Back to index](./README.md)

Source: `src/db/schema.ts` (Drizzle). Database: Neon Postgres. 33 tables.
Column names below use the TypeScript (camelCase) names; the SQL columns are
snake_case (for example `organizationId` → `organization_id`).

FK behaviour notation: **cascade** (child deleted with parent), **set null**,
**restrict** (parent delete fails while children exist).

## 1. Auth and tenancy

Managed mostly by better-auth (`src/lib/auth.ts`).

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `user` | A person who can sign in | `email` (unique), `role` (platform role: `user` / `admin`; code also treats `agent` as a service-account role), `banned`, `department`, `image` (URL, never a data URL) |
| `session` | Login session | `token`, `userId`, `activeOrganizationId` / `Name` / `Slug` (the tenant context), `impersonatedBy`. A legacy `activeOrganizationLogo` column still exists but is no longer filled. |
| `account` | better-auth credential record per user/provider | `password` column remains in the schema but password login is removed |
| `verification` | One-time values (OTP codes) | `identifier`, `value`, `expiresAt` |
| `organization` | The tenant | `name`, `slug` (unique), `logo` (resized data URL), `webUrl`, `address`, `email`, `phone`, `metadata` |
| `member` | User ↔ org membership | `organizationId`, `userId`, `role` (enum `role`: `member` / `admin` / `owner`) |
| `invitation` | Pending invite to an org | `email`, `role`, `status`, `expiresAt`, `inviterId` |
| `apikey` | better-auth API keys (`apiKey` plugin) | `key`, rate-limit fields, `permissions`; exposed by `/api/auth/keys` |

## 2. CRM entities (companies, contacts, tasks, identity)

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `client` | A company (UI: «Компания») | `name`, `namePhys` (person behind a non-company client), `email`, `phone`, `address`, `webUrl`, `currency`, `aliases` (text[]), `funnelPhase`, `status` (`entity_status`), `customFields` (jsonb), `enrichmentStatus`, `enrichmentCandidates` (jsonb), `userId` (creator), `organizationId` |
| `contact` | A person | `name` (technical/envelope name), `nameNative` (local-script name), `aliases`, `email`, `phone`, `position`, `clientId` → `client` (**set null**), `status` |
| `task` | Follow-up work | `type`, `priority`, `status`, `userId` (creator), `assigneeId`, `clientId` / `contactId` / `dealId` (all optional, **set null**), `dueDate` (not null) |
| `discovery_blocklist` | Org dictionary of entities discovery must ignore | `kind` (`blocklist_kind`), `matchKey` (normalised), `label`, `note`, `sourceItemId`; unique `(org, kind, matchKey)` |
| `org_identity_entry` | Extra names / websites / addresses that mean "our own org" | `kind` (`org_identity_kind`), `matchKey`, `label`, `note`; unique `(org, kind, matchKey)` |

## 3. Deals

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `deal_funnel_stage` | Funnel stages | `name` (English, stable key), `displayName` (org rename), `closureProbability` (numeric 0–1), `sortOrder`, `isSystem`, `ownerOrganizationId`, `isActive`, `isPrePipeline`, `isHidden` |
| `deal` | Sales opportunity | `name`, `description`, `funnelStageId` (**restrict**), `clientId` (**restrict**), `value` (numeric), `currency`, `status` (`deal_status`), `position` (fractional index for manual order in a column), `reasoning` / `changes` (LLM provenance, card display), `lastMovedBy` (`user` / `agent`) |
| `deal_contact` | Deal ↔ contact (many-to-many) | PK `(dealId, contactId)`, `role` (`deal_contact_role`) |
| `deal_activity` | Append-only deal journal | `dealId`, `actor` (`user` / `agent`), `actorUserId`, `fromStageId`, `toStageId`, `note`, `reasoning`, `createdAt`. Source of the drawer «Хронология» and the «Лента решений» feed. |

Stage resolution is **org-or-system**: if the org has its own active stages, only
those are used; otherwise the system stages (seeded: Qualification 0.05,
Discovery 0.20, Pilot 0.50, Proposal 0.60, Negotiations 0.80, Closed 1.0,
Rejected 0.0).

## 4. Catalog and orders

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `product` | Catalog item | `name`, `category`, `price` (numeric), `webPageUrl`, `imageUrl`, `totalStock`, `accountingMetadata` (jsonb: code, barcode), `additionalMetadata` (jsonb: color, country, region, …), `stockMetadata` (jsonb: per-location stock), `status` |
| `product_alias` | Brand alias dictionary for search | `aliasNorm` → `canonical`, `kind` (default `brand`); unique `(org, aliasNorm)` |
| `order` | Client order | `orderDate`, `description`, `status` (`order_status`), `totalAmount` (pre-discount subtotal), `discountPercent` (snapshot of the client's discount), `currency` (default `RUB`), `clientId` (**restrict**), `userId` |
| `order_item` | Order line | `orderId` (**cascade**), `productId` (**restrict**), `quantity`, `unitPrice` (snapshot), `positionPrice` |
| `order_access_link` | Guest confirmation link grant | `orderId` (**cascade**), `tokenHash` (sha256, unique — raw token never stored), `recipientEmail`, `status` (`order_link_status`), `expiresAt`, `lastAccessedAt`, `confirmedAt`; partial unique index: at most one `active` grant per order |
| `order_request` | One pasted client message for "order from request" | `rawText`, `comment`, `status` (`order_request_status`), `parseError`, `clientId` (**restrict**), `orderId` (**set null**) |
| `order_request_item` | One parsed intent in that message | `requestId` (**cascade**), `ordinal`, `rawSnippet`, `label`, `mode`, `filters` (jsonb), `searchPhrase`, `searchTerms` (text[]), `quantityHint`, `status` |

Derived, not stored: order discount amount and discounted total
(`computeOrderDiscount` in `src/lib/orders-format.ts`).

## 5. Sources and parsing

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `source_template` | Platform catalogue of source kinds | `provider`, `type`, `name`, `defaultProviderConfig`, `defaultAutomatedParsingIsAllowed`, `isDefault` (auto-created for new orgs), `isVisibleToOrgs`, `status` |
| `source` | One configured channel | `templateId` (**set null**), `provider`, `type` (`external` / `internal`), `providerConfig` (jsonb, non-secret ids such as `driveId`, `spaceId`, `mailbox`, `telegramOffset`), `credentialsRef` (AES-256-GCM ciphertext), `ownerOrganizationId`, `isSystem`, `automatedParsingIsAllowed`, `status`, `lastSyncedAt` |
| `source_item` | One ingested unit | `sourceId`, `organizationId` (denormalised), `externalId` (unique per source), `externalType` (`source_item_kind`), `parentSourceItemId` (self FK, **cascade**), `threadExternalId`, `filename`, `mimeType`, `metadataJson` (jsonb), `sourceCreatedAt`, `parseStatus`, `parseError`, `parsedMarkdown` (until uploaded), `orgAttribution`, `r2UploadStatus`, `markdownR2Key`, `discoveryScannedAt`, `cardAnalysisScannedAt`, `dealAnalysisScannedAt` |
| `pipeline_run` | One daily-pipeline execution | `trigger`, `status`, per-phase counters (sync / parse / upload), `errorsJson` (bounded list) |

`metadata_json` holds two things that are **merged**, never overwritten:
sync-time provider fields (subject, from/to, participants, raw text …) and
parse-time analysis fields (summary, companies, organizations, mentionedPeople,
participantDetails, orgAttribution evidence …). Discovery, cards, search and
the AI chat read these fields. The full Markdown body is not in
`metadata_json`; it is in `parsed_markdown` or in R2.

The three `*_scanned_at` columns are per-feature "already looked at" stamps.
Re-parsing an item clears them so the item is re-analysed.

## 6. Cards, rules and notifications

| Table | Purpose | Key columns / relations |
| --- | --- | --- |
| `rule` | Stored LLM prompt | `name`, `content`, `type` (`System` / `Custom`), `userId`, `organizationId`, `isDeleted` |
| `card` | LLM signal | `priority`, `category`, `message` (jsonb: `analysis`, `recommendation`, optional `taskTitle`, `orderRequest`), `accepted`, `rejectionReason`, `sourceItemId` (**set null**), `ruleId` (**set null**), `resultTaskId` / `resultOrderId` (**set null**) |
| `card_client` | Card ↔ company | PK `(cardId, clientId)` |
| `card_user` | Card ↔ involved org member (not the creator) | PK `(cardId, userId)` |
| `card_contact` | Card ↔ external contact (matched by sender email) | PK `(cardId, contactId)` |
| `notification_read_state` | Per-user "last seen" for the header bell | `organizationId`, `userId`, `lastSeenAt` |

## 7. AI model registry

Spec: `docs/specs/models/`. Vendor-neutral: column names and units follow the
models.dev schema; gateway-specific data only in jsonb (`raw`, `cost_raw`).

| Table | Purpose | Key columns |
| --- | --- | --- |
| `ai_gateway` | One row per AI gateway (seed: `vercel`) | `adapter`, `catalog_sources` (ordered; first is authoritative), `models_dev_provider_id`, `is_enabled`, `is_default` (one), `config` (non-secret), `credentials_env` (env var name, never the key), `last_synced_at`, `last_sync_error` |
| `ai_model` | Every model of every gateway, mirrored by the catalog sync. Never deleted | PK (`gateway_id`, `model_id`); `vendor`, `type`, capability booleans (`tool_call`, `structured_output`, `web_search`, `reasoning`, …), `input_modalities`, `limit_context`, `cost_*` (USD per 1M tokens; web search per 1,000), `cost_raw`, `zdr`, `is_available`, `field_sources`, `raw` |
| `ai_model_price_history` | One row per price change of a model (reporting) | `gateway_id`, `model_id`, `valid_from`, `cost_*` |
| `ai_process_assignment` | Admin's model choice per AI process (the process catalog itself is code: `src/server/ai/processes.ts`; no row = code default) | `process_key` (PK), `gateway_id`, `primary_model_id`, `fallback_model_ids` (≤3, ordered), `allowed_model_ids` (user-selectable processes), `settings`, `updated_by_user_id` |
| `ai_usage_event` | AI usage ledger: one row per model call (OTel GenAI column names). No FKs on purpose (outlives deleted orgs/users) | `organization_id`, `user_id`, `process_key`, `request_model`, `response_model`, `response_id(s)`, `status`, token counts, `web_search_count`, `steps`, `duration_ms`, `cost_estimate_usd`, `cost_actual_usd` (exact, from the gateway), `markup_percent` |
| `platform_setting` | Platform-wide settings, key → jsonb (keys, types, defaults declared in `src/server/platform-settings.ts`; no row = default). Today: `ai.markup_percent`, `ai.policy.zdr_only`, `ai.policy.no_training_only`, `ai.policy.allowed_vendors` | `key` (PK), `value`, `updated_by_user_id`, `updated_at` |
| `platform_setting_log` | Append-only change log of platform settings | `key`, `old_value`, `new_value`, `changed_by_user_id`, `changed_at` |
| `ai_process_assignment_log` | Append-only change log of assignments | `process_key`, `changed_by_user_id`, `changed_at`, `before`, `after` (jsonb snapshots; `after` null = reset) |

## 7a. Signals registry and topics (in progress)

Spec: `docs/specs/topics/`. Signals registry (DB is the master after the seed
migration `0012`): `signal_pack`, `signal_block`, `signal_category` (code PK;
all parameters incl. Russian texts, cues, anti-cues, weight, class, kind,
stage, profile, closes, date gate, trigger rule), `signal_attribute`,
`signal_relation`, `signal_pack_override`, per-org `organization_signal_pack` /
`organization_signal_override`, `signal_stage_rule` (org NULL = pack template),
`deal_risk_type` + per-org `deal_risk_stage_guard`, `signal_taxonomy_version` +
`signal_registry_change` (every save = new version + change rows). Topics phase
0: `org_setting` (+ log; `topics.enabled`, `ai.budget.daily_usd`), `topics_run`,
`topics_golden_item`, `topics_eval_result`.

## 8. Admin and audit

| Table | Purpose | Key columns |
| --- | --- | --- |
| `teardown_log` | Append-only audit of admin source teardowns | `organizationId`, `sourceId`, `sourceName`, `adminUserId`, `counts` (jsonb) |

## Important enums

| Enum | Values |
| --- | --- |
| `role` (org) | `member`, `admin`, `owner` |
| `entity_status` (client, contact, product) | `active`, `suspended`, `initial`, `deleted`, `blocked` |
| `funnel_phase` (client) | `awareness`, `interest`, `decision`, `action`, `retention` |
| `deal_status` | `active`, `cancelled`, `deleted` |
| `deal_contact_role` | `decision_maker`, `influencer`, `expert`, `initiator`, `economic_buyer`, `champion`, `blocker`, `user`, `gatekeeper` |
| `task_type` / `task_priority` / `task_status` | `meet, call, email, offer, docs, support, other` / `low, medium, high` / `todo, in_progress, done, closed` |
| `card_priority` / `card_category` | `normal, high` / `client_activity, colleagues_activity, business_info, action_required, ambiguity, data_intelligence, momentum, log_only, new_order, support` |
| `order_status` | `draft`, `awaiting_client`, `confirmed`, `finalized`, `cancelled` |
| `order_link_status` | `active`, `used`, `revoked`, `expired` |
| `order_request_status` / `_item_mode` / `_item_status` | `parsing, ready, assembling, done, abandoned` / `explicit, discovery` / `pending, added, skipped` |
| `source_provider` | `nylas`, `imap`, `gchat`, `gdrive`, `dropoff`, `whatsapp`, `aichat`, `telegram` |
| `source_type` / `source_status` | `external, internal` / `active, inactive` |
| `source_item_kind` | `email`, `chat_message`, `drive_file`, `dropoff_file`, `attachment`, `inline_image`, `derived_audio`, `aichat_session` |
| `parse_status` | `pending`, `processing`, `complete`, `failed`, `skipped` |
| `r2_upload_status` | `pending`, `complete`, `failed` |
| `org_attribution` | `own_org`, `external`, `unknown` |
| `blocklist_kind` | `email`, `domain`, `company`, `person` |
| `org_identity_kind` | `name`, `website`, `address` |
| `enrichment_status` | `enriched`, `review`, `no_match` (NULL = not processed yet) |
| `rule_type` | `System`, `Custom` |
| `pipeline_run_trigger` / `_status` | `cron, manual` / `running, success, failed` |

## Conventions

- **Soft delete through `entity_status`.** Clients and contacts are never hard
  deleted by the UI. `deleted` hides a row; discovery treats it as absent and,
  on re-scan, **revives the same row** (keeps its id and links). `blocked` also
  hides it but is never revived while the blocklist entry exists. `initial`
  marks auto-discovered rows not yet reviewed. `suspended` = archived.
- **Other soft deletes.** Deals use `deal.status` (`cancelled` = lost,
  `deleted` = test/mistake). Tasks use `status = closed`. Rules use `isDeleted`.
  Cards have no soft delete: rejection is the "dismiss" state. Sources and
  templates use `status = inactive`.
- **Restrict FKs protect business history.** `deal.clientId`, `order.clientId`,
  `order_request.clientId`, `order_item.productId` and `deal.funnelStageId` are
  `restrict`, so deleting a referenced row fails loudly.
- **`client.custom_fields` (jsonb).** Extensible per-client bag, typed in
  `src/lib/client-custom-fields.ts` and validated in `src/server/clients.ts`.
  Keys today: `type` (only for one specific org), `discount` (whole percent
  0–100, used for orders), `companyKind` (`supplier` / `partner`, drives the
  Companies tabs). Unknown keys are dropped by the server.
- **Denormalised `organization_id` on `source_item`**, copied from the source
  at insert / parse, so tenant filters need no join.
- **Snapshots on orders.** `order_item.unit_price` and `order.discount_percent`
  are copied at write time; catalog price changes do not rewrite old orders.
- **Numeric columns** (`price`, `value`, `total_amount`, `closure_probability`)
  come back from Drizzle as strings; server code parses them.
- **Search V2 columns live outside `schema.ts`.** The `product` table has
  generated columns (`name_norm`, `region_norm`, `is_drink`, `is_gift`,
  `search_vector`) and 4 indexes defined only in the custom migration
  `migrations/0002_search_v2_product_columns.sql`; the SQL functions they use
  (`translit_cyr_lat`, `immutable_unaccent`, `to_or_tsquery`) are in
  `migrations/0000_extensions_and_functions.sql`. Global search also uses these
  functions. They are kept out of `schema.ts` so Drizzle `select()` does not
  load them — see [operations.md](./operations.md#database-changes).
- **IDs** are text primary keys (UUIDs or better-auth ids), not serials.
- **Timestamps**: most tables have `createdAt` / `updatedAt`; `updatedAt` is
  bumped on update by Drizzle `$onUpdate` where declared.

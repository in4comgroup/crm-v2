import { relations, sql } from "drizzle-orm"
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  bigint,
  jsonb,
  numeric,
  uniqueIndex,
  pgEnum,
  primaryKey,
  foreignKey,
  date,
  AnyPgColumn,
} from "drizzle-orm/pg-core"
import type { ClientCustomFields } from "@/lib/client-custom-fields"
import type { OrderRequestItemFilters } from "@/lib/order-request"

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  // Sales department the user belongs to («Отдел 1» / «Отдел 2» / …). Free-form
  // text, nullable — it's an org-agnostic label used to roll salespeople up into
  // teams on the Analytics page (`src/server/analytics.ts`).
  //
  // Deliberately NOT registered in better-auth's `user.additionalFields`: it is
  // never needed at auth time, and every field better-auth returns on the
  // session gets serialised into the signed session cookie (see the org-logo
  // note under `session.additionalFields` in src/lib/auth.ts). Analytics reads
  // it straight from this column via drizzle.
  department: text("department"),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeOrganizationName: text("active_organization_name"),
    activeOrganizationLogo: text("active_organization_logo"),
    activeOrganizationSlug: text("active_organization_slug"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    webUrl: text("web_url"),
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)]
)

export const role = pgEnum("role", ["member", "admin", "owner"])

export type Role = (typeof role.enumValues)[number]

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ]
)

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
)

export const ruleType = pgEnum("rule_type", ["System", "Custom"])

export type RuleType = (typeof ruleType.enumValues)[number]

export const rule = pgTable(
  "rule",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    content: text("content").notNull().default(""),
    type: ruleType("type").notNull().default("Custom"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("rule_userId_idx").on(table.userId),
    index("rule_organizationId_idx").on(table.organizationId),
    index("rule_type_idx").on(table.type),
  ],
)

export const funnelPhase = pgEnum("funnel_phase", [
  "awareness",
  "interest",
  "decision",
  "action",
  "retention",
])

export type FunnelPhase = (typeof funnelPhase.enumValues)[number]

// `initial` is reserved for clients auto-created by the company-discovery
// scan on /clients — flags them for human review before activation. The
// existing manual "New client" form keeps creating with `active`.
// `deleted` is a soft-delete for test artifacts / mistakes: hidden from the
// lists by default AND excluded from discovery dedup/matching, so a fresh
// re-scan re-creates the entity (mirrors the deal `deleted` status). This is
// the only status the discovery scan treats as "does not exist".
export const entityStatus = pgEnum("entity_status", [
  "active",
  "suspended",
  "initial",
  "deleted",
  // `blocked` — a real but business-irrelevant entity, suppressed by the
  // discovery blocklist (see `discovery_blocklist` + refs/blocklist.md).
  // Hidden from default lists and treated as ABSENT by discovery/dedup (like
  // `deleted`), but NOT auto-revived — the dictionary keeps it suppressed.
  "blocked",
])

export type EntityStatus = (typeof entityStatus.enumValues)[number]

// Discovery blocklist entry kind (see refs/blocklist.md). `match_key` is the
// normalised canonical form per kind: lower(email) | bare host | companyMatchKey
// | personMatchKey.
export const blocklistKind = pgEnum("blocklist_kind", [
  "email",
  "domain",
  "company",
  "person",
])

export type BlocklistKind = (typeof blocklistKind.enumValues)[number]

// Own-organisation identity registry entry kind (see src/app/AGENTS.md §
// "Own-organisation identity registry"). `match_key` is the normalised
// canonical form per kind: companyMatchKey | bare host | addressMatchKey.
export const orgIdentityKind = pgEnum("org_identity_kind", [
  "name",
  "website",
  "address",
  // Identity spec I1 (docs/specs/identity): own mail domain with no website,
  // a shared mailbox (sales@ …) that is not a user, and a staff member's
  // extra address (personal email / Telegram @handle / phone; `user_id` set).
  "email_domain",
  "mailbox",
  "person",
])

export type OrgIdentityKind = (typeof orgIdentityKind.enumValues)[number]

// Order lifecycle. `draft` (internal) → `awaiting_client` (handed to the
// client for review/confirm via a guest link) → `confirmed` (back to
// internal) → `finalized` (pushed to accounting). `cancelled` is terminal.
// See `refs/spec-guest-order-link.md` for the ownership model these statuses
// drive (the guest-link layer itself is a later step).
export const orderStatus = pgEnum("order_status", [
  "draft",
  "awaiting_client",
  "confirmed",
  "finalized",
  "cancelled",
])

export type OrderStatus = (typeof orderStatus.enumValues)[number]

// Guest order-confirmation link grant lifecycle (see
// `refs/spec-guest-order-link.md`). `active` = a live link; `used` = the
// client confirmed through it; `revoked` = killed by the internal user or
// superseded by a re-send; `expired` = past its window. Exactly one `active`
// grant may exist per order (enforced by a partial unique index).
export const orderLinkStatus = pgEnum("order_link_status", [
  "active",
  "used",
  "revoked",
  "expired",
])

export type OrderLinkStatus = (typeof orderLinkStatus.enumValues)[number]

// LLM-assisted "order from request" flow (see `src/app/AGENTS.md` §
// "Order from request"). A pasted client request is parsed into intent items;
// the rep walks a wizard, one item per step, assembling a draft order.
//
// `order_request` lifecycle: `parsing` (LLM split in progress) → `ready`
// (items available, draft order minted) → `assembling` (rep walking the
// wizard) → `done` (handed off to the draft order's own lifecycle) /
// `abandoned` (rep dropped it). The draft `order` it builds owns the real
// order lifecycle; this status only tracks the assistant session.
export const orderRequestStatus = pgEnum("order_request_status", [
  "parsing",
  "ready",
  "assembling",
  "done",
  "abandoned",
])

export type OrderRequestStatus = (typeof orderRequestStatus.enumValues)[number]

// How an intent item maps onto the catalog. `explicit` = the text named a
// specific product (Cyrillic, often transliterated) → match by a Latin
// `searchPhrase`; quantity is usually given. `discovery` = a vague/category
// request → narrow with `filters`; quantity is rep-entered.
export const orderRequestItemMode = pgEnum("order_request_item_mode", [
  "explicit",
  "discovery",
])

export type OrderRequestItemMode = (typeof orderRequestItemMode.enumValues)[number]

// Per-step progress in the wizard. `pending` (not yet handled) → `added`
// (the rep added one or more lines from it) / `skipped` (rep moved past it).
export const orderRequestItemStatus = pgEnum("order_request_item_status", [
  "pending",
  "added",
  "skipped",
])

export type OrderRequestItemStatus =
  (typeof orderRequestItemStatus.enumValues)[number]

// Deal lifecycle axis — orthogonal to the funnel stage (which is a sales
// outcome). `active` is the default. `cancelled` is a real lost/withdrawn
// deal kept for win-loss analytics (surfaced via "Include cancelled").
// `deleted` is a test artifact / mistake: hidden from the board by default
// AND excluded from deal-discovery's identify/match/move logic, so a fresh
// re-scan can re-create it without colliding. Distinct from the funnel
// `Rejected` stage, which stays a real, visible sales outcome.
export const dealStatus = pgEnum("deal_status", [
  "active",
  "cancelled",
  "deleted",
  // Topics plan phase 5 (spec topics/01 §9.2): a status, not a stage — the
  // deal keeps its stage; `paused_until` / `pause_reason` say when / why.
  "paused",
])

export type DealStatus = (typeof dealStatus.enumValues)[number]

export const dealContactRole = pgEnum("deal_contact_role", [
  "decision_maker",
  "influencer",
  "expert",
  "initiator",
  "economic_buyer",
  "champion",
  "blocker",
  "user",
  "gatekeeper",
])
export type DealContactRole = (typeof dealContactRole.enumValues)[number]

// Batch web-enrichment state for a client (see refs/enrich-clients.md).
// NULL = never processed OR last run failed → the batch worklist (NULL is the
// resumability anchor). `enriched` = a match was applied (auto or via review),
// terminal. `review` = the name matched several companies → parked in the
// manual queue, with the options stored in `enrichment_candidates`. `no_match`
// = web search found nothing usable, terminal.
export const enrichmentStatus = pgEnum("enrichment_status", [
  "enriched",
  "review",
  "no_match",
])

export type EnrichmentStatus = (typeof enrichmentStatus.enumValues)[number]

// Local mirror of `ClientLookupCandidate` (src/server/clients.ts) so the
// schema module has no dependency on the server/LLM module. Stored in
// `client.enrichment_candidates` so the review dialog needs no new web call.
export type ClientLookupCandidateJson = {
  name: string
  email: string
  phone: string
  address: string
  webUrl: string
  confidence: "high" | "medium" | "low"
  whyMatch: string
}

export const client = pgTable(
  "client",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Name of the physical person behind the client when it isn't an
    // organisation (optional — orgs leave it null).
    namePhys: text("name_phys"),
    // Free-form note for the sales person to recognise this client.
    comment: text("comment"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    webUrl: text("web_url"),
    currency: text("currency").notNull().default("RUB"),
    // Extensible per-tenant custom fields (jsonb). Today only `type` is used,
    // and only for one org; every other org keeps an empty object. See
    // `src/lib/client-custom-fields.ts`.
    customFields: jsonb("custom_fields")
      .$type<ClientCustomFields>()
      .notNull()
      .default({}),
    // Org-defined custom field values («Поля», docs/specs/clients-contacts):
    // { "<custom_field.id>": value }. System keys stay in `custom_fields`.
    customValues: jsonb("custom_values").$type<Record<string, unknown>>().notNull().default({}),
    // Alternate spellings / synonyms for this company seen across sources
    // (cross-script + with/without legal form, e.g. ["Norleks", "Норлекс", "Norleks
    // INTER"]). Used by discovery to dedup a known client against new
    // candidates and to attribute contacts by company. Nullable; populated by
    // discovery + the edit form. Matched via `companyMatchKey`.
    aliases: text("aliases").array(),
    funnelPhase: funnelPhase("funnel_phase").notNull().default("awareness"),
    status: entityStatus("status").notNull().default("active"),
    // Batch web-enrichment bookkeeping (refs/enrich-clients.md). NULL =
    // unprocessed/failed (the worklist). Candidates are parked here only while
    // status='review' so the manual disambiguation dialog needs no new web call.
    enrichmentStatus: enrichmentStatus("enrichment_status"),
    enrichmentCandidates: jsonb("enrichment_candidates").$type<
      ClientLookupCandidateJson[]
    >(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // «Ответственный» (Responsible): the member who works with this company.
    // Defaults to `user_id` (the creator) on create; the org OWNER can set any
    // member; the responsible member (not owner) can only hand the company
    // over to an owner (src/server/client-responsible.ts). Topics: the deal
    // owner rule and the topic assignee fall back to it.
    responsibleUserId: text("responsible_user_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    responsibleChangedAt: timestamp("responsible_changed_at"),
    responsibleChangedByUserId: text("responsible_changed_by_user_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    // Set while a handover to the owner waits for the owner's decision (the
    // member who handed it over); cleared when an owner assigns the company.
    responsibleHandoverFromUserId: text("responsible_handover_from_user_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("client_organizationId_idx").on(table.organizationId),
    // Custom field filters on /clients (`?`, `?|` on custom_values).
    index("client_custom_values_gin").using("gin", table.customValues),
    index("client_userId_idx").on(table.userId),
    index("client_responsible_idx").on(table.organizationId, table.responsibleUserId),
    index("client_status_idx").on(table.status),
    index("client_enrichmentStatus_idx").on(table.enrichmentStatus),
  ],
)

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    // Technical / envelope name — for email contacts this is the admin-defined
    // display name from the message envelope (often English/romanized). Stable
    // identity; what address books match on. Set by discovery + manual create.
    name: text("name").notNull(),
    // Native-language name extracted from email body content (signature,
    // sign-off, letterhead) by the parser, in its original script (German,
    // Chinese, …). Nullable — only populated when the parser confidently pairs
    // a body name to this contact's envelope email. See
    // `metadata_json.participantNativeNames` + `applyDiscovery`.
    nameNative: text("name_native"),
    // Alternate name spellings / order variants / nicknames seen across
    // sources (e.g. ["Богданов Евгений", "Евгений Богданов", "Женя"]). Used
    // for search + dedup. Nullable; populated by discovery + the edit form.
    // Matched via `personMatchKey`.
    // Org-defined custom field values («Поля», docs/specs/clients-contacts).
    customValues: jsonb("custom_values").$type<Record<string, unknown>>().notNull().default({}),
    aliases: text("aliases").array(),
    phone: text("phone"),
    email: text("email"),
    position: text("position"),
    // = the client of the PRIMARY CURRENT link (docs/specs/clients-contacts/04
    // §3.1). Written together with `contact_company_link` by
    // src/server/contact-links.ts. A contact with `client_id` and no link rows
    // = one implicit current primary link (no backfill, Q12).
    clientId: text("client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    status: entityStatus("status").notNull().default("active"),
    // Set when this record was merged into another contact (status = deleted);
    // old references resolve to the kept contact.
    mergedIntoContactId: text("merged_into_contact_id").references((): AnyPgColumn => contact.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_organizationId_idx").on(table.organizationId),
    // Custom field filters on /contacts (`?`, `?|` on custom_values).
    index("contact_custom_values_gin").using("gin", table.customValues),
    index("contact_userId_idx").on(table.userId),
    index("contact_clientId_idx").on(table.clientId),
    index("contact_status_idx").on(table.status),
  ],
)

// Org-scoped blocklist dictionary (see refs/blocklist.md). The AUTHORITATIVE
// source of truth for suppressing business-irrelevant entities BEFORE discovery
// materialises a client/contact row (a row flag can't do that — most blocked
// entities have no row yet, and blocking is by domain/name, not by row). Keyed
// the same way the engines read `metadata_json`: lower(email) / bare host /
// companyMatchKey / personMatchKey.
export const discoveryBlocklist = pgTable(
  "discovery_blocklist",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: blocklistKind("kind").notNull(),
    // Normalised canonical form (the dedup key): lower(email) | bare host |
    // companyMatchKey | personMatchKey. Makes "ООО Норлекс" / "Norleks" / "Норлекс" collapse
    // to one entry.
    matchKey: text("match_key").notNull(),
    // Raw value as entered, for display.
    label: text("label").notNull(),
    // Optional operator "why" note.
    note: text("note"),
    // Provenance — which source item raised it, if blocked from a candidate.
    sourceItemId: text("source_item_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("discovery_blocklist_organizationId_idx").on(table.organizationId),
    // Adding the same block twice is a no-op (onConflictDoNothing).
    uniqueIndex("discovery_blocklist_org_kind_key_uidx").on(
      table.organizationId,
      table.kind,
      table.matchKey,
    ),
  ],
)

// Own-organisation identity registry — the owner-curated list of extra names /
// synonyms, websites and postal addresses that mean "this is US, not a client".
// The `organization` profile columns (name / web_url / address / email) stay
// the PRIMARY identity; this table is purely additive, so an org can declare a
// second brand, a second domain, or a warehouse address
// without those single-valued columns having to hold a delimited blob.
//
// Read by the one «us» resolver `getOwnOrgContext` (src/server/identity/
// own-org.ts): discovery, parse-time own-org filtering and authorship
// attribution. Owner-managed in /account → «Профиль организации».
export const orgIdentityEntry = pgTable(
  "org_identity_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: orgIdentityKind("kind").notNull(),
    // Normalised canonical form (the dedup key): companyMatchKey for `name`,
    // bare host for `website`, addressMatchKey for `address`.
    matchKey: text("match_key").notNull(),
    // Raw value as entered, for display.
    label: text("label").notNull(),
    // Optional operator "why" note.
    note: text("note"),
    // Kind `person` only: the staff member the address belongs to, and the
    // channel of the address (email | telegram | phone; text validated in code).
    userId: text("user_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
    channel: text("channel"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("org_identity_entry_organizationId_idx").on(table.organizationId),
    index("org_identity_entry_user_idx").on(table.organizationId, table.userId),
    // Adding the same value twice is a no-op (onConflictDoNothing).
    uniqueIndex("org_identity_entry_org_kind_key_uidx").on(
      table.organizationId,
      table.kind,
      table.matchKey,
    ),
  ],
)

// Append-only audit of admin "source teardown" runs (see refs/source-teardown.md).
// Records the blast radius of each hard-delete so the destructive op is
// traceable. Never read by app logic. `source_id` / `source_name` are stored
// flat (no FK) so the log survives even if the source is later removed.
export const teardownLog = pgTable("teardown_log", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  sourceName: text("source_name").notNull(),
  adminUserId: text("admin_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  // { sourceItems, r2Objects, cards, clients, contacts, deals, tasks }
  counts: jsonb("counts").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const taskType = pgEnum("task_type", [
  "meet",
  "call",
  "email",
  "offer",
  "docs",
  // Customer-support task — created when an operator accepts a `support` card.
  "support",
  "other",
])

export type TaskType = (typeof taskType.enumValues)[number]

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"])

export type TaskPriority = (typeof taskPriority.enumValues)[number]

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
  "closed",
])

export type TaskStatus = (typeof taskStatus.enumValues)[number]

export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    type: taskType("type").notNull().default("other"),
    priority: taskPriority("priority").notNull().default("medium"),
    status: taskStatus("status").notNull().default("todo"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    // Optional Deal link. Tasks can be created in a deal context — losing
    // the deal (defensive `set null`; under the no-hard-delete policy this
    // never fires in practice) leaves the task standalone.
    dealId: text("deal_id").references((): AnyPgColumn => deal.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dueDate: timestamp("due_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("task_organizationId_idx").on(table.organizationId),
    index("task_userId_idx").on(table.userId),
    index("task_assigneeId_idx").on(table.assigneeId),
    index("task_clientId_idx").on(table.clientId),
    index("task_contactId_idx").on(table.contactId),
    index("task_dealId_idx").on(table.dealId),
    index("task_status_idx").on(table.status),
  ],
)

// ── Deals ──────────────────────────────────────────────────────────────
//
// `deal_funnel_stage` is the platform-wide funnel dictionary today
// (`is_system = true`, `owner_organization_id = null` on every seeded row).
// The `is_system` + `owner_organization_id` columns mirror the source-scope
// pattern so a future "let each org tune their own funnel" iteration is
// purely additive — insert per-org stage rows with `is_system = false` and
// `owner_organization_id = <orgId>`, and the listing query becomes
// `WHERE is_system = true OR owner_organization_id = $orgId`. Existing deals
// keep referencing whatever stage row they were created with — no migration.
//
// `closure_probability` is `numeric(4,3)` to fit values in [0.000, 1.000]
// without floating-point drift; Drizzle returns it as a string, the API
// layer parses to number on read.
export const dealFunnelStage = pgTable(
  "deal_funnel_stage",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    closureProbability: numeric("closure_probability", {
      precision: 4,
      scale: 3,
    }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(true),
    ownerOrganizationId: text("owner_organization_id").references(
      () => organization.id,
      { onDelete: "cascade" },
    ),
    isActive: boolean("is_active").notNull().default(true),
    // «Область 0» перед воронкой (контакт до запроса — холодные знакомства,
    // которые ведёт маркетинг): колонка на доске есть, но это ещё не стадия
    // сделки — бледная, вне прогноза (closureProbability = 0), и при этом
    // НЕ терминальная (вероятность 0 у обычной стадии значит «Rejected»).
    // Миграция: scripts/add-funnel-stage-pre-pipeline.ts.
    isPrePipeline: boolean("is_pre_pipeline").notNull().default(false),
    // Настройки стадии из диалога «Настройки стадий» на /deals. displayName —
    // то, что видит пользователь (null → русская подпись по `name`, см.
    // dealStageLabel); `name` НЕ переименовывается: по нему определяются
    // цвета колонок и терминальные Closed/Rejected. isHidden — колонка
    // скрыта с доски (сделки в ней тоже не показываются).
    // Миграция: scripts/add-funnel-stage-settings.ts.
    displayName: text("display_name"),
    isHidden: boolean("is_hidden").notNull().default(false),
    // Stage norm for the deal-card badge «N дн без активности»: the badge
    // turns red when the days since the deal's last activity exceed it.
    // null = the default (14 days, `DEFAULT_STALE_NORM_DAYS` in
    // src/lib/deal-activity.ts). Edited in «Настройки стадий».
    staleNormDays: integer("stale_norm_days"),
    // ── Custom funnel (docs/specs/funnel §3.1) ──
    // Role of the stage for the engine / board: area0 | active | won | lost
    // (text validated in code, src/lib/funnel/config.ts). Replaces the old
    // name-based «Closed» / «Rejected» checks. `code` = stable machine key per
    // org (s1…, won, lost, area0, st_…) used by templates / import / export.
    role: text("role").notNull().default("active"),
    code: text("code"),
    description: text("description"),
    entryCondition: text("entry_condition"),
    signalsHint: text("signals_hint"),
    // false = deals in this stage never count in the money forecast.
    inForecast: boolean("in_forecast").notNull().default(true),
    // stage = closure_probability of the stage; expert = deal.expert_probability.
    probabilityMode: text("probability_mode").notNull().default("stage"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deal_funnel_stage_ownerOrganizationId_idx").on(
      table.ownerOrganizationId,
    ),
    index("deal_funnel_stage_isSystem_idx").on(table.isSystem),
    index("deal_funnel_stage_isActive_idx").on(table.isActive),
  ],
)

export const deal = pgTable(
  "deal",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // LLM-discovery provenance (nullable; null for manually-created deals).
    // `reasoning`: one-sentence rationale the deal-discovery model gave for
    // creating the deal OR moving its funnel stage (refreshed on each
    // stage move). `changes`: a short description of what changed on a
    // stage move, based on the new source signal — empty/null for a freshly
    // created deal, and the deal's `description` is never rewritten by a move.
    // Written by the old name-based deal discovery (removed in topics plan
    // phase 12); kept as history and still surfaced on the deal card.
    reasoning: text("reasoning"),
    changes: text("changes"),
    // Who performed the LAST funnel-stage move: 'agent' (auto-applied agent
    // proposal or LLM deal-discovery UPDATE_STAGE) | 'user' (kanban drag /
    // move dialog) | null (never moved since this column landed). Drives the
    // «перевёл агент» badge on the kanban card AND the idempotency guard for
    // auto-applied proposals (the agent takes at most ONE unreviewed step per
    // deal — a deal it already moved is skipped until a human moves it again).
    // Added via scripts/add-deal-last-moved-by.ts (additive SQL, NOT
    // `drizzle-kit push`).
    lastMovedBy: text("last_moved_by"),
    // `restrict` rather than `cascade` / `set null`: stages and clients are
    // never hard-deleted in this app (soft-delete via flags). Restrict makes
    // an accidental hard-delete fail loudly instead of orphaning deals.
    funnelStageId: text("funnel_stage_id")
      .notNull()
      .references(() => dealFunnelStage.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    // Nullable — operators often create a deal before a value is quoted.
    value: numeric("value", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("RUB"),
    // Lifecycle status (see `dealStatus` enum). `cancelled` + `deleted` are
    // both soft-deletes hidden from the board by default; only `active` deals
    // participate in deal-discovery (identify / match / move). Distinct from
    // the funnel `Rejected` stage, which is a visible sales outcome.
    status: dealStatus("status").notNull().default("active"),
    // Fractional-indexing key for manual kanban ordering WITHIN a funnel
    // stage (column). Nullable: legacy rows + LLM-discovered deals may have no
    // key until first dragged; the board treats null as "unordered, sort to
    // the end by updatedAt". Set/refreshed by `moveDeal` on drag. See
    // `src/lib/kanban-move.ts` (computePosition) + `refs/kanban-spec.md`.
    position: text("position"),
    // ── Topics plan phase 5 (deal bridge, spec topics/01 §9.2) ──
    // Deal type from the org's list (`deal_type`, R13); null = untyped.
    dealTypeId: text("deal_type_id").references((): AnyPgColumn => dealType.id, { onDelete: "set null" }),
    pausedUntil: timestamp("paused_until"),
    pauseReason: text("pause_reason"),
    // Why the deal ended (won / lost / withdrawn / cancelled by the agent's undo).
    outcomeReason: text("outcome_reason"),
    // Badge «создал агент»: created by the topics engine (system actor).
    createdByAgent: boolean("created_by_agent").notNull().default(false),
    // ── Topics plan phase 5a (spec topics/01 §9.3): «Текущее состояние» —
    // stored text (≤ 3 sentences / 50 words), read by the board and drawer;
    // every version in `deal_state_version`. `state_dirty_at` = new deal
    // information arrived (R16 triggers); the deal-state phase picks dirty
    // deals after the debounce (`deals.stateDebounceMinutes`, 10).
    stateText: text("state_text"),
    stateSourceItemIds: text("state_source_item_ids").array(),
    stateUpdatedAt: timestamp("state_updated_at"),
    stateDirtyAt: timestamp("state_dirty_at"),
    // ── Custom funnel (docs/specs/funnel §3.4, §3.5) ──
    // «Экспертная вероятность» 0–100 % set by a person (forecast of stages
    // with probability_mode = expert); «Бюджет из брифа» = the client's figure,
    // never in the forecast; the reason code of the outcome (org reason lists).
    expertProbability: integer("expert_probability"),
    expertProbabilityByUserId: text("expert_probability_by_user_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    expertProbabilityAt: timestamp("expert_probability_at"),
    briefBudget: numeric("brief_budget", { precision: 14, scale: 2 }),
    outcomeReasonCode: text("outcome_reason_code"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deal_organizationId_idx").on(table.organizationId),
    index("deal_userId_idx").on(table.userId),
    index("deal_clientId_idx").on(table.clientId),
    index("deal_funnelStageId_idx").on(table.funnelStageId),
    index("deal_status_idx").on(table.status),
    // Composite index for the per-column ordered read (stage + manual order).
    index("deal_stage_position_idx").on(table.funnelStageId, table.position),
    // Auto-create dedupe (org + client + type + open status, spec §9.2).
    index("deal_org_client_type_idx").on(table.organizationId, table.clientId, table.dealTypeId),
    index("deal_org_state_dirty_idx").on(table.organizationId, table.stateDirtyAt),
  ],
)

// Per-org deal types (spec topics/01 §9.2, R13). Generic default codes
// (R22): new_location, listing, tender, supply_agreement, renewal — tenant
// data, created per org by src/server/deal-types.ts (never a migration).
// Stage rules name a type by `code` (`signal_stage_rule.deal_types`).
export const dealType = pgTable(
  "deal_type",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    labelRu: text("label_ru").notNull(),
    sort: integer("sort").notNull().default(0),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("deal_type_org_code_uq").on(table.organizationId, table.code)],
)

// Append-only журнал событий сделки (создание + каждый перевод стадии) —
// «Хронология» (drawer) и «Лента решений» (top bar) читают ОТСЮДА, а не из
// deal.changes (то поле — только для карточки, одно мутируемое значение,
// не история). Добавлено через scripts/add-deal-activity.ts (additive SQL,
// НЕ `drizzle-kit push`, см. root AGENTS.md § Commands).
export const dealActivity = pgTable(
  "deal_activity",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    // 'user' | 'agent' — как lastMovedBy на deal, не отдельный enum.
    actor: text("actor").notNull(),
    // Кто из людей совершил действие (null для агентских событий).
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // null у события создания сделки (нет «откуда»).
    fromStageId: text("from_stage_id").references(() => dealFunnelStage.id, {
      onDelete: "set null",
    }),
    toStageId: text("to_stage_id").references(() => dealFunnelStage.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    reasoning: text("reasoning"),
    // Topics plan phase 5: provenance of an engine move (spec §9.2) — the
    // topic, the item, the stage rule and the evidence quote.
    topicId: text("topic_id").references((): AnyPgColumn => topic.id, { onDelete: "set null" }),
    sourceItemId: text("source_item_id").references((): AnyPgColumn => sourceItem.id, { onDelete: "set null" }),
    ruleId: text("rule_id").references((): AnyPgColumn => signalStageRule.id, { onDelete: "set null" }),
    evidence: text("evidence"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("deal_activity_dealId_idx").on(table.dealId),
    index("deal_activity_topic_idx").on(table.topicId),
    index("deal_activity_createdAt_idx").on(table.createdAt),
  ],
)

// Many-to-many: deal ↔ contact. Composite PK doubles as the dedup index
// on (dealId, contactId). Cascading on either side keeps the join table
// clean if a parent is ever hard-deleted (not expected today).
export const dealContact = pgTable(
  "deal_contact",
  {
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    role: dealContactRole("role"),
  },
  (table) => [
    primaryKey({ columns: [table.dealId, table.contactId] }),
    index("deal_contact_contactId_idx").on(table.contactId),
  ],
)

export const cardPriority = pgEnum("card_priority", ["normal", "high"])

export type CardPriority = (typeof cardPriority.enumValues)[number]

export const cardCategory = pgEnum("card_category", [
  "client_activity",
  "colleagues_activity",
  "business_info",
  "action_required",
  "ambiguity",
  "data_intelligence",
  "momentum",
  "log_only",
  // The source message looks like a client product order. The card carries
  // the verbatim client message in `message.orderRequest` and renders a
  // "Create order" button that opens the New Order dialog on /products
  // prefilled with the client + that message (→ the order-from-request flow).
  "new_order",
  // A customer-support request: complaint about product quality, a delivery
  // problem, a product issue/question. High priority; accepting it spawns a
  // `support`-type task. See `src/app/AGENTS.md` § "Support cards".
  "support",
])

export type CardCategory = (typeof cardCategory.enumValues)[number]

export const card = pgTable(
  "card",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    priority: cardPriority("priority").notNull().default("normal"),
    category: cardCategory("category").notNull(),
    // { analysis: string, recommendation: string } — produced by the
    // analysis pipeline that emits the card. Stored as JSON so the
    // shape can grow (e.g. supporting evidence links) without a
    // migration.
    message: jsonb("message").notNull().default({}),
    accepted: boolean("accepted").notNull().default(false),
    rejectionReason: text("rejection_reason"),
    // Source item whose analysis produced this card. ON DELETE SET NULL
    // so card history survives if the underlying item is purged.
    sourceItemId: text("source_item_id").references(() => sourceItem.id, {
      onDelete: "set null",
    }),
    // Rule that fired to produce this card (old Custom-rule cards only —
    // kept as history; the generation and the /rules page were removed in
    // topics plan phase 12, the `rule` table stays as their record).
    ruleId: text("rule_id").references(() => rule.id, {
      onDelete: "set null",
    }),
    // What accepting this card's recommendation actually created — stamped
    // at acceptance time by the two flows that can produce a durable row:
    // the generic "Принять" → create-task dialog (resultTaskId) and the
    // new_order "Создать заказ" flow once a real order is minted
    // (resultOrderId, from either order-builder.tsx's persist() or
    // products/page.tsx's startAssembly — see dashboard-card.tsx's
    // handleAccept). At most one is ever set per card (a card has exactly
    // one recommendation). ON DELETE SET NULL — a later hard-delete of the
    // task/order shouldn't take the card's own accept/reject history with it.
    resultTaskId: text("result_task_id").references(() => task.id, {
      onDelete: "set null",
    }),
    resultOrderId: text("result_order_id").references(() => order.id, {
      onDelete: "set null",
    }),
    // ── Topic cards (topics plan phase 4, spec topics/01 §9.1). All null on
    // old Custom-rule cards (R10). Value lists are text validated in code
    // (src/lib/topics/cards.ts): kind topic | deal_proposal |
    // stage_confirmation | deal_link (spec topics/10); status open | accepted | rejected | superseded |
    // expired | closed. The old `accepted` boolean is written in parallel
    // (expand phase). Engine fields (score … taxonomy_version) are a
    // snapshot taken when the card is written (06 A8), never by the LLM.
    topicId: text("topic_id").references((): AnyPgColumn => topic.id, { onDelete: "set null" }),
    kind: text("kind"),
    status: text("status"),
    score: integer("score"),
    band: text("band"),
    displayProfile: text("display_profile"),
    signalClass: text("signal_class"),
    leadCode: text("lead_code"),
    // «Что изменилось» of the last UPDATE (≤ 16 words, Russian).
    sinceLast: text("since_last"),
    taxonomyVersion: integer("taxonomy_version"),
    // Card expiry moment (06 §7.3; working days from deadline / cycle start).
    expiresAt: timestamp("expires_at"),
    // Compact event view (≤ 3 events, spec §9.1 Q24-12) — written by the engine.
    events: jsonb("events"),
    rejectReasonCode: text("reject_reason_code"),
    decidedAt: timestamp("decided_at"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    // deal_proposal / stage_confirmation (phase 5): the deal and the proposal.
    dealId: text("deal_id").references((): AnyPgColumn => deal.id, { onDelete: "set null" }),
    proposal: jsonb("proposal"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("card_organizationId_idx").on(table.organizationId),
    index("card_priority_idx").on(table.priority),
    index("card_category_idx").on(table.category),
    index("card_accepted_idx").on(table.accepted),
    index("card_sourceItemId_idx").on(table.sourceItemId),
    index("card_ruleId_idx").on(table.ruleId),
    index("card_resultTaskId_idx").on(table.resultTaskId),
    index("card_resultOrderId_idx").on(table.resultOrderId),
    index("card_topic_idx").on(table.topicId),
    index("card_org_status_idx").on(table.organizationId, table.status),
    // At most one OPEN card per topic and kind (spec §9.1).
    uniqueIndex("card_topic_kind_open_uq")
      .on(table.topicId, table.kind)
      .where(sql`${table.status} = 'open' AND ${table.topicId} IS NOT NULL`),
  ],
)

// Many-to-many: clients identified by the analysis that produced the
// card. Composite PK doubles as the dedup index on (cardId, clientId).
export const cardClient = pgTable(
  "card_client",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.clientId] }),
    index("card_client_clientId_idx").on(table.clientId),
  ],
)

// Many-to-many: users identified by the analysis. Note this is not the
// "creator" of the card — cards are produced by the system pipeline,
// not by an org member.
export const cardUser = pgTable(
  "card_user",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.userId] }),
    index("card_user_userId_idx").on(table.userId),
  ],
)

// Many-to-many: contacts identified by the analysis (the external
// sender of the source item, matched to an org contact by email at
// generation time). Drives the "Принять" → create-task prefill so the
// spawned task carries the related contact. Composite PK doubles as the
// dedup index on (cardId, contactId); cascades on either side.
export const cardContact = pgTable(
  "card_contact",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.contactId] }),
    index("card_contact_contactId_idx").on(table.contactId),
  ],
)

// ── Product catalog ──────────────────────────────────────────────────
//
// Org-scoped catalog of sellable items (product catalog for the
// first tenant). The source-of-truth spreadsheet has 42 columns; we map
// them into three buckets:
//   • Main attributes (spreadsheet cols C-H, minus price_range) → real
//     columns here, since the table UI + future filters key on them.
//   • Accounting IDs (cols A-B: code / EAN13 barcode) → `accountingMetadata`
//     JSON, kept opaque so the accounting-system field set can evolve
//     without a migration.
//   • Everything else (cols I-Z: description, color, country, region,
//     taste, … + the dropped `price_range`) → `additionalMetadata` JSON.
//   • Stock counts (cols AA-AP): the org-wide total lands on `totalStock`
//     (a real int so the table can sort/show it cheaply); the per-location
//     breakdown (one column per warehouse/store) lands in `stockMetadata`.
export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    // Main attributes (spreadsheet cols C, D, E, F, H).
    name: text("name").notNull(),
    category: text("category"),
    webPageUrl: text("web_page_url"),
    // Numeric price kept as numeric(14,2) — drizzle returns it as a
    // string; the API/UI parse to number for display + sorting.
    price: numeric("price", { precision: 14, scale: 2 }),
    imageUrl: text("image_url"),
    // Org-wide stock total (spreadsheet col AA). Denormalised from
    // `stockMetadata` so the table can sort/filter on it without
    // unpacking the JSON.
    totalStock: integer("total_stock"),
    // Accounting-system identifiers (cols A-B): { code, barCode }.
    accountingMetadata: jsonb("accounting_metadata").notNull().default({}),
    // Catalog attributes beyond the main columns (cols I-Z + price_range).
    additionalMetadata: jsonb("additional_metadata").notNull().default({}),
    // Per-location stock breakdown (cols AB-AP): array of
    // { key, label, count } so each warehouse/store keeps its display name.
    stockMetadata: jsonb("stock_metadata").notNull().default({}),
    status: entityStatus("status").notNull().default("active"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("product_organizationId_idx").on(table.organizationId),
    index("product_status_idx").on(table.status),
    index("product_name_idx").on(table.name),
    index("product_category_idx").on(table.category),
  ],
)

// Search V2 — DB-managed generated columns NOT represented above on purpose.
//
// The custom migration `migrations/0002_search_v2_product_columns.sql` adds
// these GENERATED ALWAYS … STORED columns + their indexes to `product` (the
// functions they call are in `migrations/0000_extensions_and_functions.sql`):
//   • name_norm     text     — lower(immutable_unaccent(translit_cyr_lat(name)))
//   • region_norm   text     — same over additional_metadata->>'region'
//   • is_drink      boolean  — false for merch categories (glasses/water/…)
//   • is_gift       boolean  — gift_packaging='Да' OR name ~ подароч/деревян
//   • search_vector tsvector — weighted 'simple' FTS (A name/vendor, C cat/type, D country/region)
// The hybrid retriever in src/server/products.ts reads them via raw `sql`.
//
// They are intentionally absent from this schema object: Drizzle `select()`
// returns every schema column (search_vector is large), and an expression that
// doesn't byte-match Drizzle's introspection would make `drizzle-kit push` drop
// + recreate them (push is not used — see AGENTS.md § Database changes).
// To change one: write a NEW custom migration (`pnpm db:custom --name …`) that
// drops + re-adds the column and recreates its index.

export type Product = typeof product.$inferSelect

// Search V2 — brand / kind / house alias map (org-scoped). Bridges the
// transliteration divergences that normalization alone can't close: a customer
// writes «грей гуз» (normalizes to `grey guz`) but the catalog name is
// `Grey Goose` (`grey goose`) — trigram 0.625, FTS misses entirely. An alias row
// {alias_norm:'grey guz', canonical:'grey goose'} lets normalizeQuery() append
// the catalog-true token so FTS + trigram both fire.
//   • alias_norm — the customer spelling AFTER full normalization
//     (lower(immutable_unaccent(translit_cyr_lat(...)))), so it compares against
//     a normalized query directly.
//   • canonical  — the catalog-true token(s), also normalized.
//   • kind       — 'brand' (default) | 'kind' (low-selectivity drink word → soft
//     boost, never a gate) | 'house' (house-pour placeholder «Х»/«хаус»; resolved
//     per category in a later phase, not via search).
// Seeded by scripts/search-v2/seed-aliases.ts from the corpus + 42 sample requests.
export const productAlias = pgTable(
  "product_alias",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    aliasNorm: text("alias_norm").notNull(),
    canonical: text("canonical").notNull(),
    kind: text("kind").notNull().default("brand"),
  },
  (table) => [
    uniqueIndex("product_alias_org_alias_uniq").on(
      table.organizationId,
      table.aliasNorm,
    ),
    index("product_alias_org_idx").on(table.organizationId),
  ],
)

export type ProductAlias = typeof productAlias.$inferSelect

// ── Orders ───────────────────────────────────────────────────────────
//
// Org-scoped sales order. Created by an org user, assigned to one client.
// Line items live in `order_item` (one row per product line). `totalAmount`
// is denormalised from the sum of line `positionPrice`s at write time so the
// orders table can sort/show it without joining + aggregating the items.
export const order = pgTable(
  "order",
  {
    id: text("id").primaryKey(),
    // Business date of the order (distinct from `createdAt`). Defaults to now
    // on create; editable later.
    orderDate: timestamp("order_date").defaultNow().notNull(),
    description: text("description"),
    status: orderStatus("status").notNull().default("draft"),
    // Order total = Σ line positionPrice. Kept as numeric(14,2) (drizzle
    // returns it as a string; the API/UI parse to number). Recomputed from
    // the line items whenever they change.
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    // Per-client discount snapshotted onto the order at save time (a whole
    // percent 0–100, sourced from `client.custom_fields.discount`). Re-synced
    // from the client on every internal create/update; guest qty edits keep it.
    // The discount AMOUNT and the discounted total are DERIVED on read (see
    // `computeOrderDiscount`) from `total_amount` × this percent — never stored,
    // so a guest qty change recomputes them without extra writes.
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("RUB"),
    // `restrict` (not cascade / set null): clients are never hard-deleted in
    // this app (soft-delete via status), so an accidental hard-delete should
    // fail loudly rather than orphan / wipe orders.
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Topics plan phase 10: the topic the order belongs to (set when the
    // order is created from a topic card «Создать заказ», or linked by a
    // user). One topic → many orders. ORDER_CONFIRMED on the order status
    // is written to this topic (src/server/topics/orders-link.ts).
    topicId: text("topic_id").references((): AnyPgColumn => topic.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("order_organizationId_idx").on(table.organizationId),
    index("order_topic_idx").on(table.topicId).where(sql`${table.topicId} is not null`),
    index("order_userId_idx").on(table.userId),
    index("order_clientId_idx").on(table.clientId),
    index("order_status_idx").on(table.status),
    index("order_orderDate_idx").on(table.orderDate),
  ],
)

export type Order = typeof order.$inferSelect

// One product line on an order. `unitPrice` is snapshotted at add-time (the
// catalog price can drift); `positionPrice = unitPrice × quantity` is stored
// so reads never have to recompute. `product` is `restrict` (catalog rows are
// soft-deleted, never hard-deleted); `order` cascades so deleting an order
// clears its lines.
export const orderItem = pgTable(
  "order_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    positionPrice: numeric("position_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("order_item_orderId_idx").on(table.orderId),
    index("order_item_productId_idx").on(table.productId),
  ],
)

export type OrderItem = typeof orderItem.$inferSelect

// Capability-based guest access grant for the order-confirmation loop. The
// bearer of the raw token (never stored — only its sha256 hash) can review
// and confirm exactly one order while it's `awaiting_client`. All lifecycle
// writes go through `src/server/order-links.ts` (spec invariant #7). The
// partial unique index guarantees at most one `active` grant per order
// (invariant #1). `order` cascade-deletes its grants.
export const orderAccessLink = pgTable(
  "order_access_link",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    // sha256(rawToken) hex. The raw token is returned to the caller exactly
    // once at mint time and never persisted.
    tokenHash: text("token_hash").notNull(),
    // Who the link was issued to (audit + the default re-send target). For
    // `awaiting_client` it must be a structurally-valid email.
    recipientEmail: text("recipient_email"),
    status: orderLinkStatus("status").notNull().default("active"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastAccessedAt: timestamp("last_accessed_at"),
    confirmedAt: timestamp("confirmed_at"),
  },
  (table) => [
    uniqueIndex("order_access_link_tokenHash_idx").on(table.tokenHash),
    index("order_access_link_orderId_idx").on(table.orderId),
    // Invariant #1: at most one live grant per order.
    uniqueIndex("order_access_link_one_active_idx")
      .on(table.orderId)
      .where(sql`status = 'active'`),
  ],
)

export type OrderAccessLink = typeof orderAccessLink.$inferSelect

// ── Order from request (LLM-assisted assembly) ───────────────────────
//
// Durable header for one pasted client request. The rep picks the client +
// adds a comment (as in "New order"), pastes the free-text message, and the
// LLM splits it into `order_request_item` rows. The wizard then assembles a
// draft `order` (linked via `orderId`) by walking the items one at a time,
// reusing the manual order builder. This row is the resumable session state;
// the real order lifecycle lives on the linked `order`.
export const orderRequest = pgTable(
  "order_request",
  {
    id: text("id").primaryKey(),
    // The pasted client message, verbatim.
    rawText: text("raw_text").notNull(),
    // Rep's note (mirrors the "New order" description; copied onto the draft
    // order's description when the draft is minted).
    comment: text("comment"),
    status: orderRequestStatus("status").notNull().default("parsing"),
    // Populated when the LLM split fails, so the UI can surface it + offer a
    // manual fallback (the rep can still build the order by hand).
    parseError: text("parse_error"),
    // `restrict` to match `order.clientId` (clients are soft-deleted only).
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    // The draft order being assembled. Null until the wizard mints it; set
    // null (not cascade) if that order is later hard-deleted so the request
    // row survives as a record of the parse.
    orderId: text("order_id").references(() => order.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("order_request_organizationId_idx").on(table.organizationId),
    index("order_request_userId_idx").on(table.userId),
    index("order_request_clientId_idx").on(table.clientId),
    index("order_request_orderId_idx").on(table.orderId),
    index("order_request_status_idx").on(table.status),
  ],
)

export type OrderRequest = typeof orderRequest.$inferSelect

// One intent item parsed from a request — a single wizard step that can
// produce 0..N order lines. `mode` decides the matching strategy: `explicit`
// uses `searchPhrase` (a Latin transliteration of the named brand);
// `discovery` uses `filters` (catalog attribute filters). `quantityHint` is
// the raw qty text (e.g. "6", "15 л", "0,7") — no unit math, the rep confirms.
// `ordinal` is the 0-based step order. `order_request` cascade-deletes items.
export const orderRequestItem = pgTable(
  "order_request_item",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => orderRequest.id, { onDelete: "cascade" }),
    // 0-based wizard step order.
    ordinal: integer("ordinal").notNull().default(0),
    // Exact fragment of the message this item came from (shown for context).
    rawSnippet: text("raw_snippet").notNull(),
    // Short human label for the step header (e.g. "William Lawson's",
    // "Северные сыры").
    label: text("label"),
    mode: orderRequestItemMode("mode").notNull(),
    // Catalog attribute filters for `discovery` items (empty for `explicit`).
    filters: jsonb("filters")
      .notNull()
      .default({})
      .$type<OrderRequestItemFilters>(),
    // Human-readable primary search phrase (best English/transliterated guess
    // for explicit, or a Russian phrase for discovery) — used for display.
    searchPhrase: text("search_phrase"),
    // Bilingual search tokens for ranked, order-independent catalog matching:
    // each meaningful request word kept in Russian AND its English
    // translation/transliteration, plus name-numbers. The catalog is mixed
    // RU/EN, so a token-OR search ranked by hit count finds products a single
    // transliterated phrase would miss. Fed to `listProducts({ terms })`.
    searchTerms: text("search_terms").array(),
    // Raw quantity text as written, prefilled into the qty field when clean.
    quantityHint: text("quantity_hint"),
    status: orderRequestItemStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("order_request_item_requestId_idx").on(table.requestId),
  ],
)

export type OrderRequestItem = typeof orderRequestItem.$inferSelect

export const sourceType = pgEnum("source_type", ["external", "internal"])

export type SourceType = (typeof sourceType.enumValues)[number]

// Provider dictionary — extend as new integrations land. Postgres enums
// can be appended via `ALTER TYPE … ADD VALUE`, which Drizzle Kit emits as
// a separate migration step.
export const sourceProvider = pgEnum("source_provider", [
  "nylas",
  // Email over a raw IMAP mailbox (no Nylas). Per-org credentials
  // (host/port/secure/user/password) in `credentials_ref`; the mailbox
  // folder lives in `provider_config`. Envelope-only incremental sync
  // (cursor + UIDVALIDITY-stamped external_id); the body is fetched lazily
  // at parse time and reuses the Nylas email LLM pipeline verbatim.
  "imap",
  "gchat",
  "gdrive",
  "dropoff",
  "whatsapp",
  // Internal-type provider for the AI chat as a source (docs/specs/ai-chat
  // §16.3): chat segments are ingested automatically (src/server/chat/
  // ingest.ts). No remote sync — items arrive pre-parsed. Lazy-provisioned
  // per org (`getOrCreateAiChatSource`). Old rows of the removed «Сохранить
  // чат» button use it too.
  "aichat",
  // Per-org Telegram bot. Push-ingested via webhook (no remote sync/pull):
  // each org's admin creates their own bot via BotFather and stores the
  // token in `credentials_ref`; the bot IS the tenant. Items (DM text in
  // Phase 1; attachments + group @-mentions later) arrive at
  // `/api/webhooks/telegram/[sourceId]` and are written directly as
  // `chat_message` source_items with parseStatus='pending'.
  "telegram",
])

export type SourceProvider = (typeof sourceProvider.enumValues)[number]

export const sourceStatus = pgEnum("source_status", ["active", "inactive"])

export type SourceStatus = (typeof sourceStatus.enumValues)[number]

// ── Source template (Phase 2 — dictionary table) ────────────────────
//
// Catalogue of source variants an admin curates. Per-org `source` rows
// are instantiated from a template via `instantiateFromTemplate(orgId,
// templateId)`. Templates carry no credentials — those are per-org by
// definition (each org's own Workspace SA / Nylas grant) and live on
// the instance row's `credentials_ref`. Soft-delete only via `status`;
// hard-deleting a template would orphan the instances that reference it
// (kept consistent by the FK's `set null` on delete).
export const sourceTemplate = pgTable(
  "source_template",
  {
    id: text("id").primaryKey(),
    type: sourceType("type").notNull().default("external"),
    provider: sourceProvider("provider").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Default non-secret connection routing copied into a new instance
    // at creation time. Empty `{}` for every provider in the initial
    // seed — each org has its own driveId/spaceId, so per-org override
    // is the norm. Future templates can carry hints (e.g. a default
    // mailbox label).
    defaultProviderConfig: jsonb("default_provider_config").notNull().default({}),
    defaultAutomatedParsingIsAllowed: boolean("default_automated_parsing_is_allowed")
      .notNull()
      .default(true),
    // True → bootstrap hook auto-instantiates this template into every
    // newly-created organisation. Default behavior in Phase 2 is
    // conservative: only Files Drop Off + AI Chat are `is_default`.
    // Owners add Email/GChat/GDrive themselves.
    isDefault: boolean("is_default").notNull().default(false),
    // True → template appears in the org-owner "Add source" picker.
    // Decoupled from `is_default` so an admin can hide a template from
    // owners without breaking auto-instantiation, or vice versa.
    isVisibleToOrgs: boolean("is_visible_to_orgs").notNull().default(true),
    status: sourceStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("source_template_provider_idx").on(table.provider),
    index("source_template_status_idx").on(table.status),
    index("source_template_isDefault_idx").on(table.isDefault),
  ],
)

export const source = pgTable(
  "source",
  {
    id: text("id").primaryKey(),
    // Lineage: which template this row was instantiated from. Null for
    // legacy rows that pre-date Phase 2 (until backfilled) and for
    // any future custom-instance rows that don't trace to a template.
    // ON DELETE SET NULL keeps instances alive if a template is hard-
    // removed, though in practice we soft-delete (status='inactive').
    templateId: text("template_id").references(() => sourceTemplate.id, {
      onDelete: "set null",
    }),
    type: sourceType("type").notNull().default("external"),
    provider: sourceProvider("provider").notNull(),
    // Provider-specific connection config — non-secret. e.g.
    //   gchat   → { spaceId: "spaces/AAQA…" }
    //   gdrive  → { driveId: "0ADu…" }
    //   nylas   → { grantId: "…" }
    //   dropoff → {}
    providerConfig: jsonb("provider_config").notNull().default({}),
    // Nullable when isSystem = true (platform-wide source visible to every
    // org). When isSystem = false this MUST be set — enforced at the server
    // layer.
    ownerOrganizationId: text("owner_organization_id").references(
      () => organization.id,
      { onDelete: "cascade" },
    ),
    isSystem: boolean("is_system").notNull().default(false),
    // When true, the daily orchestration cron is allowed to sync /
    // parse / upload items belonging to this source. When false, the
    // source is invisible to all three pipeline phases — manual UI
    // actions (Sync / Parse / Re-parse / Upload) still work, since
    // those represent an explicit operator intent. Org owners flip
    // this from the Sources page; admins flip it from /settings.
    automatedParsingIsAllowed: boolean("automated_parsing_is_allowed")
      .notNull()
      .default(true),
    name: text("name").notNull(),
    description: text("description"),
    // AES-256-GCM ciphertext (base64). Encrypted/decrypted via
    // `src/lib/credentials-crypto.ts`. Null when the provider needs no
    // per-source secret (e.g. dropoff, or gchat using the shared service
    // account).
    credentialsRef: text("credentials_ref"),
    status: sourceStatus("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("source_ownerOrganizationId_idx").on(table.ownerOrganizationId),
    index("source_provider_idx").on(table.provider),
    index("source_status_idx").on(table.status),
    index("source_isSystem_idx").on(table.isSystem),
    index("source_templateId_idx").on(table.templateId),
  ],
)

export type SourceTemplate = typeof sourceTemplate.$inferSelect

// Kinds of items a source can yield. `attachment` covers any file attached
// to a parent (email/chat); the actual format lives in `mime_type`.
// `inline_image` is the data-URI image extracted from an email body.
// `derived_audio` is the audio track our video parser produces alongside
// the video block — its `parent_source_item_id` points to the video item.
export const sourceItemKind = pgEnum("source_item_kind", [
  "email",
  "chat_message",
  "drive_file",
  "dropoff_file",
  "attachment",
  "inline_image",
  "derived_audio",
  // AI chat segment (since ai-chat CH6: the messages of a chat since the last
  // ingest; old rows = whole sessions saved by the removed «Сохранить чат»).
  // Files the user attached become `attachment` children of this row.
  "aichat_session",
])

export type SourceItemKind = (typeof sourceItemKind.enumValues)[number]

export const parseStatus = pgEnum("parse_status", [
  "pending",
  "processing",
  "complete",
  "failed",
  "skipped",
])

export type ParseStatus = (typeof parseStatus.enumValues)[number]

export const r2UploadStatus = pgEnum("r2_upload_status", [
  "pending",
  "complete",
  "failed",
])

export type R2UploadStatus = (typeof r2UploadStatus.enumValues)[number]

// Parse-time authorship classification of a source item (see
// refs/org-attribution.md). `own_org` = authored BY the owning org (a teammate
// sender, or our own no-sender document); `external` = an outside party;
// `unknown` = undetermined (the default, so existing rows fill on migration
// with no backfill). Directionality: only the SENDER/author side counts —
// recipients of an inbound client email never make it ours. The full evidence
// `{ value, confidence, matchedOn, reason }` lives in
// `metadata_json.orgAttribution`; this column is the queryable projection.
export const orgAttribution = pgEnum("org_attribution", [
  "own_org",
  "external",
  "unknown",
])

export type OrgAttribution = (typeof orgAttribution.enumValues)[number]

export const sourceItem = pgTable(
  "source_item",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    // Denormalised from `source.ownerOrganizationId` for fast org-scoped
    // queries and for tenant-isolation indexes. Null only for items that
    // belong to a system source. Kept in sync at insert time by the server
    // layer (the source is fetched first, its org copied to the item).
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    externalId: text("external_id").notNull(),
    externalType: sourceItemKind("external_type").notNull(),
    externalUrl: text("external_url"),
    // Raw provider payload + any per-kind extras (subject, from/to,
    // participants, original creation timestamp, …). Frozen snapshot at
    // fetch time — re-fetching overwrites.
    metadataJson: jsonb("metadata_json").notNull().default({}),
    parentSourceItemId: text("parent_source_item_id").references(
      (): AnyPgColumn => sourceItem.id,
      { onDelete: "cascade" },
    ),
    // Provider-side thread/conversation grouping (Gmail threadId, Chat
    // thread name, …). Indexed so "show me this thread" is a column lookup
    // rather than a JSON probe.
    threadExternalId: text("thread_external_id"),
    filename: text("filename"),
    mimeType: text("mime_type"),
    // Bytes — never MB. Display layer formats. bigint mode "number" works
    // up to 2^53; far beyond any practical attachment size.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    // The provider's own creation timestamp (Nylas `date`, Chat
    // `createTime`, Drive `modifiedTime`). Drives "items from last week"
    // queries and incremental-sync cursors.
    sourceCreatedAt: timestamp("source_created_at"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    parsedAt: timestamp("parsed_at"),
    parseError: text("parse_error"),
    // Parse-time authorship verdict (refs/org-attribution.md). Default
    // 'unknown'; recomputed on every (re)parse. Evidence lives in
    // metadata_json.orgAttribution.
    orgAttribution: orgAttribution("org_attribution")
      .notNull()
      .default("unknown"),
    // Bumped when a parser's prompt / schema / pipeline changes — lets the
    // re-parse job find rows produced by older versions.
    parserVersion: text("parser_version"),
    // Model that produced the markdown, e.g. `google/gemini-2.5-flash`.
    parserModel: text("parser_model"),
    // Parsed markdown body — lives here between Parse and Upload so the
    // Show modal can render it before R2 has the canonical copy. Cleared
    // (set to NULL) on a successful R2 upload; the Show modal then falls
    // back to fetching from R2 by `markdown_r2_key`. Skipped attachments
    // (unsupported / oversize / deletion) leave this NULL.
    parsedMarkdown: text("parsed_markdown"),
    r2UploadStatus: r2UploadStatus("r2_upload_status")
      .notNull()
      .default("pending"),
    r2UploadedAt: timestamp("r2_uploaded_at"),
    // Convention: `org_<orgId>/source_<sourceId>/item_<itemId>.md` — see
    // `src/app/AGENTS.md`. Stable across re-parses (overwrite in place).
    markdownR2Key: text("markdown_r2_key"),
    markdownR2SizeBytes: bigint("markdown_r2_size_bytes", { mode: "number" }),
    // ── Original file of a DOCUMENT (docs/specs/attachments §3.2) ──
    // Object key in storage (`org_<orgId>/files/<itemId>/<name>`); written
    // when the item is parsed or uploaded. `file_status`: stored | not_stored
    // | too_large | failed (text validated in code); null = not a document /
    // not processed yet.
    fileKey: text("file_key"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    fileMime: text("file_mime"),
    fileSha256: text("file_sha256"),
    fileStoredAt: timestamp("file_stored_at"),
    fileStatus: text("file_status"),
    // Stamped by `applyDiscovery` after the unified discover-from-sources
    // flow has considered this row (whether or not it contributed a
    // client / contact / link candidate). Default eligibility filter is
    // `discoveryScannedAt IS NULL OR parsedAt > discoveryScannedAt` so
    // re-parses re-trigger discovery naturally. Cleared by
    // `reparseSourceItem`. The "Re-scan already-reviewed items" checkbox
    // in <DiscoverDialog> bypasses this filter for ad-hoc re-runs.
    // Migrated from the two legacy stamps (client_/contact_…) via
    // scripts/migrate-discovery-scanned-at.ts.
    discoveryScannedAt: timestamp("discovery_scanned_at"),
    // ── Topics engine, signal extraction (spec topics/01 §5, §11; plan
    // phase 2). Written only by `src/server/topics/signals/`. Text columns
    // validated in code (same choice as the signals registry).
    // Normalised thread key (spec §6.1) — filled from phase 3.
    threadKey: text("thread_key"),
    // done | skipped | deferred | failed. null = never considered.
    signalStatus: text("signal_status"),
    // Why the item was skipped (gate name) or why it failed (message).
    signalReason: text("signal_reason"),
    // Item score (§5.4 rule 6) and band (§5.5: none | low | normal | high |
    // very_high | critical). A stored score is never re-scored when weights
    // change — only an explicit re-run does.
    signalScore: integer("signal_score"),
    signalBand: text("signal_band"),
    // { facts, direction, attributes, dropped[], model, … } of the run.
    signalFacts: jsonb("signal_facts").$type<Record<string, unknown> | null>(),
    signalScannedAt: timestamp("signal_scanned_at"),
    // Failed attempts in a row (the runner gives up after a few).
    signalAttempts: integer("signal_attempts").notNull().default(0),
    signalTaxonomyVersion: integer("signal_taxonomy_version"),
    // ── Topics engine, topic resolution (spec topics/01 §6; plan phase 3).
    // Written only by `src/server/topics/`. Text validated in code
    // (src/lib/topics/types.ts): done | log_only | ignored | deferred | failed.
    // null = never considered. Reset by `detachSourceItemFromTopics`.
    topicStatus: text("topic_status"),
    // Why: log_only (closing code with no topic), ignored (no counted signal
    // and nothing to attach to), the error of a failed attempt.
    topicReason: text("topic_reason"),
    topicScannedAt: timestamp("topic_scanned_at"),
    // Failed attempts in a row (the phase gives up after a few).
    topicAttempts: integer("topic_attempts").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Re-fetching the same provider item must update, not insert. Strict
    // unique on (source, externalId).
    uniqueIndex("source_item_source_external_uidx").on(
      table.sourceId,
      table.externalId,
    ),
    index("source_item_sourceId_idx").on(table.sourceId),
    index("source_item_organizationId_idx").on(table.organizationId),
    index("source_item_parentSourceItemId_idx").on(table.parentSourceItemId),
    // Upload dedupe by content (docs/specs/attachments §3.2).
    index("source_item_org_file_sha_idx").on(table.organizationId, table.fileSha256),
    index("source_item_threadExternalId_idx").on(table.threadExternalId),
    // Listing query: org's items ordered by provider creation time.
    index("source_item_org_sourceCreatedAt_idx").on(
      table.organizationId,
      table.sourceCreatedAt,
    ),
    // Worker queue: only rows that need attention. Partial index keeps it
    // tiny even as the table grows.
    index("source_item_parseStatus_pending_idx")
      .on(table.parseStatus)
      .where(sql`${table.parseStatus} in ('pending', 'failed')`),
    index("source_item_r2UploadStatus_pending_idx")
      .on(table.r2UploadStatus)
      .where(sql`${table.r2UploadStatus} in ('pending', 'failed')`),
    // First-party lookups (AI-chat company-knowledge scoping, internal-doc
    // filters) stay tiny regardless of table size.
    index("source_item_org_attribution_own_idx")
      .on(table.organizationId)
      .where(sql`${table.orgAttribution} = 'own_org'`),
    // Topics engine work queue + shadow review lists.
    index("source_item_org_signal_scanned_idx").on(
      table.organizationId,
      table.signalScannedAt,
    ),
    index("source_item_org_thread_key_idx")
      .on(table.organizationId, table.threadKey)
      .where(sql`${table.threadKey} is not null`),
    index("source_item_org_topic_scanned_idx").on(
      table.organizationId,
      table.topicScannedAt,
    ),
  ],
)

// One row per orchestration run (cron-fired or manually triggered from
// the admin "Run pipeline now" button). Counts per phase + a JSON array
// of per-item failures gives the future Sources-page widget everything
// it needs without joining back to source_item. Populated by the
// engine-agnostic `runDailyPipeline()` so observability stays portable
// even if we swap Vercel Workflows for a different scheduler later.
export const pipelineRunTrigger = pgEnum("pipeline_run_trigger", [
  "cron",
  "manual",
])
export const pipelineRunStatus = pgEnum("pipeline_run_status", [
  "running",
  "success",
  "failed",
])

export type PipelineRunTrigger = (typeof pipelineRunTrigger.enumValues)[number]
export type PipelineRunStatus = (typeof pipelineRunStatus.enumValues)[number]

export const pipelineRun = pgTable(
  "pipeline_run",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    trigger: pipelineRunTrigger("trigger").notNull(),
    // 'running' on insert, set to 'success' or 'failed' at the end. A
    // cron run that crashed mid-loop will stay 'running' until the next
    // run hard-resets it — acceptable for MVP, can add a stale-run sweep
    // later.
    status: pipelineRunStatus("status").notNull().default("running"),

    // Sync phase
    syncSourcesTotal: integer("sync_sources_total").notNull().default(0),
    syncSourcesSucceeded: integer("sync_sources_succeeded")
      .notNull()
      .default(0),
    syncSourcesFailed: integer("sync_sources_failed").notNull().default(0),
    syncItemsInserted: integer("sync_items_inserted").notNull().default(0),
    syncItemsUpdated: integer("sync_items_updated").notNull().default(0),

    // Parse phase
    parseAttempted: integer("parse_attempted").notNull().default(0),
    parseComplete: integer("parse_complete").notNull().default(0),
    parseSkipped: integer("parse_skipped").notNull().default(0),
    parseFailed: integer("parse_failed").notNull().default(0),
    // Items not attempted because the per-run cap was hit. They stay
    // 'pending' and will be picked up next run.
    parseCapped: integer("parse_capped").notNull().default(0),

    // Upload phase
    uploadAttempted: integer("upload_attempted").notNull().default(0),
    uploadSucceeded: integer("upload_succeeded").notNull().default(0),
    uploadFailed: integer("upload_failed").notNull().default(0),

    // Per-failure detail. Each entry: { phase, sourceId?, sourceItemId?,
    // message }. Bounded in code to ~200 entries to keep the column
    // sane on a catastrophically bad run.
    errorsJson: jsonb("errors_json").notNull().default([]),
  },
  (table) => [
    // Default ordering for the future widget.
    index("pipeline_run_startedAt_idx").on(table.startedAt),
  ],
)

export type PipelineRun = typeof pipelineRun.$inferSelect

export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_key_idx").on(table.key),
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
  ]
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  apikeys: many(apikey),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const productRelations = relations(product, ({ one }) => ({
  organization: one(organization, {
    fields: [product.organizationId],
    references: [organization.id],
  }),
}))

export const orderRelations = relations(order, ({ one, many }) => ({
  client: one(client, {
    fields: [order.clientId],
    references: [client.id],
  }),
  user: one(user, {
    fields: [order.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [order.organizationId],
    references: [organization.id],
  }),
  items: many(orderItem),
  links: many(orderAccessLink),
}))

export const orderItemRelations = relations(orderItem, ({ one }) => ({
  order: one(order, {
    fields: [orderItem.orderId],
    references: [order.id],
  }),
  product: one(product, {
    fields: [orderItem.productId],
    references: [product.id],
  }),
}))

export const orderAccessLinkRelations = relations(
  orderAccessLink,
  ({ one }) => ({
    order: one(order, {
      fields: [orderAccessLink.orderId],
      references: [order.id],
    }),
  }),
)

export const orderRequestRelations = relations(
  orderRequest,
  ({ one, many }) => ({
    client: one(client, {
      fields: [orderRequest.clientId],
      references: [client.id],
    }),
    order: one(order, {
      fields: [orderRequest.orderId],
      references: [order.id],
    }),
    user: one(user, {
      fields: [orderRequest.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [orderRequest.organizationId],
      references: [organization.id],
    }),
    items: many(orderRequestItem),
  }),
)

export const orderRequestItemRelations = relations(
  orderRequestItem,
  ({ one }) => ({
    request: one(orderRequest, {
      fields: [orderRequestItem.requestId],
      references: [orderRequest.id],
    }),
  }),
)

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))

export const apikeyRelations = relations(apikey, ({ one }) => ({
  user: one(user, {
    fields: [apikey.referenceId],
    references: [user.id],
  }),
}))

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
export type Organization = typeof organization.$inferSelect
export type Member = typeof member.$inferSelect
export type Invitation = typeof invitation.$inferSelect
export type ApiKey = typeof apikey.$inferSelect
export type Rule = typeof rule.$inferSelect
export type Client = typeof client.$inferSelect
export type Contact = typeof contact.$inferSelect
export type Task = typeof task.$inferSelect
export type Deal = typeof deal.$inferSelect
export type DealContact = typeof dealContact.$inferSelect
export type DealFunnelStage = typeof dealFunnelStage.$inferSelect
export type Source = typeof source.$inferSelect
export type SourceItem = typeof sourceItem.$inferSelect
export type Card = typeof card.$inferSelect
export type CardClient = typeof cardClient.$inferSelect
export type CardUser = typeof cardUser.$inferSelect
export type CardContact = typeof cardContact.$inferSelect

export const ruleRelations = relations(rule, ({ one }) => ({
  user: one(user, {
    fields: [rule.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [rule.organizationId],
    references: [organization.id],
  }),
}))

export const clientRelations = relations(client, ({ one, many }) => ({
  user: one(user, {
    fields: [client.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [client.organizationId],
    references: [organization.id],
  }),
  contacts: many(contact),
}))

export const contactRelations = relations(contact, ({ one }) => ({
  user: one(user, {
    fields: [contact.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [contact.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [contact.clientId],
    references: [client.id],
  }),
}))

export const taskRelations = relations(task, ({ one }) => ({
  user: one(user, {
    fields: [task.userId],
    references: [user.id],
    relationName: "task_creator",
  }),
  assignee: one(user, {
    fields: [task.assigneeId],
    references: [user.id],
    relationName: "task_assignee",
  }),
  organization: one(organization, {
    fields: [task.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [task.clientId],
    references: [client.id],
  }),
  contact: one(contact, {
    fields: [task.contactId],
    references: [contact.id],
  }),
  deal: one(deal, {
    fields: [task.dealId],
    references: [deal.id],
  }),
}))

export const dealFunnelStageRelations = relations(
  dealFunnelStage,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [dealFunnelStage.ownerOrganizationId],
      references: [organization.id],
    }),
    deals: many(deal),
  }),
)

export const dealRelations = relations(deal, ({ one, many }) => ({
  user: one(user, {
    fields: [deal.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [deal.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [deal.clientId],
    references: [client.id],
  }),
  funnelStage: one(dealFunnelStage, {
    fields: [deal.funnelStageId],
    references: [dealFunnelStage.id],
  }),
  contacts: many(dealContact),
  tasks: many(task),
}))

export const dealContactRelations = relations(dealContact, ({ one }) => ({
  deal: one(deal, {
    fields: [dealContact.dealId],
    references: [deal.id],
  }),
  contact: one(contact, {
    fields: [dealContact.contactId],
    references: [contact.id],
  }),
}))

export const sourceRelations = relations(source, ({ one, many }) => ({
  organization: one(organization, {
    fields: [source.ownerOrganizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [source.createdByUserId],
    references: [user.id],
  }),
  items: many(sourceItem),
}))

export const sourceItemRelations = relations(sourceItem, ({ one, many }) => ({
  source: one(source, {
    fields: [sourceItem.sourceId],
    references: [source.id],
  }),
  organization: one(organization, {
    fields: [sourceItem.organizationId],
    references: [organization.id],
  }),
  parent: one(sourceItem, {
    fields: [sourceItem.parentSourceItemId],
    references: [sourceItem.id],
    relationName: "source_item_parent",
  }),
  children: many(sourceItem, {
    relationName: "source_item_parent",
  }),
}))

export const cardRelations = relations(card, ({ one, many }) => ({
  organization: one(organization, {
    fields: [card.organizationId],
    references: [organization.id],
  }),
  sourceItem: one(sourceItem, {
    fields: [card.sourceItemId],
    references: [sourceItem.id],
  }),
  rule: one(rule, {
    fields: [card.ruleId],
    references: [rule.id],
  }),
  clients: many(cardClient),
  users: many(cardUser),
  contacts: many(cardContact),
}))

export const cardContactRelations = relations(cardContact, ({ one }) => ({
  card: one(card, {
    fields: [cardContact.cardId],
    references: [card.id],
  }),
  contact: one(contact, {
    fields: [cardContact.contactId],
    references: [contact.id],
  }),
}))

export const cardClientRelations = relations(cardClient, ({ one }) => ({
  card: one(card, {
    fields: [cardClient.cardId],
    references: [card.id],
  }),
  client: one(client, {
    fields: [cardClient.clientId],
    references: [client.id],
  }),
}))

export const cardUserRelations = relations(cardUser, ({ one }) => ({
  card: one(card, {
    fields: [cardUser.cardId],
    references: [card.id],
  }),
  user: one(user, {
    fields: [cardUser.userId],
    references: [user.id],
  }),
}))

// ─── AI model registry (docs/specs/models/02-model-registry.md) ─────────────
//
// Vendor-neutral by rule (docs/specs/models/01-gateway-providers.md §3 rule 4):
// gateway-specific data goes into the `raw` / `cost_raw` jsonb columns only.
// Column names and units follow the models.dev schema (costs = USD per 1M
// tokens).

// One row per AI gateway the platform can route through. Secrets are never
// stored here: `credentials_env` names the env var that holds the key.
export const aiGateway = pgTable(
  "ai_gateway",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Adapter key in src/server/ai/gateways (e.g. "vercel-ai-gateway").
    adapter: text("adapter").notNull(),
    // Ordered catalog sources; the first is authoritative, later ones only
    // fill empty fields (e.g. {gateway-api,models-dev}).
    catalogSources: text("catalog_sources")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Provider id in models.dev (e.g. "vercel") for the models-dev source.
    modelsDevProviderId: text("models_dev_provider_id"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    // Non-secret settings, e.g. { "baseUrl": "https://…/v1" }.
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    credentialsEnv: text("credentials_env"),
    lastSyncedAt: timestamp("last_synced_at"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Exactly one default gateway.
    uniqueIndex("ai_gateway_default_uidx")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
  ],
)

export type AiGateway = typeof aiGateway.$inferSelect

// One row per model per gateway, mirrored from the gateway catalog. Never
// deleted: a model that disappears gets is_available = false (usage events
// reference it).
export const aiModel = pgTable(
  "ai_model",
  {
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => aiGateway.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    vendor: text("vendor"),
    name: text("name").notNull(),
    family: text("family"),
    description: text("description"),
    type: text("type").notNull().default("language"),
    canonicalModelId: text("canonical_model_id"),
    // Capabilities (models.dev names). Null = unknown.
    attachment: boolean("attachment"),
    reasoning: boolean("reasoning"),
    toolCall: boolean("tool_call"),
    structuredOutput: boolean("structured_output"),
    temperature: boolean("temperature"),
    openWeights: boolean("open_weights"),
    webSearch: boolean("web_search"),
    inputModalities: text("input_modalities").array(),
    outputModalities: text("output_modalities").array(),
    limitContext: integer("limit_context"),
    limitOutput: integer("limit_output"),
    // USD per 1M tokens (models.dev unit).
    costInput: numeric("cost_input", { precision: 14, scale: 6 }),
    costOutput: numeric("cost_output", { precision: 14, scale: 6 }),
    costCacheRead: numeric("cost_cache_read", { precision: 14, scale: 6 }),
    costCacheWrite: numeric("cost_cache_write", { precision: 14, scale: 6 }),
    // USD per 1,000 web searches.
    costWebSearch: numeric("cost_web_search", { precision: 14, scale: 6 }),
    // Full source price object (tiers, service tiers, regional, media).
    costRaw: jsonb("cost_raw").$type<Record<string, unknown>>(),
    knowledge: text("knowledge"),
    releaseDate: text("release_date"),
    lastUpdated: text("last_updated"),
    status: text("status"),
    zdr: text("zdr"),
    noTraining: text("no_training"),
    regions: text("regions").array(),
    deprecatedAt: timestamp("deprecated_at"),
    isAvailable: boolean("is_available").notNull().default(true),
    // Which catalog source filled which field.
    fieldSources: jsonb("field_sources")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // Original records, keyed by catalog source.
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gatewayId, table.modelId] }),
    index("ai_model_gateway_type_idx").on(table.gatewayId, table.type),
    index("ai_model_vendor_idx").on(table.vendor),
    index("ai_model_canonical_idx").on(table.canonicalModelId),
    // Trigram search index lives in a custom migration (expression index).
  ],
)

export type AiModel = typeof aiModel.$inferSelect

// Price history: one row per price change of a model (reporting only —
// usage events store their own computed cost).
export const aiModelPriceHistory = pgTable(
  "ai_model_price_history",
  {
    id: text("id").primaryKey(),
    gatewayId: text("gateway_id").notNull(),
    modelId: text("model_id").notNull(),
    validFrom: timestamp("valid_from").defaultNow().notNull(),
    costInput: numeric("cost_input", { precision: 14, scale: 6 }),
    costOutput: numeric("cost_output", { precision: 14, scale: 6 }),
    costCacheRead: numeric("cost_cache_read", { precision: 14, scale: 6 }),
    costCacheWrite: numeric("cost_cache_write", { precision: 14, scale: 6 }),
    costWebSearch: numeric("cost_web_search", { precision: 14, scale: 6 }),
    costRaw: jsonb("cost_raw").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("ai_model_price_history_model_idx").on(
      table.gatewayId,
      table.modelId,
      table.validFrom,
    ),
    foreignKey({
      name: "ai_model_price_history_model_fk",
      columns: [table.gatewayId, table.modelId],
      foreignColumns: [aiModel.gatewayId, aiModel.modelId],
    }).onDelete("cascade"),
  ],
)

// Admin's model choice per AI process (docs/specs/models/03-processes-and-model-selection.md §4).
// The process catalog itself lives in code (src/server/ai/processes.ts); a
// process without a row runs on its code default.
export const aiProcessAssignment = pgTable("ai_process_assignment", {
  processKey: text("process_key").primaryKey(),
  gatewayId: text("gateway_id")
    .notNull()
    .references(() => aiGateway.id),
  primaryModelId: text("primary_model_id").notNull(),
  // Ordered; tried when the primary fails.
  fallbackModelIds: text("fallback_model_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Only for user-selectable processes: the models users may pick.
  allowedModelIds: text("allowed_model_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Optional call settings: { maxOutputTokens?, temperature? }. Applied only
  // when the calling code does not set the value itself.
  settings: jsonb("settings")
    .$type<{ maxOutputTokens?: number; temperature?: number }>()
    .notNull()
    .default({}),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export type AiProcessAssignment = typeof aiProcessAssignment.$inferSelect

// Append-only change log of assignments, so a cost or quality jump can be
// traced to a model change. `before` / `after` = assignment snapshots
// (null before = first choice, null after = reset to default).
export const aiProcessAssignmentLog = pgTable(
  "ai_process_assignment_log",
  {
    id: text("id").primaryKey(),
    processKey: text("process_key").notNull(),
    changedByUserId: text("changed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("ai_process_assignment_log_process_idx").on(
      table.processKey,
      table.changedAt,
    ),
  ],
)

// AI usage ledger (docs/specs/models/04-usage-and-cost.md §2): one row per
// aiGenerateText / aiStreamText call (a multi-step agent call = one row with
// the totals of all steps). Column names follow the OpenTelemetry GenAI
// semantic conventions where one exists, so the ledger can be exported as
// OTel data later. Written by src/server/ai/usage.ts; never by business code.
export const aiUsageEvent = pgTable(
  "ai_usage_event",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(), // span start
    // No FKs on purpose: the ledger outlives deleted orgs / users (billing
    // history), and recording must never fail on a constraint.
    organizationId: text("organization_id"),
    userId: text("user_id"),
    processKey: text("process_key").notNull(),
    operationName: text("operation_name").notNull(), // gen_ai.operation.name
    gatewayId: text("gateway_id").notNull(),
    providerName: text("provider_name"), // gen_ai.provider.name (upstream)
    requestModel: text("request_model").notNull(), // gen_ai.request.model
    responseModel: text("response_model"), // gen_ai.response.model
    responseId: text("response_id"), // gen_ai.response.id (last step)
    // Every step's generation id (multi-step calls), for cost reconcile.
    responseIds: text("response_ids").array(),
    status: text("status").notNull(), // ok | error | aborted
    errorType: text("error_type"), // error.type
    inputTokens: integer("input_tokens"), // gen_ai.usage.input_tokens
    outputTokens: integer("output_tokens"), // gen_ai.usage.output_tokens
    reasoningTokens: integer("reasoning_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    webSearchCount: integer("web_search_count"),
    steps: integer("steps"),
    durationMs: integer("duration_ms"),
    costEstimateUsd: numeric("cost_estimate_usd", { precision: 14, scale: 8 }),
    // Exact cost reported by the gateway (inline or by reconcile).
    costActualUsd: numeric("cost_actual_usd", { precision: 14, scale: 8 }),
    costReconcileAttempts: integer("cost_reconcile_attempts").notNull().default(0),
    // Markup in force at call time (05 §3); null until markup exists (P4).
    markupPercent: numeric("markup_percent", { precision: 6, scale: 2 }),
    ref: jsonb("ref").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("ai_usage_event_org_created_idx").on(table.organizationId, table.createdAt),
    index("ai_usage_event_process_created_idx").on(table.processKey, table.createdAt),
    index("ai_usage_event_model_created_idx").on(table.responseModel, table.createdAt),
    index("ai_usage_event_response_id_idx").on(table.responseId),
    index("ai_usage_event_created_idx").on(table.createdAt),
  ],
)

export type AiUsageEvent = typeof aiUsageEvent.$inferSelect

// Platform-wide settings, key → jsonb value (docs/specs/models/05-markup-and-end-user-cost.md §2).
// Keys and their types/defaults are declared in code
// (src/server/platform-settings.ts); a missing row = the default.
export const platformSetting = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

// Append-only change log of platform settings (old → new, who, when).
export const platformSettingLog = pgTable(
  "platform_setting_log",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    changedByUserId: text("changed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("platform_setting_log_key_idx").on(table.key, table.changedAt),
  ],
)

// ─── Topics phase 0 (docs/specs/topics/03-development-plan.md § Phase 0) ─────

// Per-organization settings, key → jsonb value. Mirrors `platform_setting`:
// keys, types and defaults are declared in code (src/server/org-settings.ts);
// a missing row = the default. E.g. `topics.enabled` (off | shadow | on),
// `ai.budget.daily_usd` (per-org override of the platform default).
export const orgSetting = pgTable(
  "org_setting",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.key] })],
)

// Append-only change log of per-organization settings.
export const orgSettingLog = pgTable(
  "org_setting_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    key: text("key").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    changedByUserId: text("changed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("org_setting_log_org_key_idx").on(table.organizationId, table.key, table.changedAt),
  ],
)

// One row per run of the hourly topics pipeline (runTopicsPipeline).
// `orgs` = per-org outcome { orgId, mode, phases: { name: counts }, error? }.
export const topicsRun = pgTable(
  "topics_run",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    trigger: pipelineRunTrigger("trigger").notNull(),
    status: pipelineRunStatus("status").notNull().default("running"),
    orgsProcessed: integer("orgs_processed").notNull().default(0),
    orgs: jsonb("orgs").$type<Record<string, unknown>[]>().notNull().default([]),
    errorsJson: jsonb("errors_json").$type<Record<string, unknown>[]>().notNull().default([]),
  },
  (table) => [index("topics_run_started_idx").on(table.startedAt)],
)

// Golden set for topics quality gates (spec §12, plan phase 0 task 7):
// real source items of an org, or synthetic messages, with the expected
// signals / subjects / topic group filled in by business reviewers.
export const topicsGoldenItem = pgTable(
  "topics_golden_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Real item, or null for a synthetic message.
    sourceItemId: text("source_item_id").references(() => sourceItem.id, {
      onDelete: "set null",
    }),
    synthetic: boolean("synthetic").notNull().default(false),
    // Synthetic message text (or a frozen copy of the real item's text).
    text: text("text"),
    // Why this item is in the set (e.g. "random sample", "rare code X").
    note: text("note"),
    // Expected result: { codes: [{ code, evidence?, subject? }], topicGroup?, noSignal? }
    expected: jsonb("expected").$type<Record<string, unknown> | null>(),
    // LLM pre-annotation (same shape), kept apart from the human answer.
    preAnnotation: jsonb("pre_annotation").$type<Record<string, unknown> | null>(),
    status: text("status").notNull().default("new"), // new | pre_annotated | reviewed | excluded
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("topics_golden_item_org_idx").on(table.organizationId, table.status),
    uniqueIndex("topics_golden_item_source_uidx")
      .on(table.organizationId, table.sourceItemId)
      .where(sql`${table.sourceItemId} is not null`),
  ],
)

// Results of a model spike / eval run over the golden set (plan phase 0
// task 8, phase 2 eval). One row per (run, item). Cost and tokens are in
// ai_usage_event (ref = { evalRunId, goldenItemId }).
export const topicsEvalResult = pgTable(
  "topics_eval_result",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    organizationId: text("organization_id").notNull(),
    goldenItemId: text("golden_item_id")
      .notNull()
      .references(() => topicsGoldenItem.id, { onDelete: "cascade" }),
    // What was tested: { process, model, promptVariant, codesInPrompt, … }
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    output: jsonb("output").$type<Record<string, unknown> | null>(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("topics_eval_result_run_idx").on(table.runId)],
)

// ─── Signals registry (docs/specs/topics/05-signals-registry.md; plan phase 1) ─
//
// The DB is the master after the v1 seed (custom migration with fixed ids).
// Value lists (class, kind, stage, profile, …) are TEXT columns validated in
// code (src/server/signals/schema.ts), not pg enums, so the editor can evolve
// them without schema migrations. Codes are the stable primary keys.

export const signalPack = pgTable("signal_pack", {
  code: text("code").primaryKey(), // base | distribution | agency | …
  labelRu: text("label_ru").notNull(),
  descriptionRu: text("description_ru"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const signalBlock = pgTable("signal_block", {
  code: text("code").primaryKey(), // A … U (N1 … N4 in older versions)
  packCode: text("pack_code")
    .notNull()
    .references(() => signalPack.code),
  labelRu: text("label_ru").notNull(),
  // client_activity | colleagues_activity | business_info
  audience: text("audience"),
  internalOnly: boolean("internal_only").notNull().default(false),
  firstPartyOnly: boolean("first_party_only").notNull().default(false),
  sort: integer("sort").notNull().default(0),
})

export const signalCategory = pgTable(
  "signal_category",
  {
    code: text("code").primaryKey(),
    packCode: text("pack_code")
      .notNull()
      .references(() => signalPack.code),
    blockCode: text("block_code")
      .notNull()
      .references(() => signalBlock.code),
    family: text("family").notNull(),
    labelRu: text("label_ru").notNull(),
    definitionRu: text("definition_ru").notNull().default(""),
    boundaryRu: text("boundary_ru").notNull().default(""),
    cuesPromptRu: text("cues_prompt_ru").array().notNull().default(sql`'{}'::text[]`),
    // { business?: [], chat?: [], terms?: [], patterns?: [] }
    synonymsRu: jsonb("synonyms_ru").$type<Record<string, string[]>>().notNull().default({}),
    // [{ text, code | null }]
    antiCuesRu: jsonb("anti_cues_ru").$type<{ text: string; code: string | null }[]>().notNull().default([]),
    exampleRu: text("example_ru").notNull().default(""),
    counterExampleRu: text("counter_example_ru").notNull().default(""),
    cardNoteRu: text("card_note_ru").notNull().default(""),
    weight: integer("weight").notNull(),
    scoreRule: text("score_rule").notNull(), // fixed | state | inherited
    class: text("class"), // risk | chance | fyi | null (state)
    classByRelation: boolean("class_by_relation").notNull().default(false),
    kind: text("kind").notNull(), // event | watchdog | derived | trend | state
    effort: text("effort"), // quick | medium | complex | null
    carriesAmount: boolean("carries_amount").notNull().default(false),
    asksUs: boolean("asks_us").notNull().default(false),
    inboundOnly: boolean("inbound_only").notNull().default(false),
    emittedBy: text("emitted_by").notNull().default("parser"), // parser | process | both
    stage: text("stage").notNull().default("active"), // active | onHold | parked | gated
    displayProfile: text("display_profile"), // W1 | D4 | P6 | P8 | S0 | S1 | null
    recipientRole: text("recipient_role"),
    closesCodes: text("closes_codes").array().notNull().default(sql`'{}'::text[]`),
    // { fact, test: within | beyond, settingKey, days? }
    dateGate: jsonb("date_gate").$type<Record<string, unknown> | null>(),
    relevanceDays: integer("relevance_days"),
    // process codes only (05 §3.6)
    triggerRule: jsonb("trigger_rule").$type<Record<string, unknown> | null>(),
    // Free text from the catalog that has no field yet (e.g. "both (mostly …)").
    noteRu: text("note_ru"),
    retiredAt: timestamp("retired_at"),
    successorCode: text("successor_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("signal_category_pack_block_idx").on(table.packCode, table.blockCode),
  ],
)

export const signalAttribute = pgTable("signal_attribute", {
  code: text("code").primaryKey(),
  packCode: text("pack_code")
    .notNull()
    .references(() => signalPack.code),
  groupCode: text("group_code"), // exclusive group (one per item)
  scope: text("scope").notNull().default("message"), // message | account | contact
  labelRu: text("label_ru").notNull(),
  definitionRu: text("definition_ru").notNull().default(""),
  weight: integer("weight").notNull(), // −1 … +2
  stage: text("stage").notNull().default("active"),
  defaultOff: boolean("default_off").notNull().default(false),
  profiles: text("profiles").array().notNull().default(sql`'{}'::text[]`),
  cuesRu: text("cues_ru").array().notNull().default(sql`'{}'::text[]`),
  antiCuesRu: text("anti_cues_ru").array().notNull().default(sql`'{}'::text[]`),
  noteRu: text("note_ru"),
  sort: integer("sort").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const signalRelation = pgTable(
  "signal_relation",
  {
    id: text("id").primaryKey(), // fixed ids for seeded rows, e.g. "rel:outranks:A:B"
    packCode: text("pack_code")
      .notNull()
      .references(() => signalPack.code),
    // outranks | leads_over | both | merges_into | dampens
    kind: text("kind").notNull(),
    codeA: text("code_a").notNull(),
    codeB: text("code_b").notNull(),
    settingKey: text("setting_key"), // dampens: how long (06 §5.2 H4)
    fact: text("fact"), // dampens: fact that bounds it (e.g. promised date)
    noteRu: text("note_ru"),
  },
  (table) => [index("signal_relation_codes_idx").on(table.codeA, table.codeB)],
)

// A vertical pack's override of a base code (05 §5; closes_codes per R12).
// NULL column = no override.
export const signalPackOverride = pgTable(
  "signal_pack_override",
  {
    packCode: text("pack_code")
      .notNull()
      .references(() => signalPack.code),
    code: text("code")
      .notNull()
      .references(() => signalCategory.code),
    weight: integer("weight"),
    displayProfile: text("display_profile"),
    recipientRole: text("recipient_role"),
    stage: text("stage"),
    closesCodes: text("closes_codes").array(),
    noteRu: text("note_ru"),
  },
  (table) => [primaryKey({ columns: [table.packCode, table.code] })],
)

// Per-org activation of packs (tenant data, set in «Сигналы»).
export const organizationSignalPack = pgTable(
  "organization_signal_pack",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    packCode: text("pack_code")
      .notNull()
      .references(() => signalPack.code),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.packCode] })],
)

// Per-org override of a code (stage on/off, weight, profile, recipient).
// closes_codes is NOT overridable per org (05 §5).
export const organizationSignalOverride = pgTable(
  "organization_signal_override",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code")
      .notNull()
      .references(() => signalCategory.code),
    stage: text("stage"),
    weight: integer("weight"),
    displayProfile: text("display_profile"),
    recipientRole: text("recipient_role"),
    // R6: "review" codes = onHold for the live prompt, run in the offline eval.
    reviewOnly: boolean("review_only").notNull().default(false),
    noteRu: text("note_ru"),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.code] })],
)

// Signal → deal effect (spec §9.2). organization_id NULL = a pack TEMPLATE
// (target by stage meaning S1…S5 / won / lost); the admin copies templates
// to an org and maps them to the org's stage ids.
export const signalStageRule = pgTable(
  "signal_stage_rule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    packCode: text("pack_code").references(() => signalPack.code),
    code: text("code")
      .notNull()
      .references(() => signalCategory.code),
    // create_deal | move_stage | in_stage | outcome_won | outcome_lost | pause | …
    effect: text("effect").notNull(),
    targetStageId: text("target_stage_id").references(() => dealFunnelStage.id, { onDelete: "set null" }),
    targetStageMeaning: text("target_stage_meaning"), // templates: S1…S5 / won / lost
    dealTypes: text("deal_types").array().notNull().default(sql`'{}'::text[]`),
    // { minConfidence, minScore, fromStageIds|fromStageMeanings, forwardOnly,
    //   requiresConfirmation, requiresFact, clientGuard }
    guards: jsonb("guards").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    noteRu: text("note_ru"),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("signal_stage_rule_org_code_idx").on(table.organizationId, table.code)],
)

// Deal risk type (platform, per pack; spec §9.4).
export const dealRiskType = pgTable("deal_risk_type", {
  code: text("code").primaryKey(),
  packCode: text("pack_code")
    .notNull()
    .references(() => signalPack.code),
  labelRu: text("label_ru").notNull(),
  descriptionRu: text("description_ru").notNull().default(""),
  // Fixed explanation when the deal-state run returns NOOP (R17).
  explanationRu: text("explanation_ru").notNull().default(""),
  triggerCodes: text("trigger_codes").array().notNull().default(sql`'{}'::text[]`),
  clearCodes: text("clear_codes").array().notNull().default(sql`'{}'::text[]`),
  severity: integer("severity").notNull(),
  minOccurrences: integer("min_occurrences").notNull().default(1),
  condition: text("condition"), // named condition, e.g. distinct_postponements_without_new_date
  scope: text("scope").notNull().default("deal"), // deal | client
  reactionRole: text("reaction_role"),
  stageGuardTemplate: text("stage_guard_template"), // e.g. "S1–S5" (meanings)
  noteRu: text("note_ru"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
})

// Per org: whether a risk type is on, and the org's stages where it applies
// (null = every stage).
export const dealRiskStageGuard = pgTable(
  "deal_risk_stage_guard",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    riskCode: text("risk_code")
      .notNull()
      .references(() => dealRiskType.code),
    enabled: boolean("enabled").notNull().default(true),
    stageIds: text("stage_ids").array(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.riskCode] })],
)

// Taxonomy versions: every accepted registry save creates one; instances,
// topics and cards store the version they were computed with.
export const signalTaxonomyVersion = pgTable("signal_taxonomy_version", {
  version: integer("version").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
})

// Change log of registry edits (one row per changed entity per save).
export const signalRegistryChange = pgTable(
  "signal_registry_change",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    // category | attribute | relation | pack | block | pack_override |
    // org_pack | org_override | stage_rule | risk_type | risk_guard
    entity: text("entity").notNull(),
    entityKey: text("entity_key").notNull(),
    organizationId: text("organization_id"),
    action: text("action").notNull(), // create | update | delete
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    changedByUserId: text("changed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("signal_registry_change_version_idx").on(table.version),
    index("signal_registry_change_entity_idx").on(table.entity, table.entityKey),
  ],
)

// ─── Topics engine: signal extraction (spec topics/01 §5, §11; plan phase 2) ─
//
// Value lists (origin, confidence, status, kind) are text validated in code
// (src/lib/signals/extraction-types.ts), like the registry.

// One signal code found once. Origin `communication` = a source item
// (evidence = verbatim quote); `system_of_record` / `external` come in
// phases 8 / 11 with source_item_id null.
export const signalInstance = pgTable(
  "signal_instance",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    // communication | system_of_record | external
    origin: text("origin").notNull().default("communication"),
    sourceItemId: text("source_item_id").references(() => sourceItem.id, {
      onDelete: "cascade",
    }),
    // AI process (or deterministic gate, e.g. `gate.bounce`) that emitted it.
    processKey: text("process_key"),
    externalUrl: text("external_url"),
    evidence: text("evidence").notNull(),
    // Evidence found in the item's own text (fuzzy, whitespace-insensitive).
    evidenceFound: boolean("evidence_found").notNull().default(true),
    confidence: text("confidence").notNull(), // high | medium | low
    // Index into the item's subjects; -1 = all subjects.
    subjectIndex: integer("subject_index").notNull().default(-1),
    // Counts for the score (§5.4): false for low confidence, outranked,
    // state codes, process codes.
    counted: boolean("counted").notNull().default(false),
    // Why the instance does not count (low_confidence | outranked | state | …).
    notCountedReason: text("not_counted_reason"),
    // Effective weight at extraction time (0 when not counted).
    scoreContrib: integer("score_contrib").notNull().default(0),
    // Topic it was attached to — set by topic resolution (phase 3).
    topicId: text("topic_id").references((): AnyPgColumn => topic.id, {
      onDelete: "set null",
    }),
    taxonomyVersion: integer("taxonomy_version").notNull(),
    // ── Process codes (topics phase 8: CRM checks + watchdogs, 06 §4.2 B5).
    // Dedupe key of the condition the process found, e.g.
    // `client:<id>:last_order:<orderId>`; null for parser instances.
    conditionKey: text("condition_key"),
    // Data of the check (numbers, dates, order / product ids) for the card
    // writer, the drawer and the next check. Shape per code (src/lib/topics/checks.ts).
    facts: jsonb("facts"),
    // Last time the process found the condition still true.
    checkedAt: timestamp("checked_at"),
    // B5: the condition is no longer true → the instance stops scoring.
    clearedAt: timestamp("cleared_at"),
    // Russian reason («Новый заказ № 1250 от 03.12.2026»).
    clearedReason: text("cleared_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signal_instance_condition_uq")
      .on(table.organizationId, table.code, table.conditionKey)
      .where(sql`${table.conditionKey} is not null`),
    index("signal_instance_item_idx").on(table.sourceItemId),
    index("signal_instance_org_code_idx").on(table.organizationId, table.code, table.createdAt),
    index("signal_instance_topic_idx")
      .on(table.topicId)
      .where(sql`${table.topicId} is not null`),
  ],
)

// One (counterparty × matter) pair inside an item (spec §5.3 subjects[]).
// client_id / contact_id are resolved in phase 3 (topic resolution).
export const sourceItemSubject = pgTable(
  "source_item_subject",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => sourceItem.id, { onDelete: "cascade" }),
    subjectIndex: integer("subject_index").notNull(),
    counterparty: text("counterparty").notNull().default(""),
    onBehalfOf: text("on_behalf_of").notNull().default(""),
    matter: text("matter").notNull().default(""),
    // [{ kind: invoice|order|offer|contract|claim|other, value }]
    references: jsonb("references")
      .$type<{ kind: string; value: string }[]>()
      .notNull()
      .default([]),
    products: text("products").array().notNull().default(sql`'{}'::text[]`),
    clientId: text("client_id").references(() => client.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_item_subject_item_idx_uidx").on(table.sourceItemId, table.subjectIndex),
    index("source_item_subject_org_idx").on(table.organizationId),
  ],
)

// ─── Topics engine: topics (spec topics/01 §2, §6, §7, §11; plan phase 3) ──
//
// Value lists (status, sub_state, role, event type, actor) are text validated
// in code (src/lib/topics/types.ts), like the signals tables. Written only by
// `src/server/topics/`. Attention / card / display-profile / owner fields come
// in phase 4.

// One business question between the org and ONE counterparty (a client and /
// or a contact, R14). Matching never uses `title` — only ids, references and
// the matcher (spec §6.3).
export const topic = pgTable(
  "topic",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => client.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "set null" }),
    // Counterparty as the model wrote it (kept for unresolved topics and re-link).
    counterpartyRaw: text("counterparty_raw").notNull().default(""),
    dealId: text("deal_id").references(() => deal.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    // Russian, nominative case (from the subject of the first item).
    matter: text("matter").notNull().default(""),
    // Matter family (signal_category.family of the lead / first code).
    family: text("family"),
    // open | dormant | resolved | done | dismissed | merged | expired | archived
    status: text("status").notNull().default("open"),
    // waiting_on_us | waiting_on_them | none (only meaningful while open)
    subState: text("sub_state").notNull().default("none"),
    leadCode: text("lead_code"),
    class: text("class"), // risk | chance | fyi
    score: integer("score").notNull().default(0),
    band: text("band").notNull().default("none"),
    // Union of the subjects' references, normalised: [{ kind, value, key }]
    references: jsonb("references")
      .$type<{ kind: string; value: string; key: string }[]>()
      .notNull()
      .default([]),
    products: text("products").array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp("first_seen_at").notNull(),
    lastActivityAt: timestamp("last_activity_at").notNull(),
    closedAt: timestamp("closed_at"),
    // closed_by:<CODE> | user_done | user_dismissed | merged
    closedReason: text("closed_reason"),
    relatedTopicId: text("related_topic_id").references((): AnyPgColumn => topic.id, {
      onDelete: "set null",
    }),
    mergedIntoTopicId: text("merged_into_topic_id").references((): AnyPgColumn => topic.id, {
      onDelete: "set null",
    }),
    snoozedUntil: timestamp("snoozed_until"),
    taxonomyVersion: integer("taxonomy_version"),
    // ── Attention (topics plan phase 4, 06-attention-engine.md). Text value
    // lists validated in code (src/lib/topics/attention-types.ts).
    // Display profile after steps G–I: P8 | P6 | D4 | W1 | S0 | null.
    displayProfile: text("display_profile"),
    // List after step J: now («Сейчас») | digest («Сводка») | week («Неделя»)
    // | none (only «Все темы»).
    list: text("list").notNull().default("none"),
    // Full result of computeAttention: score after boosts, rank, deadline,
    // escalations, explanation lines («Почему в этом списке», 06 §11).
    attention: jsonb("attention"),
    // When the hourly run must recompute this topic (06 §10).
    nextAttentionCheckAt: timestamp("next_attention_check_at"),
    // Display cycle (06 §7.1).
    cycleStartedAt: timestamp("cycle_started_at"),
    cycleReminders: integer("cycle_reminders").notNull().default(0),
    cycleReason: text("cycle_reason"),
    // Last evening reminder (phase 7 delivery, 06 §7.3): set by the delivery
    // phase at `eveningDigestTime` (once per local day); drives the in-app
    // «Напоминание» marker and the once-per-evening guard of `cycle_reminders`.
    lastReminderAt: timestamp("last_reminder_at"),
    // Since when the topic waits on us (boost O, 06 §4.4).
    waitingSince: timestamp("waiting_since"),
    snoozedAt: timestamp("snoozed_at"),
    // Assignee for the «Мои» filter (06 §7.2): deal owner, else client's
    // responsible user, else none.
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("topic_org_status_idx").on(table.organizationId, table.status),
    index("topic_org_list_idx").on(table.organizationId, table.list),
    index("topic_org_next_check_idx").on(table.organizationId, table.nextAttentionCheckAt),
    index("topic_org_client_idx").on(table.organizationId, table.clientId),
    index("topic_org_contact_idx").on(table.organizationId, table.contactId),
    index("topic_org_last_activity_idx").on(table.organizationId, table.lastActivityAt),
  ],
)

// Source item (subject) ↔ topic. role: origin | update | closing | context.
export const topicItem = pgTable(
  "topic_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => sourceItem.id, { onDelete: "cascade" }),
    // Index into the item's subjects (-1 = the whole item, e.g. context).
    subjectIndex: integer("subject_index").notNull().default(-1),
    role: text("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("topic_item_topic_item_subject_uidx").on(
      table.topicId,
      table.sourceItemId,
      table.subjectIndex,
    ),
    index("topic_item_topic_idx").on(table.topicId),
    index("topic_item_source_item_idx").on(table.sourceItemId),
  ],
)

// Append-only journal of a topic (created, item attached, closed, reopened,
// timers, user actions, merge, re-link). actor: agent | user.
export const topicEvent = pgTable(
  "topic_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor").notNull().default("agent"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    sourceItemId: text("source_item_id").references(() => sourceItem.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("topic_event_topic_idx").on(table.topicId, table.createdAt)],
)

// «Исключения из анализа» (spec §5.2 gate 3a; Q31, R18): addresses, domains
// and chats of one org that the engine never analyses. Managed by the org
// owner. normalized_value = lower(email) | bare host | chat id / chat name.
export const analysisExclusion = pgTable(
  "analysis_exclusion",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // email | domain | chat
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    note: text("note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_exclusion_org_kind_value_uidx").on(
      table.organizationId,
      table.kind,
      table.normalizedValue,
    ),
  ],
)

// Stored metrics of one eval run over the golden set (plan phase 2 task 8).
// Per-item results stay in topics_eval_result; this row keeps the summary
// (per-code precision / recall, gate verdict) so runs can be compared later
// even after golden items change.
export const topicsEvalRun = pgTable(
  "topics_eval_run",
  {
    id: text("id").primaryKey(), // = topics_eval_result.run_id
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // spike | eval
    kind: text("kind").notNull().default("eval"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    metrics: jsonb("metrics").$type<Record<string, unknown> | null>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("topics_eval_run_org_idx").on(table.organizationId, table.createdAt)],
)

export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  apikey,
  rule,
  client,
  contact,
  task,
  deal,
  dealContact,
  dealFunnelStage,
  source,
  sourceItem,
  pipelineRun,
  card,
  cardClient,
  cardUser,
  cardContact,
}

// Russian production calendar (spec topics/01 §8, 06 §2): one row per
// calendar day that differs from the plain Mon–Fri rule OR every day of a
// seeded year (seed = platform reference data, one custom migration per
// year). Read by the attention engine for working days / hours.
// `is_short` = pre-holiday day shortened by one hour.
export const workCalendarDay = pgTable(
  "work_calendar_day",
  {
    region: text("region").notNull().default("RU"),
    day: date("day", { mode: "string" }).notNull(),
    isWorking: boolean("is_working").notNull(),
    isShort: boolean("is_short").notNull().default(false),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.region, table.day] })],
)

// Append-only history of «Текущее состояние» (spec topics/01 §9.3, phase 5a).
// decision: UPDATE (new text) | NOOP (run, text kept) | FIXED (fixed text:
// no data / won / lost) | REJECTED (server checks refused the model text) |
// USER (manual edit). actor: agent | user.
export const dealStateVersion = pgTable(
  "deal_state_version",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    text: text("text"),
    reason: text("reason"),
    sourceItemIds: text("source_item_ids").array().notNull().default(sql`'{}'::text[]`),
    topicIds: text("topic_ids").array().notNull().default(sql`'{}'::text[]`),
    actor: text("actor").notNull().default("agent"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    model: text("model"),
    aiUsageEventId: text("ai_usage_event_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("deal_state_version_deal_idx").on(table.dealId, table.createdAt)],
)

// Deal risks (spec topics/01 §9.4, phase 5a): one row per activation of a
// `deal_risk_type` on a deal. status: active | cleared. cleared_by: signal |
// outcome | user | state_summary. At most one ACTIVE row per deal and type.
export const dealRisk = pgTable(
  "deal_risk",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    riskType: text("risk_type")
      .notNull()
      .references(() => dealRiskType.code),
    status: text("status").notNull().default("active"),
    severity: integer("severity").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    // Topic that holds the newest trigger instance (its card is forced to UPDATE, R17).
    topicId: text("topic_id").references((): AnyPgColumn => topic.id, { onDelete: "set null" }),
    triggerInstanceIds: text("trigger_instance_ids").array().notNull().default(sql`'{}'::text[]`),
    sourceItemIds: text("source_item_ids").array().notNull().default(sql`'{}'::text[]`),
    // «В чём риск / на чём основана оценка» from deals.state_summary, else null
    // (the UI falls back to deal_risk_type.description_ru, R17).
    explanationRu: text("explanation_ru"),
    explanationSourceItemIds: text("explanation_source_item_ids").array().notNull().default(sql`'{}'::text[]`),
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
    clearedAt: timestamp("cleared_at"),
    clearedBy: text("cleared_by"),
    clearedReason: text("cleared_reason"),
    clearedByUserId: text("cleared_by_user_id").references(() => user.id, { onDelete: "set null" }),
    clearInstanceId: text("clear_instance_id"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deal_risk_deal_idx").on(table.dealId, table.status),
    index("deal_risk_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("deal_risk_active_uq")
      .on(table.dealId, table.riskType)
      .where(sql`${table.status} = 'active'`),
  ],
)

// ── Topics plan phase 7: delivery (spec topics/01 §8.1, 06 §7.3, Q15) ──
// One row per delivery attempt: a digest / reminder email (later Telegram)
// to one user. `local_date` = the org-local day (for the per-day limits and
// the idempotency of digests). channel: email | telegram. kind:
// morning_digest | weekly_digest | evening_reminder | push | test. status:
// sent | failed | skipped. Value lists are text validated in code.
export const topicDelivery = pgTable(
  "topic_delivery",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    kind: text("kind").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    topicIds: text("topic_ids").array().notNull().default(sql`'{}'::text[]`),
    cardIds: text("card_ids").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull(),
    error: text("error"),
    subject: text("subject"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("topic_delivery_org_user_day_idx").on(table.organizationId, table.userId, table.localDate),
    // One morning / weekly digest per user and local day (re-runs are no-ops).
    uniqueIndex("topic_delivery_digest_uq")
      .on(table.organizationId, table.userId, table.channel, table.kind, table.localDate)
      .where(sql`${table.kind} IN ('morning_digest', 'weekly_digest', 'evening_reminder') AND ${table.status} = 'sent'`),
  ],
)

// Per-user delivery choices inside one org (phase 7). No row = defaults
// (all email kinds on). Telegram binding fields are kept for later.
export const topicDeliveryPref = pgTable(
  "topic_delivery_pref",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    emailMorning: boolean("email_morning").notNull().default(true),
    emailWeekly: boolean("email_weekly").notNull().default(true),
    emailEvening: boolean("email_evening").notNull().default(true),
    // Topic pushes in Telegram (docs/specs/telegram/04 TI3): on by default —
    // they need an active Telegram binding of the member anyway (opt-in).
    telegramEnabled: boolean("telegram_enabled").notNull().default(true),
    telegramChatId: text("telegram_chat_id"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
)

// ── Topics plan phase 8: CRM checks + watchdogs (spec topics/01 §5.6,
// 05 §3.6, 06 §4.2 B5). One row per run of one check for one org.
// check_key: see CHECK_KEYS in src/lib/topics/checks.ts. period_key: the
// schedule period (`2026-11-14` daily, `2026-W46` weekly, `2026-11`
// monthly, `run:<runId>` for checks of every hourly run). trigger: schedule
// | manual | preview. status: running | ok | failed | skipped. Value lists
// are text validated in code.
export const topicCheckRun = pgTable(
  "topic_check_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    checkKey: text("check_key").notNull(),
    periodKey: text("period_key").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    // { evaluated, found, created, refreshed, cleared, skipped, ... }
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("topic_check_run_org_check_idx").on(table.organizationId, table.checkKey, table.startedAt),
    // A scheduled check runs once per period (re-runs inside the period are no-ops).
    uniqueIndex("topic_check_run_schedule_uq")
      .on(table.organizationId, table.checkKey, table.periodKey)
      .where(sql`${table.trigger} = 'schedule' AND ${table.status} <> 'failed'`),
  ],
)

// ── Topics plan phase 8 follow-up: catalogue history for the checks
// INTERNAL_PRICE_CHANGE / INTERNAL_PRODUCT_STATUS_UPDATE. The last seen
// state of each product (one row per product); the daily check compares
// the catalogue with it, emits the changes, then writes the new state.
// No row yet = first sight (no signal, 05 §3.6 «no previous snapshot»).
export const productWatchState = pgTable(
  "product_watch_state",
  {
    productId: text("product_id")
      .primaryKey()
      .references(() => product.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 14, scale: 2 }),
    status: text("status"),
    totalStock: integer("total_stock"),
    // Vintage (year) as the catalogue stores it (additional_metadata), text.
    vintage: text("vintage"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    checkedAt: timestamp("checked_at").defaultNow().notNull(),
  },
  (table) => [index("product_watch_state_org_idx").on(table.organizationId)],
)

// ── Identity spec (docs/specs/identity) I1: own organization profile ──────
// Business categories («Отрасль»): platform reference data (rows in a
// migration, fixed codes, ON CONFLICT DO NOTHING). Shared by the org
// profile and (later) client profiles. No ОКВЭД (decision Q2).
export const industry = pgTable("industry", {
  code: text("code").primaryKey(),
  labelRu: text("label_ru").notNull(),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
})

// What the org does (group B of spec §3.1). One row per org; identity data
// (names, domains, mailboxes, staff addresses) stays in `organization` +
// `org_identity_entry`. Lists are jsonb validated in code
// (src/lib/identity/org-profile.ts). Edited by the org OWNER only.
export const orgProfile = pgTable("org_profile", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // «Чем занимается компания», ≤ 500 chars.
  description: text("description"),
  industryCode: text("industry_code").references(() => industry.code, { onDelete: "set null" }),
  // «Комментарий к отрасли».
  industryNote: text("industry_note"),
  // «Роль на рынке»: MARKET_ROLES codes.
  marketRoles: text("market_roles").array().notNull().default(sql`'{}'::text[]`),
  // «Продукты и услуги»: [{ name, description?, categories?[] }]
  products: jsonb("products").$type<{ name: string; description?: string; categories?: string[] }[]>().notNull().default([]),
  // «Наши клиенты»: [{ name, description? }]
  targetCustomers: jsonb("target_customers").$type<{ name: string; description?: string }[]>().notNull().default([]),
  // «Кто продаёт нам»: [{ name, description? }]
  supplierTypes: jsonb("supplier_types").$type<{ name: string; description?: string }[]>().notNull().default([]),
  geography: text("geography"),
  // «Наши термины»: [{ term, meaning }]
  glossary: jsonb("glossary").$type<{ term: string; meaning: string }[]>().notNull().default([]),
  // «Нет своего домена (почта на общих сервисах)».
  noOwnDomain: boolean("no_own_domain").notNull().default(false),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

// Change log of `org_profile` (who, when, before / after of changed fields).
export const orgProfileLog = pgTable(
  "org_profile_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    changedByUserId: text("changed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("org_profile_log_org_idx").on(table.organizationId, table.createdAt)],
)

// ── Identity spec I5 / I6: client business profile («Профиль компании») ───
// One row per client (spec §4.1). Lists are jsonb validated in code
// (src/lib/identity/client-profile.ts). `field_meta` = provenance per field
// { source: manual | web | communications | import, byUserId?, at,
// confidence?, evidenceUrl?, verified }. Edited by the client's responsible
// member and the org owner (Q3); web data fills EMPTY fields only (Q5).
export const clientProfile = pgTable(
  "client_profile",
  {
    clientId: text("client_id")
      .primaryKey()
      .references(() => client.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // «Чем занимается», ≤ 500 chars.
    description: text("description"),
    industryCode: text("industry_code").references(() => industry.code, { onDelete: "set null" }),
    industryNote: text("industry_note"),
    // «Роль на рынке»: MARKET_ROLES codes (same list as the org profile).
    marketRoles: text("market_roles").array().notNull().default(sql`'{}'::text[]`),
    // «Продукты и услуги клиента»: [{ name }] ≤ 15.
    products: jsonb("products").$type<{ name: string }[]>().notNull().default([]),
    // «Что им интересно у нас»: { lines: our product line names[], note? }.
    needs: jsonb("needs").$type<{ lines: string[]; note?: string }>().notNull().default({ lines: [] }),
    // «Размер»: CLIENT_SIZE_BANDS code; `points_of_sale` for a chain.
    sizeBand: text("size_band"),
    pointsOfSale: integer("points_of_sale"),
    geography: text("geography"),
    // Provenance per field: { [field]: FieldMeta }.
    fieldMeta: jsonb("field_meta").$type<Record<string, unknown>>().notNull().default({}),
    // Last web enrichment of the profile (refresh rule: older than 180 days).
    webEnrichedAt: timestamp("web_enriched_at"),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("client_profile_org_idx").on(table.organizationId),
    index("client_profile_org_industry_idx").on(table.organizationId, table.industryCode),
  ],
)

// Automatic value for a field that already has a manual value (spec §4.3):
// the responsible KAM accepts or rejects it. status: pending | accepted |
// rejected | superseded (a newer proposal for the same field).
export const clientProfileProposal = pgTable(
  "client_profile_proposal",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    confidence: text("confidence"),
    evidenceUrl: text("evidence_url"),
    status: text("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("client_profile_proposal_client_idx").on(table.clientId, table.status),
    index("client_profile_proposal_org_idx").on(table.organizationId, table.status),
  ],
)

// ── Funnel templates (docs/specs/funnel §3.7) — PLATFORM reference data ──
// Rows come from migrations with fixed codes (ON CONFLICT DO NOTHING);
// `config` = FunnelConfig (src/lib/funnel/config.ts), generic wording only.
export const funnelTemplate = pgTable("funnel_template", {
  code: text("code").primaryKey(),
  labelRu: text("label_ru").notNull(),
  description: text("description"),
  sort: integer("sort").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
})

// ── Documents (docs/specs/attachments §3.3) ───────────────────────────────
// Many-to-many: a document (file `source_item`) ↔ company / contact / deal /
// task / order. `entity_type` / `origin` / `confidence` are text validated in
// code (src/lib/documents.ts). A person's «Отвязать» keeps the row with
// `removed_at`, so the automatic step never adds the same link again.
export const documentLink = pgTable(
  "document_link",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => sourceItem.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    origin: text("origin").notNull(),
    confidence: text("confidence").notNull().default("high"),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    removedAt: timestamp("removed_at"),
    removedByUserId: text("removed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("document_link_item_entity_uq").on(table.sourceItemId, table.entityType, table.entityId),
    index("document_link_entity_idx").on(table.organizationId, table.entityType, table.entityId),
  ],
)

// ── Custom fields of companies and contacts (docs/specs/clients-contacts) ──
// Org-scoped field definitions; the org OWNER manages them, every member
// edits the values (`client.custom_values` / `contact.custom_values`, keyed
// by the field id). `entity` client | contact and `type` are text validated
// in code (src/lib/custom-fields.ts). «Удалить» = `archived_at`.
export const customField = pgTable(
  "custom_field",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    // { options?: [{ id, label, archived? }], currency?, decimals?, multiline? }
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    helpText: text("help_text"),
    section: text("section"),
    isShown: boolean("is_shown").notNull().default(true),
    // «Показывать в списке»: a column on /clients or /contacts (spec §3.3).
    showInList: boolean("show_in_list").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("custom_field_org_entity_idx").on(table.organizationId, table.entity, table.position)],
)

// One row per changed custom value (Q9): who, when, before, after.
export const customFieldValueLog = pgTable(
  "custom_field_value_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    fieldId: text("field_id")
      .notNull()
      .references(() => customField.id, { onDelete: "cascade" }),
    before: jsonb("before"),
    after: jsonb("after"),
    changedByUserId: text("changed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("custom_field_value_log_entity_idx").on(table.organizationId, table.entity, table.entityId, table.createdAt)],
)

// ── Contact ↔ company links over time (docs/specs/clients-contacts/04) ─────
// Value lists are text validated in code (src/lib/contact-links.ts).

// One row per contact × company period. relation employee | consultant |
// representative | other; status current | former; exactly one primary among
// the current links (mirrored to `contact.client_id`).
export const contactCompanyLink = pgTable(
  "contact_company_link",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    relation: text("relation").notNull().default("employee"),
    status: text("status").notNull().default("current"),
    isPrimary: boolean("is_primary").notNull().default(false),
    position: text("position"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    // manual | discovery | proposal | implicit (the pre-existing client_id) | merge
    source: text("source").notNull().default("manual"),
    evidenceSourceItemId: text("evidence_source_item_id").references(() => sourceItem.id, { onDelete: "set null" }),
    endReason: text("end_reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    endedByUserId: text("ended_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_company_link_contact_idx").on(table.contactId, table.status),
    index("contact_company_link_client_idx").on(table.organizationId, table.clientId, table.status),
  ],
)

// Extra addresses of one person (Q2). `contact.email` / `phone` stay the
// primary active ones; this table holds the rest (old X address, second
// company address, Telegram). `value` is normalised (lower-case email, digits
// of a phone, handle without «@»).
export const contactAddress = pgTable(
  "contact_address",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    // active | old
    status: text("status").notNull().default("active"),
    clientId: text("client_id").references(() => client.id, { onDelete: "set null" }),
    // manual | proposal | merge | discovery
    source: text("source").notNull().default("manual"),
    firstSeenAt: timestamp("first_seen_at"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contact_address_contact_value_uq").on(table.contactId, table.kind, table.value),
    index("contact_address_org_value_idx").on(table.organizationId, table.kind, table.value),
  ],
)

// A proposal that a contact changed company / works for two companies / is a
// second record of the same person (rules P1–P5, §4). A person decides (Q4).
export const contactLinkProposal = pgTable(
  "contact_link_proposal",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    // A second record of the same person (merged on «Перешёл» / «Работает с обеими»).
    candidateContactId: text("candidate_contact_id").references((): AnyPgColumn => contact.id, { onDelete: "cascade" }),
    fromClientId: text("from_client_id").references(() => client.id, { onDelete: "set null" }),
    toClientId: text("to_client_id").references(() => client.id, { onDelete: "set null" }),
    // The new address seen (email / phone / telegram), normalised.
    newAddressKind: text("new_address_kind"),
    newAddress: text("new_address"),
    // A company name seen for Y when Y is not a client yet («Создать компанию Y»).
    toCompanyName: text("to_company_name"),
    // moved | second_company | same_person | left
    kind: text("kind").notNull(),
    confidence: text("confidence").notNull().default("medium"),
    // P1 … P5
    rule: text("rule").notNull(),
    // { sourceItemIds: string[], quote?: string, date?: string }
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    evidenceAt: timestamp("evidence_at"),
    // Dedupe key of the pair (contact + candidate / address / company).
    pairKey: text("pair_key").notNull(),
    // pending | accepted | rejected | superseded
    status: text("status").notNull().default("pending"),
    // moved | both | other_person
    decision: text("decision"),
    snoozedUntil: timestamp("snoozed_until"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contact_link_proposal_contact_idx").on(table.contactId, table.status),
    index("contact_link_proposal_org_idx").on(table.organizationId, table.status),
    uniqueIndex("contact_link_proposal_pair_uq").on(table.organizationId, table.pairKey),
  ],
)

// Journal of link changes (add, end, primary, decision, merge). Append-only.
export const contactLinkEvent = pgTable(
  "contact_link_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("contact_link_event_contact_idx").on(table.contactId, table.createdAt)],
)

// ── Notifications (docs/specs/notifications) ───────────────────────────────
// One row per RECIPIENT. `kind` / `category` / `priority` are text validated
// in code (src/lib/notifications/kinds.ts). `dedupe_key` (namespaced with
// the org id by the engine) makes a condition notify a person once.
// `organization_id` null = a platform notification (platform admins, shown
// in every org). Written only through src/server/notifications/.
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    // important | info
    priority: text("priority").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    readAt: timestamp("read_at"),
    dismissedAt: timestamp("dismissed_at"),
    // The condition is gone («уже не актуально»).
    resolvedAt: timestamp("resolved_at"),
    // Hidden after this (info 3 days, important 5 days — Q11).
    expiresAt: timestamp("expires_at").notNull(),
    // Telegram copy of an important notification (telegram/04 Q21): null = not
    // decided yet (e.g. outside working hours → the hourly sweep); sent |
    // failed | blocked | no_binding | opted_out | stale | not_sent.
    telegramStatus: text("telegram_status"),
    telegramAt: timestamp("telegram_at"),
  },
  (table) => [
    uniqueIndex("notification_user_dedupe_uq").on(table.userId, table.dedupeKey),
    index("notification_user_list_idx").on(table.userId, table.expiresAt, table.createdAt),
    index("notification_dedupe_idx").on(table.dedupeKey),
    index("notification_tg_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.priority} = 'important' and ${table.telegramStatus} is null`),
  ],
)

// Per user and org: categories switched off in the app (Q8). No row = all on.
export const notificationPref = pgTable(
  "notification_pref",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // { [category]: false } — absent = on
    categories: jsonb("categories").$type<Record<string, boolean>>().notNull().default({}),
    // Telegram copies of IMPORTANT notifications (telegram/04 Q21): { [category]: false } — absent = on.
    telegramCategories: jsonb("telegram_categories").$type<Record<string, boolean>>().notNull().default({}),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
)

// ── AI chat history (docs/specs/ai-chat/01-specification.md §16.1, CH5) ──
// One thread per conversation of ONE user in ONE org (Q16). Business data,
// not private (Q21) — the panel lists only the user's own threads, and the
// content reaches the org through the «AI Chat» source (CH6).
export const aiChatThread = pgTable(
  "ai_chat_thread",
  {
    // Client-generated (the browser opens a new chat before the first send).
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // First user question (≤ 60 chars), the user can rename.
    title: text("title").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    // §16.3 (CH6): on = segments go to the org's «AI Chat» source; off = «Не передавать в источники».
    ingestMode: text("ingest_mode").notNull().default("on"),
    // Last message seq already sent to sources (CH6); 0 = none.
    ingestedSeq: integer("ingested_seq").notNull().default(0),
    // Soft delete by the user; the daily pipeline removes the row later.
    deletedAt: timestamp("deleted_at"),
    // web | telegram (docs/specs/ai-chat-telegram §5): where the thread is written.
    channel: text("channel").notNull().default("web"),
  },
  (table) => [
    index("ai_chat_thread_user_list_idx")
      .on(table.organizationId, table.userId, table.lastMessageAt)
      .where(sql`${table.deletedAt} is null`),
    index("ai_chat_thread_last_message_idx").on(table.lastMessageAt),
  ],
)

// One UI message of a thread. `parts` = the AI SDK UI message parts as the
// user saw them: text, files, our data parts (records / stats / evidence /
// turn); never tool calls, reasoning or admin debug (§9).
export const aiChatMessage = pgTable(
  "ai_chat_message",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => aiChatThread.id, { onDelete: "cascade" }),
    // 1, 2, 3 … per thread.
    seq: integer("seq").notNull(),
    // user | assistant
    role: text("role").notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Q14: up | down | null (assistant messages only) + optional comment.
    feedback: text("feedback"),
    feedbackComment: text("feedback_comment"),
    feedbackAt: timestamp("feedback_at"),
  },
  (table) => [uniqueIndex("ai_chat_message_thread_seq_uq").on(table.threadId, table.seq)],
)

// AI chat actions (docs/specs/ai-chat-tools §13, phase T1): one row per draft
// group the chat prepared (company, contact, company + contacts, …). The model
// only proposes; a record is created when the user confirms the card
// (`POST /api/chat/actions`). The row is the audit of what was created from
// which chat / message / files (decision Q15: no column on the records).
export const aiChatAction = pgTable(
  "ai_chat_action",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Kept when the chat is purged (90 days) — the audit row stays.
    threadId: text("thread_id").references(() => aiChatThread.id, { onDelete: "set null" }),
    // The assistant message that carries the draft card.
    messageId: text("message_id"),
    // company | contact | company_contact (T1); later deal / task / tasks / update / link
    kind: text("kind").notNull(),
    // draft | needs_input | created | partly_created | cancelled | expired | failed
    status: text("status").notNull().default("draft"),
    // Items with values, per-field source, removed values, matches, checks (src/lib/chat/actions.ts).
    draft: jsonb("draft").$type<unknown>().notNull(),
    // What the user confirmed (edited values + decisions).
    confirmedValues: jsonb("confirmed_values").$type<unknown>(),
    // [{ type, id, title, existing? }]
    results: jsonb("results").$type<unknown[]>(),
    // Chat files (source items) the draft came from.
    sourceItemIds: text("source_item_ids").array().notNull().default(sql`'{}'::text[]`),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (table) => [
    index("ai_chat_action_user_idx").on(table.organizationId, table.userId, table.createdAt),
    index("ai_chat_action_thread_idx").on(table.threadId),
  ],
)

// ── Telegram: staff binding, router, sender, AI chat over Telegram ──────
// Specs: docs/specs/telegram/04-identity-and-chats.md §5 / §5.5 and
// docs/specs/ai-chat-telegram/01-specification.md §5.

// A VERIFIED link member ↔ Telegram account through the org bot (one row per
// org × member × bot; history kept: a re-bind makes a new row). Gives the
// inbound identity AND the outbound address. Value lists are text checked in
// code: status active | blocked (the user blocked the bot) | unbound.
export const telegramBinding = pgTable(
  "telegram_binding",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Numeric Telegram user id (never changes) as text — ids exceed 2^31.
    tgUserId: text("tg_user_id").notNull(),
    tgUsername: text("tg_username"),
    tgName: text("tg_name"),
    // Private chat id for sending (= tg_user_id).
    chatId: text("chat_id").notNull(),
    status: text("status").notNull().default("active"),
    // The member's current AI chat thread in Telegram (ai-chat-telegram §9).
    aiChatThreadId: text("ai_chat_thread_id").references(() => aiChatThread.id, { onDelete: "set null" }),
    // One AI chat worker at a time per member (ai-chat-telegram §5 worker lock).
    chatLockUntil: timestamp("chat_lock_until"),
    chatLockToken: text("chat_lock_token"),
    boundAt: timestamp("bound_at").defaultNow().notNull(),
    unboundAt: timestamp("unbound_at"),
    unboundReason: text("unbound_reason"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_binding_active_tg_uq")
      .on(table.sourceId, table.tgUserId)
      .where(sql`${table.status} <> 'unbound'`),
    uniqueIndex("telegram_binding_active_user_uq")
      .on(table.sourceId, table.userId)
      .where(sql`${table.status} <> 'unbound'`),
    index("telegram_binding_org_idx").on(table.organizationId, table.status),
  ],
)

// One-time binding code of the deep link `t.me/<bot>?start=<code>` (§5.2):
// stored hashed, single use, 15 minutes.
export const telegramBindCode = pgTable(
  "telegram_bind_code",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("telegram_bind_code_hash_uq").on(table.codeHash)],
)

// Handled updates per bot (§5.5 C5): Telegram re-sends an update that got no
// answer — handle each update id once. Rows older than 7 days are removed.
export const telegramUpdateSeen = pgTable(
  "telegram_update_seen",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    updateId: bigint("update_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.updateId] }),
    index("telegram_update_seen_created_idx").on(table.createdAt),
  ],
)

// Inline button ids (§5.5 C6): `callback_data` is ≤ 64 bytes, so a button
// carries a short random id that maps to the action, the member and an expiry.
export const telegramButton = pgTable(
  "telegram_button",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => telegramBinding.id, { onDelete: "cascade" }),
    // card_confirm | card_cancel | card_decision | question_option | stats_csv | retry | feedback
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // The Telegram message that carries the button (edited after a press).
    tgMessageId: integer("tg_message_id"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("telegram_button_binding_idx").on(table.bindingId, table.createdAt)],
)

// Every message the bot sent (one sender, §5.5 C6): status, Telegram message
// id and what it was about — for replies (ai-chat-telegram Q9), card edits,
// feedback buttons and the log. kind = binding | chat_answer | chat_card |
// chat_question | chat_sources | chat_notice | chat_status | chat_csv | system.
export const telegramOutMessage = pgTable(
  "telegram_out_message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    bindingId: text("binding_id").references(() => telegramBinding.id, { onDelete: "set null" }),
    chatId: text("chat_id").notNull(),
    kind: text("kind").notNull(),
    // sent | failed | skipped
    status: text("status").notNull(),
    error: text("error"),
    tgMessageId: integer("tg_message_id"),
    aiChatThreadId: text("ai_chat_thread_id").references(() => aiChatThread.id, { onDelete: "set null" }),
    aiChatMessageId: text("ai_chat_message_id"),
    // The record a message is about, e.g. { type: "topic", id } (context of a reply).
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("telegram_out_message_chat_idx").on(table.sourceId, table.chatId, table.tgMessageId),
    index("telegram_out_message_created_idx").on(table.createdAt),
  ],
)

// Inbox of a member's private-chat messages for the AI chat (ai-chat-telegram
// §5–§6): the router writes one row per update and answers 200 at once; the
// worker merges close rows into ONE chat turn. status = pending | processing
// | done | failed. kind = text | voice | file | contact | forward | option.
export const telegramChatInbox = pgTable(
  "telegram_chat_inbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => telegramBinding.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    tgMessageId: integer("tg_message_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    mediaGroupId: text("media_group_id"),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    aiChatThreadId: text("ai_chat_thread_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [index("telegram_chat_inbox_binding_idx").on(table.bindingId, table.status, table.createdAt)],
)

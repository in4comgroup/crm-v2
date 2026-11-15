import "server-only"
import { randomUUID } from "crypto"
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { organization, source, sourceItem, topicsGoldenItem } from "@/db/schema"
import {
  normalizeGoldenExpected,
  readGoldenExpected,
  readTopicGroups,
  reviewReadinessError,
  topicGroupKey,
} from "@/lib/topics/golden-expected"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import { loadEngineTopicsBySourceItem } from "@/server/topics/eval/grouping"
import type { ExtractionEnvelope } from "@/server/topics/prompt/extraction"
import { loadPromptCodes } from "@/server/topics/prompt/extraction"
import { runExtraction } from "@/server/topics/prompt/run-extraction"
import { messageContent } from "@/server/topics/signals/evidence"
import { envelopeFromItem, itemMarkdown, mapPool } from "@/server/topics/signals/item-input"
import {
  counterpartyLineForItem,
  loadExtractionCounterparties,
  type ExtractionCounterparties,
} from "@/server/topics/signals/counterparty-line"

// Golden set for the topics quality gates (spec 01 §12, plan phase 0 task 7).
// Every function takes the org id explicitly (`server-only`). Callers: the
// platform-admin route /api/admin/topics/golden (session check there) and the
// session-bound reviewer wrapper src/server/topics/golden-review.ts
// (/api/topics/golden, org owner / admin of the ACTIVE org: review actions
// only — read, save expected, mark reviewed, exclude).
//
// Real items: parsed, non-junk ROOT source items of the org. Their markdown
// is frozen into `text` at sampling time, so a later reparse or teardown does
// not change the set. Synthetic items: free text typed by the admin.

export const GOLDEN_STATUSES = ["new", "pre_annotated", "reviewed", "excluded"] as const
export type GoldenStatus = (typeof GOLDEN_STATUSES)[number]

/** Non-retired registry codes (cached registry, ≤ 60 s). */
async function knownSignalCodes(): Promise<Set<string>> {
  const registry = await getRegistry()
  return new Set(registry.categories.filter((c) => !c.retiredAt).map((c) => c.code))
}

/**
 * Human answer (and pre-annotation) shape; codes must be registry codes.
 * Stored form: src/lib/topics/golden-expected.ts (`topicGroups` list; the
 * old `topicGroup` string is still accepted and folded into it on save).
 */
export const goldenExpectedSchema = (knownCodes: Set<string>) =>
  z
    .object({
      codes: z.array(
        z
          .object({
            code: z
              .string()
              .min(1)
              .refine((c) => knownCodes.has(c), { message: "Неизвестный код сигнала" }),
            evidence: z.string().optional(),
            subject: z.string().optional(),
          })
          .passthrough(),
      ),
      noSignal: z.boolean().optional(),
      topicGroups: z.array(z.string()).optional(),
      topicGroup: z.string().optional(),
      reviewNote: z.string().optional(),
    })
    .passthrough()

export type GoldenExpected = z.infer<ReturnType<typeof goldenExpectedSchema>>

export class GoldenSetError extends Error {
  constructor(
    message: string,
    public reason: "not_found" | "invalid" = "invalid",
  ) {
    super(message)
  }
}

export type GoldenWorkItem = {
  id: string
  synthetic: boolean
  text: string
  envelope: ExtractionEnvelope
  /** Parse-time authorship (null for synthetic items) and item date — for post-processing. */
  orgAttribution: string | null
  date: Date | null
}

/**
 * Text + envelope of golden items (for extraction). Items without text are
 * left out. `counterparties` (identity I4, only when the org profile is in the
 * prompt) adds the «Контрагент: …» line to real items with a known client.
 */
export async function loadGoldenWorkItems(
  orgId: string,
  ids: string[],
  opts: { counterparties?: ExtractionCounterparties | null } = {},
): Promise<GoldenWorkItem[]> {
  if (ids.length === 0) return []
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
  const rows = await db
    .select({
      id: topicsGoldenItem.id,
      synthetic: topicsGoldenItem.synthetic,
      text: topicsGoldenItem.text,
      createdAt: topicsGoldenItem.createdAt,
      provider: source.provider,
      externalType: sourceItem.externalType,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      orgAttribution: sourceItem.orgAttribution,
      metadataJson: sourceItem.metadataJson,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
    })
    .from(topicsGoldenItem)
    .leftJoin(sourceItem, eq(sourceItem.id, topicsGoldenItem.sourceItemId))
    .leftJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(eq(topicsGoldenItem.organizationId, orgId), inArray(topicsGoldenItem.id, ids)))
  const out = await mapPool(rows, 5, async (r): Promise<GoldenWorkItem | null> => {
    const raw = r.text ?? (await itemMarkdown(r))
    const text = raw ? messageContent(raw) : null
    if (!text?.trim()) return null
    const envelope: ExtractionEnvelope = r.synthetic
      ? { synthetic: true, date: r.createdAt.toISOString() }
      : envelopeFromItem(r, text)
    envelope.orgName = org?.name ?? null
    if (!r.synthetic && opts.counterparties) {
      envelope.counterpartyLine = await counterpartyLineForItem(opts.counterparties, r, envelope)
    }
    return {
      id: r.id,
      synthetic: r.synthetic,
      text,
      envelope,
      orgAttribution: r.synthetic ? null : r.orgAttribution,
      date: r.synthetic ? r.createdAt : (r.sourceCreatedAt ?? r.createdAt),
    }
  })
  const byId = new Map(out.filter((x): x is GoldenWorkItem => x !== null).map((x) => [x.id, x]))
  return ids.map((id) => byId.get(id)).filter((x): x is GoldenWorkItem => !!x)
}

// ── Org picker ────────────────────────────────────────────────────────────

export async function listGoldenOrgOptions(): Promise<{ id: string; name: string; goldenItems: number }[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      goldenItems: sql<number>`(select count(*)::int from ${topicsGoldenItem} g where g.organization_id = ${organization.id})`,
    })
    .from(organization)
    .orderBy(asc(organization.name))
  return rows
}

// ── Sampling ──────────────────────────────────────────────────────────────

/**
 * Add up to `count` parsed, non-junk root items of the org from the last
 * `days` days that are not in the set yet. Providers are mixed round-robin,
 * most recent first within each provider.
 */
export async function sampleGoldenItems(
  orgId: string,
  opts: { count: number; days: number },
): Promise<{ added: number; candidates: number; byProvider: Record<string, number> }> {
  const want = Math.max(1, Math.min(200, Math.floor(opts.count)))
  const days = Math.max(1, Math.min(3650, Math.floor(opts.days)))
  const itemDate = sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.fetchedAt})`
  const candidates = await db
    .select({
      id: sourceItem.id,
      provider: source.provider,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        sql`${sourceItem.parentSourceItemId} is null`,
        eq(sourceItem.parseStatus, "complete"),
        sql`(${sourceItem.parsedMarkdown} is not null or ${sourceItem.markdownR2Key} is not null)`,
        sql`coalesce((${sourceItem.metadataJson}->'relevance'->>'isJunk')::boolean, false) = false`,
        sql`${source.provider} <> 'aichat'`,
        sql`${itemDate} >= now() - make_interval(days => ${days})`,
        sql`not exists (select 1 from ${topicsGoldenItem} g where g.organization_id = ${orgId} and g.source_item_id = ${sourceItem.id})`,
      ),
    )
    .orderBy(desc(itemDate))
    .limit(Math.min(2000, want * 4))

  // Round-robin across providers.
  const queues = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const q = queues.get(c.provider) ?? []
    q.push(c)
    queues.set(c.provider, q)
  }
  const ordered: typeof candidates = []
  while (ordered.length < candidates.length) {
    for (const q of queues.values()) {
      const next = q.shift()
      if (next) ordered.push(next)
    }
  }

  const byProvider: Record<string, number> = {}
  let added = 0
  // Read texts in small chunks until enough non-empty items are added.
  let pos = 0
  while (pos < ordered.length && added < want) {
    const chunk = ordered.slice(pos, pos + Math.min(10, want - added + 2))
    pos += chunk.length
    const texts = await mapPool(chunk, 5, (c) => itemMarkdown(c))
    const rows = chunk
      .map((c, k) => ({ c, text: texts[k] }))
      .filter((x) => x.text && x.text.trim().length > 0)
      .slice(0, want - added)
    if (rows.length === 0) continue
    const inserted = await db
      .insert(topicsGoldenItem)
      .values(
        rows.map(({ c, text }) => ({
          id: randomUUID(),
          organizationId: orgId,
          sourceItemId: c.id,
          synthetic: false,
          text,
          note: `выборка ${days} дн.`,
          status: "new",
        })),
      )
      .onConflictDoNothing()
      .returning({ id: topicsGoldenItem.id, sourceItemId: topicsGoldenItem.sourceItemId })
    for (const r of inserted) {
      const p = rows.find((x) => x.c.id === r.sourceItemId)?.c.provider ?? "unknown"
      byProvider[p] = (byProvider[p] ?? 0) + 1
    }
    added += inserted.length
  }
  return { added, candidates: candidates.length, byProvider }
}

export async function addSyntheticItem(
  orgId: string,
  input: { text: string; note?: string | null },
): Promise<{ id: string }> {
  const text = input.text.trim()
  if (!text) throw new GoldenSetError("Текст сообщения пуст")
  if (text.length > 50_000) throw new GoldenSetError("Текст длиннее 50 000 символов")
  const id = randomUUID()
  await db.insert(topicsGoldenItem).values({
    id,
    organizationId: orgId,
    synthetic: true,
    text,
    note: input.note?.trim() || null,
    status: "new",
  })
  return { id }
}

// ── Listing / review ──────────────────────────────────────────────────────

export type GoldenDirection = "inbound" | "outbound" | "internal"

export type GoldenListRow = {
  id: string
  synthetic: boolean
  sourceItemId: string | null
  provider: string | null
  kind: string | null
  itemDate: string | null
  subject: string | null
  textPreview: string
  textChars: number
  status: string
  note: string | null
  expectedCodes: string[] | null
  preCodes: string[] | null
  /** Expected topic groups; null = the field is not set. */
  topicGroups: string[] | null
  reviewedAt: string | null
  createdAt: string
}

const codesOf = (v: Record<string, unknown> | null): string[] | null => {
  if (!v || !Array.isArray(v.codes)) return null
  return (v.codes as { code?: unknown }[])
    .map((c) => (typeof c?.code === "string" ? c.code : ""))
    .filter(Boolean)
}

export type GoldenListFilters = {
  status?: string | null
  synthetic?: "real" | "synthetic" | null
  /** true = only items with a pre-annotation, false = only without. */
  suggestions?: boolean | null
  limit?: number
  offset?: number
}

export async function listGoldenItems(
  orgId: string,
  filters: GoldenListFilters = {},
): Promise<{ rows: GoldenListRow[]; total: number; counts: Record<string, number> }> {
  const conds: SQL[] = [eq(topicsGoldenItem.organizationId, orgId)]
  if (filters.status) conds.push(eq(topicsGoldenItem.status, filters.status))
  if (filters.synthetic === "real") conds.push(eq(topicsGoldenItem.synthetic, false))
  if (filters.synthetic === "synthetic") conds.push(eq(topicsGoldenItem.synthetic, true))
  if (filters.suggestions === true) conds.push(isNotNull(topicsGoldenItem.preAnnotation))
  if (filters.suggestions === false) conds.push(isNull(topicsGoldenItem.preAnnotation))
  const where = and(...conds)
  const limit = Math.max(1, Math.min(500, filters.limit ?? 100))
  const offset = Math.max(0, filters.offset ?? 0)

  const [rows, [{ total }], countRows] = await Promise.all([
    db
      .select({
        id: topicsGoldenItem.id,
        synthetic: topicsGoldenItem.synthetic,
        sourceItemId: topicsGoldenItem.sourceItemId,
        provider: source.provider,
        kind: sourceItem.externalType,
        itemDate: sourceItem.sourceCreatedAt,
        subject: sql<string | null>`${sourceItem.metadataJson}->>'subject'`,
        textPreview: sql<string>`left(coalesce(${topicsGoldenItem.text}, ''), 300)`,
        textChars: sql<number>`length(coalesce(${topicsGoldenItem.text}, ''))::int`,
        status: topicsGoldenItem.status,
        note: topicsGoldenItem.note,
        expected: topicsGoldenItem.expected,
        preAnnotation: topicsGoldenItem.preAnnotation,
        reviewedAt: topicsGoldenItem.reviewedAt,
        createdAt: topicsGoldenItem.createdAt,
      })
      .from(topicsGoldenItem)
      .leftJoin(sourceItem, eq(sourceItem.id, topicsGoldenItem.sourceItemId))
      .leftJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where)
      .orderBy(desc(topicsGoldenItem.createdAt), asc(topicsGoldenItem.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(topicsGoldenItem).where(where),
    db
      .select({ status: topicsGoldenItem.status, n: count() })
      .from(topicsGoldenItem)
      .where(eq(topicsGoldenItem.organizationId, orgId))
      .groupBy(topicsGoldenItem.status),
  ])
  return {
    rows: rows.map((r) => ({
      id: r.id,
      synthetic: r.synthetic,
      sourceItemId: r.sourceItemId,
      provider: r.provider,
      kind: r.kind,
      itemDate: (r.itemDate ?? (r.synthetic ? r.createdAt : null))?.toISOString() ?? null,
      subject: r.subject,
      textPreview: r.textPreview,
      textChars: r.textChars,
      status: r.status,
      note: r.note,
      expectedCodes: codesOf(r.expected),
      preCodes: codesOf(r.preAnnotation),
      topicGroups: readTopicGroups(r.expected),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    counts: Object.fromEntries(countRows.map((c) => [c.status, c.n])),
  }
}

export type GoldenItemDetail = GoldenListRow & {
  organizationId: string
  text: string
  /** The message the model judges (`## Content` of the markdown; synthetic = the text). */
  contentText: string
  /** inbound / outbound / internal when known (signal run, else authorship). */
  direction: GoldenDirection | null
  directionSource: "signals" | "attribution" | null
  from: string | null
  expected: Record<string, unknown> | null
  preAnnotation: Record<string, unknown> | null
}

function directionOf(signalDirection: string | null, orgAttribution: string | null) {
  if (signalDirection === "inbound" || signalDirection === "outbound" || signalDirection === "internal") {
    return { direction: signalDirection as GoldenDirection, directionSource: "signals" as const }
  }
  if (orgAttribution === "own_org") return { direction: "outbound" as const, directionSource: "attribution" as const }
  if (orgAttribution === "external") return { direction: "inbound" as const, directionSource: "attribution" as const }
  return { direction: null, directionSource: null }
}

/** One item. `orgId` given = tenant check (another org's item → not found). */
export async function getGoldenItem(id: string, orgId?: string): Promise<GoldenItemDetail> {
  const conds: SQL[] = [eq(topicsGoldenItem.id, id)]
  if (orgId !== undefined) conds.push(eq(topicsGoldenItem.organizationId, orgId))
  const [r] = await db
    .select({
      id: topicsGoldenItem.id,
      organizationId: topicsGoldenItem.organizationId,
      synthetic: topicsGoldenItem.synthetic,
      sourceItemId: topicsGoldenItem.sourceItemId,
      provider: source.provider,
      kind: sourceItem.externalType,
      itemDate: sourceItem.sourceCreatedAt,
      subject: sql<string | null>`${sourceItem.metadataJson}->>'subject'`,
      metadataJson: sourceItem.metadataJson,
      orgAttribution: sourceItem.orgAttribution,
      signalDirection: sql<string | null>`${sourceItem.signalFacts}->>'direction'`,
      text: topicsGoldenItem.text,
      status: topicsGoldenItem.status,
      note: topicsGoldenItem.note,
      expected: topicsGoldenItem.expected,
      preAnnotation: topicsGoldenItem.preAnnotation,
      reviewedAt: topicsGoldenItem.reviewedAt,
      createdAt: topicsGoldenItem.createdAt,
    })
    .from(topicsGoldenItem)
    .leftJoin(sourceItem, eq(sourceItem.id, topicsGoldenItem.sourceItemId))
    .leftJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(...conds))
  if (!r) throw new GoldenSetError("Элемент не найден", "not_found")
  const text = r.text ?? ""
  const { metadataJson, orgAttribution, signalDirection, ...rest } = r
  const envelope = r.synthetic
    ? null
    : envelopeFromItem(
        { provider: r.provider, externalType: r.kind, sourceCreatedAt: r.itemDate, orgAttribution, metadataJson },
        text,
      )
  return {
    ...rest,
    ...(r.synthetic ? { direction: null, directionSource: null } : directionOf(signalDirection, orgAttribution)),
    from: envelope?.from ?? null,
    text,
    contentText: r.synthetic ? text : messageContent(text),
    textPreview: text.slice(0, 300),
    textChars: text.length,
    itemDate: (r.itemDate ?? (r.synthetic ? r.createdAt : null))?.toISOString() ?? null,
    expectedCodes: codesOf(r.expected),
    preCodes: codesOf(r.preAnnotation),
    topicGroups: readTopicGroups(r.expected),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export type GoldenUpdatePatch = { expected?: unknown; status?: string; note?: string | null }

/**
 * Save the expected answer and / or the status. A saved answer does NOT
 * change the status by itself; status `reviewed` needs an answer with ≥ 1
 * code or «Сигналов нет» and stamps the reviewer. `orgId` given = tenant check.
 */
export async function updateGoldenItem(
  id: string,
  patch: GoldenUpdatePatch,
  reviewerId: string,
  orgId?: string,
): Promise<GoldenItemDetail> {
  const current = await getGoldenItem(id, orgId)
  const set: Partial<typeof topicsGoldenItem.$inferInsert> = {}
  let finalExpected: Record<string, unknown> | null = current.expected
  if (patch.expected !== undefined) {
    if (patch.expected === null) {
      set.expected = null
      finalExpected = null
    } else {
      const parsed = goldenExpectedSchema(await knownSignalCodes()).safeParse(patch.expected)
      if (!parsed.success) {
        throw new GoldenSetError(
          `expected: ${parsed.error.issues.map((i) => `${i.path.join(".") || "—"}: ${i.message}`).join("; ")}`,
        )
      }
      try {
        finalExpected = normalizeGoldenExpected(parsed.data as Record<string, unknown>)
      } catch (e) {
        throw new GoldenSetError(e instanceof Error ? e.message : String(e))
      }
      set.expected = finalExpected
    }
  }
  if (patch.status !== undefined) {
    if (!(GOLDEN_STATUSES as readonly string[]).includes(patch.status)) {
      throw new GoldenSetError(`Неизвестный статус: ${patch.status}`)
    }
    if (patch.status === "reviewed") {
      const why = reviewReadinessError(readGoldenExpected(finalExpected))
      if (why) throw new GoldenSetError(why)
      set.reviewedByUserId = reviewerId
      set.reviewedAt = new Date()
    }
    set.status = patch.status
  }
  if (patch.note !== undefined) set.note = patch.note?.trim() || null
  if (Object.keys(set).length === 0) throw new GoldenSetError("Нет изменений")
  const updated = await db
    .update(topicsGoldenItem)
    .set(set)
    .where(and(eq(topicsGoldenItem.id, id), eq(topicsGoldenItem.organizationId, current.organizationId)))
    .returning({ id: topicsGoldenItem.id })
  if (updated.length === 0) throw new GoldenSetError("Элемент не найден", "not_found")
  return getGoldenItem(id, orgId)
}

// ── Review helpers (editor data) ──────────────────────────────────────────

export type GoldenCodeOption = {
  code: string
  labelRu: string
  blockCode: string
  blockLabel: string
  /** Active for the org (EFFECTIVE signals) — the picker offers these. */
  active: boolean
}

/**
 * Codes for the picker: every non-retired registry code with its Russian
 * label and block; `active` = the org's EFFECTIVE active codes
 * (`getEffectiveSignals`). Inactive ones are only used to label stored codes.
 */
export async function goldenCodeOptions(orgId: string): Promise<GoldenCodeOption[]> {
  const [registry, effective] = await Promise.all([getRegistry(), getEffectiveSignals(orgId)])
  const activeCodes = new Set(effective.filter((s) => s.active).map((s) => s.code))
  const blocks = new Map(registry.blocks.map((b) => [b.code, b.labelRu]))
  return registry.categories
    .filter((c) => !c.retiredAt)
    .map((c) => ({
      code: c.code,
      labelRu: c.labelRu,
      blockCode: c.blockCode,
      blockLabel: blocks.get(c.blockCode) ?? c.blockCode,
      active: activeCodes.has(c.code),
    }))
    .sort((a, b) => a.blockCode.localeCompare(b.blockCode) || a.labelRu.localeCompare(b.labelRu, "ru"))
}

/** Topic-group labels already used in the org's set (autocomplete), most used first. */
export async function goldenGroupLabels(orgId: string): Promise<{ label: string; count: number }[]> {
  const rows = await db
    .select({ expected: topicsGoldenItem.expected })
    .from(topicsGoldenItem)
    .where(and(eq(topicsGoldenItem.organizationId, orgId), isNotNull(topicsGoldenItem.expected)))
  const byKey = new Map<string, { label: string; count: number }>()
  for (const r of rows) {
    for (const label of readTopicGroups(r.expected) ?? []) {
      const key = topicGroupKey(label)
      const e = byKey.get(key) ?? { label, count: 0 }
      e.count++
      byKey.set(key, e)
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
}

/**
 * «Взять из движка»: the topics the engine linked this golden item's real
 * source item to (`topic_item`; merged topics → their target). Synthetic = [].
 */
export async function goldenEngineTopics(
  orgId: string,
  goldenId: string,
): Promise<{ id: string; title: string; status: string; roles: string[] }[]> {
  const [g] = await db
    .select({ sourceItemId: topicsGoldenItem.sourceItemId, synthetic: topicsGoldenItem.synthetic })
    .from(topicsGoldenItem)
    .where(and(eq(topicsGoldenItem.id, goldenId), eq(topicsGoldenItem.organizationId, orgId)))
  if (!g) throw new GoldenSetError("Элемент не найден", "not_found")
  if (g.synthetic || !g.sourceItemId) return []
  const map = await loadEngineTopicsBySourceItem(orgId, [g.sourceItemId])
  return map.get(g.sourceItemId) ?? []
}

/**
 * «Следующее»: the next unreviewed item (status new / pre_annotated) after
 * `afterId` in the list order (newest first, then id); wraps to the start.
 */
export async function nextUnreviewedGoldenId(orgId: string, afterId: string | null): Promise<string | null> {
  const open = and(
    eq(topicsGoldenItem.organizationId, orgId),
    inArray(topicsGoldenItem.status, ["new", "pre_annotated"]),
  )
  const order = [desc(topicsGoldenItem.createdAt), asc(topicsGoldenItem.id)] as const
  if (afterId) {
    const [cur] = await db
      .select({ createdAt: topicsGoldenItem.createdAt })
      .from(topicsGoldenItem)
      .where(and(eq(topicsGoldenItem.id, afterId), eq(topicsGoldenItem.organizationId, orgId)))
    if (cur) {
      const [next] = await db
        .select({ id: topicsGoldenItem.id })
        .from(topicsGoldenItem)
        .where(
          and(
            open,
            sql`(${topicsGoldenItem.createdAt} < ${cur.createdAt} or (${topicsGoldenItem.createdAt} = ${cur.createdAt} and ${topicsGoldenItem.id} > ${afterId}))`,
          ),
        )
        .orderBy(...order)
        .limit(1)
      if (next) return next.id
    }
  }
  const [first] = await db
    .select({ id: topicsGoldenItem.id })
    .from(topicsGoldenItem)
    .where(afterId ? and(open, sql`${topicsGoldenItem.id} <> ${afterId}`) : open)
    .orderBy(...order)
    .limit(1)
  return first?.id ?? null
}

// ── Pre-annotation ────────────────────────────────────────────────────────

export const PREANNOTATE_MAX_IDS = 10

/**
 * LLM pre-annotation of up to 10 items: extraction over the "review" code
 * set (on + review codes, so reviewers also see candidates for the offline
 * batch). Stores `pre_annotation`; status → pre_annotated unless the item
 * is already reviewed or excluded. Throws SignalsNotEnabledError (before any
 * call) when the org has no active signal code.
 */
export async function preAnnotate(
  orgId: string,
  ids: string[],
): Promise<{ id: string; ok: boolean; codes?: string[]; error?: string }[]> {
  const unique = [...new Set(ids)].slice(0, PREANNOTATE_MAX_IDS)
  const promptSet = await loadPromptCodes(orgId, "review")
  const counterparties = promptSet.promptContext ? await loadExtractionCounterparties(orgId) : null
  const items = await loadGoldenWorkItems(orgId, unique, { counterparties })
  const found = new Set(items.map((i) => i.id))
  const missing = unique
    .filter((id) => !found.has(id))
    .map((id) => ({ id, ok: false, error: "Нет текста или элемент не найден" }))
  const done = await mapPool(items, 3, async (item) => {
    try {
      const run = await runExtraction({
        orgId,
        text: item.text,
        envelope: item.envelope,
        variant: "single",
        promptSet,
        ref: { goldenItemId: item.id, preAnnotation: true },
      })
      const out = run.output
      const pre = {
        codes: (out?.signals ?? []).map((s) => ({
          code: s.code,
          evidence: s.evidence,
          confidence: s.confidence,
          subject: out?.subjects[s.subjectIndex]?.matter ?? undefined,
        })),
        noSignal: (out?.signals.length ?? 0) === 0,
        attributes: out?.attributes ?? [],
        subjects: out?.subjects ?? [],
        direction: out?.direction ?? null,
        model: run.model,
        codeSet: run.codeSet,
        taxonomyVersion: run.taxonomyVersion,
        at: new Date().toISOString(),
      }
      await db
        .update(topicsGoldenItem)
        .set({
          preAnnotation: pre,
          status: sql`case when ${topicsGoldenItem.status} in ('reviewed', 'excluded') then ${topicsGoldenItem.status} else 'pre_annotated' end`,
        })
        .where(and(eq(topicsGoldenItem.id, item.id), eq(topicsGoldenItem.organizationId, orgId)))
      return { id: item.id, ok: true, codes: pre.codes.map((c) => c.code) }
    } catch (error) {
      return { id: item.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return [...done, ...missing]
}

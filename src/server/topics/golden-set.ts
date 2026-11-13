import "server-only"
import { randomUUID } from "crypto"
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { organization, source, sourceItem, topicsGoldenItem } from "@/db/schema"
import { getTextObject } from "@/server/storage"
import { SIGNAL_CATALOG_V0 } from "@/server/topics/catalog/catalog-v0"
import type { ExtractionEnvelope } from "@/server/topics/prompt/extraction"
import { runExtraction } from "@/server/topics/prompt/run-extraction"

// Golden set for the topics quality gates (spec 01 §12, plan phase 0 task 7).
// Platform-admin tooling: every function takes the org id explicitly; the
// admin route is the only caller and does the session check.
//
// Real items: parsed, non-junk ROOT source items of the org. Their markdown
// is frozen into `text` at sampling time, so a later reparse or teardown does
// not change the set. Synthetic items: free text typed by the admin.

export const GOLDEN_STATUSES = ["new", "pre_annotated", "reviewed", "excluded"] as const
export type GoldenStatus = (typeof GOLDEN_STATUSES)[number]

const KNOWN_CODES = new Set(SIGNAL_CATALOG_V0.map((c) => c.code))

/** Human answer (and pre-annotation) shape. */
export const goldenExpectedSchema = z
  .object({
    codes: z.array(
      z
        .object({
          code: z
            .string()
            .min(1)
            .refine((c) => KNOWN_CODES.has(c), { message: "Неизвестный код сигнала" }),
          evidence: z.string().optional(),
          subject: z.string().optional(),
        })
        .passthrough(),
    ),
    noSignal: z.boolean().optional(),
    topicGroup: z.string().optional(),
  })
  .passthrough()

export type GoldenExpected = z.infer<typeof goldenExpectedSchema>

export class GoldenSetError extends Error {
  constructor(
    message: string,
    public reason: "not_found" | "invalid" = "invalid",
  ) {
    super(message)
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

// ── Text + envelope ───────────────────────────────────────────────────────

async function itemMarkdown(row: {
  parsedMarkdown: string | null
  markdownR2Key: string | null
}): Promise<string | null> {
  if (row.parsedMarkdown) return row.parsedMarkdown
  if (!row.markdownR2Key) return null
  try {
    return await getTextObject(row.markdownR2Key)
  } catch (error) {
    console.warn("[topics/golden] markdown not readable", row.markdownR2Key, error)
    return null
  }
}

type Addr = { name?: string | null; email?: string | null }
function formatAddrs(v: unknown): string | null {
  if (!Array.isArray(v)) return typeof v === "string" ? v : null
  const parts = (v as Addr[])
    .map((a) => (a?.name ? `${a.name} <${a.email ?? ""}>` : (a?.email ?? "")))
    .filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

function envelopeFromItem(item: {
  provider: string | null
  externalType: string | null
  sourceCreatedAt: Date | null
  orgAttribution: string | null
  metadataJson: unknown
}): ExtractionEnvelope {
  const m = (item.metadataJson ?? {}) as Record<string, unknown>
  const tg = (m.telegram ?? {}) as Record<string, unknown>
  const tgFrom = (tg.from ?? null) as { firstName?: string; lastName?: string; username?: string } | null
  const senders = Array.isArray(m.senders) ? (m.senders as unknown[]).filter((s) => typeof s === "string") : []
  const from =
    formatAddrs(m.from) ??
    (tgFrom
      ? [tgFrom.firstName, tgFrom.lastName].filter(Boolean).join(" ") +
        (tgFrom.username ? ` (@${tgFrom.username})` : "")
      : null) ??
    (senders.length ? senders.join(", ") : null)
  const fwd = (tg.forwardOrigin ?? tg.forward_origin ?? null) as Record<string, unknown> | null
  return {
    provider: item.provider,
    kind: item.externalType,
    date: item.sourceCreatedAt?.toISOString() ?? null,
    subject: typeof m.subject === "string" ? m.subject : null,
    from,
    to: formatAddrs(m.to),
    cc: formatAddrs(m.cc),
    orgAttribution: item.orgAttribution,
    originalAuthor: fwd ? JSON.stringify(fwd).slice(0, 200) : null,
  }
}

export type GoldenWorkItem = {
  id: string
  synthetic: boolean
  text: string
  envelope: ExtractionEnvelope
}

/** Text + envelope of golden items (for extraction). Items without text are left out. */
export async function loadGoldenWorkItems(orgId: string, ids: string[]): Promise<GoldenWorkItem[]> {
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
    const text = r.text ?? (await itemMarkdown(r))
    if (!text?.trim()) return null
    const envelope: ExtractionEnvelope = r.synthetic
      ? { synthetic: true, date: r.createdAt.toISOString() }
      : envelopeFromItem(r)
    envelope.orgName = org?.name ?? null
    return { id: r.id, synthetic: r.synthetic, text, envelope }
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
  reviewedAt: string | null
  createdAt: string
}

const codesOf = (v: Record<string, unknown> | null): string[] | null => {
  if (!v || !Array.isArray(v.codes)) return null
  return (v.codes as { code?: unknown }[])
    .map((c) => (typeof c?.code === "string" ? c.code : ""))
    .filter(Boolean)
}

export async function listGoldenItems(
  orgId: string,
  filters: {
    status?: string | null
    synthetic?: "real" | "synthetic" | null
    limit?: number
    offset?: number
  } = {},
): Promise<{ rows: GoldenListRow[]; total: number; counts: Record<string, number> }> {
  const conds: SQL[] = [eq(topicsGoldenItem.organizationId, orgId)]
  if (filters.status) conds.push(eq(topicsGoldenItem.status, filters.status))
  if (filters.synthetic === "real") conds.push(eq(topicsGoldenItem.synthetic, false))
  if (filters.synthetic === "synthetic") conds.push(eq(topicsGoldenItem.synthetic, true))
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
  expected: Record<string, unknown> | null
  preAnnotation: Record<string, unknown> | null
}

export async function getGoldenItem(id: string): Promise<GoldenItemDetail> {
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
    .where(eq(topicsGoldenItem.id, id))
  if (!r) throw new GoldenSetError("Элемент не найден", "not_found")
  const text = r.text ?? ""
  return {
    ...r,
    text,
    textPreview: text.slice(0, 300),
    textChars: text.length,
    itemDate: (r.itemDate ?? (r.synthetic ? r.createdAt : null))?.toISOString() ?? null,
    expectedCodes: codesOf(r.expected),
    preCodes: codesOf(r.preAnnotation),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function updateGoldenItem(
  id: string,
  patch: { expected?: unknown; status?: string; note?: string | null },
  reviewerId: string,
): Promise<GoldenItemDetail> {
  const set: Partial<typeof topicsGoldenItem.$inferInsert> = {}
  if (patch.expected !== undefined) {
    if (patch.expected === null) {
      set.expected = null
    } else {
      const parsed = goldenExpectedSchema.safeParse(patch.expected)
      if (!parsed.success) {
        throw new GoldenSetError(
          `expected: ${parsed.error.issues.map((i) => `${i.path.join(".") || "—"}: ${i.message}`).join("; ")}`,
        )
      }
      set.expected = parsed.data as Record<string, unknown>
      set.reviewedByUserId = reviewerId
      set.reviewedAt = new Date()
      if (patch.status === undefined) set.status = "reviewed"
    }
  }
  if (patch.status !== undefined) {
    if (!(GOLDEN_STATUSES as readonly string[]).includes(patch.status)) {
      throw new GoldenSetError(`Неизвестный статус: ${patch.status}`)
    }
    set.status = patch.status
    if (patch.status === "reviewed") {
      set.reviewedByUserId = reviewerId
      set.reviewedAt = new Date()
    }
  }
  if (patch.note !== undefined) set.note = patch.note?.trim() || null
  if (Object.keys(set).length === 0) throw new GoldenSetError("Нет изменений")
  const updated = await db
    .update(topicsGoldenItem)
    .set(set)
    .where(eq(topicsGoldenItem.id, id))
    .returning({ id: topicsGoldenItem.id })
  if (updated.length === 0) throw new GoldenSetError("Элемент не найден", "not_found")
  return getGoldenItem(id)
}

// ── Pre-annotation ────────────────────────────────────────────────────────

export const PREANNOTATE_MAX_IDS = 10

/**
 * LLM pre-annotation of up to 10 items: extraction over the "review" code
 * set (on + review codes, so reviewers also see candidates for the offline
 * batch). Stores `pre_annotation`; status → pre_annotated unless the item
 * is already reviewed or excluded.
 */
export async function preAnnotate(
  orgId: string,
  ids: string[],
): Promise<{ id: string; ok: boolean; codes?: string[]; error?: string }[]> {
  const unique = [...new Set(ids)].slice(0, PREANNOTATE_MAX_IDS)
  const items = await loadGoldenWorkItems(orgId, unique)
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
        codeSet: "review",
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

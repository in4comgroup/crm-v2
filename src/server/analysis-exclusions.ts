// «Исключения из анализа» (analysis exclusions) — server half. A per-org
// deny-list of email addresses, domains and chats the engine never analyses
// (spec docs/specs/topics/01-specification.md §5.2 gate 3a; Q31, R18).
//
//   • Read: `loadAnalysisExclusions(orgId)` — cached per org in this process,
//     invalidated on every add / delete made here.
//   • Owner CRUD: list / add / remove, org + user ids explicit. The route
//     owns the session check; `getOrgMemberRole` is the owner gate.
//   • Sync helpers: a per-source "skip watermark" so the incremental cursor
//     of IMAP / Nylas / Google Chat moves past messages that were skipped
//     (they are never stored, so `max(source_created_at)` cannot see them).
//
// `import "server-only"`, NOT `"use server"`: every function takes the org id
// as a parameter (root AGENTS.md rule 5) and the module exports sync helpers.
import "server-only"

import { randomUUID } from "crypto"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { analysisExclusion, member, source } from "@/db/schema"
import {
  ANALYSIS_EXCLUSION_KINDS,
  exclusionProbeFromItem,
  matchAnalysisExclusion,
  normalizeExclusionValue,
  type AnalysisExclusionEntry,
  type AnalysisExclusionKind,
} from "@/lib/analysis-exclusion-match"

export type { AnalysisExclusionEntry, AnalysisExclusionKind }

export class AnalysisExclusionError extends Error {
  constructor(
    public readonly reason: "forbidden" | "not_found" | "bad_request",
    message: string,
  ) {
    super(message)
    this.name = "AnalysisExclusionError"
  }
}

// ── Loader (cached) ───────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { entries: AnalysisExclusionEntry[]; expires: number }>()

/** Drop the cached list of one org. Called on every mutation in this module. */
export function invalidateAnalysisExclusions(orgId: string): void {
  cache.delete(orgId)
}

function isKind(v: string): v is AnalysisExclusionKind {
  return (ANALYSIS_EXCLUSION_KINDS as readonly string[]).includes(v)
}

/** Every exclusion of one org (empty for a null org). 60 s cache per process. */
export async function loadAnalysisExclusions(
  orgId: string,
): Promise<AnalysisExclusionEntry[]> {
  if (!orgId) return []
  const now = Date.now()
  const hit = cache.get(orgId)
  if (hit && hit.expires > now) return hit.entries
  const rows = await db
    .select({
      id: analysisExclusion.id,
      kind: analysisExclusion.kind,
      value: analysisExclusion.value,
      normalizedValue: analysisExclusion.normalizedValue,
    })
    .from(analysisExclusion)
    .where(eq(analysisExclusion.organizationId, orgId))
  const entries: AnalysisExclusionEntry[] = rows
    .filter((r) => isKind(r.kind))
    .map((r) => ({ ...r, kind: r.kind as AnalysisExclusionKind }))
  cache.set(orgId, { entries, expires: now + CACHE_TTL_MS })
  return entries
}

/**
 * The exclusion that matches one stored source item, or null. Used by the
 * parse-time guard and available to the topics engine.
 */
export async function findItemExclusion(item: {
  organizationId: string | null
  provider: string | null
  metadataJson: unknown
  threadExternalId: string | null
  externalId?: string | null
}): Promise<AnalysisExclusionEntry | null> {
  if (!item.organizationId) return null
  const entries = await loadAnalysisExclusions(item.organizationId)
  if (entries.length === 0) return null
  return matchAnalysisExclusion(entries, exclusionProbeFromItem(item))
}

// ── Owner CRUD ────────────────────────────────────────────────────────

export type AnalysisExclusionRow = AnalysisExclusionEntry & {
  note: string | null
  createdAt: string
}

/** Role of a user in an org (`owner` | `admin` | `member`), or null. */
export async function getOrgMemberRole(
  orgId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function listAnalysisExclusions(
  orgId: string,
): Promise<AnalysisExclusionRow[]> {
  const rows = await db
    .select({
      id: analysisExclusion.id,
      kind: analysisExclusion.kind,
      value: analysisExclusion.value,
      normalizedValue: analysisExclusion.normalizedValue,
      note: analysisExclusion.note,
      createdAt: analysisExclusion.createdAt,
    })
    .from(analysisExclusion)
    .where(eq(analysisExclusion.organizationId, orgId))
    .orderBy(asc(analysisExclusion.kind), asc(analysisExclusion.normalizedValue))
  return rows
    .filter((r) => isKind(r.kind))
    .map((r) => ({
      ...r,
      kind: r.kind as AnalysisExclusionKind,
      createdAt: r.createdAt.toISOString(),
    }))
}

const INVALID_MESSAGE: Record<AnalysisExclusionKind, string> = {
  email: "Неверный адрес электронной почты",
  domain: "Неверный домен (пример: example.com)",
  chat: "Неверный чат: Telegram — id чата или @username, WhatsApp — название чата, Google Chat — spaces/…",
}

/**
 * Add one entry. Idempotent: a value that normalises to an existing entry
 * returns that entry with `added: false`. Throws `bad_request` (Russian
 * message) for an invalid value.
 */
export async function addAnalysisExclusion(input: {
  orgId: string
  userId: string
  kind: AnalysisExclusionKind
  value: string
  note?: string | null
}): Promise<{ added: boolean; entry: AnalysisExclusionRow }> {
  if (!isKind(input.kind)) {
    throw new AnalysisExclusionError("bad_request", "Неверный тип исключения")
  }
  const value = (input.value ?? "").trim()
  const normalizedValue = normalizeExclusionValue(input.kind, value)
  if (!normalizedValue) {
    throw new AnalysisExclusionError("bad_request", INVALID_MESSAGE[input.kind])
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null

  const inserted = await db
    .insert(analysisExclusion)
    .values({
      id: randomUUID(),
      organizationId: input.orgId,
      kind: input.kind,
      value: value.slice(0, 500),
      normalizedValue,
      note,
      createdByUserId: input.userId,
    })
    .onConflictDoNothing({
      target: [
        analysisExclusion.organizationId,
        analysisExclusion.kind,
        analysisExclusion.normalizedValue,
      ],
    })
    .returning({ id: analysisExclusion.id })
  invalidateAnalysisExclusions(input.orgId)

  const rows = await db
    .select({
      id: analysisExclusion.id,
      kind: analysisExclusion.kind,
      value: analysisExclusion.value,
      normalizedValue: analysisExclusion.normalizedValue,
      note: analysisExclusion.note,
      createdAt: analysisExclusion.createdAt,
    })
    .from(analysisExclusion)
    .where(
      and(
        eq(analysisExclusion.organizationId, input.orgId),
        eq(analysisExclusion.kind, input.kind),
        eq(analysisExclusion.normalizedValue, normalizedValue),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error("Exclusion row not found after insert")
  return {
    added: inserted.length > 0,
    entry: { ...row, kind: input.kind, createdAt: row.createdAt.toISOString() },
  }
}

/** Remove one entry of the org. Items skipped earlier stay skipped (re-parse to analyse them). */
export async function removeAnalysisExclusion(orgId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(analysisExclusion)
    .where(and(eq(analysisExclusion.id, id), eq(analysisExclusion.organizationId, orgId)))
    .returning({ id: analysisExclusion.id })
  invalidateAnalysisExclusions(orgId)
  if (deleted.length === 0) {
    throw new AnalysisExclusionError("not_found", "Исключение не найдено")
  }
}

// ── Sync helpers: skip watermark ──────────────────────────────────────
//
// Skipped messages are not stored, so the incremental cursor
// (`max(source_item.source_created_at)`) cannot move past them: a run of
// excluded mail at the head of the mailbox would be fetched again every run
// and could crowd real mail out of the per-call page. Each sync therefore
// records the newest skipped message time in `source.provider_config`
// (key below, merged with jsonb `||` so no other key is touched) and uses
// `max(stored cursor, watermark)` as its cursor. A config save from the
// sources UI drops the key — harmless: the next run re-fetches and re-skips.

export const EXCLUSION_SKIP_WATERMARK_KEY = "exclusionSkipWatermark"

export function readExclusionSkipWatermark(
  providerConfig: Record<string, unknown>,
): Date | null {
  const raw = providerConfig[EXCLUSION_SKIP_WATERMARK_KEY]
  if (typeof raw !== "string") return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The later of the stored-items cursor and the skip watermark. */
export function cursorWithSkipWatermark(
  stored: Date | null,
  providerConfig: Record<string, unknown>,
): Date | null {
  const wm = readExclusionSkipWatermark(providerConfig)
  if (!wm) return stored
  if (!stored) return wm
  return wm > stored ? wm : stored
}

/** Raise the watermark to `at` (never lowers it). */
export async function advanceExclusionSkipWatermark(
  sourceId: string,
  providerConfig: Record<string, unknown>,
  at: Date | null,
): Promise<void> {
  if (!at || Number.isNaN(at.getTime())) return
  const current = readExclusionSkipWatermark(providerConfig)
  if (current && current >= at) return
  await db
    .update(source)
    .set({
      providerConfig: sql`coalesce(${source.providerConfig}, '{}'::jsonb) || ${JSON.stringify({
        [EXCLUSION_SKIP_WATERMARK_KEY]: at.toISOString(),
      })}::jsonb`,
    })
    .where(eq(source.id, sourceId))
}

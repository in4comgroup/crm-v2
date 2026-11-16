import "server-only"

import { and, eq, notInArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, clientProfile, industry, user } from "@/db/schema"
import { UNSPECIFIED } from "@/lib/analytics-format"
import {
  STATS_DEFAULT_TOP_N,
  STATS_MAX_ROWS,
  STATS_VOCAB,
  type StatsResult,
  type StatsRow,
} from "@/lib/chat/stats"
import type { AppliedFilter } from "@/lib/chat/records"
import { CLIENT_RELATION_LABELS, clientRelation } from "@/lib/client-relation"
import { CLIENT_SIZE_LABELS_RU, type ClientSizeBand } from "@/lib/identity/client-profile"
import { loadClientDealFlags } from "@/server/chat/records/shared"
import type { RecordsContext } from "@/server/chat/records/types"
import { getClientSegments } from "@/server/identity/client-profile-context"
import { StatsInputError, emptyWarnings, periodLabel, resolveChart, timeLabel, type NormalisedQuery } from "./engine"

// `clients` statistics (spec §8). The relationship («Клиент» / «Потенциальный»
// / …) and the A / B / C segment are derived in code (src/lib/client-relation.ts,
// getClientSegments), not columns — so this subject aggregates in JS over the
// org's companies (tens to hundreds of rows). Only measure: count.

type Point = { key: string; label: string }
type ClientFacts = { createdAt: Date; dims: Record<string, Point> }

function timePoint(dim: string, d: Date, tz: string): Point {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {})
  const y = parts.year
  const m = Number(parts.month)
  let key: string
  if (dim === "time.year") key = y
  else if (dim === "time.quarter") key = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}`
  else if (dim === "time.month") key = `${y}-${parts.month}`
  else {
    // ISO week start (Monday), like Postgres date_trunc('week').
    const local = new Date(Date.UTC(Number(y), m - 1, Number(parts.day)))
    local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7))
    key = local.toISOString().slice(0, 10)
  }
  return { key, label: timeLabel(dim, key) }
}

export async function runClientsStats(ctx: RecordsContext, q: NormalisedQuery): Promise<StatsResult> {
  const vocab = STATS_VOCAB.clients
  if (!vocab.measures[q.measure]) {
    throw new StatsInputError(`Неизвестный показатель «${q.measure}» для «${vocab.label}»; допустимо: count`)
  }
  for (const d of [q.dimension, q.splitBy, ...q.filters.map((f) => f.dimension)]) {
    if (d && !vocab.dimensions[d]) {
      throw new StatsInputError(
        `Неизвестное измерение «${d}» для «${vocab.label}»; допустимо: ${Object.keys(vocab.dimensions).join(", ")}`,
      )
    }
  }

  const [rows, flags, segments] = await Promise.all([
    db
      .select({
        id: client.id,
        createdAt: client.createdAt,
        customFields: client.customFields,
        responsibleUserId: client.responsibleUserId,
        responsibleName: user.name,
        industryCode: clientProfile.industryCode,
        industryLabel: industry.labelRu,
        sizeBand: clientProfile.sizeBand,
      })
      .from(client)
      .leftJoin(clientProfile, eq(clientProfile.clientId, client.id))
      .leftJoin(industry, eq(clientProfile.industryCode, industry.code))
      .leftJoin(user, eq(user.id, client.responsibleUserId))
      .where(and(eq(client.organizationId, ctx.orgId), notInArray(client.status, ["deleted", "blocked"]))),
    loadClientDealFlags(ctx.orgId),
    getClientSegments(ctx.orgId, ctx.now).catch(() => new Map<string, string>()),
  ])

  const facts: ClientFacts[] = rows.map((r) => {
    const rel = clientRelation({
      companyKind: (r.customFields as Record<string, unknown> | null)?.companyKind,
      hasWonDeal: flags.won.has(r.id),
      hasOpenDeal: flags.open.has(r.id),
    })
    const seg = segments.get(r.id)
    const dims: Record<string, Point> = {
      relation: { key: rel, label: CLIENT_RELATION_LABELS[rel] },
      industry: { key: r.industryCode ?? "", label: r.industryLabel ?? UNSPECIFIED },
      responsible: { key: r.responsibleUserId ?? "", label: r.responsibleName ?? UNSPECIFIED },
      size: { key: r.sizeBand ?? "", label: r.sizeBand ? (CLIENT_SIZE_LABELS_RU[r.sizeBand as ClientSizeBand] ?? r.sizeBand) : UNSPECIFIED },
      segment: { key: seg ?? "", label: seg ? `Сегмент ${seg}` : "Без сегмента" },
    }
    for (const t of ["time.week", "time.month", "time.quarter", "time.year"]) dims[t] = timePoint(t, r.createdAt, ctx.timeZone)
    return { createdAt: r.createdAt, dims }
  })

  const applied: AppliedFilter[] = []
  let selected = facts.filter((f) => (!q.from || f.createdAt >= q.from) && (!q.to || f.createdAt <= q.to))
  // Several values of ONE dimension = OR, different dimensions = AND.
  const byDimension = new Map<string, string[]>()
  for (const flt of q.filters) {
    byDimension.set(flt.dimension, [...(byDimension.get(flt.dimension) ?? []), flt.value.trim().toLowerCase()])
    applied.push({ label: vocab.dimensions[flt.dimension].label, value: flt.value.trim() })
  }
  for (const [dim, values] of byDimension) {
    selected = selected.filter((f) => {
      const p = f.dims[dim]
      return !!p && values.some((v) => p.key.toLowerCase() === v || p.label.toLowerCase() === v)
    })
  }

  const metaBase = {
    measureLabel: vocab.measures.count.label,
    measureKind: "count" as const,
    periodLabel: periodLabel(q.from, q.to, ctx.timeZone),
    applied,
  }
  const base = { query: { subject: "clients" as const }, subject: "clients" as const, subjectLabel: vocab.label }
  const warnings = emptyWarnings(q, selected.length === 0)

  if (!q.dimension) {
    return {
      ...base,
      rows: [],
      scalar: selected.length,
      meta: { ...metaBase, dimensionLabel: null, splitLabel: null, total: selected.length, rowCount: 0, truncated: false, chart: "table", warnings },
    }
  }

  const dim = q.dimension
  const isTime = Boolean(vocab.dimensions[dim].isTime)
  const counts = new Map<string, StatsRow>()
  const primaryTotals = new Map<string, number>()
  for (const f of selected) {
    const p = f.dims[dim]
    const s = q.splitBy ? f.dims[q.splitBy] : null
    const id = s ? `${p.key}\u0000${s.key}` : p.key
    const row = counts.get(id) ?? {
      key: p.key,
      label: p.label,
      value: 0,
      ...(s ? { splitKey: s.key, splitLabel: s.label } : {}),
    }
    row.value += 1
    counts.set(id, row)
    primaryTotals.set(p.key, (primaryTotals.get(p.key) ?? 0) + 1)
  }

  // Top N categories by count (time: all, chronological).
  const topN = Math.min(Math.max(Math.trunc(q.topN ?? STATS_DEFAULT_TOP_N), 1), 50)
  const order = [...primaryTotals.entries()].sort((a, b) => (isTime ? a[0].localeCompare(b[0]) : b[1] - a[1]))
  const keep = new Set((isTime ? order : order.slice(0, topN)).map(([k]) => k))
  const out = [...counts.values()]
    .filter((r) => keep.has(r.key))
    .sort((a, b) =>
      isTime
        ? a.key.localeCompare(b.key) || (a.splitKey ?? "").localeCompare(b.splitKey ?? "")
        : (primaryTotals.get(b.key) ?? 0) - (primaryTotals.get(a.key) ?? 0) || b.value - a.value,
    )
  const truncated = keep.size < primaryTotals.size || out.length > STATS_MAX_ROWS

  const rowsOut = out.slice(0, STATS_MAX_ROWS)
  return {
    ...base,
    rows: rowsOut,
    scalar: null,
    meta: {
      ...metaBase,
      dimensionLabel: vocab.dimensions[dim].label,
      splitLabel: q.splitBy ? vocab.dimensions[q.splitBy].label : null,
      total: rowsOut.reduce((a, r) => a + r.value, 0),
      rowCount: rowsOut.length,
      truncated,
      chart: resolveChart(q.chart, { isTime, split: Boolean(q.splitBy), rows: keep.size }),
      warnings,
    },
  }
}

// Turn contract of the AI chat v2 (docs/specs/ai-chat/01-specification.md §3,
// §9). Client-safe: the route writes these data parts, the chat UI reads
// them. The model writes only prose; every list, chart, link and status the
// user sees comes from a data part built by code.
//
// Data parts of one assistant message:
// - `data-status`   transient (never in message.parts) — the status line (§9)
// - `data-records`  one per record tool call (search / list / get), merged in the UI (§7.1)
// - `data-stats`    one per `queryStats` call (§8)
// - `data-evidence` source items the model read + web sources (§3)
// - `data-turn`     at the end: which data the answer used + duration (Q10)
// - `data-debug`    platform admins only: «Ход рассуждений» (Q5, Q11)
// - `data-spec`     json-render, written by `pipeJsonRender` (Q6, non-CRM content only)

import {
  RECORD_TYPE_LABELS,
  type AppliedFilter,
  type RecordCount,
  type RecordHit,
  type RecordType,
} from "@/lib/chat/records"
import type { StatsResult } from "@/lib/chat/stats"

// ── Status (§9) ───────────────────────────────────────────────────────

export type ChatStatusStage = "thinking" | "crm" | "list" | "record" | "reading" | "stats" | "web" | "writing"
export type ChatStatus = { stage: ChatStatusStage; label: string }

const cut = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export const STATUS_THINKING: ChatStatus = { stage: "thinking", label: "Думаю…" }
export const STATUS_WRITING: ChatStatus = { stage: "writing", label: "Готовлю ответ…" }

/** Russian status of a tool call, from its input only (never the tool name). */
export function statusForTool(tool: string, input: unknown, title?: string | null): ChatStatus {
  const i = (input ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : "")
  switch (tool) {
    case "searchRecords": {
      const q = str(i.query)
      return { stage: "crm", label: q ? `Ищу в CRM: «${cut(q, 40)}»…` : "Ищу в CRM…" }
    }
    case "listRecords": {
      const t = i.type as RecordType | undefined
      const many = t && RECORD_TYPE_LABELS[t] ? RECORD_TYPE_LABELS[t].many.toLowerCase() : "записи"
      return { stage: "list", label: `Подбираю ${many}…` }
    }
    case "getRecord":
      return { stage: "record", label: title ? `Открываю: ${cut(title)}…` : "Открываю запись…" }
    case "readSource":
      return { stage: "reading", label: title ? `Читаю: «${cut(title)}»…` : "Читаю источник…" }
    case "queryStats":
      return { stage: "stats", label: title ? `Считаю статистику: ${cut(title)}…` : "Считаю статистику…" }
    case "searchWeb":
      return { stage: "web", label: "Ищу в интернете…" }
    default:
      return STATUS_THINKING
  }
}

// ── Data parts ────────────────────────────────────────────────────────

/** One record tool call (search / list / get) — merged per answer in the UI. */
export type ChatRecordsPart = {
  counts: Partial<Record<RecordType, RecordCount>>
  hits: Partial<Record<RecordType, RecordHit[]>>
  /** Filters of a `listRecords` call («Статус: открыта»). */
  applied?: AppliedFilter[]
}

export type ChatWebSource = { url: string; title: string }

/** Evidence of the answer: source items the model actually read, web sources. */
export type ChatEvidencePart = {
  sourceItems: RecordHit[]
  web: ChatWebSource[]
}

export type ChatTurnSource = "crm" | "web"

/** End of a turn: «CRM · интернет · 7 с» (Q10). */
export type ChatTurnPart = {
  used: ChatTurnSource[]
  ms: number
}

/** One step of «Ход рассуждений» (platform admins only). */
export type ChatDebugStep =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; input: string; output: string; ms: number; error?: boolean }

export type ChatDebugPart = {
  model: string | null
  steps: ChatDebugStep[]
}

export type ChatDataParts = {
  status: ChatStatus
  records: ChatRecordsPart
  stats: StatsResult
  evidence: ChatEvidencePart
  turn: ChatTurnPart
  debug: ChatDebugPart
}

type AnyPart = { type: string; data?: unknown }

/** All `data-<name>` parts of a message, in order. */
export function dataParts<K extends keyof ChatDataParts>(parts: readonly AnyPart[], name: K): ChatDataParts[K][] {
  const type = `data-${name}`
  return parts.filter((p) => p.type === type && p.data != null).map((p) => p.data as ChatDataParts[K])
}

/**
 * ONE results block per answer (§7.1): merge the record parts of all record
 * tool calls. Hits de-duplicated by type + id (first seen wins); a type's
 * count = the largest count any call reported, never less than the hits
 * shown. Filter chips only when exactly one call carried filters.
 */
export function mergeRecordsParts(parts: readonly ChatRecordsPart[]): ChatRecordsPart | null {
  if (!parts.length) return null
  const hits: Partial<Record<RecordType, RecordHit[]>> = {}
  const counts: Partial<Record<RecordType, RecordCount>> = {}
  const seen = new Set<string>()
  for (const p of parts) {
    for (const [t, list] of Object.entries(p.hits) as [RecordType, RecordHit[]][]) {
      for (const h of list ?? []) {
        const key = `${h.type}:${h.id}`
        if (seen.has(key)) continue
        seen.add(key)
        ;(hits[h.type] ??= []).push(h)
      }
      if (!hits[t]) hits[t] = hits[t] ?? []
    }
    for (const [t, c] of Object.entries(p.counts) as [RecordType, RecordCount][]) {
      const prev = counts[t]
      if (!prev || c.capped || (!prev.capped && c.total > prev.total)) counts[t] = c
    }
  }
  for (const [t, list] of Object.entries(hits) as [RecordType, RecordHit[]][]) {
    const c = counts[t]
    if (!c || (!c.capped && c.total < list.length)) counts[t] = { total: list.length, capped: false }
  }
  const withFilters = parts.filter((p) => p.applied?.length)
  const anyHits = Object.values(hits).some((l) => l && l.length)
  const anyCount = Object.values(counts).some((c) => c && c.total > 0)
  if (!anyHits && !anyCount && !withFilters.length) {
    return { counts: {}, hits: {} }
  }
  return {
    counts,
    hits,
    ...(withFilters.length === 1 ? { applied: withFilters[0].applied } : {}),
  }
}

/** Evidence of all calls of a turn, de-duplicated (items by id, web by URL). */
export function mergeEvidenceParts(parts: readonly ChatEvidencePart[]): ChatEvidencePart | null {
  const items = new Map<string, RecordHit>()
  const web = new Map<string, ChatWebSource>()
  for (const p of parts) {
    for (const h of p.sourceItems) if (!items.has(h.id)) items.set(h.id, h)
    for (const w of p.web) if (w.url && !web.has(w.url)) web.set(w.url, w)
  }
  if (!items.size && !web.size) return null
  return { sourceItems: [...items.values()], web: [...web.values()] }
}

/** «CRM · интернет · 7 с» (Q10); no tool used → «7 с». */
export function turnLine(t: ChatTurnPart): string {
  const words: string[] = []
  if (t.used.includes("crm")) words.push("CRM")
  if (t.used.includes("web")) words.push("интернет")
  const s = Math.max(1, Math.round(t.ms / 1000))
  return [...words, `${s} с`].join(" · ")
}

// ── Errors (§9) ───────────────────────────────────────────────────────

export const CHAT_ERROR_CLASSES = ["model_unavailable", "timeout", "limit", "unknown"] as const
export type ChatErrorClass = (typeof CHAT_ERROR_CLASSES)[number]

/** Prefix of the stream error text — the client maps it to Russian. */
export const CHAT_ERROR_PREFIX = "chat_error:"

export const CHAT_ERROR_MESSAGES_RU: Record<ChatErrorClass, string> = {
  model_unavailable: "Модель сейчас недоступна, попробуйте ещё раз.",
  timeout: "Ответ занял слишком много времени.",
  limit: "Месячный лимит ИИ вашей организации исчерпан.",
  unknown: "Не удалось получить ответ. Попробуйте ещё раз.",
}

/**
 * Russian text of a failed request as `useChat` reports it: a stream error
 * («chat_error:<class>») or an HTTP error body (`{ error, message }`). Never
 * shows the raw error.
 */
export function chatErrorText(message: string | null | undefined): { cls: ChatErrorClass; text: string } {
  const m = (message ?? "").trim()
  if (m.startsWith(CHAT_ERROR_PREFIX)) {
    const cls = m.slice(CHAT_ERROR_PREFIX.length) as ChatErrorClass
    if ((CHAT_ERROR_CLASSES as readonly string[]).includes(cls)) return { cls, text: CHAT_ERROR_MESSAGES_RU[cls] }
  }
  try {
    const body = JSON.parse(m) as { error?: string; message?: string }
    if (body.error === "monthly_limit") {
      return { cls: "limit", text: body.message || CHAT_ERROR_MESSAGES_RU.limit }
    }
    if (typeof body.error === "string" && body.error.startsWith(CHAT_ERROR_PREFIX)) {
      return chatErrorText(body.error)
    }
  } catch {
    // not JSON
  }
  if (/timeout|timed out|aborted/i.test(m)) return { cls: "timeout", text: CHAT_ERROR_MESSAGES_RU.timeout }
  return { cls: "unknown", text: CHAT_ERROR_MESSAGES_RU.unknown }
}

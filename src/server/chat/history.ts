import "server-only"

import type { UIMessage } from "ai"
import { RECORD_TYPE_LABELS, RECORD_TYPE_ORDER } from "@/lib/chat/records"
import type { ChatEvidencePart, ChatRecordsPart } from "@/lib/chat/turn"
import type { StatsResult } from "@/lib/chat/stats"

// What the model sees of EARLIER turns (spec §9: tool parts never reach the
// browser, so they are not in the history the client sends back). The
// records / stats / evidence a turn showed are folded into short text notes,
// so a follow-up («а какие у него сделки?») can use the refs without a new
// search. Pure — unit-tested.

const KEEP = new Set(["text", "file"])
const NOTE_HITS = 15

/** Keep text, files and our data parts; drop tool / reasoning / source / unknown parts and empty messages. */
export function cleanHistory(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && Array.isArray(m.parts))
    .map((m) => ({
      ...m,
      parts: m.parts.filter((p) => KEEP.has(p.type) || p.type === "data-records" || p.type === "data-stats" || p.type === "data-evidence"),
    }))
    .filter((m) => m.parts.length > 0)
}

type DataPartLike = { type: string; data?: unknown }

/** `convertDataPart` for convertToModelMessages: data part → a short text note (or nothing). */
export function dataPartToModelText(part: DataPartLike): { type: "text"; text: string } | undefined {
  if (part.type === "data-records" && part.data) {
    const d = part.data as ChatRecordsPart
    const lines: string[] = []
    let n = 0
    for (const t of RECORD_TYPE_ORDER) {
      for (const h of d.hits[t] ?? []) {
        if (n >= NOTE_HITS) break
        lines.push(`${RECORD_TYPE_LABELS[t].one} «${h.title}» (type ${t}, ref ${h.id})`)
        n++
      }
    }
    if (!lines.length) return { type: "text", text: "[Показано пользователю: ничего не найдено]" }
    return { type: "text", text: `[Показано пользователю в списке: ${lines.join("; ")}]` }
  }
  if (part.type === "data-stats" && part.data) {
    const r = part.data as StatsResult
    const m = r.meta
    const what = [r.subjectLabel, m.measureLabel, m.dimensionLabel ? `по «${m.dimensionLabel}»` : null, m.periodLabel]
      .filter(Boolean)
      .join(", ")
    const value = r.scalar != null ? `; значение ${Math.round(r.scalar * 100) / 100}` : ""
    return { type: "text", text: `[Показана статистика: ${what}${value}]` }
  }
  if (part.type === "data-evidence" && part.data) {
    const e = part.data as ChatEvidencePart
    const items = e.sourceItems.map((h) => `«${h.title}» (ref ${h.id})`)
    const web = e.web.map((w) => w.url)
    const text = [items.length ? `прочитано: ${items.join("; ")}` : "", web.length ? `веб-источники: ${web.join(", ")}` : ""]
      .filter(Boolean)
      .join("; ")
    return text ? { type: "text", text: `[${text}]` } : undefined
  }
  return undefined
}

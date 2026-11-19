// AI chat answer → Telegram messages (docs/specs/ai-chat-telegram/
// 01-specification.md §7, §8). PURE and client-safe: one renderer over the
// STORED parts of an assistant answer (the same parts the web chat shows).
//
// Order of the output (§7): attachment notices → the answer (prose, records,
// statistics, composed view, «🌐 с данными из интернета») → draft cards →
// questions → sources. Every message is valid Telegram HTML of ≤ 4,096
// visible characters. Ids / refs never appear in the text; buttons carry
// typed actions the sender maps to short server-side ids (L4).

import { applySpecPatch, getByPath, nestedToFlat } from "@json-render/core"
import type { Spec, UIElement } from "@json-render/core"
import {
  ACTION_KIND_TITLES,
  isOpenActionStatus,
  missingFields,
  type ActionResult,
  type ChatActionResultPart,
  type ChatDraftPart,
  type CompanyValues,
  type ConfirmActionInput,
  type ContactValues,
  type DealMoveValues,
  type DealValues,
  type DraftItem,
  type DraftMatch,
  type ItemDecision,
  type ItemType,
  type LinkValues,
  type OrderRequestValues,
  type TaskUpdateValues,
  type TaskValues,
  type UpdateValues,
  normalizeDealValue,
} from "@/lib/chat/actions"
import type { ChatAttachmentPart } from "@/lib/chat/files"
import { RECORD_TYPE_LABELS, RECORD_TYPE_ORDER, formatRecordCount, type RecordHit, type RecordType } from "@/lib/chat/records"
import { statsValueText, type StatsResult } from "@/lib/chat/stats"
import {
  INTERNAL_NOTE_LINE,
  cleanIdLinks,
  dataParts,
  mergeEvidenceParts,
  mergeRecordsParts,
  type ChatEvidencePart,
  type ChatQuestionPart,
  type ChatRecordsPart,
} from "@/lib/chat/turn"
import {
  TELEGRAM_MAX_TEXT,
  escapeAttr,
  escapeHtml,
  fitsPreTable,
  linkHtml,
  markdownToTelegramHtml,
  preTableHtml,
  safeHttpUrl,
  splitTelegramHtml,
  tableToTelegramHtml,
  visibleLength,
} from "@/lib/telegram/html"

// ── Output contract ─────────────────────────────────────────────────────

export type TgButtonAction =
  | { kind: "card_confirm"; actionId: string }
  | { kind: "card_cancel"; actionId: string }
  | { kind: "card_decision"; actionId: string; itemKey: string; decision: string; existingId?: string }
  | { kind: "question_option"; questionId: string; option: string }
  | { kind: "stats_csv"; statsIndex: number } // index among this message's data-stats parts

export type TgButton = { text: string; action: TgButtonAction } | { text: string; url: string }

export type TgOutMessage = {
  role: "answer" | "card" | "question" | "sources" | "notice"
  html: string // ≤ 4096 visible chars, valid Telegram HTML
  buttons?: TgButton[][] // rows
  actionId?: string // for role "card"
  questionId?: string // for role "question"
}

export type TgRenderContext = {
  /** Public origin of the CRM (`NEXT_PUBLIC_APP_URL`), e.g. https://app.truffalo.ai */
  appUrl: string
  /** AI chat thread of the answer («открыть в CRM» = the web chat on this thread, §13). */
  threadId: string
  /** IANA zone for dates (org time zone); omitted = the runtime's zone, as the web chat. */
  timeZone?: string
}

type AnyPart = { type: string; text?: string; data?: unknown; id?: string }

// ── Small helpers ───────────────────────────────────────────────────────

const ROWS_PER_TYPE = 5
const STATS_ROWS = 12
const QUESTION_OPTIONS = 5

function baseUrl(ctx: TgRenderContext): string {
  return (ctx.appUrl ?? "").trim().replace(/\/+$/, "")
}

function absUrl(ctx: TgRenderContext, href: string): string | null {
  if (!href) return null
  if (/^https?:\/\//i.test(href)) return safeHttpUrl(href)
  if (!href.startsWith("/")) return null
  return safeHttpUrl(`${baseUrl(ctx)}${href}`)
}

/** The web chat opened on this thread (spec §13 deep link `?chat=`). */
export function chatThreadUrl(ctx: TgRenderContext): string {
  return `${baseUrl(ctx)}/dashboard?chat=${encodeURIComponent(ctx.threadId)}`
}

function dateText(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(d)
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
  }
}

const cut = (s: string, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Lower-case first letter («Компании» → «компании»). */
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

function fmtNumber(n: number, digits: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n)
}

/**
 * Short money for Telegram (spec §7): «950 ₽», «8,5 тыс ₽», «350 тыс ₽»,
 * «1,2 млн ₽», «3 млрд ₽». One decimal below 10 units of the scale, a
 * trailing «,0» is never shown.
 */
export function shortMoney(value: number, currency = "₽"): string {
  if (!Number.isFinite(value)) return ""
  const abs = Math.abs(value)
  const scaled = (div: number, unit: string) => {
    const n = value / div
    return `${fmtNumber(n, Math.abs(n) >= 10 ? 0 : 1)} ${unit} ${currency}`
  }
  if (abs >= 1e9) return scaled(1e9, "млрд")
  if (abs >= 1e6) return scaled(1e6, "млн")
  if (abs >= 1e3) return scaled(1e3, "тыс")
  return `${fmtNumber(value, abs >= 10 ? 0 : 2)} ${currency}`
}

/** Exact value (as the web table): money gets «₽». */
function exactValue(value: number, kind: StatsResult["meta"]["measureKind"]): string {
  const t = statsValueText(value, kind)
  return kind === "money" && t ? `${t} ₽` : t
}

/** A value for the short table: money short, other kinds as the web. */
function shortValue(value: number, kind: StatsResult["meta"]["measureKind"]): string {
  return kind === "money" ? shortMoney(value) : statsValueText(value, kind)
}

// ── Prose ───────────────────────────────────────────────────────────────

/** Answer text without internal note lines and record ids (the stream filter already did this; kept as a guard). */
function cleanProse(text: string): string {
  return cleanIdLinks(
    text
      .split("\n")
      .filter((l) => !INTERNAL_NOTE_LINE.test(l))
      .join("\n"),
  )
}

// ── Records (§7 results block) ──────────────────────────────────────────

function hitLine(hit: RecordHit, ctx: TgRenderContext): string {
  const bits: string[] = []
  if (hit.subtitle) bits.push(escapeHtml(cut(hit.subtitle, 80)))
  if (hit.badge?.label) bits.push(escapeHtml(hit.badge.label))
  for (const f of (hit.facts ?? []).slice(0, 3)) {
    if (f.value) bits.push(escapeHtml(f.label ? `${f.label}: ${f.value}` : f.value))
  }
  const date = dateText(hit.date, ctx.timeZone)
  if (date && !bits.some((b) => b.includes(date))) bits.push(date)
  const url = absUrl(ctx, hit.href)
  if (url) bits.push(`<a href="${escapeAttr(url)}">открыть</a>`)
  const title = `<b>${escapeHtml(cut(hit.title || "Без названия", 120))}</b>`
  return `• ${title}${bits.length ? ` — ${bits.join(" · ")}` : ""}`
}

/** The merged results block (`data-records`) as Telegram HTML; "" = nothing to show. */
export function renderRecordsHtml(records: ChatRecordsPart, ctx: TgRenderContext): string {
  const countParts = RECORD_TYPE_ORDER.flatMap((t) => {
    const c = records.counts[t]
    if (!c || c.total === 0) return []
    return [`${lowerFirst(RECORD_TYPE_LABELS[t].many)} ${formatRecordCount(c)}`]
  })
  const sections = RECORD_TYPE_ORDER.filter((t) => (records.hits[t]?.length ?? 0) > 0)
  const applied = records.applied ?? []
  if (!countParts.length && !sections.length && !applied.length) return ""

  const blocks: string[] = []
  const head = [countParts.length ? `Нашёл: ${escapeHtml(countParts.join(" · "))}` : "Ничего не нашёл"]
  if (applied.length) head.push(`Фильтр: ${escapeHtml(applied.map((f) => `${f.label}: ${f.value}`).join(" · "))}`)
  blocks.push(head.join("\n"))

  for (const t of sections) {
    const hits = records.hits[t as RecordType] ?? []
    const count = records.counts[t] ?? { total: hits.length, capped: false }
    const lines = [`<b>${escapeHtml(RECORD_TYPE_LABELS[t].many)}</b>`]
    for (const h of hits.slice(0, ROWS_PER_TYPE)) lines.push(hitLine(h, ctx))
    const more = Math.max(count.total, hits.length) - Math.min(hits.length, ROWS_PER_TYPE)
    const crm = `<a href="${escapeAttr(chatThreadUrl(ctx))}">открыть в CRM</a>`
    if (count.capped) lines.push(`…всего ${escapeHtml(formatRecordCount(count))} — ${crm}`)
    else if (more > 0) lines.push(`…ещё ${more} — ${crm}`)
    blocks.push(lines.join("\n"))
  }
  return blocks.join("\n\n")
}

// ── Statistics (§7) ─────────────────────────────────────────────────────

function hasStatsData(r: StatsResult): boolean {
  return r.rows.length > 0 || r.scalar != null
}

/** One statistics result as Telegram HTML. */
export function renderStatsHtml(result: StatsResult): string {
  const { meta } = result
  const lines: string[] = []
  const dim = meta.dimensionLabel ? ` · ${lowerFirst(meta.dimensionLabel)}${meta.splitLabel ? ` × ${lowerFirst(meta.splitLabel)}` : ""}` : ""
  lines.push(`📊 <b>${escapeHtml(meta.measureLabel)}</b>${escapeHtml(dim)}`)
  const sub = [result.subjectLabel, meta.periodLabel, ...meta.applied.map((f) => `${f.label}: ${f.value}`)].filter(Boolean)
  if (sub.length) lines.push(`<i>${escapeHtml(sub.join(" · "))}</i>`)

  if (!result.rows.length) {
    if (result.scalar != null) lines.push(`Итог: <b>${escapeHtml(exactValue(result.scalar, meta.measureKind))}</b>`)
    else lines.push("Нет данных для этого запроса.")
  } else {
    const split = Boolean(meta.splitLabel)
    const shown = result.rows.slice(0, STATS_ROWS)
    const table = shown.map((r) => [r.label ?? "", ...(split ? [r.splitLabel ?? ""] : []), shortValue(r.value, meta.measureKind)])
    const labelsShort = shown.every((r) => (r.label ?? "").length <= 18 && (!split || (r.splitLabel ?? "").length <= 18))
    if (labelsShort && fitsPreTable(table.map((r) => r.slice(0, -1)))) {
      lines.push(preTableHtml(table))
    } else {
      for (const r of table) {
        const value = r[r.length - 1]
        const label = r.slice(0, -1).filter(Boolean).join(" · ")
        lines.push(`• ${escapeHtml(label)} — ${escapeHtml(value)}`)
      }
    }
    if (meta.measureKind === "money" || meta.measureKind === "count") {
      lines.push(`Всего: <b>${escapeHtml(exactValue(meta.total, meta.measureKind))}</b>`)
    }
    const more = result.rows.length - shown.length
    if (more > 0) lines.push(`…ещё ${more} ${rowsWord(more)} — в CSV`)
    if (meta.truncated) lines.push(`<i>Показаны только первые ${meta.rowCount} — остальные значения меньше.</i>`)
  }
  if (meta.warnings.length) lines.push(`⚠️ ${escapeHtml(meta.warnings.join(" "))}`)
  return lines.join("\n")
}

function rowsWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return "строка"
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "строки"
  return "строк"
}

// ── Composed view (`data-spec`, json-render) ───────────────────────────

type SpecPayload = { type?: string; patch?: unknown; spec?: unknown }

/** Rebuild the composed spec from the message's `data-spec` parts (patch / flat / nested, as json-render does). */
export function specFromParts(parts: readonly AnyPart[]): Spec | null {
  let spec: Spec = { root: "", elements: {} }
  let has = false
  for (const p of parts) {
    if (p.type !== "data-spec" || !p.data || typeof p.data !== "object") continue
    const d = p.data as SpecPayload & Partial<Spec>
    try {
      if (d.type === "patch" && d.patch && typeof d.patch === "object") {
        spec = applySpecPatch(spec, d.patch as Parameters<typeof applySpecPatch>[1])
        has = true
      } else if (d.type === "flat" && d.spec && typeof d.spec === "object") {
        Object.assign(spec, d.spec)
        has = true
      } else if (d.type === "nested" && d.spec && typeof d.spec === "object") {
        Object.assign(spec, nestedToFlat(d.spec as Record<string, unknown>))
        has = true
      } else if (typeof d.root === "string" && d.elements && typeof d.elements === "object") {
        Object.assign(spec, { root: d.root, elements: d.elements, ...(d.state ? { state: d.state } : {}) })
        has = true
      }
    } catch {
      // A broken patch: skip it (the rest still renders).
    }
  }
  return has && spec.root && spec.elements?.[spec.root] ? spec : null
}

function resolveProp(v: unknown, state: Record<string, unknown>): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { $state?: unknown }).$state === "string") {
    try {
      return getByPath(state, (v as { $state: string }).$state)
    } catch {
      return undefined
    }
  }
  return v
}

function cellText(v: unknown, type: string | undefined): string {
  if (v == null) return ""
  if (typeof v === "number") {
    if (type === "currency") return shortMoney(v)
    if (type === "percentage") return `${fmtNumber(v, 1)} %`
    return fmtNumber(v, 2)
  }
  if (typeof v === "boolean") return v ? "да" : "нет"
  if (typeof v === "string") return v
  return ""
}

/** Flatten a json-render spec to Telegram HTML (spec §7 «Composed view»). */
export function renderSpecHtml(spec: Spec): string {
  const state = (spec.state ?? {}) as Record<string, unknown>
  const seen = new Set<string>()
  const walk = (key: string, depth: number): string => {
    if (depth > 20 || seen.has(key)) return ""
    seen.add(key)
    const el = spec.elements[key] as UIElement | undefined
    if (!el) return ""
    const props = (el.props ?? {}) as Record<string, unknown>
    const prop = (name: string) => resolveProp(props[name], state)
    const childKeys = [...(el.children ?? []), ...Object.values(el.slots ?? {}).flat()]
    const children = () => childKeys.map((k) => walk(k, depth + 1)).filter((s) => s.trim())
    switch (el.type) {
      case "Stack":
      case "Grid":
        return children().join("\n\n")
      case "Badge": {
        const label = prop("label")
        return typeof label === "string" && label.trim() ? `[${escapeHtml(label.trim())}]` : ""
      }
      case "KeyValue": {
        const items = prop("items")
        if (!Array.isArray(items)) return ""
        return items
          .map((it) => {
            const o = (it ?? {}) as { label?: unknown; value?: unknown }
            const label = typeof o.label === "string" ? o.label : ""
            const value = cellText(o.value, undefined)
            return label || value ? `${label ? `${escapeHtml(label)}: ` : ""}${escapeHtml(value)}` : ""
          })
          .filter(Boolean)
          .join("\n")
      }
      case "DataTable": {
        const columns = prop("columns")
        const rows = prop("rows")
        if (!Array.isArray(columns) || !Array.isArray(rows)) return ""
        const cols = columns
          .map((c) => (c ?? {}) as { key?: unknown; label?: unknown; type?: unknown })
          .filter((c) => typeof c.key === "string")
          .map((c) => ({ key: c.key as string, label: typeof c.label === "string" ? c.label : (c.key as string), type: typeof c.type === "string" ? c.type : undefined }))
        if (!cols.length) return ""
        const body = rows.slice(0, STATS_ROWS).map((r) => cols.map((c) => cellText((r as Record<string, unknown>)?.[c.key], c.type).replace(/\|/g, "/")))
        const title = prop("title")
        const out = [typeof title === "string" && title.trim() ? `<b>${escapeHtml(title.trim())}</b>` : ""]
        // Cells are plain text here: escape markdown markers by passing them through the plain path.
        out.push(tableToTelegramHtml(cols.map((c) => escapeMd(c.label)), body.map((r) => r.map(escapeMd))))
        if (rows.length > STATS_ROWS) out.push(`…ещё ${rows.length - STATS_ROWS} ${rowsWord(rows.length - STATS_ROWS)}`)
        return out.filter(Boolean).join("\n")
      }
      case "Markdown": {
        const content = prop("content")
        return typeof content === "string" ? markdownToTelegramHtml(cleanProse(content)) : ""
      }
      default: {
        // Unknown element: its text props + its children.
        const texts = ["title", "label", "text", "content", "description", "value"]
          .map((n) => prop(n))
          .filter((v): v is string => typeof v === "string" && !!v.trim())
          .map((v) => escapeHtml(v.trim()))
        return [...texts, ...children()].join("\n")
      }
    }
  }
  return walk(spec.root, 0).replace(/\n{3,}/g, "\n\n").trim()
}

/** Escape markdown markers so a plain value stays plain in the table renderer. */
function escapeMd(s: string): string {
  return s.replace(/([\\`*_~[\]<])/g, "\\$1")
}

// ── Draft cards (§8) ────────────────────────────────────────────────────

/** Item order of the web card (companies, contacts, deals, tasks, …). */
const ITEM_ORDER: Record<ItemType, number> = {
  company: 0,
  contact: 1,
  deal: 2,
  task: 3,
  update: 4,
  link: 5,
  order_request: 6,
  deal_move: 7,
  task_update: 8,
}

const sortedItems = (draft: ChatDraftPart) => [...draft.draft.items].sort((a, b) => ITEM_ORDER[a.type] - ITEM_ORDER[b.type])

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

/**
 * Values the web card sends for an item it was never edited in:
 * `toValues(toForm(item))` of draft-card.tsx, replicated field by field.
 */
export function defaultItemValues(item: DraftItem): unknown {
  if (item.type === "company") {
    const v = item.values as CompanyValues
    return {
      name: (v.name ?? "").trim(),
      aliases: splitList((v.aliases ?? []).join(", ")),
      website: (v.website ?? "").trim(),
      email: (v.email ?? "").trim(),
      phone: (v.phone ?? "").trim(),
      address: (v.address ?? "").trim(),
      comment: (v.comment ?? "").trim(),
    }
  }
  if (item.type === "contact") {
    const v = item.values as ContactValues
    return {
      name: (v.name ?? "").trim(),
      nameNative: (v.nameNative ?? "").trim(),
      position: (v.position ?? "").trim(),
      emails: splitList((v.emails ?? []).join(", ")),
      phones: splitList((v.phones ?? []).join(", ")),
      telegram: (v.telegram ?? "").trim().replace(/^@+/, ""),
      companyId: v.companyId ?? null,
      companyKey: v.companyKey ?? null,
      companyName: (v.companyName ?? "").trim(),
      noCompany: v.noCompany === true && !v.companyId && !v.companyKey,
    }
  }
  if (item.type === "deal") {
    const v = item.values as DealValues
    return {
      name: (v.name ?? "").trim(),
      description: (v.description ?? "").trim(),
      companyId: v.companyId ?? null,
      companyKey: v.companyKey ?? null,
      companyName: (v.companyName ?? "").trim(),
      contactIds: v.contactIds ?? [],
      contactKeys: v.contactKeys ?? [],
      contactNames: v.contactNames ?? [],
      value: normalizeDealValue(v.value ?? ""),
      valueText: v.valueText ?? "",
      currency: v.currency ?? "",
      dealTypeId: v.dealTypeId ?? null,
      dealTypeName: v.dealTypeName ?? "",
      stageId: v.stageId ?? null,
      stageName: v.stageName ?? "",
      ruleNote: v.ruleNote ?? "",
    }
  }
  if (item.type === "update") {
    const v = item.values as UpdateValues
    return { targetType: v.targetType, targetId: v.targetId, targetName: v.targetName ?? "", changes: v.changes ?? [] }
  }
  if (item.type === "order_request") {
    const v = item.values as OrderRequestValues
    return {
      clientId: v.clientId ?? null,
      companyKey: v.companyKey ?? null,
      clientName: v.clientName ?? "",
      requestText: v.requestText ?? "",
      comment: (v.comment ?? "").trim(),
    }
  }
  if (item.type === "deal_move") {
    const v = item.values as DealMoveValues
    const outcome = v.outcome ?? null
    return {
      dealId: v.dealId,
      dealName: v.dealName ?? "",
      fromStageName: v.fromStageName ?? "",
      stageId: v.stageId ?? null,
      stageName: v.stageName ?? "",
      outcome,
      reasonCode: outcome === "lost" ? (v.reasonCode ?? "") : "",
      reasonText: (v.reasonText ?? "").trim(),
    }
  }
  if (item.type === "task_update") {
    const v = item.values as TaskUpdateValues
    const action = v.action ?? "done"
    return {
      taskId: v.taskId,
      taskTitle: v.taskTitle ?? "",
      action,
      dueDate: action === "reschedule" ? (v.dueDate ?? "") : "",
      dueText: v.dueText ?? "",
      currentDue: v.currentDue ?? "",
    }
  }
  if (item.type === "link") {
    const v = item.values as LinkValues
    return {
      contactId: v.contactId ?? null,
      contactName: v.contactName ?? "",
      clientId: v.clientId ?? null,
      clientName: v.clientName ?? "",
      primary: v.primary ?? false,
      dealId: v.dealId ?? null,
      dealName: v.dealName ?? "",
    }
  }
  const v = item.values as TaskValues
  return {
    title: (v.title ?? "").trim(),
    description: (v.description ?? "").trim(),
    type: v.type ?? "other",
    priority: v.priority ?? "medium",
    dueDate: v.dueDate ?? "",
    dueText: (v.dueText ?? "").trim(),
    assigneeId: v.assigneeId ?? null,
    assigneeName: (v.assigneeName ?? "").trim(),
    companyId: v.companyId ?? null,
    companyKey: v.companyKey ?? null,
    companyName: v.companyName ?? "",
    contactId: v.contactId ?? null,
    contactKey: v.contactKey ?? null,
    contactName: v.contactName ?? "",
    dealId: v.dealId ?? null,
    dealKey: v.dealKey ?? null,
    dealName: v.dealName ?? "",
    done: v.done ?? false,
  }
}

type CardChoice = { label: string; decision: ItemDecision; existingId?: string }

function matchName(m: DraftMatch): string {
  return `«${m.title}»${m.subtitle ? ` (${m.subtitle})` : ""}`
}

/**
 * The duplicate choices of an item, as the web card offers them
 * (`choiceOptions` of draft-card.tsx), with the Telegram button labels
 * of spec §8.1. Empty = a plain create, no choice.
 */
export function cardItemChoices(item: DraftItem): CardChoice[] {
  const exact = item.matches.filter((m) => m.kind === "exact")
  const deleted = item.matches.filter((m) => m.kind === "deleted")
  if (!exact.length && !deleted.length) return []
  const deal = item.type === "deal"
  const out: CardChoice[] = []
  for (const m of exact) {
    out.push({
      label: exact.length === 1 ? (deal ? "Использовать существующую" : "Использовать существующий") : `Использовать ${matchName(m)}`,
      decision: "use_existing",
      existingId: m.id,
    })
    if (m.fill?.length) {
      out.push({
        label: exact.length === 1 ? (deal ? "Дополнить существующую" : "Дополнить существующий") : `Дополнить ${matchName(m)}`,
        decision: "fill_existing",
        existingId: m.id,
      })
    }
  }
  for (const m of deleted) {
    out.push({ label: deleted.length === 1 ? "Восстановить" : `Восстановить ${matchName(m)}`, decision: "restore", existingId: m.id })
  }
  out.push(
    exact.length
      ? { label: deal ? "Создать новую" : "Создать новый", decision: "create_anyway" }
      : { label: deal ? "Создать новую" : "Создать новый", decision: "create" },
  )
  return out
}

export type TgCardState = "confirm" | "decide" | "needs_input" | "open_crm" | "closed"

type CardRow = { item: DraftItem; include: boolean; choices: CardChoice[]; missing: string[] }

function cardRows(draft: ChatDraftPart): CardRow[] {
  return sortedItems(draft).map((item) => {
    const choices = cardItemChoices(item)
    // An exact match defaults to «Использовать существующий»: no new-record
    // fields are needed then (the web card and the server skip them too).
    const usesExisting = choices.some((c) => c.decision === "use_existing")
    return {
      item,
      include: !item.refused,
      choices,
      missing: usesExisting ? [] : missingFields({ type: item.type, values: defaultItemValues(item) as DraftItem["values"] }),
    }
  })
}

/**
 * What Telegram can do with the card (spec §8.1):
 * - `confirm` — open, every included item has no missing field and no duplicate choice;
 * - `decide` — exactly ONE included item has a duplicate choice (exact / deleted match);
 * - `needs_input` — an included item misses a required field;
 * - `open_crm` — several items with choices, or nothing can be created here (all refused);
 * - `closed` — created / cancelled / expired / failed / confirming.
 */
export function telegramCardState(draft: ChatDraftPart): TgCardState {
  if (!isOpenActionStatus(draft.status)) return "closed"
  const rows = cardRows(draft).filter((r) => r.include)
  if (!rows.length) return "open_crm"
  if (rows.some((r) => r.missing.length > 0)) return "needs_input"
  const withChoices = rows.filter((r) => r.choices.length > 0)
  if (withChoices.length === 0) return "confirm"
  if (withChoices.length === 1) return "decide"
  return "open_crm"
}

/**
 * The confirm input the web card would send with its DEFAULT values and
 * decisions (draft-card.tsx `submit()`), for a card in state `confirm` —
 * or in state `decide` with the person's `choice` for the one item that
 * has choices. null = not confirmable from Telegram.
 */
export function telegramCardConfirmInput(
  draft: ChatDraftPart,
  choice?: { itemKey: string; decision: string; existingId?: string },
): ConfirmActionInput | null {
  const state = telegramCardState(draft)
  const rows = cardRows(draft)
  let chosen: { key: string; option: CardChoice } | null = null
  if (state === "decide") {
    if (!choice) return null
    const row = rows.find((r) => r.include && r.choices.length > 0)
    if (!row || row.item.key !== choice.itemKey) return null
    const option = row.choices.find(
      (o) => o.decision === choice.decision && (o.existingId ?? null) === (choice.existingId ?? null),
    )
    if (!option) return null
    chosen = { key: row.item.key, option }
  } else if (state !== "confirm") {
    return null
  } else if (choice) {
    // Nothing to choose on this card: a stale button.
    return null
  }
  return {
    actionId: draft.actionId,
    attachFile: draft.draft.files.length > 0,
    items: rows.map((r) => {
      const decision: ItemDecision = chosen && chosen.key === r.item.key ? chosen.option.decision : "create"
      const existingId = chosen && chosen.key === r.item.key ? chosen.option.existingId : undefined
      return {
        key: r.item.key,
        include: r.include,
        decision,
        ...(existingId ? { existingId } : {}),
        values: defaultItemValues(r.item),
      }
    }),
  }
}

/** Short Russian names of the missing fields (the web shows full sentences). */
const MISSING_WORDS: Record<string, string> = {
  title: "что сделать",
  dueDate: "срок",
  assignee: "исполнитель",
  name: "название / имя",
  companyOrChannel: "компания или телефон / e-mail / Telegram",
  client: "компания клиента",
  requestText: "текст запроса клиента",
  reason: "причина проигрыша",
  changes: "новые данные",
  contact: "контакт",
  target: "компания или сделка",
  company: "компания сделки",
  stage: "стадия",
}

const ITEM_PREFIX: Record<ItemType, string> = {
  company: "Компания",
  contact: "Контакт",
  task: "Задача",
  deal: "Сделка",
  update: "Дополнить",
  link: "Связать",
  order_request: "Запрос клиента",
  deal_move: "Перевод сделки",
  task_update: "Задача",
}

function localDateTime(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local ?? "")
  if (!m) return local ?? ""
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`
}

function itemName(item: DraftItem): string {
  switch (item.type) {
    case "task":
      return (item.values as TaskValues).title
    case "update":
      return (item.values as UpdateValues).targetName
    case "order_request":
      return (item.values as OrderRequestValues).clientName
    case "deal_move":
      return (item.values as DealMoveValues).dealName
    case "task_update":
      return (item.values as TaskUpdateValues).taskTitle
    case "link": {
      const l = item.values as LinkValues
      return [l.contactName, l.clientName || l.dealName].filter(Boolean).join(" ↔ ")
    }
    default:
      return (item.values as CompanyValues | ContactValues | DealValues).name
  }
}

/** Key values of an item (only filled ones), escaped. */
function itemFacts(item: DraftItem, draft: ChatDraftPart): string[] {
  const out: string[] = []
  const add = (v: string | null | undefined) => {
    const t = (v ?? "").trim()
    if (t) out.push(escapeHtml(cut(t, 120)))
  }
  const companyInCard = draft.draft.items.some((i) => i.type === "company")
  switch (item.type) {
    case "company": {
      const v = item.values as CompanyValues
      add(v.website)
      add(v.phone)
      add(v.email)
      add(v.address)
      break
    }
    case "contact": {
      const v = item.values as ContactValues
      add(v.position)
      for (const p of v.phones ?? []) add(p)
      for (const e of v.emails ?? []) add(e)
      if (v.telegram) add(`@${v.telegram.replace(/^@+/, "")}`)
      if (v.companyName && !(companyInCard && v.companyKey)) add(v.companyName)
      break
    }
    case "task": {
      const v = item.values as TaskValues
      if (v.done) add(v.dueDate ? `выполнено ${localDateTime(v.dueDate)}` : "выполнено")
      else if (v.dueDate) add(`срок ${localDateTime(v.dueDate)}`)
      if (v.assigneeName) add(`исполнитель ${v.assigneeName}`)
      add(v.companyName)
      add(v.contactName)
      add(v.dealName ? `сделка «${v.dealName}»` : "")
      break
    }
    case "deal": {
      const v = item.values as DealValues
      if (v.companyName && !(companyInCard && v.companyKey)) add(v.companyName)
      if (v.value) {
        const n = Number(v.value)
        const sign = { RUB: "₽", USD: "$", EUR: "€", CNY: "¥", GBP: "£" }[v.currency] ?? (v.currency ? v.currency : "₽")
        add(Number.isFinite(n) ? shortMoney(n, sign) : v.valueText)
      } else add(v.valueText)
      add(v.dealTypeName)
      add(v.stageName ? `стадия «${v.stageName}»` : "")
      break
    }
    case "update": {
      const v = item.values as UpdateValues
      for (const c of (v.changes ?? []).slice(0, 6)) add(`${c.label}: ${c.value}`)
      break
    }
    case "link": {
      const v = item.values as LinkValues
      if (v.primary) add("основная компания")
      break
    }
    case "order_request": {
      const v = item.values as OrderRequestValues
      add(`«${cut(v.requestText ?? "", 160)}»`)
      add(v.comment)
      break
    }
    case "deal_move": {
      const v = item.values as DealMoveValues
      const target = v.outcome === "won" ? "выиграна" : v.outcome === "lost" ? "проиграна" : v.stageName
      add(`${v.fromStageName ? `${v.fromStageName} → ` : "→ "}${target || "?"}`)
      add(v.reasonText)
      break
    }
    case "task_update": {
      const v = item.values as TaskUpdateValues
      add(v.action === "done" ? "отметить выполненной" : v.dueDate ? `новый срок ${localDateTime(v.dueDate)}` : "перенести срок")
      break
    }
  }
  return out
}

const RESULT_LABELS: Record<ActionResult["type"], string> = {
  order_request: "Запрос клиента",
  client: "Компания",
  contact: "Контакт",
  task: "Задача",
  deal: "Сделка",
}

/** «— восстановлен», … as the web card's `resultNote`. */
function resultNote(r: ActionResult, items: DraftItem[]): string {
  const masc = r.type === "contact"
  if (r.moved) return " — переведена"
  if (r.type === "task") {
    const upd = items.find((i) => i.type === "task_update" && (i.values as TaskUpdateValues).taskId === r.id)
    if (upd) return (upd.values as TaskUpdateValues).action === "done" ? " — выполнена" : " — срок перенесён"
  }
  if (r.restored) return masc ? " — восстановлен" : " — восстановлена"
  if (r.updated) return masc ? " — дополнен" : " — дополнена"
  if (r.linked) return masc ? " — связан" : " — связана"
  if (r.existing) return " — существующая запись"
  return ""
}

/** The card's latest state: a `data-action-result` of the same action wins over an older draft status. */
function withResult(draft: ChatDraftPart, results: readonly ChatActionResultPart[]): ChatDraftPart {
  const r = results.find((x) => x.actionId === draft.actionId)
  if (!r) return draft
  if (!isOpenActionStatus(draft.status) && draft.status !== "confirming" && draft.results?.length) return draft
  return { ...draft, status: r.status, results: r.results }
}

/** One draft card as a Telegram message (role "card"). */
export function renderCardMessage(draft: ChatDraftPart, ctx: TgRenderContext): TgOutMessage {
  const items = sortedItems(draft)
  const tasks = items.filter((i) => i.type === "task").length
  const kindTitle = lowerFirst(ACTION_KIND_TITLES[draft.kind] ?? "черновик")
  const lines: string[] = [`📝 <b>Черновик: ${escapeHtml(kindTitle)}${draft.kind === "tasks" && tasks > 1 ? ` (${tasks})` : ""}</b>`]
  const state = telegramCardState(draft)
  const open = isOpenActionStatus(draft.status)

  for (const item of items) {
    const name = itemName(item) || "без названия"
    const facts = itemFacts(item, draft)
    const prefix = ITEM_PREFIX[item.type]
    if (item.refused) {
      lines.push(`⛔ ${escapeHtml(prefix)}: ${escapeHtml(cut(name, 80))} — ${escapeHtml(item.refused)}`)
      continue
    }
    lines.push(`${escapeHtml(prefix)}: <b>${escapeHtml(cut(name, 120))}</b>${facts.length ? ` · ${facts.join(" · ")}` : ""}`)
    if (open) {
      for (const m of item.matches.filter((x) => x.kind === "exact" || x.kind === "deleted").slice(0, 3)) {
        const url = absUrl(ctx, m.type === "client" ? `/clients/${encodeURIComponent(m.id)}` : m.type === "deal" ? `/deals?openDeal=${encodeURIComponent(m.id)}` : `/contacts?openContact=${encodeURIComponent(m.id)}`)
        const what = m.kind === "deleted" ? "Есть удалённая запись" : "Уже есть в CRM"
        lines.push(`   ⚠️ ${what}: ${escapeHtml(matchName(m))}${url ? ` — <a href="${escapeAttr(url)}">открыть</a>` : ""}`)
      }
    }
  }

  const buttons: TgButton[][] = []
  const editButton: TgButton = { text: "✏️ Изменить в CRM", url: chatThreadUrl(ctx) }
  const cancelButton: TgButton = { text: "✖️ Отменить", action: { kind: "card_cancel", actionId: draft.actionId } }

  if (open && draft.draft.files.length > 0 && state !== "open_crm") lines.push("📎 Файл будет прикреплён к записи")

  switch (state) {
    case "confirm":
      buttons.push([{ text: "✅ Создать", action: { kind: "card_confirm", actionId: draft.actionId } }, cancelButton])
      buttons.push([editButton])
      break
    case "decide": {
      const row = cardRows(draft).find((r) => r.include && r.choices.length > 0)
      if (row) {
        for (const c of row.choices.slice(0, 6)) {
          buttons.push([
            {
              text: cut(c.label, 60),
              action: {
                kind: "card_decision",
                actionId: draft.actionId,
                itemKey: row.item.key,
                decision: c.decision,
                ...(c.existingId ? { existingId: c.existingId } : {}),
              },
            },
          ])
        }
      }
      buttons.push([cancelButton])
      break
    }
    case "needs_input": {
      const many = items.filter((i) => !i.refused).length > 1
      const parts = cardRows(draft)
        .filter((r) => r.include && r.missing.length)
        .map((r) => {
          const words = r.missing.map((m) => MISSING_WORDS[m] ?? m).join(", ")
          return many ? `${words} (${ITEM_PREFIX[r.item.type].toLowerCase()} «${cut(itemName(r.item), 40)}»)` : words
        })
      lines.push(`❓ Не хватает: ${escapeHtml(parts.join("; "))}. Ответьте сообщением`)
      buttons.push([editButton, cancelButton])
      break
    }
    case "open_crm":
      lines.push("Выбор и правка — в CRM.")
      buttons.push([editButton])
      break
    case "closed":
      lines.push(...closedLines(draft, ctx))
      break
  }

  const html = fitCard(lines)
  return { role: "card", html, actionId: draft.actionId, ...(buttons.length ? { buttons } : {}) }
}

function closedLines(draft: ChatDraftPart, ctx: TgRenderContext): string[] {
  switch (draft.status) {
    case "created":
    case "partly_created": {
      const results = draft.results ?? []
      const out = [results.length ? "✅ <b>Создано:</b>" : "✅ Создано: ничего"]
      for (const r of results) {
        const url = absUrl(ctx, r.href)
        const label = `${RESULT_LABELS[r.type] ?? "Запись"} «${cut(r.title, 80)}»${resultNote(r, draft.draft.items)}`
        const link = url ? ` — <a href="${escapeAttr(url)}">${r.type === "order_request" ? "собрать заказ" : "открыть"}</a>` : ""
        out.push(`• ${escapeHtml(label)}${link}`)
      }
      if (draft.status === "partly_created" && draft.error) out.push(`⚠️ ${escapeHtml(draft.error)}`)
      return out
    }
    case "cancelled":
      return ["✖️ Отменено"]
    case "expired":
      return ["⌛ Черновик устарел — попросите подготовить карточку заново"]
    case "confirming":
      return ["⏳ Создаю…"]
    case "failed":
      return [`⚠️ ${escapeHtml(draft.error || "Не удалось создать записи")}`]
    default:
      return []
  }
}

/** A card is ONE message: drop item lines from the end until it fits (rare: ≤ 12 items). */
function fitCard(lines: string[]): string {
  let html = lines.join("\n")
  if (visibleLength(html) <= TELEGRAM_MAX_TEXT) return html
  const keep = [...lines]
  while (keep.length > 2 && visibleLength(keep.join("\n")) > TELEGRAM_MAX_TEXT - 40) keep.splice(keep.length - 2, 1)
  html = `${keep.join("\n")}\n…`
  return splitTelegramHtml(html)[0] ?? ""
}

// ── Questions (§8.2) ────────────────────────────────────────────────────

export function renderQuestionMessage(q: ChatQuestionPart): TgOutMessage {
  const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, QUESTION_OPTIONS)
  const html = splitTelegramHtml(`❓ ${escapeHtml(q.question ?? "")}`)[0] ?? "❓"
  return {
    role: "question",
    html,
    questionId: q.id,
    ...(options.length ? { buttons: options.map((o) => [{ text: cut(o, 60), action: { kind: "question_option" as const, questionId: q.id, option: o } }]) } : {}),
  }
}

// ── Sources (§7) ────────────────────────────────────────────────────────

function webSiteName(url: string, title: string): string {
  // Grounding links are redirects; their title is the real site (as the web «Источники ответа»).
  if (title && !/^https?:/i.test(title)) return title
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function renderSourcesHtml(evidence: ChatEvidencePart, ctx: TgRenderContext): string {
  const n = evidence.sourceItems.length + evidence.web.length
  if (!n) return ""
  const lines: string[] = [`<b>Источники (${n})</b>`]
  for (const h of evidence.sourceItems) {
    const date = dateText(h.date, ctx.timeZone)
    const url = absUrl(ctx, h.href)
    lines.push(`• ${escapeHtml(cut(h.title || "Источник", 100))}${date ? ` · ${date}` : ""}${url ? ` — <a href="${escapeAttr(url)}">открыть</a>` : ""}`)
  }
  for (const w of evidence.web) {
    const site = webSiteName(w.url, w.title)
    lines.push(`• ${escapeHtml(cut(site, 60))} — ${linkHtml(w.url, "ссылка")}`)
  }
  return `<blockquote expandable>${lines.join("\n")}</blockquote>`
}

// ── Attachments (§7) ────────────────────────────────────────────────────

function attachmentNotice(a: ChatAttachmentPart): string {
  const reason = (a.reason ?? "").trim() || "файл не удалось разобрать"
  return `⚠️ Не удалось прочитать «${escapeHtml(cut(a.name || "файл", 80))}»: ${escapeHtml(reason)}`
}

// ── The renderer ────────────────────────────────────────────────────────

const EMPTY_ANSWER = "Не получилось сформулировать ответ. Спросите, пожалуйста, ещё раз — например, другими словами."

/**
 * Stored parts of one assistant answer → Telegram messages (spec §7, §8).
 * `data-debug`, `data-status`, reasoning / tool / file parts are ignored.
 */
export function renderTelegramAnswer(parts: readonly AnyPart[], ctx: TgRenderContext): TgOutMessage[] {
  const out: TgOutMessage[] = []

  // (g) Attachments that were not read → notices first.
  for (const a of dataParts(parts, "attachment")) {
    if (a.status === "failed" || a.status === "skipped") {
      for (const html of splitTelegramHtml(attachmentNotice(a))) out.push({ role: "notice", html })
    }
  }

  // (a) The answer: prose → records → statistics → composed view → web line.
  const sections: string[] = []
  const prose = parts
    .filter((p) => p.type === "text" && typeof p.text === "string" && p.text.trim())
    .map((p) => cleanProse(p.text as string).trim())
    .filter(Boolean)
    .join("\n\n")
  if (prose) {
    const html = markdownToTelegramHtml(prose)
    if (html) sections.push(html)
  }
  const records = mergeRecordsParts(dataParts(parts, "records"))
  if (records) {
    const html = renderRecordsHtml(records, ctx)
    if (html) sections.push(html)
  }
  const stats = dataParts(parts, "stats")
  const csvButtons: TgButton[][] = []
  stats.forEach((s, index) => {
    sections.push(renderStatsHtml(s))
    if (hasStatsData(s)) {
      const text = stats.filter(hasStatsData).length > 1 ? `📎 CSV · ${cut(s.meta.measureLabel, 40)}` : "📎 CSV"
      csvButtons.push([{ text, action: { kind: "stats_csv", statsIndex: index } }])
    }
  })
  const spec = specFromParts(parts)
  if (spec) {
    const html = renderSpecHtml(spec)
    if (html) sections.push(html)
  }
  const turn = dataParts(parts, "turn").at(-1)
  if (turn?.used?.includes("web")) sections.push("🌐 с данными из интернета")

  const drafts = dataParts(parts, "draft")
  const questions = dataParts(parts, "question")
  const evidence = mergeEvidenceParts(dataParts(parts, "evidence"))

  if (!sections.length && !drafts.length && !questions.length) sections.push(escapeHtml(EMPTY_ANSWER))

  const answers = splitTelegramHtml(sections.join("\n\n")).map((html): TgOutMessage => ({ role: "answer", html }))
  if (csvButtons.length && answers.length) answers[answers.length - 1].buttons = csvButtons
  out.push(...answers)

  // (d) Draft cards, one message each (latest state from `data-action-result`).
  const results = dataParts(parts, "action-result")
  const seenCards = new Set<string>()
  for (const d of drafts) {
    if (!d?.actionId || !d.draft || seenCards.has(d.actionId)) continue
    seenCards.add(d.actionId)
    out.push(renderCardMessage(withResult(d, results), ctx))
  }

  // (e) Questions.
  for (const q of questions) {
    if (q?.id && q.question) out.push(renderQuestionMessage(q))
  }

  // (f) Sources.
  if (evidence) {
    for (const html of splitTelegramHtml(renderSourcesHtml(evidence, ctx))) out.push({ role: "sources", html })
  }

  return out
}

// ── Checks (tests / eval) ───────────────────────────────────────────────

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "tg-spoiler", "a", "code", "pre", "blockquote"])
const INLINE_FORMAT = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "tg-spoiler"])

/**
 * True when the HTML uses only Telegram's tags with valid attributes,
 * balanced, nested as the Bot API allows (no entity inside code / pre
 * except pre > code; no nested quotes or links), and text has no stray
 * `<`, `>` or `&`.
 */
export function answerAllowedTagsOnly(html: string): boolean {
  const re = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[^>]*)?)>|&(?:#\d{1,7}|#x[0-9a-f]{1,6}|lt|gt|amp|quot);|[<>&]/gi
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[0]
    if (raw === "<" || raw === ">" || raw === "&") return false
    if (raw[0] === "&") continue
    const closing = m[1] === "/"
    const name = m[2].toLowerCase()
    const attrs = (m[3] ?? "").trim()
    if (!ALLOWED.has(name)) return false
    if (closing) {
      if (attrs || stack.pop() !== name) return false
      continue
    }
    // Attributes.
    if (name === "a") {
      const a = /^href="([^"]*)"$/.exec(attrs)
      if (!a || !safeHttpUrl(a[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"))) return false
    } else if (name === "code") {
      if (attrs && !/^class="language-[a-z0-9+#.-]{1,20}"$/i.test(attrs)) return false
      if (attrs && stack.at(-1) !== "pre") return false
    } else if (name === "blockquote") {
      if (attrs && attrs !== "expandable") return false
    } else if (attrs) {
      return false
    }
    // Nesting.
    const parent = stack.at(-1)
    if (parent === "code") return false
    if (parent === "pre" && name !== "code") return false
    if (stack.includes("pre") && name !== "code") return false
    if ((name === "code" || name === "pre") && stack.some((s) => INLINE_FORMAT.has(s) || s === "a")) return false
    if (name === "blockquote" && stack.includes("blockquote")) return false
    if (name === "a" && stack.includes("a")) return false
    if (name === "pre" && stack.length > 0) return false
    if (INLINE_FORMAT.has(name) && stack.includes(name)) return false
    stack.push(name)
  }
  return stack.length === 0
}

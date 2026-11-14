// Golden-set expected answer (spec topics/01 §12, plan phase 0 task 7 +
// phase 3 «Open»). PURE and client-safe: shared by the review editor
// (/settings → «Темы» → «Эталонный набор» and /review), the server save path
// (src/server/topics/golden-set.ts) and the grouping eval.
//
// Stored shape (topics_golden_item.expected, jsonb):
//   { codes: [{ code, evidence?, subject? }],
//     noSignal?: boolean,
//     topicGroups?: string[],   // business questions of the message («Темы сообщения»)
//     reviewNote?: string }     // «Заметка проверяющего»
// Old rows may carry `topicGroup: string` — read as a one-element list and
// rewritten as `topicGroups` on the next save. Other keys pass through.

export type GoldenExpectedCode = { code: string; evidence?: string; subject?: string }

export type GoldenExpectedValue = {
  codes: GoldenExpectedCode[]
  noSignal: boolean
  /** null = the field was never set (old rows); [] = «no topic». */
  topicGroups: string[] | null
  reviewNote: string
}

export const TOPIC_GROUP_MAX = 20
export const TOPIC_GROUP_MAX_CHARS = 200
export const REVIEW_NOTE_MAX_CHARS = 5000

/** Display form of a topic-group label: trimmed, single spaces. */
export function normalizeTopicGroupLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim()
}

/** Comparison key of a label: case-, ё- and spacing-insensitive. */
export function topicGroupKey(label: string): string {
  return normalizeTopicGroupLabel(label).toLowerCase().replace(/ё/g, "е")
}

/** Labels deduplicated by key (first spelling wins), empty ones dropped. */
export function dedupeTopicGroups(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = normalizeTopicGroupLabel(raw)
    const key = topicGroupKey(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/**
 * Topic groups of a stored `expected`: `topicGroups` (array) and / or the
 * old `topicGroup` (string). null = neither key is present.
 */
export function readTopicGroups(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const e = raw as { topicGroups?: unknown; topicGroup?: unknown }
  const hasList = Array.isArray(e.topicGroups)
  const hasOld = typeof e.topicGroup === "string"
  if (!hasList && !hasOld) return null
  const labels: string[] = []
  if (hasList) for (const g of e.topicGroups as unknown[]) if (typeof g === "string") labels.push(g)
  if (hasOld) labels.push(e.topicGroup as string)
  return dedupeTopicGroups(labels)
}

const optText = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  return t ? t : undefined
}

/** Tolerant read of a stored `expected` (null when there is none). */
export function readGoldenExpected(raw: unknown): GoldenExpectedValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const e = raw as { codes?: unknown; noSignal?: unknown; reviewNote?: unknown }
  const codes: GoldenExpectedCode[] = []
  if (Array.isArray(e.codes)) {
    for (const c of e.codes as Record<string, unknown>[]) {
      const code = typeof c?.code === "string" ? c.code.trim() : ""
      if (!code) continue
      const evidence = optText(c.evidence)
      const subject = optText(c.subject)
      codes.push({ code, ...(evidence ? { evidence } : {}), ...(subject ? { subject } : {}) })
    }
  }
  return {
    codes,
    noSignal: e.noSignal === true,
    topicGroups: readTopicGroups(raw),
    reviewNote: typeof e.reviewNote === "string" ? e.reviewNote : "",
  }
}

/**
 * Storage form of an expected answer (after the schema check): trims texts,
 * drops empty optional fields, folds the old `topicGroup` into
 * `topicGroups` (always written), keeps unknown keys. Throws a Russian
 * message on a contradiction or over-long input.
 */
export function normalizeGoldenExpected(input: Record<string, unknown>): Record<string, unknown> {
  const value = readGoldenExpected(input)
  if (!value) throw new Error("Ожидается объект { codes: [...] }")
  if (value.noSignal && value.codes.length > 0) {
    throw new Error("Отмечено «Сигналов нет», но список сигналов не пуст")
  }
  const groups = value.topicGroups ?? []
  if (groups.length > TOPIC_GROUP_MAX) throw new Error(`Не больше ${TOPIC_GROUP_MAX} тем у одного сообщения`)
  if (groups.some((g) => g.length > TOPIC_GROUP_MAX_CHARS)) {
    throw new Error(`Подпись темы длиннее ${TOPIC_GROUP_MAX_CHARS} символов`)
  }
  const note = value.reviewNote.trim()
  if (note.length > REVIEW_NOTE_MAX_CHARS) throw new Error(`Заметка длиннее ${REVIEW_NOTE_MAX_CHARS} символов`)

  // Keep unknown keys (and extra per-code keys) as they came.
  const rest = { ...input }
  delete rest.topicGroup
  delete rest.reviewNote
  const rawCodes = (Array.isArray(input.codes) ? (input.codes as Record<string, unknown>[]) : []).filter(
    (r) => typeof r?.code === "string" && r.code.trim(),
  )
  // readGoldenExpected kept the same rows in the same order.
  const codes = value.codes.map((c, i) => {
    const extra = { ...rawCodes[i] }
    delete extra.evidence
    delete extra.subject
    return { ...extra, ...c }
  })
  return {
    ...rest,
    codes,
    noSignal: value.noSignal,
    topicGroups: groups,
    ...(note ? { reviewNote: note } : {}),
  }
}

/** Why an answer cannot be marked «Проверен» (null = it can). */
export function reviewReadinessError(value: GoldenExpectedValue | null): string | null {
  if (!value) return "Нет ожидаемого результата"
  if (!value.noSignal && value.codes.length === 0) {
    return "Отметьте «Сигналов нет» или добавьте хотя бы один сигнал"
  }
  return null
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„'’`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

/**
 * UI hint only: is the quote in the message text? Same idea as the engine's
 * check (src/server/topics/signals/evidence.ts), without the ellipsis rule.
 */
export function quoteFoundInText(quote: string, text: string): boolean {
  const q = squash(quote).replace(/^[.…\s]+|[.…\s]+$/g, "")
  if (!q) return true
  const t = squash(text)
  if (t.includes(q)) return true
  const parts = q
    .split(/…|\.\.\./)
    .map((p) => p.trim())
    .filter((p) => p.length > 3)
  return parts.length > 1 && parts.every((p) => t.includes(p))
}

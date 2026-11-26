// Org time for task deadlines (2026-11-26, tester request «Срок по
// умолчанию 23:59, можно выбрать время»). Every org has ONE time zone
// («Рабочий контекст»: `attention.params.timeZone`) and a default due time
// (org_setting `tasks.defaultDueTime`, default 23:59). A deadline the person
// enters is a wall time IN THE ORG ZONE; it is stored as a UTC instant and
// always shown in the org zone — never in the browser's zone. Pure,
// client-safe, unit-tested.

import { isLocalDateTime, localToUtc, utcToLocal, zonedParts } from "@/lib/chat/due-date"
import { ATTENTION_DEFAULTS } from "@/lib/topics/attention-params"

export const DEFAULT_TASK_DUE_TIME = "23:59"
export const FALLBACK_TIME_ZONE = ATTENTION_DEFAULTS.timeZone

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type OrgTime = {
  /** IANA zone of the org («Рабочий контекст»). */
  timeZone: string
  /** «HH:MM» — the deadline time of a new task / a date without a time. */
  defaultDueTime: string
}

export const ORG_TIME_FALLBACK: OrgTime = { timeZone: FALLBACK_TIME_ZONE, defaultDueTime: DEFAULT_TASK_DUE_TIME }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** An ISO instant with a zone (Z or ±HH:MM) — sent by code, already UTC-exact. */
const ZONED_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/**
 * PURE. A deadline from a request → the UTC instant. Accepts «YYYY-MM-DD»
 * (= that day at the org's default due time), «YYYY-MM-DDTHH:MM» (wall time
 * in the org zone) or a full ISO instant with a zone (kept as is). null =
 * not a valid deadline.
 */
export function parseTaskDue(raw: unknown, org: OrgTime): Date | null {
  if (typeof raw !== "string") return null
  const v = raw.trim()
  if (DAY_RE.test(v)) return localToUtc(`${v}T${org.defaultDueTime}`, org.timeZone)
  if (isLocalDateTime(v)) return localToUtc(v, org.timeZone)
  if (ZONED_ISO_RE.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** PURE. Today (in the org zone) at the default due time, as «YYYY-MM-DDTHH:MM». */
export function defaultDueLocal(now: Date, org: OrgTime): string {
  return `${utcToLocal(now, org.timeZone).slice(0, 10)}T${org.defaultDueTime}`
}

/** PURE. A stored instant → { date «YYYY-MM-DD», time «HH:MM» } in the org zone. */
export function dueParts(iso: string | Date, timeZone: string): { date: string; time: string } {
  const local = utcToLocal(typeof iso === "string" ? new Date(iso) : iso, timeZone)
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}

const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** PURE. «26 нояб. 2026» in the org zone. */
export function formatOrgDay(iso: string | Date, timeZone: string): string {
  const p = zonedParts(typeof iso === "string" ? new Date(iso) : iso, timeZone)
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`
}

/** PURE. «26 нояб. 2026, 23:59» in the org zone. */
export function formatOrgDue(iso: string | Date, timeZone: string): string {
  const p = zonedParts(typeof iso === "string" ? new Date(iso) : iso, timeZone)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}, ${two(p.h)}:${two(p.mi)}`
}

/** PURE. «26.11.2026 23:59» in the org zone (compact tables). */
export function formatOrgDueShort(iso: string | Date, timeZone: string): string {
  const p = zonedParts(typeof iso === "string" ? new Date(iso) : iso, timeZone)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${two(p.d)}.${two(p.m)}.${p.y} ${two(p.h)}:${two(p.mi)}`
}

/** PURE. The org-local calendar day of an instant as a LOCAL-midnight Date (for day grids in the browser). */
export function orgDayAsLocalDate(iso: string | Date, timeZone: string): Date {
  const p = zonedParts(typeof iso === "string" ? new Date(iso) : iso, timeZone)
  return new Date(p.y, p.m - 1, p.d)
}

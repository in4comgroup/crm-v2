// «Рабочий контекст» of an organization (2026-11-19): time zone + working
// hours, edited by the org OWNER in «Профиль организации». Stored as the org
// override of `attention.params` (org_setting, PARTIAL — only these three
// keys; the rest stays platform / code default). Read by everything through
// `loadAttentionParams` (topics lists and deadlines, digests and pushes,
// notification checks, CRM checks, the AI chat's «today» line). Pure,
// client-safe, unit-tested.

import { z } from "zod"

/** True when the runtime knows the IANA zone (e.g. «Europe/Vienna»). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ")

export const workingContextInputSchema = z
  .object({
    timeZone: z.string().trim().refine(isValidTimeZone, "Неизвестный часовой пояс"),
    workStart: hhmm,
    workEnd: hhmm,
  })
  .refine((v) => v.workStart < v.workEnd, { message: "Начало рабочего дня должно быть раньше конца", path: ["workEnd"] })

export type WorkingContextInput = z.infer<typeof workingContextInputSchema>

/** The org override of `attention.params` with the working context set (other keys kept). */
export function withWorkingContext(
  current: Record<string, unknown> | null | undefined,
  input: WorkingContextInput,
): Record<string, unknown> {
  return { ...(current ?? {}), timeZone: input.timeZone, workStart: input.workStart, workEnd: input.workEnd }
}

/** Time zones for the picker: the runtime list (or a short fallback), the current one always included. */
export function timeZoneOptions(current?: string | null): string[] {
  let all: string[] = []
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  } catch {
    all = []
  }
  if (!all.length) {
    all = ["Europe/Vienna", "Europe/Berlin", "Europe/London", "Europe/Moscow", "Europe/Minsk", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Almaty", "Asia/Dubai", "UTC"]
  }
  if (current && !all.includes(current)) all = [current, ...all]
  return all
}

/** «UTC+01:00» of a zone at `at` (for the picker labels). */
export function utcOffsetLabel(tz: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value
    if (!part || part === "GMT") return "UTC+00:00"
    return part.replace("GMT", "UTC")
  } catch {
    return ""
  }
}

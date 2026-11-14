// Email renderer of topics delivery (topics plan phase 7): the morning
// digest «Темы на сегодня», the weekly digest «Итоги недели по темам» and
// the evening reminder «Не закрыто сегодня». PURE and client-safe: a model
// in, { subject, html, text } out. Russian, simple inline-styled HTML (mail
// clients drop <style>) plus a plain-text part. Every user / model text is
// HTML-escaped. Unit-tested in delivery-render.test.ts.

import type { DeliveryKind } from "./delivery-routing"

export type DigestEntry = {
  topicId: string
  /** Card headline, else the topic title. */
  headline: string
  /** «Почему сейчас» (card), else the first explanation line. */
  whyNow: string | null
  company: string | null
  /** Next deadline, ISO date ("YYYY-MM-DD") or datetime. */
  deadline: string | null
  overdue: boolean
  /** Deep link to the topic drawer on the dashboard. */
  link: string
  /** Short marker: «Напоминание 2 из 3», «Лимит дня», … */
  note?: string | null
}

export type DigestSection = {
  title: string
  hint?: string | null
  entries: DigestEntry[]
  /** Show only the first N entries + «Ещё N» (morning «Сводка»). */
  visible?: number | null
  /** Target of «Ещё N». */
  moreLink?: string | null
}

export type DigestModel = {
  kind: DeliveryKind
  /** Test send from the admin block: subject prefix «[Тест]». */
  test?: boolean
  orgName: string
  userName: string | null
  /** «пятница, 20 ноября» (org time). */
  dateLabel: string
  sections: DigestSection[]
  dashboardUrl: string
  settingsUrl: string
  /** Org time zone for deadlines with a time. */
  timeZone: string
}

export type RenderedEmail = { subject: string; html: string; text: string; topicCount: number; empty: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Only http(s) links reach the HTML (no javascript: etc.). */
function safeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? escapeHtml(u) : "#"
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const topicsWord = (n: number) => pluralRu(n, "тема", "темы", "тем")

/** «20 ноября» for a date, «20 ноября, 10:00» for a datetime (org time). */
export function formatDeadlineRu(v: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00Z`)
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
  }
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return v
  const day = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone })
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone })
  return `${day}, ${time}`
}

const COUNT = (sections: DigestSection[]) => sections.reduce((n, s) => n + s.entries.length, 0)

export function digestSubject(kind: DeliveryKind, count: number, test = false): string {
  const base =
    kind === "morning_digest"
      ? `Темы на сегодня — ${count} в работе`
      : kind === "weekly_digest"
        ? "Итоги недели по темам"
        : `Не закрыто сегодня: ${count} ${topicsWord(count)}`
  return test ? `[Тест] ${base}` : base
}

function intro(m: DigestModel, count: number): { greeting: string; lead: string } {
  const name = m.userName?.trim() || null
  if (m.kind === "morning_digest") {
    return {
      greeting: name ? `Доброе утро, ${name}!` : "Доброе утро!",
      lead: `Темы на ${m.dateLabel}: ${count} ${topicsWord(count)} в работе.`,
    }
  }
  if (m.kind === "weekly_digest") {
    return {
      greeting: name ? `${name}, итоги недели` : "Итоги недели",
      lead: `Обзор тем на ${m.dateLabel}: ${count} ${topicsWord(count)}.`,
    }
  }
  return {
    greeting: name ? `Добрый вечер, ${name}!` : "Добрый вечер!",
    lead: `Сегодня не закрыто: ${count} ${topicsWord(count)}. По ним ждут нашего ответа.`,
  }
}

// ── HTML ──────────────────────────────────────────────────────────────────

const C = {
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  bg: "#f9fafb",
  link: "#2563eb",
  red: "#dc2626",
  note: "#1d4ed8",
  noteBg: "#dbeafe",
}

function entryHtml(e: DigestEntry, tz: string): string {
  const meta: string[] = []
  if (e.company) meta.push(escapeHtml(e.company))
  if (e.deadline) {
    const dl = `${e.overdue ? "просрочено, срок" : "срок"} ${escapeHtml(formatDeadlineRu(e.deadline, tz))}`
    meta.push(e.overdue ? `<span style="color:${C.red}">${dl}</span>` : dl)
  }
  const note = e.note
    ? ` <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:12px;font-weight:normal;color:${C.note};background:${C.noteBg}">${escapeHtml(e.note)}</span>`
    : ""
  return [
    `<tr><td style="padding:12px 0;border-top:1px solid ${C.border}">`,
    `<div style="font-size:15px;font-weight:bold;line-height:1.4"><a href="${safeUrl(e.link)}" style="color:${C.text};text-decoration:none">${escapeHtml(e.headline)}</a>${note}</div>`,
    meta.length ? `<div style="font-size:13px;color:${C.muted};padding-top:2px">${meta.join(" · ")}</div>` : "",
    e.whyNow
      ? `<div style="font-size:14px;line-height:1.5;padding-top:6px"><span style="color:${C.muted}">Почему сейчас:</span> ${escapeHtml(e.whyNow)}</div>`
      : "",
    `<div style="font-size:13px;padding-top:6px"><a href="${safeUrl(e.link)}" style="color:${C.link}">Открыть тему →</a></div>`,
    `</td></tr>`,
  ].join("")
}

function sectionHtml(s: DigestSection, tz: string): string {
  if (s.entries.length === 0) return ""
  const visible = s.visible && s.visible > 0 ? s.visible : s.entries.length
  const shown = s.entries.slice(0, visible)
  const more = s.entries.length - shown.length
  return [
    `<tr><td style="padding:20px 0 4px 0">`,
    `<div style="font-size:17px;font-weight:bold;color:${C.text}">${escapeHtml(s.title)} <span style="font-weight:normal;color:${C.muted}">${s.entries.length}</span></div>`,
    s.hint ? `<div style="font-size:13px;color:${C.muted};padding-top:2px">${escapeHtml(s.hint)}</div>` : "",
    `</td></tr>`,
    ...shown.map((e) => entryHtml(e, tz)),
    more > 0 && s.moreLink
      ? `<tr><td style="padding:10px 0;border-top:1px solid ${C.border};font-size:14px"><a href="${safeUrl(s.moreLink)}" style="color:${C.link}">Ещё ${more} →</a></td></tr>`
      : "",
  ].join("")
}

// ── Text ──────────────────────────────────────────────────────────────────

function entryText(e: DigestEntry, tz: string): string {
  const lines = [`• ${e.headline}${e.note ? ` [${e.note}]` : ""}`]
  const meta: string[] = []
  if (e.company) meta.push(e.company)
  if (e.deadline) meta.push(`${e.overdue ? "просрочено, срок" : "срок"} ${formatDeadlineRu(e.deadline, tz)}`)
  if (meta.length) lines.push(`  ${meta.join(" · ")}`)
  if (e.whyNow) lines.push(`  Почему сейчас: ${e.whyNow}`)
  lines.push(`  ${e.link}`)
  return lines.join("\n")
}

function sectionText(s: DigestSection, tz: string): string {
  if (s.entries.length === 0) return ""
  const visible = s.visible && s.visible > 0 ? s.visible : s.entries.length
  const shown = s.entries.slice(0, visible)
  const more = s.entries.length - shown.length
  return [
    `${s.title.toUpperCase()} (${s.entries.length})`,
    ...(s.hint ? [s.hint] : []),
    "",
    ...shown.map((e) => entryText(e, tz)),
    ...(more > 0 && s.moreLink ? ["", `Ещё ${more}: ${s.moreLink}`] : []),
  ].join("\n")
}

// ── Render ────────────────────────────────────────────────────────────────

export function renderDigest(m: DigestModel): RenderedEmail {
  const count = COUNT(m.sections)
  const subject = digestSubject(m.kind, count, m.test)
  const { greeting, lead } = intro(m, count)
  const footer = `Это письмо Truffalo для участников организации «${m.orgName}».`
  const html = [
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.text}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.border};border-radius:8px">`,
    `<tr><td style="padding:24px 24px 8px 24px">`,
    `<div style="font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:.04em">Truffalo · ${escapeHtml(m.orgName)}</div>`,
    `<div style="font-size:20px;font-weight:bold;padding-top:8px">${escapeHtml(greeting)}</div>`,
    `<div style="font-size:15px;line-height:1.5;padding-top:6px">${escapeHtml(lead)}</div>`,
    `</td></tr>`,
    `<tr><td style="padding:0 24px 8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">`,
    ...m.sections.map((s) => sectionHtml(s, m.timeZone)),
    `</table></td></tr>`,
    `<tr><td style="padding:16px 24px 24px 24px"><a href="${safeUrl(m.dashboardUrl)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:${C.text};color:#ffffff;text-decoration:none;font-size:14px">Открыть темы в Truffalo</a></td></tr>`,
    `</table>`,
    `<div style="max-width:600px;font-size:12px;line-height:1.5;color:${C.muted};padding:12px 12px 0 12px">${escapeHtml(footer)} <a href="${safeUrl(m.settingsUrl)}" style="color:${C.muted}">Настроить уведомления</a></div>`,
    `</td></tr></table></body></html>`,
  ].join("")
  const text = [
    `Truffalo · ${m.orgName}`,
    "",
    greeting,
    lead,
    "",
    ...m.sections.map((s) => sectionText(s, m.timeZone)).filter(Boolean).flatMap((s) => [s, ""]),
    `Открыть темы: ${m.dashboardUrl}`,
    "",
    "—",
    footer,
    `Настроить уведомления: ${m.settingsUrl}`,
  ].join("\n")
  return { subject, html, text, topicCount: count, empty: count === 0 }
}

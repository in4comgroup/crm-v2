// Telegram messages of topic pushes and important notifications
// (docs/specs/telegram/04 TI3, docs/specs/topics/08 T2 / T3). PURE: Russian
// Telegram HTML + the buttons; the server stores the action buttons and sends.

import { deliveryLinks, digestEntry } from "@/lib/topics/delivery-content"
import { formatDeadlineRu } from "@/lib/topics/delivery-render"
import type { TopicEntry } from "@/lib/topics/topic-ui"
import { escapeHtml, linkHtml, safeHttpUrl } from "@/lib/telegram/html"

export type PushButton =
  | { text: string; url: string }
  | { text: string; action: { kind: "topic_done" | "topic_snooze"; topicId: string } }

export type PushMessage = { html: string; buttons: PushButton[][] }

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Telegram URL buttons need https; http (local dev) becomes a text link instead. */
function urlButton(text: string, url: string): PushButton | null {
  return /^https:\/\//i.test(url) ? { text, url } : null
}

/**
 * A topic that entered «Сейчас» (T2): headline, company, why now, deadline,
 * the next steps of its card; buttons «Открыть» (the topic drawer),
 * «✅ Готово», «⏰ Отложить до завтра» (T3).
 */
export function renderTopicPush(e: TopicEntry, ctx: { appUrl: string; timeZone: string }): PushMessage {
  const links = deliveryLinks(ctx.appUrl)
  const d = digestEntry(e, links)
  const urgent = e.attention?.overdue || e.attention?.profile === "P8" || (e.attention?.escalations?.length ?? 0) > 0
  const lines: string[] = [`${urgent ? "🔴" : "🔔"} <b>${escapeHtml(cut(d.headline, 200))}</b>`]
  if (d.company) lines.push(escapeHtml(d.company))
  if (d.whyNow) lines.push(`<i>${escapeHtml(cut(d.whyNow, 300))}</i>`)
  if (d.deadline) lines.push(`${d.overdue ? "⚠️ Просрочено, срок" : "Срок"}: ${escapeHtml(formatDeadlineRu(d.deadline, ctx.timeZone))}`)
  const steps = (e.card?.status === "open" ? e.card.steps : []).filter(Boolean).slice(0, 3)
  if (steps.length) lines.push(steps.map((s) => `• ${escapeHtml(cut(s, 200))}`).join("\n"))
  const open = urlButton("Открыть", d.link)
  if (!open && safeHttpUrl(d.link)) lines.push(linkHtml(d.link, "Открыть в CRM"))
  return {
    html: lines.join("\n"),
    buttons: [
      ...(open ? [[open]] : []),
      [
        { text: "✅ Готово", action: { kind: "topic_done", topicId: e.topicId } },
        { text: "⏰ Отложить до завтра", action: { kind: "topic_snooze", topicId: e.topicId } },
      ],
    ],
  }
}

/** The push after a button: the old text + the result line; only «Открыть» stays. */
export function pushAfterAction(html: string, result: string, openUrl: string | null): PushMessage {
  const open = openUrl ? urlButton("Открыть", openUrl) : null
  return { html: `${html}\n\n${escapeHtml(result)}`, buttons: open ? [[open]] : [] }
}

/** An important notification (Q21): «❗ title», body, «Открыть в CRM». */
export function renderNotificationMessage(n: { title: string; body: string | null; href: string | null }, appUrl: string): PushMessage {
  const lines = [`❗ <b>${escapeHtml(cut(n.title, 300))}</b>`]
  if (n.body) lines.push(escapeHtml(cut(n.body, 1000)))
  const url = n.href ? (/^https?:\/\//i.test(n.href) ? n.href : `${appUrl.replace(/\/+$/, "")}${n.href.startsWith("/") ? "" : "/"}${n.href}`) : null
  const open = url ? urlButton("Открыть в CRM", url) : null
  if (url && !open && safeHttpUrl(url)) lines.push(linkHtml(url, "Открыть в CRM"))
  return { html: lines.join("\n"), buttons: open ? [[open]] : [] }
}

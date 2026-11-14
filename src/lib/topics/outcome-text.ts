// Client-safe Russian summary of a manual topic resolution of one item
// (POST /api/admin/topics/signals → `topics`, POST /api/admin/topics/topics
// action resolveItem → `outcome`). Used in toasts.

export const TOPIC_ITEM_STATUS_LABELS_RU: Record<string, string> = {
  done: "привязано",
  log_only: "только журнал (закрытие без темы)",
  ignored: "без учитываемых сигналов",
  deferred: "отложено (бюджет ИИ)",
  failed: "ошибка",
  missing: "сообщение не найдено",
}

type OutcomeLike = {
  status: string
  created: number
  attached: number
  context: number
  logOnly: number
  matcherCalls: number
  error?: string
}

type LinkLike = { title: string; role: string }

export function topicOutcomeText(outcome: OutcomeLike, links: readonly LinkLike[] = []): string {
  const parts = [`Темы: ${TOPIC_ITEM_STATUS_LABELS_RU[outcome.status] ?? outcome.status}`]
  if (outcome.created) parts.push(`новых ${outcome.created}`)
  if (outcome.attached) parts.push(`добавлено в ${outcome.attached}`)
  if (outcome.context) parts.push(`контекст ${outcome.context}`)
  if (outcome.matcherCalls) parts.push(`вызовов ИИ ${outcome.matcherCalls}`)
  if (outcome.error) parts.push(outcome.error)
  const titles = [...new Set(links.map((l) => l.title))]
  if (titles.length) parts.push(`«${titles.slice(0, 3).join("», «")}»${titles.length > 3 ? ` +${titles.length - 3}` : ""}`)
  return parts.join(" · ")
}

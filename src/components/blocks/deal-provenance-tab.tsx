"use client"

import { useEffect, useState } from "react"
import { Bot, FileText, Loader2, Quote, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import type { DealRow, DealProvenanceResult } from "@/app/api/deals/route"
import { getProvider } from "@/lib/sources/providers"
import {
  TOPIC_ITEM_ROLE_LABELS_RU,
  TOPIC_STATUS_LABELS_RU,
  type TopicItemRole,
  type TopicStatus,
} from "@/lib/topics/types"
import { TOPIC_LIST_LABELS_RU, type TopicList } from "@/lib/topics/attention-types"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

type Activity = DealProvenanceResult["activity"][number]

// Main line of one journal event: creation, stage move or (from = to) a
// non-move event (pause / resume / undo / topic link) whose meaning is the note.
function activityHeadline(
  a: Activity,
  stageLabels: Record<string, string>,
): { text: string; noteUsed: boolean } {
  const label = (id: string | null) => (id ? (stageLabels[id] ?? "—") : "—")
  if (!a.fromStageId) {
    return {
      text: a.toStageId
        ? `Сделка создана · стадия «${label(a.toStageId)}»`
        : "Сделка создана",
      noteUsed: false,
    }
  }
  if (a.fromStageId !== a.toStageId) {
    return {
      text: `${label(a.fromStageId)} → ${label(a.toStageId)}`,
      noteUsed: false,
    }
  }
  return { text: a.note ?? "Событие по сделке", noteUsed: true }
}

// «Происхождение» tab of the deal drawer (topics plan phase 5, spec 01 §9.2
// / §14): real provenance from `listDealProvenance` — the topics of the deal
// (status / list / lead code) with their messages, and the journal with the
// actor, the stage change, the rule, the evidence quote and the topic. Old
// deals without topics show the plain `deal_activity` journal.
export function DealProvenanceTab({
  deal,
  active,
}: {
  deal: DealRow
  // Load only while the tab is visible (and reload on deal updates).
  active: boolean
}) {
  const [data, setData] = useState<{
    dealId: string
    view: DealProvenanceResult | null
    error: boolean
  } | null>(null)
  const [openItem, setOpenItem] = useState<{ id: string; title: string } | null>(
    null,
  )

  useEffect(() => {
    if (!active) return
    let cancelled = false
    fetch(`/api/deals?provenanceFor=${deal.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("load failed")
        const json = (await r.json()) as { provenance: DealProvenanceResult }
        if (!cancelled) {
          setData({ dealId: deal.id, view: json.provenance, error: false })
        }
      })
      .catch(() => {
        if (!cancelled) setData({ dealId: deal.id, view: null, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [active, deal.id, deal.updatedAt])

  const current = data && data.dealId === deal.id ? data : null

  const header = (
    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
      {deal.createdByAgent ? (
        <Badge
          variant="secondary"
          className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
        >
          <Bot className="h-3 w-3" />
          создал агент
        </Badge>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" />
          Создана вручную{deal.userName ? `: ${deal.userName}` : ""}
        </span>
      )}
      <span>· {formatDate(deal.createdAt)}</span>
    </div>
  )

  if (!current) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }
  if (current.error || !current.view) {
    return (
      <div className="space-y-4">
        {header}
        <div className="text-muted-foreground">
          Не удалось загрузить происхождение сделки.
        </div>
      </div>
    )
  }

  const { topics, activity, stageLabels, leadCodeLabels } = current.view
  const topicTitle = new Map(topics.map((t) => [t.id, t.title]))

  return (
    <div className="space-y-5">
      {header}
      {deal.outcomeReason && (
        <div className="rounded-md border bg-muted/50 p-2.5">
          <div className="text-xs text-muted-foreground">Причина исхода</div>
          <div className="max-w-[32rem] whitespace-pre-wrap">
            {deal.outcomeReason}
          </div>
        </div>
      )}

      {topics.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Темы сделки · {topics.length}
          </div>
          {topics.map((t) => (
            <div key={t.id} className="space-y-2 rounded-md border p-2.5">
              <div className="font-medium leading-snug max-w-[32rem]">
                {t.title}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {TOPIC_STATUS_LABELS_RU[t.status as TopicStatus] ?? t.status}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {TOPIC_LIST_LABELS_RU[t.list as TopicList] ?? t.list}
                </Badge>
                {t.leadCode && (
                  <Badge variant="outline" className="text-[10px]">
                    {leadCodeLabels[t.leadCode] ?? t.leadCode}
                    <span className="ml-1 font-mono text-muted-foreground">
                      {t.leadCode}
                    </span>
                  </Badge>
                )}
              </div>
              {t.items.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Сообщений нет.
                </div>
              ) : (
                <ul className="space-y-1">
                  {t.items.map((i) => {
                    const provider = i.provider ? getProvider(i.provider) : null
                    const Icon = provider?.icon ?? FileText
                    const title = i.subject || "Сообщение без темы"
                    return (
                      <li key={i.sourceItemId}>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenItem({ id: i.sourceItemId, title })
                          }
                          className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-accent"
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sky-700 dark:text-sky-400">
                              {title}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTime(i.date)}
                              {provider ? ` · ${provider.label}` : ""}
                              {" · "}
                              {TOPIC_ITEM_ROLE_LABELS_RU[i.role as TopicItemRole] ??
                                i.role}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Журнал сделки
        </div>
        {activity.length === 0 ? (
          <div className="text-muted-foreground">Пока нет событий по сделке.</div>
        ) : (
          activity.map((a) => {
            const isAgent = a.actor === "agent"
            const { text, noteUsed } = activityHeadline(a, stageLabels)
            const topic = a.topicId ? topicTitle.get(a.topicId) : null
            return (
              <div
                key={a.id}
                className={`space-y-1 border-l-2 pl-3 pb-1 ${
                  isAgent ? "border-violet-500/50" : ""
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isAgent ? (
                    <Bot className="h-3 w-3 text-violet-600 dark:text-violet-300" />
                  ) : (
                    <User className="h-3 w-3" />
                  )}
                  {formatDateTime(a.createdAt)} ·{" "}
                  {isAgent ? "Агент" : (a.actorName ?? "Пользователь")}
                </div>
                <div className="max-w-[32rem] whitespace-pre-wrap">{text}</div>
                {!noteUsed && a.note && (
                  <div className="max-w-[32rem] whitespace-pre-wrap text-muted-foreground">
                    {a.note}
                  </div>
                )}
                {a.ruleNote && (
                  <div className="text-xs text-muted-foreground">
                    Правило: {a.ruleNote}
                  </div>
                )}
                {a.evidence && (
                  <blockquote className="flex max-w-[32rem] gap-1.5 rounded-md bg-muted/60 p-2 text-xs italic">
                    <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="whitespace-pre-wrap">{a.evidence}</span>
                  </blockquote>
                )}
                {(topic || a.sourceItemId) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {topic && (
                      <span className="text-muted-foreground">
                        Тема: <span className="text-foreground">{topic}</span>
                      </span>
                    )}
                    {a.sourceItemId && (
                      <button
                        type="button"
                        className="text-sky-700 hover:underline dark:text-sky-400"
                        onClick={() =>
                          setOpenItem({
                            id: a.sourceItemId!,
                            title: topic ?? "Сообщение",
                          })
                        }
                      >
                        Показать сообщение
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      <ParsedMarkdownDialog
        itemId={openItem?.id ?? null}
        title={openItem?.title ?? ""}
        open={openItem !== null}
        onOpenChange={(o) => {
          if (!o) setOpenItem(null)
        }}
      />
    </div>
  )
}

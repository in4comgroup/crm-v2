"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { TopicDrawer } from "@/components/blocks/topic-drawer"
import type { RelatedTopicRow, RelatedTopicsResult } from "@/app/api/topics/related/route"

// «Темы» tab of the company page / drawer, the contact drawer and the deal
// drawer (spec topics/01 §14, plan phase 6 task 3). Data: GET
// /api/topics/related. The tab is shown only when the answer says
// `visible` (org topics mode `on`). A row opens the topic drawer; after a
// change there the list reloads.

export type RelatedTopicsQuery =
  | { clientId: string }
  | { contactId: string }
  | { dealId: string }

function queryString(q: RelatedTopicsQuery): string {
  if ("clientId" in q) return `clientId=${encodeURIComponent(q.clientId)}`
  if ("contactId" in q) return `contactId=${encodeURIComponent(q.contactId)}`
  return `dealId=${encodeURIComponent(q.dealId)}`
}

/**
 * Loads the related topics while `enabled` (e.g. the drawer is open).
 * `result` is null until the first answer for this query; `visible` is
 * false while unknown, so callers can render the tab trigger only on
 * `visible`.
 */
export function useRelatedTopics(query: RelatedTopicsQuery | null, enabled = true) {
  const key = query ? queryString(query) : null
  const [state, setState] = useState<{ key: string; result: RelatedTopicsResult } | null>(null)

  // setState only in the fetch callbacks (never synchronously in the effect).
  const reload = useCallback(() => {
    if (!key) return
    const hidden: RelatedTopicsResult = { visible: false, open: [], recent: [], recentDays: 60 }
    fetch(`/api/topics/related?${key}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RelatedTopicsResult | null) => setState({ key, result: d ?? hidden }))
      .catch(() => setState({ key, result: hidden }))
  }, [key])

  useEffect(() => {
    if (enabled && key) reload()
  }, [enabled, key, reload])

  const result = state && state.key === key ? state.result : null
  return {
    result,
    visible: result?.visible === true,
    loading: result === null,
    reload,
  }
}

const BAND_CLASS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-700 dark:text-red-300",
  very_high: "bg-red-500/15 text-red-700 dark:text-red-300",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  normal: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
}

const CLASS_LABEL: Record<string, string> = {
  risk: "Риск",
  chance: "Возможность",
  fyi: "К сведению",
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function RelatedTopicsList({
  result,
  loading,
  onChanged,
  showCounterparty = false,
  showDeal = true,
}: {
  result: RelatedTopicsResult | null
  loading: boolean
  /** Called after a change in the topic drawer (reload the list). */
  onChanged: () => void
  /** Show company / contact names on each row (deal drawer). */
  showCounterparty?: boolean
  /** Show the linked deal name (company / contact surfaces). */
  showDeal?: boolean
}) {
  const [openTopicId, setOpenTopicId] = useState<string | null>(null)

  if (!result) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {loading ? "Загрузка…" : "Нет данных"}
      </p>
    )
  }

  const empty = result.open.length === 0 && result.recent.length === 0

  return (
    <div className="space-y-4">
      {empty ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Тем пока нет.
        </p>
      ) : (
        <>
          <TopicGroup
            title="Открытые"
            rows={result.open}
            emptyText="Открытых тем нет."
            onOpen={setOpenTopicId}
            showCounterparty={showCounterparty}
            showDeal={showDeal}
          />
          <TopicGroup
            title={`Недавние (закрыты за ${result.recentDays} дн.)`}
            rows={result.recent}
            emptyText="Недавно закрытых тем нет."
            onOpen={setOpenTopicId}
            showCounterparty={showCounterparty}
            showDeal={showDeal}
          />
        </>
      )}

      <TopicDrawer
        topicId={openTopicId}
        open={Boolean(openTopicId)}
        onOpenChange={(o) => {
          if (!o) setOpenTopicId(null)
        }}
        onChanged={onChanged}
      />
    </div>
  )
}

function TopicGroup({
  title,
  rows,
  emptyText,
  onOpen,
  showCounterparty,
  showDeal,
}: {
  title: string
  rows: RelatedTopicRow[]
  emptyText: string
  onOpen: (id: string) => void
  showCounterparty: boolean
  showDeal: boolean
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {rows.length > 0 && <span className="ml-1.5">{rows.length}</span>}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <TopicRow
                topic={t}
                onOpen={onOpen}
                showCounterparty={showCounterparty}
                showDeal={showDeal}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TopicRow({
  topic: t,
  onOpen,
  showCounterparty,
  showDeal,
}: {
  topic: RelatedTopicRow
  onOpen: (id: string) => void
  showCounterparty: boolean
  showDeal: boolean
}) {
  const counterparty = [t.clientName, t.contactName].filter(Boolean).join(" · ")
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors space-y-1.5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{t.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(t.closedAt ?? t.lastActivityAt)}
        </span>
      </div>
      {t.openCardHeadline && (
        <p className="text-xs text-foreground/80 line-clamp-2">{t.openCardHeadline}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[11px]">
          {t.statusLabel}
          {t.subStateLabel && <> · {t.subStateLabel}</>}
        </Badge>
        {t.list !== "none" && t.status !== "merged" && (
          <Badge variant="secondary" className="text-[11px]">
            {t.listLabel}
          </Badge>
        )}
        {t.band !== "none" && (
          <Badge
            variant="secondary"
            className={`text-[11px] ${BAND_CLASS[t.band] ?? ""}`}
            title={`Оценка ${t.score}`}
          >
            {t.bandLabel} · {t.score}
          </Badge>
        )}
        {t.class && CLASS_LABEL[t.class] && (
          <span className="text-[11px] text-muted-foreground">{CLASS_LABEL[t.class]}</span>
        )}
      </div>
      {(t.leadLabel || (showCounterparty && counterparty) || (showDeal && t.dealName)) && (
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          {t.leadLabel && <div>Главный сигнал: {t.leadLabel}</div>}
          {showCounterparty && counterparty && <div>{counterparty}</div>}
          {showDeal && t.dealName && <div>Сделка: {t.dealName}</div>}
        </div>
      )}
    </button>
  )
}

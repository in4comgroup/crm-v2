"use client"

// Dashboard attention lists and topic details.

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageLoader } from "@/components/blocks/page-loader"
import { DealCardBlock, TopicEntryCard, formatDateTimeRu } from "@/components/blocks/topic-card"
import { TopicDrawer } from "@/components/blocks/topic-drawer"
import { useDetailNavigation } from "@/components/blocks/detail-drawer-layout"
import { SearchableSelect } from "@/components/ui/searchable-select"
import {
  DIGEST_VISIBLE_ITEMS,
  TOPIC_STATUS_FILTERS,
  TOPIC_STATUS_FILTER_LABELS_RU,
  TOPIC_TABS,
  TOPIC_TAB_LABELS_RU,
  splitDigest,
  splitWeek,
  type TopicCounts,
  type TopicEntry,
  type TopicListResponse,
  type TopicTab,
} from "@/lib/topics/topic-ui"
import { usePersistentTab } from "@/lib/use-persistent-tab"

const ANY = "__any__"
const DASHBOARD_TABS = [...TOPIC_TABS.filter((tab) => tab !== "all"), "none", "all"] as const
type DashboardTab = TopicTab | "none"
const STATUS_OPTIONS = TOPIC_STATUS_FILTERS.filter((status) => status !== "closed")

const TAB_DESCRIPTIONS: Record<DashboardTab, string> = {
  now: "Срочные темы и решения по сделкам, которые требуют внимания сейчас.",
  digest: "Темы, к которым стоит вернуться сегодня, включая новые после утренней подборки.",
  week: "Менее срочные темы, к которым можно вернуться в ближайшие дни.",
  none: "Темы вне списков внимания.",
  all: "Все темы, доступные по выбранным фильтрам, включая те, что не входят в списки внимания.",
}

function Grid({ entries, onChanged, onOpen }: { entries: TopicEntry[]; onChanged: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-[min(100%,19rem)] gap-4 @[29.375rem]:grid-cols-[repeat(auto-fill,29.375rem)]">
        {entries.map((e) => (
          <TopicEntryCard key={e.topicId} entry={e} onChanged={onChanged} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <h3 className="text-sm font-semibold">{children}</h3>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-muted/50 dark:bg-muted/30 border-muted">
      <CardHeader>
        <CardTitle className="text-base text-muted-foreground font-normal text-center">{label}</CardTitle>
      </CardHeader>
    </Card>
  )
}

export function TopicListsSection() {
  // Remembered per browser. The hook also reads the `?tab=` deep link (emails,
  // topics phase 7) on mount — it wins over the stored tab. The hook's effect
  // runs before the deep-link effect below, which then strips the URL.
  const [tab, setTab] = usePersistentTab<DashboardTab>("dashboard.topics", "now", {
    allowed: DASHBOARD_TABS,
  })
  const [mine, setMine] = useState(false)
  const [status, setStatus] = useState<string>("all")
  const showFilters = tab === "all" || tab === "none"
  const [clientId, setClientId] = useState(ANY)
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  // `key` = the tab + filters the data was loaded for. A list loaded for
  // other filters is never shown: after a click on «Мои» / a tab / a filter
  // the page shows the loader until the new list arrives (bug list
  // 2026-11-21, item 3 — the old cards stayed for seconds and «Мои» looked
  // broken).
  const [data, setData] = useState<(TopicListResponse & { key: string }) | null>(null)
  const [counts, setCounts] = useState<TopicCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const req = useRef(0)

  // Deep links (topics phase 7 emails): `?topic=<id>` opens the topic drawer,
  // `?tab=now|digest|week|all` picks the tab (applied by usePersistentTab
  // above). Read once, then removed from the URL.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search)
    const topicId = qs.get("topic")
    const tabParam = qs.get("tab")
    if (topicId) setDrawerId(topicId)
    if (topicId || tabParam) {
      qs.delete("topic")
      qs.delete("tab")
      const rest = qs.toString()
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`)
    }
  }, [])

  const queryKey = JSON.stringify([tab, mine, status, clientId])

  const load = useCallback(async () => {
    const id = ++req.current
    const key = JSON.stringify([tab, mine, status, clientId])
    const qs = new URLSearchParams({ tab: tab === "none" ? "all" : tab })
    if (mine) qs.set("mine", "1")
    if (tab === "all" || tab === "none") {
      qs.set("status", status)
      if (tab === "none") qs.set("list", "none")
      if (clientId !== ANY) qs.set("clientId", clientId)
    }
    try {
      const [listRes, countRes] = await Promise.all([fetch(`/api/topics?${qs}`), fetch("/api/topics?counts=1")])
      const listData = await listRes.json().catch(() => ({}))
      const countData = await countRes.json().catch(() => ({}))
      if (id !== req.current) return
      if (!listRes.ok) {
        setError(listData.error || "Не удалось загрузить темы")
        return
      }
      setError(null)
      setData({ ...(listData as TopicListResponse), key })
      if (countRes.ok) setCounts(countData.counts as TopicCounts)
    } catch {
      if (id === req.current) setError("Не удалось загрузить темы. Проверьте соединение.")
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [tab, mine, status, clientId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    if (!showFilters || clients.length) return
    fetch("/api/topics?clients=1")
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .catch(() => {})
  }, [showFilters, clients.length])

  const refresh = useCallback(() => void load(), [load])
  const current = data?.key === queryKey ? data : null
  const entries = current ? current.entries : []
  const displayedTopicIds = new Set<string>()
  function renderGrid(group: TopicEntry[]) {
    for (const entry of group) displayedTopicIds.add(entry.topicId)
    return <Grid entries={group} onChanged={refresh} onOpen={openTopic} />
  }
  function openTopic(id: string) {
    topicNavigation.select(id)
  }

  const countOf = (t: TopicTab) => (counts ? counts[t][mine ? "mine" : "all"] : null)

  let body: React.ReactNode
  if (loading && !current) body = <PageLoader />
  else if (error)
    body = (
      <Card className="border-dashed border-destructive/40 bg-destructive/5">
        <CardHeader className="items-center text-center gap-3">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <CardTitle className="text-base font-normal text-muted-foreground">{error}</CardTitle>
          <Button size="sm" variant="outline" onClick={refresh}>
            Повторить
          </Button>
        </CardHeader>
      </Card>
    )
  else if (tab === "now") {
    const dealCards = current?.tab === "now" ? current.dealCards : []
    for (const card of dealCards) displayedTopicIds.add(card.topicId)
    body = (
      <div className="space-y-4">
        {dealCards.length > 0 && (
          <>
            <SectionTitle hint={`${dealCards.length}`}>Решения по сделкам</SectionTitle>
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {dealCards.map((c) => (
                <DealCardBlock
                  key={c.id}
                  card={c}
                  topicId={c.topicId}
                  topicTitle={c.clientName ? `${c.clientName} — ${c.topicTitle}` : c.topicTitle}
                  onChanged={refresh}
                  onOpenTopic={openTopic}
                />
              ))}
            </div>
            <SectionTitle>Темы</SectionTitle>
          </>
        )}
        {entries.length ? (
          renderGrid(entries)
        ) : (
          <Empty label="Сейчас нет тем, которые требуют внимания." />
        )}
      </div>
    )
  } else if (tab === "digest") {
    const parts = splitDigest(entries, current?.digestVisibleItems ?? DIGEST_VISIBLE_ITEMS)
    body = (
      <div className="space-y-4">
        <SectionTitle hint={`снимок ${formatDateTimeRu(current?.digestSnapshotAt ?? null) ?? ""}`}>Утренняя сводка</SectionTitle>
        {parts.shown.length ? (
          renderGrid(parts.shown)
        ) : (
          <Empty label="В утренней сводке нет тем." />
        )}
        {parts.more.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowMore((v) => !v)}>
              {showMore ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {showMore ? "Свернуть" : `Ещё ${parts.more.length}`}
            </Button>
            {showMore && renderGrid(parts.more)}
          </>
        )}
        {parts.sinceMorning.length > 0 && (
          <>
            <SectionTitle hint={`${parts.sinceMorning.length}`}>Новое с утра</SectionTitle>
            {renderGrid(parts.sinceMorning)}
          </>
        )}
      </div>
    )
  } else if (tab === "week") {
    const parts = splitWeek(entries)
    body = (
      <div className="space-y-4">
        <SectionTitle hint={`снимок ${formatDateTimeRu(current?.weeklySnapshotAt ?? null) ?? ""}`}>Обзор недели</SectionTitle>
        {parts.main.length ? (
          renderGrid(parts.main)
        ) : (
          <Empty label="В обзоре недели нет тем." />
        )}
        {parts.expired.length > 0 && (
          <>
            <SectionTitle hint="карточка истекла, тема ещё открыта">Истекло</SectionTitle>
            {renderGrid(parts.expired)}
          </>
        )}
        {parts.dormant.length > 0 && (
          <>
            <SectionTitle hint="нет активности, показ один раз">Тема затихла</SectionTitle>
            {renderGrid(parts.dormant)}
          </>
        )}
        {parts.since.length > 0 && (
          <>
            <SectionTitle hint={`${parts.since.length} · войдут в следующий обзор`}>Новое после обзора</SectionTitle>
            {renderGrid(parts.since)}
          </>
        )}
      </div>
    )
  } else {
    body = entries.length ? (
      renderGrid(entries)
    ) : (
      <Empty label="Нет тем по заданным фильтрам." />
    )
  }

  const topicNavigation = useDetailNavigation(drawerId, [...displayedTopicIds], setDrawerId)

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-3 flex-wrap rounded-xl border bg-card p-3 shrink-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as DashboardTab)}>
          <TabsList aria-label="Срочность" className="h-auto flex-wrap" aria-describedby="topic-list-description">
            {DASHBOARD_TABS.map((t) => {
              const n = t === "none" ? null : countOf(t)
              return (
                <TabsTrigger key={t} value={t}>
                  {t === "none" ? "Остальные" : TOPIC_TAB_LABELS_RU[t]}
                  {n !== null && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{n}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch size="sm" checked={mine} onCheckedChange={setMine} />
          Только мои
        </label>
        {showFilters && (
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {TOPIC_STATUS_FILTER_LABELS_RU[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchableSelect
              size="sm"
              label="Компания"
              searchLabel="Поиск компании"
              className="max-w-72"
              options={[{ id: ANY, name: "Все компании" }, ...clients]}
              value={clientId}
              onValueChange={setClientId}
            />
          </>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Обновить темы" onClick={refresh} disabled={loading}>
                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Обновить темы</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <p id="topic-list-description" className="px-1 text-sm text-muted-foreground">
        {TAB_DESCRIPTIONS[tab]}
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none pb-4">{body}</div>
      <TopicDrawer
        topicId={drawerId}
        open={!!drawerId}
        navigation={topicNavigation.navigation}
        onOpenChange={(o) => {
          if (!o) setDrawerId(null)
        }}
        onChanged={refresh}
      />
    </div>
  )
}

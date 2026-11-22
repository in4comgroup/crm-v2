"use client"

// Dashboard topic lists (topics plan phase 6, spec topics/01 §8.1, §14;
// 06-attention-engine.md §7.2, §7.4): tabs «Сейчас» / «Сводка» / «Неделя»
// / «Все темы» with counts, the filter «Мои», the topic cards in rank order
// and the topic drawer. Shown only when the org's topics mode is `on` (the
// dashboard page decides). Data: `GET /api/topics`.

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageLoader } from "@/components/blocks/page-loader"
import { DealCardBlock, TopicEntryCard, formatDateTimeRu } from "@/components/blocks/topic-card"
import { TopicDrawer } from "@/components/blocks/topic-drawer"
import { TOPIC_LIST_LABELS_RU } from "@/lib/topics/attention-types"
import { TOPIC_STATUSES, TOPIC_STATUS_LABELS_RU } from "@/lib/topics/types"
import {
  DIGEST_VISIBLE_ITEMS,
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

function Grid({ entries, onChanged, onOpen }: { entries: TopicEntry[]; onChanged: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-stretch">
      {entries.map((e) => (
        <TopicEntryCard key={e.topicId} entry={e} onChanged={onChanged} onOpen={onOpen} />
      ))}
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
  const [tab, setTab] = usePersistentTab<TopicTab>("dashboard.topics", "now", {
    allowed: TOPIC_TABS,
  })
  const [mine, setMine] = useState(false)
  const [status, setStatus] = useState("live")
  const [list, setList] = useState(ANY)
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

  const queryKey = JSON.stringify([tab, mine, status, list, clientId])

  const load = useCallback(async () => {
    const id = ++req.current
    const key = JSON.stringify([tab, mine, status, list, clientId])
    const qs = new URLSearchParams({ tab })
    if (mine) qs.set("mine", "1")
    if (tab === "all") {
      qs.set("status", status)
      if (list !== ANY) qs.set("list", list)
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
  }, [tab, mine, status, list, clientId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    if (tab !== "all" || clients.length) return
    fetch("/api/topics?clients=1")
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .catch(() => {})
  }, [tab, clients.length])

  const refresh = useCallback(() => void load(), [load])
  const current = data?.key === queryKey ? data : null
  const entries = current ? current.entries : []

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
                  onOpenTopic={setDrawerId}
                />
              ))}
            </div>
            <SectionTitle>Темы</SectionTitle>
          </>
        )}
        {entries.length ? (
          <Grid entries={entries} onChanged={refresh} onOpen={setDrawerId} />
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
          <Grid entries={parts.shown} onChanged={refresh} onOpen={setDrawerId} />
        ) : (
          <Empty label="В утренней сводке нет тем." />
        )}
        {parts.more.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowMore((v) => !v)}>
              {showMore ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {showMore ? "Свернуть" : `Ещё ${parts.more.length}`}
            </Button>
            {showMore && <Grid entries={parts.more} onChanged={refresh} onOpen={setDrawerId} />}
          </>
        )}
        {parts.sinceMorning.length > 0 && (
          <>
            <SectionTitle hint={`${parts.sinceMorning.length}`}>Новое с утра</SectionTitle>
            <Grid entries={parts.sinceMorning} onChanged={refresh} onOpen={setDrawerId} />
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
          <Grid entries={parts.main} onChanged={refresh} onOpen={setDrawerId} />
        ) : (
          <Empty label="В обзоре недели нет тем." />
        )}
        {parts.expired.length > 0 && (
          <>
            <SectionTitle hint="карточка истекла, тема ещё открыта">Истекло</SectionTitle>
            <Grid entries={parts.expired} onChanged={refresh} onOpen={setDrawerId} />
          </>
        )}
        {parts.dormant.length > 0 && (
          <>
            <SectionTitle hint="нет активности, показ один раз">Тема затихла</SectionTitle>
            <Grid entries={parts.dormant} onChanged={refresh} onOpen={setDrawerId} />
          </>
        )}
        {parts.since.length > 0 && (
          <>
            <SectionTitle hint={`${parts.since.length} · войдут в следующий обзор`}>Новое после обзора</SectionTitle>
            <Grid entries={parts.since} onChanged={refresh} onOpen={setDrawerId} />
          </>
        )}
      </div>
    )
  } else {
    body = entries.length ? (
      <Grid entries={entries} onChanged={refresh} onOpen={setDrawerId} />
    ) : (
      <Empty label="Нет тем по заданным фильтрам." />
    )
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-3 flex-wrap rounded-xl border bg-card p-3 shrink-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TopicTab)}>
          <TabsList>
            {TOPIC_TABS.map((t) => {
              const n = countOf(t)
              return (
                <TabsTrigger key={t} value={t}>
                  {TOPIC_TAB_LABELS_RU[t]}
                  {n !== null && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{n}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Checkbox id="topics-mine" checked={mine} onCheckedChange={(v) => setMine(v === true)} />
          <Label htmlFor="topics-mine" className="text-xs cursor-pointer">
            Мои
          </Label>
        </div>
        {tab === "all" && (
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* ONE «open» value (bug list 2026-11-21, item 9): «Открытые»
                    = open + dormant (live); the status `open` alone is not
                    offered — «Открытые» and «Открыта» used to show different
                    sets. «Затихла» still picks the dormant ones. */}
                <SelectItem value="live">Открытые</SelectItem>
                <SelectItem value="all">Все статусы</SelectItem>
                {TOPIC_STATUSES.filter((s) => s !== "merged" && s !== "open").map((s) => (
                  <SelectItem key={s} value={s}>
                    {TOPIC_STATUS_LABELS_RU[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={list} onValueChange={setList}>
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue placeholder="Список" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Все</SelectItem>
                {(["now", "digest", "week", "none"] as const).map((l) => (
                  <SelectItem key={l} value={l}>
                    {l === "none" ? "Остальные" : TOPIC_LIST_LABELS_RU[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger size="sm" className="w-fit max-w-64">
                <SelectValue placeholder="Компания" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Все компании</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Обновить" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none pb-4">{body}</div>
      <TopicDrawer
        topicId={drawerId}
        open={!!drawerId}
        onOpenChange={(o) => {
          if (!o) setDrawerId(null)
        }}
        onChanged={refresh}
      />
    </div>
  )
}

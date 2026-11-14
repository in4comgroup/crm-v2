"use client"

// Shadow review of the topics signal extraction (plan phase 2, spec
// topics/01 §5, §13) — platform admin only, on the «Темы» tab of /settings.
// Org select → stats line → filters → scanned items; a row expands to show
// instances, dropped codes, facts, subjects, direction, forward info, model
// and tokens. «Извлечь заново» / «Извлечь» run ONE item now (signals, then
// topic resolution when the item is `done`; manual action,
// ignores the org's topics mode). API: /api/admin/topics/signals.

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Loader, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  SIGNAL_BAND_LABELS_RU,
  SIGNAL_BANDS,
  SIGNAL_DROP_REASONS,
  SIGNAL_ITEM_STATUSES,
  SIGNAL_NOT_COUNTED_REASONS,
  SIGNAL_SKIP_REASONS,
  type SignalBand,
  type SignalItemStatus,
  type SignalReviewItem,
} from "@/lib/signals/extraction-types"
import type { AdminTopicsOrgsResponse } from "@/app/api/admin/topics/route"
import type {
  AdminSignalsExtractResponse,
  AdminSignalsListResponse,
  AdminSignalsStatsResponse,
  SignalStats,
} from "@/app/api/admin/topics/signals/route"
import { topicOutcomeText } from "@/lib/topics/outcome-text"

const ALL = "__all__"
const PAGE_SIZE = 50

const STATUS_LABEL: Record<SignalItemStatus, string> = {
  done: "Готово",
  skipped: "Пропущено",
  deferred: "Отложено",
  failed: "Ошибка",
}

const STATUS_CLASS: Record<SignalItemStatus, string> = {
  done: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  skipped: "text-muted-foreground",
  deferred: "border-amber-300 text-amber-700 dark:text-amber-400",
  failed: "border-red-300 text-red-600 dark:text-red-400",
}

const BAND_CLASS: Record<SignalBand, string> = {
  none: "bg-muted text-muted-foreground",
  low: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  normal: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  very_high: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  critical: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
}

const DIRECTION_LABEL: Record<string, string> = {
  inbound: "входящее",
  outbound: "исходящее",
  internal: "внутреннее",
}

const CONFIDENCE_LABEL: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" }

const OWNER_LABEL: Record<string, string> = { us: "мы", them: "они", unknown: "неясно" }

const MODE_LABEL: Record<string, string> = { off: "выкл.", shadow: "тень", on: "вкл." }

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"

/** Russian label of a stored signal_reason (gate key, «gate: x», or an error). */
export function signalReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  const [head, ...rest] = reason.split(":")
  const detail = rest.join(":").trim()
  const key = head.trim()
  if (key in SIGNAL_SKIP_REASONS) {
    const label = SIGNAL_SKIP_REASONS[key as keyof typeof SIGNAL_SKIP_REASONS]
    return detail ? `${label}: ${detail}` : label
  }
  if (key === "gate") return `Правило: ${detail}`
  if (key === "budget") return "Исчерпан бюджет ИИ"
  return reason
}

function BandBadge({ band, score }: { band: SignalBand | null; score: number | null }) {
  if (!band) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant="secondary" className={`font-normal ${BAND_CLASS[band]}`}>
      {score ?? 0} · {SIGNAL_BAND_LABELS_RU[band]}
    </Badge>
  )
}

function StatsLine({ stats }: { stats: SignalStats | null }) {
  if (!stats) return null
  const statuses = SIGNAL_ITEM_STATUSES.filter((s) => stats.byStatus[s])
  const bands = SIGNAL_BANDS.filter((b) => stats.byBand[b])
  const skips = Object.entries(stats.bySkipReason).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {statuses.length === 0 ? (
          <span className="text-muted-foreground">Ещё ничего не просканировано.</span>
        ) : (
          statuses.map((s) => (
            <span key={s}>
              <span className="text-muted-foreground">{STATUS_LABEL[s]}:</span>{" "}
              <span className="tabular-nums">{stats.byStatus[s]}</span>
            </span>
          ))
        )}
        <span>
          <span className="text-muted-foreground">Ждут обработки:</span>{" "}
          <span className="tabular-nums">{stats.pending}</span>
        </span>
        <span>
          <span className="text-muted-foreground">История с:</span>{" "}
          {stats.historyStart ? fmtDate(stats.historyStart) : "темы не включались"}
        </span>
      </div>
      {bands.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-muted-foreground">Важность:</span>
          {bands.map((b) => (
            <Badge key={b} variant="secondary" className={`font-normal ${BAND_CLASS[b]}`}>
              {SIGNAL_BAND_LABELS_RU[b]} · {stats.byBand[b]}
            </Badge>
          ))}
        </div>
      )}
      {skips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-muted-foreground">Пропуски:</span>
          {skips.map(([k, n]) => (
            <Badge key={k} variant="outline" className="font-normal">
              {signalReasonLabel(k)} · {n}
            </Badge>
          ))}
        </div>
      )}
      {stats.topCodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-muted-foreground">
            Частые коды ({stats.topCodesDays} дн.):
          </span>
          {stats.topCodes.map((c) => (
            <Badge key={c.code} variant="secondary" className="font-normal" title={c.labelRu ?? undefined}>
              <span className="font-mono">{c.code}</span> · {c.count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

function ItemDetail({ item }: { item: SignalReviewItem }) {
  const f = item.facts
  const facts = f?.facts
  const dateFacts = facts
    ? ([
        ["Окончание договора", facts.contractEndDate],
        ["Предложенная встреча", facts.proposedMeetingDate],
        ["Отсрочка, дней", facts.paymentTermsDays],
        ["Запрошенный лимит", facts.creditLimitRequested],
        ["Вернётся (автоответ)", facts.oooReturnDate ?? null],
        ["Заместитель", facts.oooDeputy ?? null],
      ] as const).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : []
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="text-xs text-muted-foreground">
        ID: <span className="font-mono">{item.id}</span> · просканировано {fmtDate(item.scannedAt)}
        {item.taxonomyVersion !== null && <> · версия таксономии {item.taxonomyVersion}</>}
      </div>

      {item.instances.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Цитата</TableHead>
                <TableHead>Уверенность</TableHead>
                <TableHead>Учтён</TableHead>
                <TableHead className="text-right">Балл</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {item.instances.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="align-top">
                    <div className="font-mono text-xs">{i.code}</div>
                    {i.labelRu && <div className="text-xs text-muted-foreground">{i.labelRu}</div>}
                    {i.subjectIndex >= 0 && (
                      <div className="text-xs text-muted-foreground">предмет #{i.subjectIndex}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal align-top text-xs italic">
                    «{i.evidence}»
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    {CONFIDENCE_LABEL[i.confidence] ?? i.confidence}
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    {i.counted ? (
                      "да"
                    ) : (
                      <span className="text-muted-foreground">
                        нет
                        {i.notCountedReason &&
                          ` — ${SIGNAL_NOT_COUNTED_REASONS[i.notCountedReason as keyof typeof SIGNAL_NOT_COUNTED_REASONS] ?? i.notCountedReason}`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{i.scoreContrib}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {f && f.dropped.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Отброшенные коды</div>
          <ul className="flex flex-col gap-0.5 text-xs">
            {f.dropped.map((d, k) => (
              <li key={k}>
                <span className="font-mono">{d.code}</span> —{" "}
                {SIGNAL_DROP_REASONS[d.reason] ?? d.reason}
                {d.evidence && <span className="italic text-muted-foreground"> «{d.evidence}»</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {f && (
        <div className="grid grid-cols-1 gap-1">
          <KV k="Направление">
            {DIRECTION_LABEL[f.direction] ?? f.direction}
            {f.modelDirection && f.modelDirection !== f.direction && (
              <span className="text-muted-foreground">
                {" "}
                (модель: {DIRECTION_LABEL[f.modelDirection] ?? f.modelDirection})
              </span>
            )}
          </KV>
          {f.forward && (
            <KV k="Пересылка">
              переслал {f.forward.forwardedBy ?? "—"}, автор {f.forward.originalAuthor ?? "—"}
            </KV>
          )}
          {f.dominantCode && (
            <KV k="Главный код">
              <span className="font-mono">{f.dominantCode}</span>
            </KV>
          )}
          {f.attributes.length > 0 && (
            <KV k="Атрибуты">
              {f.attributes.map((a) => `${a.code} (${a.weight > 0 ? "+" : ""}${a.weight})`).join(", ")}
              <span className="text-muted-foreground"> · поправка {f.attrAdj}</span>
            </KV>
          )}
          {facts && facts.amounts.length > 0 && (
            <KV k="Суммы">
              <ul>
                {facts.amounts.map((a, k) => (
                  <li key={k}>
                    {a.value.toLocaleString("ru-RU")} {a.currency} ({a.scope}, НДС {a.vat})
                    {a.evidence && <span className="italic text-muted-foreground"> «{a.evidence}»</span>}
                  </li>
                ))}
              </ul>
            </KV>
          )}
          {facts && facts.deadlines.length > 0 && (
            <KV k="Сроки">
              <ul>
                {facts.deadlines.map((d, k) => (
                  <li key={k}>
                    {d.date} — {d.what} ({OWNER_LABEL[d.owner] ?? d.owner}
                    {d.precision === "resolved" ? ", вычислено" : ""})
                  </li>
                ))}
              </ul>
            </KV>
          )}
          {dateFacts.map(([k, v]) => (
            <KV key={k} k={k}>
              {String(v)}
            </KV>
          ))}
          {facts?.meetingReply && (
            <KV k="Ответ на встречу">
              {facts.meetingReply.response ?? "—"} {facts.meetingReply.meetingTitle ?? ""}
            </KV>
          )}
          <KV k="Источник результата">
            {f.producer.kind === "gate"
              ? `правило ${f.producer.gate ?? ""}`
              : `${f.producer.model ?? "—"} (${f.producer.process ?? "—"})`}
            {(f.inputTokens != null || f.outputTokens != null) && (
              <span className="text-muted-foreground">
                {" "}
                · токены {f.inputTokens ?? "?"} → {f.outputTokens ?? "?"}
              </span>
            )}
            {f.durationMs != null && <span className="text-muted-foreground"> · {f.durationMs} мс</span>}
          </KV>
        </div>
      )}

      {item.subjects.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Предметы</div>
          <div className="flex flex-col gap-1">
            {item.subjects.map((s) => (
              <div key={s.index} className="rounded-md border p-2 text-xs">
                <span className="text-muted-foreground">#{s.index}</span> {s.counterparty || "—"}
                {s.onBehalfOf && <span className="text-muted-foreground"> (от имени {s.onBehalfOf})</span>}
                {s.matter && <> · {s.matter}</>}
                {s.references.length > 0 && (
                  <div className="text-muted-foreground">
                    Ссылки: {s.references.map((r) => `${r.kind} ${r.value}`).join(", ")}
                  </div>
                )}
                {s.products.length > 0 && (
                  <div className="text-muted-foreground">Товары: {s.products.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!f && item.instances.length === 0 && (
        <div className="text-muted-foreground">{signalReasonLabel(item.reason) ?? "Нет данных."}</div>
      )}
    </div>
  )
}

type OrgRow = AdminTopicsOrgsResponse["orgs"][number]

export function AdminTopicsSignals() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [orgId, setOrgId] = useState("")
  const [status, setStatus] = useState(ALL)
  const [band, setBand] = useState(ALL)
  const [codeInput, setCodeInput] = useState("")
  const [code, setCode] = useState("")
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<SignalReviewItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<SignalStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [runningId, setRunningId] = useState<string | null>(null)
  const [manualId, setManualId] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/topics")
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        const list = (data as AdminTopicsOrgsResponse).orgs
        setOrgs(list)
        const first = list.find((o) => o.mode !== "off") ?? list[0]
        if (first) setOrgId((cur) => cur || first.organizationId)
      } catch (e) {
        toast.error(`Не удалось загрузить организации: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ orgId, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
      if (status !== ALL) sp.set("status", status)
      if (band !== ALL) sp.set("band", band)
      if (code) sp.set("code", code)
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/admin/topics/signals?${sp}`),
        fetch(`/api/admin/topics/signals?${new URLSearchParams({ orgId, stats: "1" })}`),
      ])
      const list = await listRes.json()
      if (!listRes.ok) throw new Error(list?.error ?? `HTTP ${listRes.status}`)
      const st = await statsRes.json()
      if (!statsRes.ok) throw new Error(st?.error ?? `HTTP ${statsRes.status}`)
      setRows((list as AdminSignalsListResponse).rows)
      setTotal((list as AdminSignalsListResponse).total)
      setStats((st as AdminSignalsStatsResponse).stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId, status, band, code, page])

  useEffect(() => {
    void load()
  }, [load])

  const extract = async (itemId: string) => {
    if (!orgId || !itemId.trim()) return
    setRunningId(itemId)
    try {
      const res = await fetch("/api/admin/topics/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, itemId: itemId.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const { result, item, topics } = data as AdminSignalsExtractResponse
      const codes = item?.instances.filter((i) => i.counted).map((i) => i.code) ?? []
      const parts = [
        STATUS_LABEL[result.status],
        result.band ? `балл ${result.score ?? 0} (${SIGNAL_BAND_LABELS_RU[result.band]})` : null,
        codes.length ? `коды: ${codes.join(", ")}` : null,
        result.status !== "done" ? signalReasonLabel(result.reason) : null,
      ].filter(Boolean)
      const topicText = topics
        ? topics.outcome
          ? topicOutcomeText(topics.outcome, topics.links)
          : `Темы: ошибка — ${topics.error}`
        : null
      const opts = topicText ? { description: topicText } : undefined
      const text = parts.join(" · ")
      if (result.status === "failed" || topics?.error || topics?.outcome?.status === "failed") toast.error(text, opts)
      else toast.success(text, opts)
      if (item) {
        setRows((prev) => {
          if (!prev) return [item]
          const i = prev.findIndex((r) => r.id === item.id)
          if (i < 0) return [item, ...prev]
          const next = [...prev]
          next[i] = item
          return next
        })
        setExpanded((prev) => new Set(prev).add(item.id))
      }
    } catch (e) {
      toast.error(`Не удалось извлечь сигналы: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunningId(null)
    }
  }

  const applyCode = () => {
    const next = codeInput.trim()
    if (next === code) return
    setCode(next)
    setPage(0)
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Select value={orgId} onValueChange={(v) => { setOrgId(v); setPage(0) }}>
          <SelectTrigger size="sm" className="w-64" aria-label="Организация">
            <SelectValue placeholder="Организация" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.organizationId} value={o.organizationId}>
                {o.name} · {MODE_LABEL[o.mode] ?? o.mode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0) }}>
          <SelectTrigger size="sm" className="w-36" aria-label="Статус">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            {SIGNAL_ITEM_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={band} onValueChange={(v) => { setBand(v); setPage(0) }}>
          <SelectTrigger size="sm" className="w-40" aria-label="Важность">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Любая важность</SelectItem>
            {SIGNAL_BANDS.map((b) => (
              <SelectItem key={b} value={b}>
                {SIGNAL_BAND_LABELS_RU[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 w-40 font-mono text-xs"
          placeholder="Код сигнала"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyCode()
          }}
          onBlur={applyCode}
        />
        <div className="ml-auto flex items-center gap-2">
          <Input
            className="h-8 w-56 font-mono text-xs"
            placeholder="ID сообщения"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void extract(manualId)
            }}
          />
          <Button
            size="sm"
            onClick={() => void extract(manualId)}
            disabled={!orgId || !manualId.trim() || runningId !== null}
          >
            {runningId === manualId.trim() && manualId.trim() ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Извлечь
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || !orgId}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
      </div>

      <StatsLine stats={stats} />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Дата</TableHead>
              <TableHead>Канал</TableHead>
              <TableHead>Тема / от кого</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Балл</TableHead>
              <TableHead>Коды</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-red-500">
                  Не удалось загрузить: {error}
                </TableCell>
              </TableRow>
            ) : !rows ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center">
                  {orgId ? (
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground">Выберите организацию.</span>
                  )}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Нет просканированных сообщений по фильтрам.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => {
                const open = expanded.has(r.id)
                const zebra = i % 2 === 1 ? "bg-muted/40" : ""
                const counted = r.instances.filter((x) => x.counted)
                const other = r.instances.length - counted.length
                return (
                  <Fragment key={r.id}>
                    <TableRow className={`cursor-pointer ${zebra}`} onClick={() => toggle(r.id)} aria-expanded={open}>
                      <TableCell>
                        {open ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.sourceCreatedAt)}</TableCell>
                      <TableCell className="text-xs">
                        <div>{r.provider ?? "—"}</div>
                        <div className="text-muted-foreground">{r.externalType}</div>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">
                        <div className="truncate font-medium">{r.subject || "(без темы)"}</div>
                        <div className="truncate text-muted-foreground">{r.from ?? "—"}</div>
                      </TableCell>
                      <TableCell className="max-w-56 text-xs">
                        {r.status ? (
                          <Badge variant="outline" className={`font-normal ${STATUS_CLASS[r.status]}`}>
                            {STATUS_LABEL[r.status]}
                          </Badge>
                        ) : (
                          "—"
                        )}
                        {r.reason && r.status !== "done" && (
                          <div className="mt-0.5 truncate text-muted-foreground" title={r.reason}>
                            {signalReasonLabel(r.reason)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <BandBadge band={r.band} score={r.score} />
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {counted.map((x) => (
                            <Badge key={x.id} variant="secondary" className="font-mono text-[10px]" title={x.labelRu ?? undefined}>
                              {x.code}
                            </Badge>
                          ))}
                          {other > 0 && <span className="text-xs text-muted-foreground">+{other} не учт.</span>}
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title="Извлечь заново"
                          aria-label="Извлечь заново"
                          disabled={runningId !== null}
                          onClick={() => void extract(r.id)}
                        >
                          {runningId === r.id ? (
                            <Loader className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className={`hover:bg-transparent ${zebra}`}>
                        <TableCell />
                        <TableCell colSpan={7} className="whitespace-normal pb-4">
                          <ItemDetail item={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Всего {total} · страница {page + 1} из {pages}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-8" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={page + 1 >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

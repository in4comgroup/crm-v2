"use client"

// Debug block «Темы (отладка)» of the topic engine (plan phase 3 task 8,
// spec topics/01 §6–§7) — platform admin only, on the «Темы» tab of
// /settings. Org select → counts per status → status filter → topics table.
// A row opens a dialog: topic facts, items (open markdown, detach, resolve
// again), signal instances with evidence, the event journal, and the
// actions «Готово» / «Не относится» / «Объединить с…»; phase 4: the
// attention result (list, profile, score, «Почему в этом списке») and the
// topic card (open card + history) with «Переписать карточку»; phase 5:
// the deal bridge (linked deal, decision log per signal instance, deal
// proposal / stage confirmation cards) with «Решить по сделке».
// API: /api/admin/topics/topics. Users never see this.

import { DEFAULT_PAGE_SIZE, TablePager } from "@/components/blocks/table-pager"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { FileText, Handshake, Loader, PenLine, RefreshCw, RotateCcw, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { SIGNAL_BAND_LABELS_RU, SIGNAL_NOT_COUNTED_REASONS, type SignalBand } from "@/lib/signals/extraction-types"
import { topicOutcomeText } from "@/lib/topics/outcome-text"
import {
  TOPIC_ITEM_ROLE_LABELS_RU,
  TOPIC_STATUS_LABELS_RU,
  TOPIC_STATUSES,
  TOPIC_SUB_STATE_LABELS_RU,
  type TopicStatus,
} from "@/lib/topics/types"
import { TOPIC_LIST_LABELS_RU, type TopicList } from "@/lib/topics/attention-types"
import {
  DEAL_RISK_CLEARED_BY_LABELS_RU,
  DEAL_STATE_DECISION_LABELS_RU,
  type DealRiskView,
  type DealStateDecision,
  type DealStateView,
} from "@/lib/topics/deal-state"
import {
  CARD_EVENT_GROUP_LABELS_RU,
  CARD_KIND_LABELS_RU,
  CARD_REJECT_REASON_LABELS_RU,
  CARD_STATUS_LABELS_RU,
  isCardKind,
  type CardRejectReason,
  type CardStatus,
} from "@/lib/topics/cards"
import type { AdminTopicsOrgsResponse } from "@/app/api/admin/topics/route"
import type {
  AdminTopicActionResponse,
  AdminTopicDetailResponse,
  AdminTopicsListResponse,
  TopicDebugCard,
  TopicDebugDealCard,
  TopicDebugDealDecision,
  TopicDebugDetail,
  TopicDebugRow,
} from "@/app/api/admin/topics/topics/route"

const DEAL_ACTION_LABEL: Record<string, string> = {
  create: "создана сделка",
  link: "привязана к сделке",
  propose: "предложение «Новая возможность?»",
  move: "перевод вперёд",
  confirm: "подтверждение стадии",
  outcome: "итог сделки",
  pause: "пауза",
  resume: "снятие паузы",
  context: "контекст сделки",
  skip: "без действия",
}
const DEAL_STATUS_LABEL: Record<string, string> = {
  active: "активна",
  paused: "на паузе",
  cancelled: "отменена",
  deleted: "удалена",
}

function dealActionText(action: string): string {
  const [a, dry] = action.split(":")
  return `${DEAL_ACTION_LABEL[a] ?? a}${dry === "dry_run" ? " (тень: не выполнено)" : ""}`
}

function DealDecisionView({ d }: { d: TopicDebugDealDecision }) {
  return (
    <div className="rounded-lg border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{d.code}</span>
        {d.labelRu && <span className="text-muted-foreground">{d.labelRu}</span>}
        {d.confidence && <Badge variant="outline">{d.confidence}</Badge>}
        {d.topicScore !== null && <span className="text-muted-foreground">балл темы {d.topicScore}</span>}
        {d.dryRun && <Badge variant="secondary">тень</Badge>}
        <span className="ml-auto text-muted-foreground">{fmtDate(d.createdAt)}</span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {d.results.length === 0 && <li className="text-muted-foreground">Правил нет.</li>}
        {d.results.map((r, i) => (
          <li key={i}>
            <span className="font-mono text-muted-foreground">{r.effect || "—"}</span> →{" "}
            <span className="font-medium">{dealActionText(r.action)}</span>
            {r.stageLabel && <> · «{r.stageLabel}»</>}
            {r.reasonRu && <span className="text-muted-foreground"> · {r.reasonRu}</span>}
            {r.ruleNote && <span className="text-muted-foreground"> · правило: {r.ruleNote.split("\n")[0]}</span>}
            {r.error && <span className="text-red-500"> · ошибка: {r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DealCardView({ c }: { c: TopicDebugDealCard }) {
  const p = c.proposal
  return (
    <div className="rounded-lg border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{isCardKind(c.kind) ? CARD_KIND_LABELS_RU[c.kind] : c.kind}</Badge>
        <CardStatusBadge status={c.status} />
        <span className="font-medium">{c.headline}</span>
        <span className="ml-auto text-muted-foreground">{fmtDate(c.createdAt)}</span>
      </div>
      {p && (
        <div className="mt-1 text-muted-foreground">
          {p.codeLabelRu} ({p.confidence}, балл {p.topicScore}) · {p.reasonRu}
          {p.evidence && <> · «{p.evidence}»</>}
          {p.dealTypeLabelRu && <> · тип: {p.dealTypeLabelRu}</>}
          {p.stageLabelRu && <> · стадия: {p.fromStageLabelRu ? `${p.fromStageLabelRu} → ` : ""}{p.stageLabelRu}</>}
          {p.dealOptions && p.dealOptions.length > 0 && <> · сделки на выбор: {p.dealOptions.map((o) => o.name).join(", ")}</>}
        </div>
      )}
      {(c.rejectReasonCode || c.rejectionReason) && (
        <div className="mt-1">
          Отклонено: {c.rejectReasonCode ? (CARD_REJECT_REASON_LABELS_RU[c.rejectReasonCode as CardRejectReason] ?? c.rejectReasonCode) : ""}
          {c.rejectionReason ? ` — ${c.rejectionReason}` : ""}
        </div>
      )}
      {c.dealId && <div className="mt-1 font-mono text-muted-foreground">сделка {c.dealId}</div>}
    </div>
  )
}

const ALL = "__all__"
const LIVE = "open,dormant"

const MODE_LABEL: Record<string, string> = { off: "выкл.", shadow: "тень", on: "вкл." }
const CLASS_LABEL: Record<string, string> = { risk: "риск", chance: "шанс", fyi: "к сведению" }
const CONFIDENCE_LABEL: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" }

const EVENT_LABEL: Record<string, string> = {
  created: "Создана",
  item_attached: "Добавлено сообщение",
  item_detached: "Сообщение отвязано",
  reopened: "Открыта снова",
  resolved: "Решена",
  dormant: "Затихла",
  expired: "Истекла",
  archived: "В архив",
  done: "Отмечена «Готово»",
  dismissed: "«Не относится»",
  merged_into: "Объединена в другую",
  merged_from: "Присоединена другая",
  relinked: "Контрагент изменён",
}

const STATUS_CLASS: Partial<Record<TopicStatus, string>> = {
  open: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  dormant: "border-amber-300 text-amber-700 dark:text-amber-400",
  resolved: "border-sky-300 text-sky-700 dark:text-sky-400",
  done: "border-sky-300 text-sky-700 dark:text-sky-400",
}

const BAND_CLASS: Record<SignalBand, string> = {
  none: "bg-muted text-muted-foreground",
  low: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  normal: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  very_high: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  critical: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"

const statusLabel = (s: string) => TOPIC_STATUS_LABELS_RU[s as TopicStatus] ?? s
const listLabel = (l: string) => TOPIC_LIST_LABELS_RU[l as TopicList] ?? l
const cardStatusLabel = (s: string | null) => (s ? (CARD_STATUS_LABELS_RU[s as CardStatus] ?? s) : "—")

const CARD_STATUS_CLASS: Partial<Record<CardStatus, string>> = {
  open: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  accepted: "border-sky-300 text-sky-700 dark:text-sky-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
}

const CARD_OUTCOME_LABEL: Record<string, string> = {
  created: "Карточка создана",
  updated: "Карточка обновлена (UPDATE)",
  superseded: "Создана новая карточка (NEW), старая заменена",
  noop: "Писатель вернул NOOP — текст не изменился",
  invalid: "Писатель вернул пустой текст — карточка не изменена",
  unchanged: "Без изменений",
  closed: "Карточка закрыта",
  kept: "Карточка оставлена",
  skipped: "Пропущено",
}

function CardStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">нет</span>
  return (
    <Badge variant="outline" className={`w-fit font-normal ${CARD_STATUS_CLASS[status as CardStatus] ?? "text-muted-foreground"}`}>
      {cardStatusLabel(status)}
    </Badge>
  )
}

/** One topic card: text as the user sees it + engine fields. */
function TopicCardView({ c, compact = false }: { c: TopicDebugCard; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CardStatusBadge status={c.status} />
        {c.decision && <Badge variant="secondary" className="font-normal">{c.decision}</Badge>}
        <span className="text-xs text-muted-foreground">
          {fmtDate(c.createdAt)} · обновлена {fmtDate(c.updatedAt)}
          {c.expiresAt && ` · истекает ${fmtDate(c.expiresAt)}`}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{c.id}</span>
      </div>
      <div className="font-medium">{c.headline || "(без заголовка)"}</div>
      {!compact && (
        <>
          <div><span className="text-muted-foreground">Почему сейчас: </span>{c.whyNow || "—"}</div>
          <div><span className="text-muted-foreground">Что изменилось: </span>{c.sinceLast || c.whatChanged || "—"}</div>
          {c.steps.length > 0 && (
            <ol className="list-decimal pl-5">
              {c.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          {c.taskTitle && <div className="text-xs text-muted-foreground">Задача: {c.taskTitle}</div>}
          {c.events.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs">
              {c.events.map((e, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{CARD_EVENT_GROUP_LABELS_RU[e.group] ?? e.group} · {fmtDate(e.at)} · </span>
                  {e.labelRu}{e.evidence && <span className="italic text-muted-foreground"> «{e.evidence}»</span>}
                </li>
              ))}
            </ul>
          )}
          {c.orderRequest && (
            <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
              <span className="text-muted-foreground">Запрос для «Создать заказ»: </span>{c.orderRequest}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Снимок: {c.score ?? "—"} · {c.band ?? "—"} · {c.displayProfile ?? "—"} · {c.signalClass ? (CLASS_LABEL[c.signalClass] ?? c.signalClass) : "—"} · {c.leadCode ?? "—"} · категория {c.category} · приоритет {c.priority}
            {c.force && ` · ожидает обновления: ${c.force}`}
          </div>
        </>
      )}
      {(c.rejectReasonCode || c.rejectionReason) && (
        <div className="text-xs text-red-700 dark:text-red-400">
          Отклонена: {c.rejectReasonCode ? (CARD_REJECT_REASON_LABELS_RU[c.rejectReasonCode as CardRejectReason] ?? c.rejectReasonCode) : ""}
          {c.rejectionReason && ` — ${c.rejectionReason}`}
        </div>
      )}
    </div>
  )
}

function BandBadge({ band, score }: { band: string; score: number }) {
  const b = band as SignalBand
  return (
    <Badge variant="secondary" className={`font-normal ${BAND_CLASS[b] ?? ""}`}>
      {score} · {SIGNAL_BAND_LABELS_RU[b] ?? band}
    </Badge>
  )
}

function StatusBadge({ status, subState }: { status: string; subState?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className={`w-fit font-normal ${STATUS_CLASS[status as TopicStatus] ?? "text-muted-foreground"}`}>
        {statusLabel(status)}
      </Badge>
      {subState && subState !== "none" && (
        <span className="text-xs text-muted-foreground">
          {TOPIC_SUB_STATE_LABELS_RU[subState as keyof typeof TOPIC_SUB_STATE_LABELS_RU] ?? subState}
        </span>
      )}
    </div>
  )
}

/** Client / contact / raw counterparty of a topic (deleted / blocked flagged). */
function Counterparty({ row }: { row: TopicDebugRow }) {
  const flag = (s: string | null) =>
    s === "deleted" ? " (удалён)" : s === "blocked" ? " (заблокирован)" : ""
  return (
    <div className="flex flex-col text-xs">
      {row.clientName && <span className="font-medium">{row.clientName}{flag(row.clientStatus)}</span>}
      {row.contactName && <span>{row.contactName}{flag(row.contactStatus)}</span>}
      {!row.clientName && !row.contactName && (
        <span className="text-amber-700 dark:text-amber-400">не определён</span>
      )}
      {row.counterpartyRaw && <span className="text-muted-foreground">«{row.counterpartyRaw}»</span>}
    </div>
  )
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-36 shrink-0 text-muted-foreground">{k}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

type OrgRow = AdminTopicsOrgsResponse["orgs"][number]

export function AdminTopicsTopics() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [orgId, setOrgId] = useState("")
  const [status, setStatus] = useState(ALL)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [list, setList] = useState<AdminTopicsListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/topics")
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        const rows = (data as AdminTopicsOrgsResponse).orgs
        setOrgs(rows)
        const first = rows.find((o) => o.mode !== "off") ?? rows[0]
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
      const sp = new URLSearchParams({ organizationId: orgId, limit: String(pageSize), offset: String(page * pageSize) })
      if (status !== ALL) sp.set("status", status)
      const res = await fetch(`/api/admin/topics/topics?${sp}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setList(data as AdminTopicsListResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId, status, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const pickStatus = (v: string) => {
    setStatus(v)
    setPage(0)
  }

  const total = list?.total ?? 0
  const counts = TOPIC_STATUSES.filter((s) => list?.byStatus[s])

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
        <Select value={status} onValueChange={pickStatus}>
          <SelectTrigger size="sm" className="w-44" aria-label="Статус">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            <SelectItem value={LIVE}>Живые (открытые + затихшие)</SelectItem>
            {TOPIC_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TOPIC_STATUS_LABELS_RU[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading || !orgId}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {list && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-3 text-sm">
          {counts.length === 0 ? (
            <span className="text-muted-foreground">У организации нет тем.</span>
          ) : (
            <>
              <span className="mr-1 text-muted-foreground">По статусам:</span>
              {counts.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickStatus(status === s ? ALL : s)}
                  className="cursor-pointer"
                >
                  <Badge variant={status === s ? "default" : "outline"} className="font-normal">
                    {TOPIC_STATUS_LABELS_RU[s]} · {list.byStatus[s]}
                  </Badge>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тема</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Семейство / код</TableHead>
              <TableHead>Балл</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Список</TableHead>
              <TableHead>Карточка</TableHead>
              <TableHead className="text-right">Сообщ.</TableHead>
              <TableHead>Активность</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-red-500">
                  Не удалось загрузить: {error}
                </TableCell>
              </TableRow>
            ) : !list ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center">
                  {orgId ? (
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground">Выберите организацию.</span>
                  )}
                </TableCell>
              </TableRow>
            ) : list.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Нет тем по фильтру.
                </TableCell>
              </TableRow>
            ) : (
              list.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer even:bg-muted/40" onClick={() => setOpenId(r.id)}>
                  <TableCell className="max-w-sm whitespace-normal text-xs">
                    <div className="font-medium">{r.title}</div>
                    {r.class && <div className="text-muted-foreground">{CLASS_LABEL[r.class] ?? r.class}</div>}
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    <Counterparty row={r} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{r.family ?? "—"}</div>
                    {r.leadCode && (
                      <div className="font-mono text-muted-foreground" title={r.leadLabelRu ?? undefined}>
                        {r.leadCode}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <BandBadge band={r.band} score={r.score} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} subState={r.subState} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{listLabel(r.list)}</div>
                    {(r.displayProfile || r.attentionScore !== null) && (
                      <div className="text-muted-foreground">
                        {r.displayProfile ?? "—"} · {r.attentionScore ?? "—"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <CardStatusBadge status={r.cardStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.itemCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.lastActivityAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <TablePager
        page={page}
        pageSize={pageSize}
        total={total}
        disabled={loading}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(0)
        }}
      />

      <TopicDetailDialog
        orgId={orgId}
        topicId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
      />
    </div>
  )
}

function TopicDetailDialog({
  orgId,
  topicId,
  onClose,
  onChanged,
}: {
  orgId: string
  topicId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<TopicDebugDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [mergeTargets, setMergeTargets] = useState<TopicDebugRow[]>([])
  const [mergeTarget, setMergeTarget] = useState("")
  const [mdItem, setMdItem] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    setDetail(null)
    setLoadError(null)
    setNote("")
    setMergeTarget("")
    if (!topicId || !orgId) return
    let cancelled = false
    void (async () => {
      try {
        const [res, listRes] = await Promise.all([
          fetch(`/api/admin/topics/topics?${new URLSearchParams({ organizationId: orgId, id: topicId })}`),
          fetch(`/api/admin/topics/topics?${new URLSearchParams({ organizationId: orgId, status: "open,dormant,resolved,done,expired", limit: "200" })}`),
        ])
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        const others = listRes.ok ? ((await listRes.json()) as AdminTopicsListResponse).rows : []
        if (cancelled) return
        setDetail((data as AdminTopicDetailResponse).detail)
        setMergeTargets(others.filter((t) => t.id !== topicId))
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, topicId])

  const act = async (
    action: "done" | "dismiss" | "merge" | "detachItem" | "resolveItem" | "rewriteCard" | "runDeals" | "refreshDealState",
    extra: { targetTopicId?: string; sourceItemId?: string } = {},
  ) => {
    if (!topicId) return
    const key = `${action}:${extra.sourceItemId ?? ""}`
    setBusy(key)
    try {
      const res = await fetch("/api/admin/topics/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId, topicId, action, note: note.trim() || undefined, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const { detail: next, outcome, card, deals, dealState } = data as AdminTopicActionResponse
      if (outcome) toast.success(topicOutcomeText(outcome))
      else if (card) toast.success(CARD_OUTCOME_LABEL[card.outcome] ?? card.outcome)
      else if (deals)
        toast.success(
          "skipped" in deals
            ? deals.skipped === "no stage rules"
              ? "У организации нет правил стадий — скопируйте шаблоны в «Сигналах»"
              : deals.skipped
            : deals.instances === 0
              ? "Новых сигналов для сделки нет"
              : `Решено сигналов: ${deals.instances}${deals.dryRun ? " (тень: сделки не менялись)" : ""}`,
        )
      else if (dealState)
        toast.success(
          `Состояние: ${DEAL_STATE_DECISION_LABELS_RU[dealState.decision as DealStateDecision] ?? dealState.decision}${
            dealState.reasons?.length ? ` — ${dealState.reasons.join("; ")}` : ""
          }`,
        )
      else toast.success("Готово")
      onChanged()
      if (!next) {
        toast.info("Тема удалена: в ней не осталось сообщений с сигналами.")
        onClose()
        return
      }
      setDetail(next)
      setNote("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const t = detail?.topic
  const closed = t ? t.status === "merged" || t.status === "dismissed" : true

  return (
    <>
      <Dialog open={!!topicId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t?.title ?? "Тема"}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{topicId}</DialogDescription>
          </DialogHeader>

          {loadError ? (
            <div className="text-sm text-red-500">Не удалось загрузить: {loadError}</div>
          ) : !detail || !t ? (
            <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                <KV k="Статус">
                  <StatusBadge status={t.status} subState={t.subState} />
                </KV>
                <KV k="Балл">
                  <BandBadge band={t.band} score={t.score} />
                  {t.class && <span className="ml-2 text-muted-foreground">{CLASS_LABEL[t.class] ?? t.class}</span>}
                </KV>
                <KV k="Контрагент">
                  <Counterparty row={t} />
                </KV>
                <KV k="Предмет">{t.matter || "—"}</KV>
                <KV k="Семейство">{t.family ?? "—"}</KV>
                <KV k="Ведущий код">
                  {t.leadCode ? (
                    <>
                      <span className="font-mono">{t.leadCode}</span>
                      {t.leadLabelRu && <span className="text-muted-foreground"> — {t.leadLabelRu}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </KV>
                <KV k="Период">
                  {fmtDate(t.firstSeenAt)} → {fmtDate(t.lastActivityAt)}
                </KV>
                <KV k="Закрыта">
                  {t.closedAt ? `${fmtDate(t.closedAt)} (${t.closedReason ?? "—"})` : "—"}
                </KV>
                {t.references.length > 0 && (
                  <KV k="Ссылки">{t.references.map((r) => `${r.kind} ${r.value}`).join(", ")}</KV>
                )}
                {t.products.length > 0 && <KV k="Товары">{t.products.join(", ")}</KV>}
                {t.mergedIntoTopicId && (
                  <KV k="Объединена в">
                    <span className="font-mono text-xs">{t.mergedIntoTopicId}</span>
                  </KV>
                )}
                {t.relatedTopicId && (
                  <KV k="Связана с">
                    <span className="font-mono text-xs">{t.relatedTopicId}</span>
                  </KV>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                <Input
                  className="h-8 w-64"
                  placeholder="Комментарий (необязательно)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={closed}
                />
                <Button size="sm" disabled={closed || busy !== null} onClick={() => void act("done")}>
                  {busy === "done:" && <Loader className="h-4 w-4 animate-spin" />}
                  Готово
                </Button>
                <Button size="sm" variant="outline" disabled={t.status === "merged" || busy !== null} onClick={() => void act("dismiss")}>
                  {busy === "dismiss:" && <Loader className="h-4 w-4 animate-spin" />}
                  Не относится
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Select value={mergeTarget} onValueChange={setMergeTarget} disabled={t.status === "merged"}>
                    <SelectTrigger size="sm" className="w-72" aria-label="Тема для объединения">
                      <SelectValue placeholder="Объединить с…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mergeTargets.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">Других тем нет</div>
                      ) : (
                        mergeTargets.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.title} · {statusLabel(o.status)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!mergeTarget || t.status === "merged" || busy !== null}
                    onClick={() => void act("merge", { targetTopicId: mergeTarget })}
                  >
                    {busy === "merge:" && <Loader className="h-4 w-4 animate-spin" />}
                    Объединить
                  </Button>
                </div>
              </div>

              <section className="flex flex-col gap-1">
                <h3 className="font-medium">Внимание</h3>
                {!detail.attention ? (
                  <div className="text-xs text-muted-foreground">Ещё не рассчитано (фаза «attention» не запускалась для темы).</div>
                ) : (
                  <div className="grid grid-cols-1 gap-1 rounded-lg border p-3 md:grid-cols-2">
                    <KV k="Список">
                      {listLabel(detail.attention.list)}
                      {detail.attention.hiddenReason && (
                        <span className="text-muted-foreground"> · скрыта: {detail.attention.hiddenReason}</span>
                      )}
                    </KV>
                    <KV k="Профиль">
                      {detail.attention.profile ?? "—"}
                      {detail.attention.baseProfile !== detail.attention.profile && (
                        <span className="text-muted-foreground"> (базовый {detail.attention.baseProfile ?? "—"})</span>
                      )}
                    </KV>
                    <KV k="Балл внимания">
                      <BandBadge band={detail.attention.band} score={detail.attention.score} />
                      {detail.attention.boosts.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {detail.attention.boosts.map((b) => `${b.code}+${b.points}`).join(", ")}
                        </span>
                      )}
                    </KV>
                    <KV k="Срок">
                      {detail.attention.deadline ?? "—"}
                      {detail.attention.overdue && <span className="text-red-600"> · просрочен</span>}
                      {detail.attention.escalations.length > 0 && (
                        <span className="text-muted-foreground"> · {detail.attention.escalations.join(", ")}</span>
                      )}
                    </KV>
                    <KV k="Цикл">
                      {fmtDate(detail.attention.cycleStartedAt)}
                      {detail.attention.cycleReason && <span className="text-muted-foreground"> · {detail.attention.cycleReason}</span>}
                    </KV>
                    <KV k="Карточка до">{fmtDate(detail.attention.cardExpiresAt)}</KV>
                    {detail.attention.explanation.length > 0 && (
                      <div className="md:col-span-2">
                        <div className="text-muted-foreground">Почему в этом списке:</div>
                        <ul className="list-disc pl-5">
                          {detail.attention.explanation.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">Карточка ({detail.cards.length})</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={busy !== null}
                    onClick={() => void act("rewriteCard")}
                  >
                    {busy === "rewriteCard:" ? <Loader className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                    Переписать карточку
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  «Переписать карточку» вызывает писатель карточек один раз (ИИ), в любом режиме организации. Пользователи видят карточки тем только в режиме «вкл.».
                </p>
                {detail.cards.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Карточки нет.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <TopicCardView c={detail.cards[0]} />
                    {detail.cards.length > 1 && (
                      <>
                        <div className="text-xs text-muted-foreground">История</div>
                        {detail.cards.slice(1).map((c) => (
                          <TopicCardView key={c.id} c={c} compact />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">Сделка</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={busy !== null}
                    onClick={() => void act("runDeals")}
                  >
                    {busy === "runDeals:" ? <Loader className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
                    Решить по сделке
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  «Решить по сделке» применяет правила стадий к ещё не решённым сигналам темы. Сделки меняются только в режиме «вкл.»; в тени решения только записываются.
                </p>
                {detail.deal ? (
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                    <KV k="Сделка">
                      {detail.deal.name}
                      {detail.deal.createdByAgent && <Badge variant="secondary" className="ml-2">создал агент</Badge>}
                    </KV>
                    <KV k="Стадия">
                      {detail.deal.stageLabel ?? "—"} · {DEAL_STATUS_LABEL[detail.deal.status] ?? detail.deal.status}
                      {detail.deal.pausedUntil && <> до {fmtDate(detail.deal.pausedUntil)}</>}
                    </KV>
                    <KV k="Тип">{detail.deal.dealTypeLabel ?? "—"}</KV>
                    <KV k="ID">
                      <span className="font-mono text-xs">{detail.deal.id}</span>
                    </KV>
                    {detail.deal.outcomeReason && <KV k="Итог / причина">{detail.deal.outcomeReason}</KV>}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Тема не привязана к сделке.</div>
                )}
                {detail.deal && (
                  <DealStateDebug
                    state={detail.dealState}
                    risks={detail.dealRisks}
                    busy={busy === "refreshDealState:"}
                    disabled={busy !== null}
                    onRefresh={() => void act("refreshDealState")}
                  />
                )}
                {detail.dealCards.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted-foreground">Карточки сделки ({detail.dealCards.length})</div>
                    {detail.dealCards.map((c) => (
                      <DealCardView key={c.id} c={c} />
                    ))}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">Решения по сигналам ({detail.dealDecisions.length})</div>
                {detail.dealDecisions.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Решений пока нет.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {detail.dealDecisions.map((d) => (
                      <DealDecisionView key={d.id} d={d} />
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-1">
                <h3 className="font-medium">Сообщения ({detail.items.length})</h3>
                <p className="text-xs text-muted-foreground">
                  Текст сообщения открывается, только если эта организация активна у вас в сессии.
                </p>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Канал</TableHead>
                        <TableHead>Тема / от кого</TableHead>
                        <TableHead>Роль</TableHead>
                        <TableHead>Балл</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map((i) => (
                        <TableRow key={`${i.sourceItemId}:${i.subjectIndex}`}>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDate(i.date)}</TableCell>
                          <TableCell className="text-xs">
                            <div>{i.provider ?? "—"}</div>
                            <div className="text-muted-foreground">{i.externalType}</div>
                          </TableCell>
                          <TableCell className="max-w-xs text-xs">
                            <div className="truncate font-medium">{i.subject || "(без темы)"}</div>
                            <div className="truncate text-muted-foreground">{i.from ?? "—"}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{i.sourceItemId}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {TOPIC_ITEM_ROLE_LABELS_RU[i.role as keyof typeof TOPIC_ITEM_ROLE_LABELS_RU] ?? i.role}
                            {i.subjectIndex >= 0 && <div className="text-muted-foreground">предмет #{i.subjectIndex}</div>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {i.signalBand ? <BandBadge band={i.signalBand} score={i.signalScore ?? 0} /> : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-0.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title="Показать сообщение"
                                aria-label="Показать сообщение"
                                onClick={() => setMdItem({ id: i.sourceItemId, title: i.subject || i.sourceItemId })}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title="Отвязать сообщение"
                                aria-label="Отвязать сообщение"
                                disabled={busy !== null || t.status === "merged"}
                                onClick={() => void act("detachItem", { sourceItemId: i.sourceItemId })}
                              >
                                {busy === `detachItem:${i.sourceItemId}` ? (
                                  <Loader className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Unlink className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title="Разобрать заново (отвязать и снова найти тему)"
                                aria-label="Разобрать заново"
                                disabled={busy !== null}
                                onClick={() => void act("resolveItem", { sourceItemId: i.sourceItemId })}
                              >
                                {busy === `resolveItem:${i.sourceItemId}` ? (
                                  <Loader className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="flex flex-col gap-1">
                <h3 className="font-medium">Сигналы ({detail.instances.length})</h3>
                {detail.instances.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Нет сигналов.</div>
                ) : (
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
                        {detail.instances.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="align-top">
                              <div className="font-mono text-xs">{i.code}</div>
                              {i.labelRu && <div className="text-xs text-muted-foreground">{i.labelRu}</div>}
                              <div className="font-mono text-[10px] text-muted-foreground">{i.sourceItemId ?? "без сообщения"}</div>
                              {(i.origin !== "communication" || i.processKey) && (
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {i.origin}
                                  {i.processKey ? ` · ${i.processKey}` : ""}
                                  {i.conditionKey ? ` · ${i.conditionKey}` : ""}
                                </div>
                              )}
                              {i.clearedAt && (
                                <div className="text-[10px] text-amber-600">
                                  условие снято{i.clearedReason ? `: ${i.clearedReason}` : ""}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="max-w-md whitespace-normal align-top text-xs italic">«{i.evidence}»</TableCell>
                            <TableCell className="align-top text-xs">{CONFIDENCE_LABEL[i.confidence] ?? i.confidence}</TableCell>
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
              </section>

              <section className="flex flex-col gap-1">
                <h3 className="font-medium">Журнал ({detail.events.length})</h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.events.map((e) => (
                    <li key={e.id} className="rounded-md border p-2">
                      <span className="text-muted-foreground">{fmtDate(e.createdAt)}</span>{" "}
                      <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>{" "}
                      <span className="text-muted-foreground">
                        · {e.actor === "user" ? `пользователь ${e.userName ?? ""}` : `агент${e.userName ? ` (${e.userName})` : ""}`}
                      </span>
                      {e.sourceItemId && <span className="font-mono text-[10px] text-muted-foreground"> · {e.sourceItemId}</span>}
                      {Object.keys(e.payload ?? {}).length > 0 && (
                        <div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                          {JSON.stringify(e.payload)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ParsedMarkdownDialog
        itemId={mdItem?.id ?? null}
        title={mdItem?.title ?? ""}
        open={!!mdItem}
        onOpenChange={(o) => !o && setMdItem(null)}
        markdownUrl={(id) => `/api/admin/topics/topics?${new URLSearchParams({ organizationId: orgId, markdownItemId: id })}`}
      />
    </>
  )
}

// Phase 5a: «Текущее состояние» + risks of the topic's deal (debug view).
function DealStateDebug({
  state,
  risks,
  busy,
  disabled,
  onRefresh,
}: {
  state: DealStateView | null
  risks: DealRiskView[]
  busy: boolean
  disabled: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div className="font-medium">Текущее состояние</div>
        {state?.pending && <Badge variant="outline">ждёт обновления</Badge>}
        <Button size="sm" variant="outline" className="ml-auto" disabled={disabled} onClick={onRefresh}>
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить состояние
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        «Обновить состояние» пересчитывает риски сделки и вызывает «deals.state_summary» один раз (ИИ), в любом режиме организации.
      </p>
      {state?.text ? (
        <div>
          <div>{state.text}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(state.updatedAt)}
            {state.sourceItemIds.length > 0 && <> · источники: {state.sourceItemIds.join(", ")}</>}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Текста ещё нет.</div>
      )}
      {state && state.versions.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-muted-foreground">Версии (последние {state.versions.length})</div>
          {state.versions.map((v) => (
            <div key={v.id} className="rounded border px-2 py-1 text-xs">
              <span className="font-medium">{DEAL_STATE_DECISION_LABELS_RU[v.decision] ?? v.decision}</span>
              <span className="text-muted-foreground">
                {" "}
                · {fmtDate(v.createdAt)} · {v.actor === "user" ? "пользователь" : "агент"}
                {v.actorName ? ` (${v.actorName})` : ""}
                {v.model ? ` · ${v.model}` : ""}
              </span>
              {v.text && <div>{v.text}</div>}
              {v.reason && <div className="text-muted-foreground">Причина: {v.reason}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground">Риски ({risks.length})</div>
      {risks.length === 0 ? (
        <div className="text-xs text-muted-foreground">Рисков нет.</div>
      ) : (
        risks.map((r) => (
          <div key={r.id} className="rounded border px-2 py-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={r.status === "active" ? "destructive" : "secondary"}>
                {r.status === "active" ? "активен" : "снят"}
              </Badge>
              <span className="font-medium">{r.labelRu}</span>
              <span className="font-mono text-muted-foreground">{r.riskType}</span>
              <span className="text-muted-foreground">
                важность {r.severity} · повторов {r.occurrences} · с {fmtDate(r.detectedAt)}
              </span>
            </div>
            <div>
              {r.explanationRu}
              {!r.explanationFromAgent && <span className="text-muted-foreground"> (типовой текст)</span>}
            </div>
            {r.triggers.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {r.triggers.map((x) => (
                  <li key={x.instanceId}>
                    <span className="font-mono">{x.code}</span>: «{x.evidence}»
                  </li>
                ))}
              </ul>
            )}
            {r.status === "cleared" && (
              <div className="text-muted-foreground">
                Снят {fmtDate(r.clearedAt)}
                {r.clearedBy ? ` · ${DEAL_RISK_CLEARED_BY_LABELS_RU[r.clearedBy]}` : ""}
                {r.clearedByUserName ? ` (${r.clearedByUserName})` : ""}
                {r.clearedReason ? ` — ${r.clearedReason}` : ""}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

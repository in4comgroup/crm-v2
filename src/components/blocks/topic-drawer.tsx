"use client"

// Topic detail drawer (topics plan phase 6, spec topics/01 §14): title,
// company / contact / deal links, status + sub-state, list + «Почему в этом
// списке», the card with its actions, deal cards, signals with evidence
// quotes, the timeline (messages + journal) and the drawer actions:
// Принять → задача, Отклонить, Готово, Отложить до…, Объединить с…,
// Отвязать сообщение, Привязать к сделке, «Ответственный», «Не относится»,
// «Заказы» (phase 10: linked orders, «Привязать заказ», «Отвязать»).
// Self-contained: loads `GET /api/topics?id=` and acts through
// `POST /api/topics` / `PUT /api/cards`; `onChanged` lets the caller refresh
// its own list. Used by the dashboard and by the company / contact / deal
// «Темы» tabs.

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Building2, FileText, GitMerge, Handshake, Link2Off, Loader, ShoppingCart, Unlink, User, UserPlus, Users, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { SourceMessageDialog } from "@/components/blocks/source-message-dialog"
import { TelegramLinkContactDialog } from "@/components/blocks/telegram-link-contact-dialog"
import {
  DealCardBlock,
  ListExplanation,
  TopicCardActions,
  TopicCardText,
  formatDateTimeRu,
  topicAction,
} from "@/components/blocks/topic-card"
import { cn } from "@/lib/utils"
import { CARD_STATUS_LABELS_RU, isCardStatus } from "@/lib/topics/cards"
import { formatOrderAmount, formatOrderDate, ORDER_STATUS_LABEL } from "@/lib/orders-format"
import type { OrderStatus } from "@/db/schema"
import { TOPIC_ITEM_ROLE_LABELS_RU, TOPIC_SUB_STATE_LABELS_RU, type TopicItemRole, type TopicSubState } from "@/lib/topics/types"
import {
  SOURCE_CHANNEL_LABELS_RU,
  CYCLE_MARKER_LABELS_RU,
  topicStatusRu,
  type TopicDealOption,
  type TopicDetailView,
  type TopicItemView,
  type TopicMergeOption,
  type TopicOrderOption,
  type TopicOwnerOption,
} from "@/lib/topics/topic-ui"

export type TopicDrawerProps = {
  topicId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after every action that changed the topic (refresh the caller's list). */
  onChanged?: () => void
}

const CHANNEL_LABEL = SOURCE_CHANNEL_LABELS_RU

const DIRECTION_LABEL: Record<string, string> = { inbound: "входящее", outbound: "исходящее", internal: "внутреннее" }
const CONFIDENCE_LABEL: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" }
const NONE = "__none__"

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function useOptions<T>(url: string | null): T[] | null {
  const [state, setState] = useState<{ url: string; options: T[] } | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setState({ url, options: (d.options ?? []) as T[] })
      })
      .catch(() => {
        if (!cancelled) setState({ url, options: [] })
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return url && state?.url === url ? state.options : null
}

/** Pick-and-confirm dialog (merge / deal link). */
function PickDialog({
  open,
  onOpenChange,
  title,
  description,
  options,
  empty,
  confirm,
  onConfirm,
  pending,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  options: { id: string; label: string }[] | null
  empty: string
  confirm: string
  onConfirm: (id: string) => void
  pending: boolean
}) {
  const [value, setValue] = useState("")
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setValue("")
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {options === null ? (
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Выберите" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Отмена
          </Button>
          <Button onClick={() => onConfirm(value)} disabled={pending || !value}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TopicDrawer({ topicId, open, onOpenChange, onChanged }: TopicDrawerProps) {
  const [topic, setTopic] = useState<TopicDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [mergeOpen, setMergeOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissReason, setDismissReason] = useState("")
  const [sourceItem, setSourceItem] = useState<TopicItemView | null>(null)
  // «Связать с контактом» of a Telegram message (docs/specs/telegram/04 §6.2).
  const [linkItemId, setLinkItemId] = useState<string | null>(null)
  const [ownersWanted, setOwnersWanted] = useState(false)

  const load = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/topics?id=${encodeURIComponent(id)}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Не удалось загрузить тему")
        setTopic(null)
      } else {
        setError(null)
        setTopic(d.topic as TopicDetailView)
      }
    } catch {
      setError("Не удалось загрузить тему")
    } finally {
      setLoadedId(id)
    }
  }, [])

  useEffect(() => {
    if (open && topicId) void load(topicId)
  }, [open, topicId, load])

  const reload = useCallback(() => {
    if (topicId) void load(topicId)
    onChanged?.()
  }, [topicId, load, onChanged])

  const mergeOptions = useOptions<TopicMergeOption>(mergeOpen && topicId ? `/api/topics?options=merge&id=${topicId}` : null)
  const dealOptions = useOptions<TopicDealOption>(dealOpen && topicId ? `/api/topics?options=deals&id=${topicId}` : null)
  const orderOptions = useOptions<TopicOrderOption>(orderOpen && topicId ? `/api/topics?options=orders&id=${topicId}` : null)
  const owners = useOptions<TopicOwnerOption>(open && ownersWanted ? "/api/topics?options=owners" : null)

  const act = (body: Record<string, unknown>, ok: string, after?: (r: Record<string, unknown>) => void) =>
    start(async () => {
      if (!topicId) return
      try {
        const r = await topicAction({ topicId, ...body })
        toast.success(ok)
        after?.(r)
        if (r.deleted) {
          onChanged?.()
          onOpenChange(false)
          return
        }
        reload()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие")
      }
    })

  const loading = open && !!topicId && loadedId !== topicId
  const t = topic && topic.topicId === topicId ? topic : null
  const live = t ? t.status === "open" || t.status === "dormant" : false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader className="p-4 pb-3 border-b shrink-0 pr-12">
          <SheetTitle className="leading-snug">{t?.title ?? (loading ? "Загрузка…" : "Тема")}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {t?.clientName && (
                <Link href={`/clients?openClient=${t.clientId}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  {t.clientName}
                </Link>
              )}
              {t?.contactName && (
                <Link href={`/contacts?openContact=${t.contactId}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <User className="h-3.5 w-3.5" />
                  {t.contactName}
                </Link>
              )}
              {t?.deal && (
                <Link href={`/deals?openDeal=${t.deal.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Handshake className="h-3.5 w-3.5" />
                  {t.deal.name}
                  {t.deal.stageLabel ? ` · ${t.deal.stageLabel}` : ""}
                </Link>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          {loading && !t ? (
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : t ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{topicStatusRu(t.status)}</Badge>
                {t.status === "open" && t.subState !== "none" && (
                  <Badge variant="outline" className="font-normal">
                    {TOPIC_SUB_STATE_LABELS_RU[t.subState as TopicSubState] ?? t.subState}
                  </Badge>
                )}
                {t.marker && (
                  <Badge variant="secondary" className="bg-blue-500/15 text-blue-700 dark:text-blue-300">
                    {CYCLE_MARKER_LABELS_RU[t.marker]}
                  </Badge>
                )}
                {t.snoozedUntil && (
                  <Badge variant="outline" className="font-normal">
                    Отложено до {formatDateTimeRu(t.snoozedUntil)}
                  </Badge>
                )}
                {t.attention?.deadline && (
                  <Badge variant="outline" className={cn("font-normal", t.attention.overdue && "text-red-600 dark:text-red-400")}>
                    {t.attention.overdue ? "Просрочено: " : "Срок: "}
                    {formatDateTimeRu(t.attention.deadline)}
                  </Badge>
                )}
                <ListExplanation entry={t} />
              </div>
              {t.closedReason && !live && (
                <p className="text-xs text-muted-foreground">
                  Закрыта {formatDateTimeRu(t.closedAt)}.
                  {t.status === "done" && " «Готово» — отметка человека, не подтверждение решения вопроса."}
                </p>
              )}

              {t.attention && t.attention.explanation.length > 0 && (
                <Section title="Почему в этом списке">
                  <ul className="text-sm space-y-0.5 list-disc pl-5">
                    {t.attention.explanation.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Карточка">
                <div className="rounded-lg border p-3 space-y-3">
                  <TopicCardText card={t.card} title={t.title} />
                  {t.card && t.card.status !== "open" && (
                    <p className="text-xs text-muted-foreground">
                      Статус карточки: {t.card.status && isCardStatus(t.card.status) ? CARD_STATUS_LABELS_RU[t.card.status] : t.card.status}
                    </p>
                  )}
                  <TopicCardActions entry={t} onChanged={reload} />
                </div>
              </Section>

              {t.allDealCards.length > 0 && (
                <Section title="Сделка: решения">
                  <div className="space-y-2">
                    {t.allDealCards.slice(0, 5).map((c) => (
                      <DealCardBlock key={c.id} card={c} topicId={t.topicId} onChanged={reload} />
                    ))}
                  </div>
                </Section>
              )}

              <Section title={`Заказы (${t.orders.length})`}>
                {t.orders.length > 0 && (
                  <ul className="space-y-1.5">
                    {t.orders.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border p-2 text-sm">
                        <Link href={`/products?openOrder=${o.id}`} className="font-medium hover:underline">
                          Заказ {o.label}
                        </Link>
                        <Badge variant="outline" className="font-normal text-xs">
                          {ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatOrderAmount(o.total, o.currency)} · {formatOrderDate(o.orderDate)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 px-2"
                          disabled={pending}
                          onClick={() => act({ action: "unlink_order", orderId: o.id }, "Заказ отвязан от темы")}
                        >
                          <Unlink className="h-3.5 w-3.5 mr-1" />
                          Отвязать
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" variant="outline" disabled={!t.clientId || t.status === "merged" || pending} onClick={() => setOrderOpen(true)}>
                  <ShoppingCart className="h-4 w-4 mr-1" />
                  Привязать заказ
                </Button>
              </Section>

              <Section title="Действия с темой">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!live || pending} onClick={() => setMergeOpen(true)}>
                    <GitMerge className="h-4 w-4 mr-1" />
                    Объединить с…
                  </Button>
                  <Button size="sm" variant="outline" disabled={!t.clientId || t.status === "merged" || pending} onClick={() => setDealOpen(true)}>
                    <Handshake className="h-4 w-4 mr-1" />
                    {t.dealId ? "Другая сделка…" : "Привязать к сделке"}
                  </Button>
                  {t.dealId && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act({ action: "link_deal", dealId: null }, "Тема отвязана от сделки")}>
                      <Link2Off className="h-4 w-4 mr-1" />
                      Отвязать от сделки
                    </Button>
                  )}
                  {t.status !== "dismissed" && t.status !== "merged" && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDismissOpen(true)}>
                      <XCircle className="h-4 w-4 mr-1" />
                      Не относится
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Ответственный</span>
                  <Select
                    value={t.ownerUserId ?? NONE}
                    onOpenChange={(o) => o && setOwnersWanted(true)}
                    onValueChange={(v) =>
                      act({ action: "set_owner", userId: v === NONE ? null : v }, v === NONE ? "Ответственный снят" : "Ответственный назначен")
                    }
                    disabled={pending}
                  >
                    <SelectTrigger size="sm" className="w-fit min-w-48">
                      <SelectValue placeholder="Не назначен">{t.ownerName ?? (t.ownerUserId ? "…" : "Не назначен")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Не назначен</SelectItem>
                      {(owners ?? []).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name || o.email}
                        </SelectItem>
                      ))}
                      {t.ownerUserId && !owners && <SelectItem value={t.ownerUserId}>{t.ownerName ?? "…"}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </Section>

              <Section title={`Сигналы (${t.signals.length})`}>
                {t.signals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет сигналов.</p>
                ) : (
                  <ul className="space-y-2">
                    {t.signals.map((s) => (
                      <li key={s.id} className={cn("rounded-md border p-2 text-sm", (!s.counted || s.clearedAt) && "opacity-70")}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.labelRu ?? s.code}</span>
                          <span className="text-xs text-muted-foreground">
                            уверенность {CONFIDENCE_LABEL[s.confidence] ?? s.confidence} · {formatDateTimeRu(s.createdAt)}
                          </span>
                          {s.origin === "system_of_record" && (
                            <Badge variant="secondary" className="font-normal text-xs">
                              Данные CRM
                            </Badge>
                          )}
                          {s.origin === "communication" && s.processKey?.startsWith("check.") && (
                            <Badge variant="secondary" className="font-normal text-xs">
                              Сторож
                            </Badge>
                          )}
                          {!s.counted && !s.clearedAt && (
                            <Badge variant="outline" className="font-normal text-xs">
                              не учитывается
                            </Badge>
                          )}
                        </div>
                        {s.clearedAt && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Условие снято{s.clearedReason ? `: ${s.clearedReason}` : ""}
                          </p>
                        )}
                        {s.evidence && <p className="mt-1 italic text-muted-foreground">«{s.evidence}»</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Tabs defaultValue="items">
                <TabsList>
                  <TabsTrigger value="items">Сообщения ({t.items.length})</TabsTrigger>
                  <TabsTrigger value="events">Журнал ({t.events.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="items" className="pt-2">
                  {t.items.length === 0 && (
                    <p className="text-sm text-muted-foreground">Тема создана проверкой данных CRM.</p>
                  )}
                  <ul className="space-y-2">
                    {t.items.map((i) => (
                      <li key={`${i.sourceItemId}:${i.subjectIndex}`} className="rounded-md border p-2 text-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{formatDateTimeRu(i.date)}</span>
                          <span>· {CHANNEL_LABEL[i.provider ?? ""] ?? i.provider ?? "Источник"}</span>
                          {i.direction && <span>· {DIRECTION_LABEL[i.direction] ?? i.direction}</span>}
                          <Badge variant="outline" className="font-normal text-xs">
                            {TOPIC_ITEM_ROLE_LABELS_RU[i.role as TopicItemRole] ?? i.role}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate">{i.subject || i.from || "Сообщение"}</p>
                        {i.subject && i.from && <p className="text-xs text-muted-foreground truncate">{i.from}</p>}
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSourceItem(i)}>
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Открыть
                          </Button>
                          {i.provider === "telegram" && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setLinkItemId(i.sourceItemId)}>
                              <UserPlus className="h-3.5 w-3.5 mr-1" />
                              Связать с контактом
                            </Button>
                          )}
                          {t.status !== "merged" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              disabled={pending}
                              onClick={() => act({ action: "detach", sourceItemId: i.sourceItemId }, "Сообщение отвязано")}
                            >
                              <Unlink className="h-3.5 w-3.5 mr-1" />
                              Отвязать
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </TabsContent>
                <TabsContent value="events" className="pt-2">
                  <ul className="space-y-1.5">
                    {t.events.map((e) => (
                      <li key={e.id} className="text-sm flex gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap pt-0.5 w-28 shrink-0">
                          {formatDateTimeRu(e.createdAt)}
                        </span>
                        <span>
                          {e.text}
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            — {e.actor === "user" ? (e.userName ?? "пользователь") : "система"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>

        <PickDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          title="Объединить с другой темой"
          description="Выбранная тема станет частью этой: её сообщения и сигналы перейдут сюда."
          options={mergeOptions?.map((o) => ({ id: o.id, label: `${o.title} · ${formatDateTimeRu(o.lastActivityAt)}` })) ?? null}
          empty="Нет других открытых тем этой компании."
          confirm="Объединить"
          pending={pending}
          onConfirm={(id) => act({ action: "merge", otherTopicId: id }, "Темы объединены", () => setMergeOpen(false))}
        />
        <PickDialog
          open={dealOpen}
          onOpenChange={setDealOpen}
          title="Привязать к сделке"
          description="Открытые сделки компании этой темы."
          options={
            dealOptions
              ?.filter((o) => o.id !== t?.dealId)
              .map((o) => ({ id: o.id, label: `${o.name}${o.stageLabel ? ` · ${o.stageLabel}` : ""}${o.status === "paused" ? " · пауза" : ""}` })) ?? null
          }
          empty="У компании нет открытых сделок."
          confirm="Привязать"
          pending={pending}
          onConfirm={(id) => act({ action: "link_deal", dealId: id }, "Тема привязана к сделке", () => setDealOpen(false))}
        />
        <PickDialog
          open={orderOpen}
          onOpenChange={setOrderOpen}
          title="Привязать заказ"
          description="Заказы компании этой темы. Подтверждённый заказ закрывает запрос заказа в теме."
          options={
            orderOptions?.map((o) => ({
              id: o.id,
              label: `${o.label} · ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status} · ${formatOrderAmount(o.total, o.currency)} · ${formatOrderDate(o.orderDate)}${o.otherTopicTitle ? ` · в теме «${o.otherTopicTitle}»` : ""}`,
            })) ?? null
          }
          empty="У компании нет других заказов."
          confirm="Привязать"
          pending={pending}
          onConfirm={(id) => act({ action: "link_order", orderId: id }, "Заказ привязан к теме", () => setOrderOpen(false))}
        />
        <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Тема не относится к работе</DialogTitle>
              <DialogDescription>Тема закроется и пропадёт из списков. Комментарий — по желанию.</DialogDescription>
            </DialogHeader>
            <Textarea value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} rows={3} placeholder="Комментарий" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDismissOpen(false)} disabled={pending}>
                Отмена
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  act({ action: "dismiss", reason: dismissReason }, "Тема закрыта", () => {
                    setDismissOpen(false)
                    setDismissReason("")
                  })
                }
              >
                Закрыть тему
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <TelegramLinkContactDialog
          itemId={linkItemId}
          open={!!linkItemId}
          onOpenChange={(o) => {
            if (!o) setLinkItemId(null)
          }}
          onLinked={reload}
        />
        <SourceMessageDialog
          itemId={sourceItem?.sourceItemId ?? null}
          open={!!sourceItem}
          onOpenChange={(o) => {
            if (!o) setSourceItem(null)
          }}
          title={sourceItem?.subject ?? "Сообщение"}
          channel={sourceItem ? (CHANNEL_LABEL[sourceItem.provider ?? ""] ?? sourceItem.provider) : null}
          from={sourceItem?.from ?? null}
          to={null}
          date={sourceItem ? formatDateTimeRu(sourceItem.date) : null}
        />
      </SheetContent>
    </Sheet>
  )
}

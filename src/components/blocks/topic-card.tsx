"use client"

// Topic card of the topics UI (topics plan phase 6, spec topics/01 §9.1,
// §14): the card text of a topic (headline, «Почему сейчас», «Что
// изменилось», ≤ 3 steps), its meta (company, deadline, marker, list
// explanation) and the actions of its kind. Used by the dashboard lists
// (topic-lists-section.tsx) and the topic drawer (topic-drawer.tsx).
// Card decisions go through the existing `PUT /api/cards` (accept → task,
// reject with a reason code, deal_execute); topic actions through
// `POST /api/topics`. Every action ends with `onChanged()`.

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlarmClock,
  Building2,
  CalendarClock,
  CheckCheck,
  Handshake,
  Info,
  ListTodo,
  ShoppingCart,
  User,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import TaskEditDialog from "@/components/forms/form-task-edit"
import { CardRejectReasonSelect } from "@/components/blocks/card-reject-reason-select"
import {
  CARD_REJECT_DIALOG_TITLE_RU,
  DealLinkChooser,
  dealExecuteToast,
  defaultRejectReason,
} from "@/components/blocks/deal-link-chooser"
import { NewOrderDialog } from "@/components/blocks/order-request-wizard"
import {
  GO_LABEL,
  NO_GO_DIALOG_DESCRIPTION,
  NO_GO_DIALOG_TITLE,
  NO_GO_LABEL,
  dealCardGate,
} from "@/components/blocks/deal-funnel-ui"
import { cn } from "@/lib/utils"
import type { TaskPriority, TaskStatus } from "@/db/schema"
import { suggestTaskType } from "@/lib/tasks/suggest-task-type"
import { TOPIC_LIST_LABELS_RU } from "@/lib/topics/attention-types"
import {
  closesTopicOnReject,
  CARD_KIND_LABELS_RU,
  CARD_STATUS_LABELS_RU,
  DEAL_CARD_ACCEPT_LABEL_RU,
  DEAL_CARD_REJECT_LABEL_RU,
  isCardStatus,
} from "@/lib/topics/cards"
import { TOPIC_SUB_STATE_LABELS_RU, type TopicSubState } from "@/lib/topics/types"
import {
  CYCLE_MARKER_LABELS_RU,
  topicStatusRu,
  type TopicCardView,
  type TopicEntry,
} from "@/lib/topics/topic-ui"

// ── API helpers ───────────────────────────────────────────────────────────

async function postJson(url: string, method: "POST" | "PUT", body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Не удалось выполнить действие")
  return data
}

/** POST /api/topics action (Russian error in the thrown message). */
export function topicAction(body: Record<string, unknown>) {
  return postJson("/api/topics", "POST", body)
}

/** Recompute the topic's attention after a card decision (best effort). */
async function recompute(topicId: string) {
  try {
    await topicAction({ action: "recompute", topicId })
  } catch {
    // The hourly run recomputes anyway.
  }
}

// ── Formatting ────────────────────────────────────────────────────────────

export function formatDateTimeRu(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return d.toLocaleString("ru-RU", dateOnly ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

const CLASS_TONE: Record<string, string> = {
  risk: "bg-red-500/15 text-red-700 dark:text-red-300",
  chance: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  fyi: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
}
const CLASS_LABEL: Record<string, string> = { risk: "Риск", chance: "Возможность", fyi: "Информация" }

const ACCEPT_TONE =
  "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25"

function cardStatusLabel(s: string | null): string | null {
  return s && isCardStatus(s) ? CARD_STATUS_LABELS_RU[s] : s
}

function isoDay(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── «Почему в этом списке» ────────────────────────────────────────────────

export function ListExplanation({ entry }: { entry: Pick<TopicEntry, "attention"> }) {
  const a = entry.attention
  if (!a) return null
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-help"
        >
          <Info className="h-3.5 w-3.5" />
          {TOPIC_LIST_LABELS_RU[a.list]}
          {a.profile ? ` · ${a.profile}` : ""}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          Почему в этом списке
        </div>
        {a.explanation.length ? (
          <ul className="space-y-0.5 text-sm">
            {a.explanation.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Нет объяснения.</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

// ── Card text ─────────────────────────────────────────────────────────────

export function TopicCardText({ card, title }: { card: TopicCardView | null; title: string }) {
  if (!card) {
    return <p className="text-sm text-muted-foreground italic">Карточки пока нет — тема в работе у системы.</p>
  }
  return (
    <div className="space-y-2 text-sm">
      {card.headline && card.headline !== title && <p className="font-medium leading-snug">{card.headline}</p>}
      {card.whyNow && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Почему сейчас</div>
          <p className="leading-relaxed">{card.whyNow}</p>
        </div>
      )}
      {card.whatChanged && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Что изменилось</div>
          <p className="leading-relaxed">{card.whatChanged}</p>
        </div>
      )}
      {card.steps.length > 0 && (
        <div className="rounded-md border border-blue-500/25 bg-blue-500/10 p-2 dark:border-blue-400/25 dark:bg-blue-400/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-0.5">
            Шаги
          </div>
          <ol className="list-decimal pl-5 space-y-0.5">
            {card.steps.slice(0, 3).map((s, i) => (
              <li key={i}>{s.replace(/^\d+[.)]\s*/, "")}</li>
            ))}
          </ol>
        </div>
      )}
      {card.rejectionReason && card.status === "rejected" && (
        <p className="text-xs text-muted-foreground">Причина отклонения: {card.rejectionReason}</p>
      )}
    </div>
  )
}

// ── Reject dialog ─────────────────────────────────────────────────────────

function RejectDialog({
  card,
  open,
  onOpenChange,
  onDone,
}: {
  card: TopicCardView
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  // Go / no-go proposal (custom funnel §3.2): the org no-go list, required.
  const { gate, noGoReasons } = dealCardGate(card)
  const initialCode = gate ? "" : defaultRejectReason(card.kind)
  const [code, setCode] = useState<string>(initialCode)
  const [text, setText] = useState("")
  const [pending, start] = useTransition()
  const submit = () =>
    start(async () => {
      try {
        await postJson("/api/cards", "PUT", { id: card.id, action: "reject", rejectReasonCode: code, rejectionReason: text.trim() })
        toast.success(closesTopicOnReject(code) ? "Карточка отклонена, тема закрыта" : "Карточка отклонена")
        onOpenChange(false)
        setCode(initialCode)
        setText("")
        onDone()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отклонить карточку")
      }
    })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gate ? NO_GO_DIALOG_TITLE : CARD_REJECT_DIALOG_TITLE_RU[card.kind]}</DialogTitle>
          <DialogDescription>
            {gate ? NO_GO_DIALOG_DESCRIPTION : "Выберите причину. Комментарий — по желанию. Причины помогают настроить систему."}
          </DialogDescription>
        </DialogHeader>
        <CardRejectReasonSelect
          value={code}
          onChange={setCode}
          disabled={pending}
          kind={card.kind}
          noGoReasons={gate ? noGoReasons : undefined}
        />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий (необязательно)" rows={3} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={pending || !code}>
            {gate ? NO_GO_LABEL : "Отклонить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Snooze ────────────────────────────────────────────────────────────────

export function SnoozeButton({
  topicId,
  snoozedUntil,
  onDone,
  disabled,
}: {
  topicId: string
  snoozedUntil: string | null
  onDone: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(isoDay(1))
  const [pending, start] = useTransition()
  const run = (body: Record<string, unknown>, ok: string) =>
    start(async () => {
      try {
        await topicAction({ topicId, ...body })
        toast.success(ok)
        setOpen(false)
        onDone()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие")
      }
    })
  if (snoozedUntil) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => run({ action: "unsnooze" }, "Откладывание снято")}
      >
        <AlarmClock className="h-4 w-4 mr-1" />
        Вернуть
      </Button>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled || pending}>
          <AlarmClock className="h-4 w-4 mr-1" />
          Отложить до…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2">
        <div className="text-sm font-medium">Отложить до</div>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDay(isoDay(1))}>
            Завтра
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDay(isoDay(7))}>
            Через неделю
          </Button>
        </div>
        <Input type="date" value={day} min={isoDay(1)} onChange={(e) => setDay(e.target.value)} className="h-8" />
        <p className="text-xs text-muted-foreground">
          Тема вернётся в начале рабочего дня. Новое важное сообщение вернёт её раньше.
        </p>
        <Button size="sm" className="w-full" disabled={!day || pending} onClick={() => run({ action: "snooze", until: day }, "Тема отложена")}>
          Отложить
        </Button>
      </PopoverContent>
    </Popover>
  )
}

// ── Actions ───────────────────────────────────────────────────────────────

type ActionEntry = Pick<
  TopicEntry,
  "topicId" | "title" | "status" | "clientId" | "taskContactId" | "dealId" | "family" | "snoozedUntil" | "card"
>

/**
 * Actions of a `topic` card + the topic itself: «Создать задачу» /
 * «Создать заказ» (ORDER_REQUESTED) / Отклонить while the card is open;
 * Готово and Отложить до… while the topic is live.
 */
export function TopicCardActions({
  entry,
  onChanged,
  className,
}: {
  entry: ActionEntry
  onChanged: () => void
  className?: string
}) {
  const router = useRouter()
  const card = entry.card
  const cardOpen = card?.kind === "topic" && card.status === "open"
  const live = entry.status === "open" || entry.status === "dormant"
  const [rejectOpen, setRejectOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [pending, start] = useTransition()

  // Prefill of «Создать задачу» (bug list 2026-11-21, item 24): company,
  // contact (topic's, else the newest one on its items), deal of the topic,
  // type from the card's meaning; «Исполнитель» defaults to the creator in
  // the form itself.
  const taskInitialValues = useMemo(
    () => ({
      name: card?.taskTitle?.trim() || card?.headline || entry.title,
      description: card ? card.steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, "")}`).join("\n") : "",
      type: suggestTaskType({
        taskTitle: card?.taskTitle,
        headline: card?.headline,
        steps: card?.steps,
        family: entry.family,
        category: card?.category,
      }),
      priority: (card?.priority === "high" ? "high" : "medium") as TaskPriority,
      status: "todo" as TaskStatus,
      ...(entry.clientId ? { clientId: entry.clientId } : {}),
      ...(entry.taskContactId ? { contactId: entry.taskContactId } : {}),
      ...(entry.dealId ? { dealId: entry.dealId } : {}),
    }),
    [card, entry.title, entry.clientId, entry.taskContactId, entry.dealId, entry.family],
  )

  const accept = (taskId?: string) =>
    start(async () => {
      if (!card) return
      try {
        await postJson("/api/cards", "PUT", { id: card.id, action: "accept", ...(taskId ? { resultTaskId: taskId } : {}) })
        await recompute(entry.topicId)
        // No success toast: the task form already said «Задача создана».
        onChanged()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось принять карточку")
      }
    })

  const done = () =>
    start(async () => {
      try {
        await topicAction({ action: "done", topicId: entry.topicId })
        toast.success("Тема отмечена «Готово»")
        onChanged()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось отметить тему")
      }
    })

  const isOrder = card?.category === "new_order"

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {cardOpen && card && (
        <>
          {isOrder && (
            <Button size="sm" variant="secondary" className={ACCEPT_TONE} disabled={pending} onClick={() => setOrderOpen(true)}>
              <ShoppingCart className="h-4 w-4 mr-1" />
              Создать заказ
            </Button>
          )}
          <TaskEditDialog
            mode="create"
            initialValues={taskInitialValues}
            onSuccess={accept}
            trigger={
              <Button size="sm" variant="secondary" className={isOrder ? undefined : ACCEPT_TONE} disabled={pending}>
                <ListTodo className="h-4 w-4 mr-1" />
                Создать задачу
              </Button>
            }
          />
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejectOpen(true)}>
            <X className="h-4 w-4 mr-1" />
            Отклонить
          </Button>
          <RejectDialog card={card} open={rejectOpen} onOpenChange={setRejectOpen} onDone={() => void recompute(entry.topicId).then(onChanged)} />
        </>
      )}
      {live && (
        <>
          <Button size="sm" variant="outline" disabled={pending} onClick={done}>
            <CheckCheck className="h-4 w-4 mr-1" />
            Готово
          </Button>
          <SnoozeButton topicId={entry.topicId} snoozedUntil={entry.snoozedUntil} onDone={onChanged} disabled={pending} />
        </>
      )}
      {card?.resultTaskId && (
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link href={`/tasks?openTask=${card.resultTaskId}`}>
            <ListTodo className="h-4 w-4 mr-1" />
            Задача
          </Link>
        </Button>
      )}
      {card?.resultOrderId && (
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link href={`/products?openOrder=${card.resultOrderId}`}>
            <ShoppingCart className="h-4 w-4 mr-1" />
            Заказ
          </Link>
        </Button>
      )}
      {isOrder && card && (
        <NewOrderDialog
          open={orderOpen}
          onOpenChange={setOrderOpen}
          onManual={() => {
            setOrderOpen(false)
            router.push(`/products?orderFromCard=${card.id}`)
          }}
          onAssemble={(requestId) => {
            setOrderOpen(false)
            router.push(`/products?assembleRequest=${requestId}&cardId=${card.id}`)
          }}
          initialClientId={entry.clientId}
          initialRawText={card.orderRequest ?? ""}
        />
      )}
    </div>
  )
}

/**
 * «Создать» / «Подтвердить» / deal chooser + «Связать» (deal_link) and
 * «Не сделка» / «Отклонить» / «Ни к одной» of an open deal card.
 */
export function DealCardActions({
  card,
  topicId,
  onChanged,
}: {
  card: TopicCardView
  topicId: string
  onChanged: () => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [pending, start] = useTransition()
  if (card.kind === "topic" || card.status !== "open") return null
  const kind = card.kind
  const { gate } = dealCardGate(card)
  const execute = (dealId?: string) =>
    start(async () => {
      try {
        const r = await postJson("/api/cards", "PUT", { id: card.id, action: "deal_execute", ...(dealId ? { dealId } : {}) })
        await recompute(topicId)
        toast.success(dealExecuteToast(kind, r.linked))
        onChanged()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие")
      }
    })
  return (
    <div className="flex flex-wrap gap-2">
      {kind === "deal_link" ? (
        <DealLinkChooser
          options={card.proposal?.dealOptions}
          pending={pending}
          onLink={execute}
          className="w-full"
          buttonClassName={ACCEPT_TONE}
        />
      ) : (
        <Button size="sm" variant="secondary" className={ACCEPT_TONE} disabled={pending} onClick={() => execute()}>
          <Handshake className="h-4 w-4 mr-1" />
          {gate ? GO_LABEL : DEAL_CARD_ACCEPT_LABEL_RU[kind]}
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejectOpen(true)}>
        <X className="h-4 w-4 mr-1" />
        {gate ? NO_GO_LABEL : DEAL_CARD_REJECT_LABEL_RU[kind]}
      </Button>
      <RejectDialog card={card} open={rejectOpen} onOpenChange={setRejectOpen} onDone={() => void recompute(topicId).then(onChanged)} />
    </div>
  )
}

/** Compact deal card («Новая возможность?» / «Подтвердить стадию» / «К какой сделке относится тема?»). */
export function DealCardBlock({
  card,
  topicId,
  topicTitle,
  onChanged,
  onOpenTopic,
}: {
  card: TopicCardView
  topicId: string
  topicTitle?: string
  onChanged: () => void
  onOpenTopic?: (topicId: string) => void
}) {
  const p = card.proposal
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {dealCardGate(card).gate ? "Новая возможность: go / no-go" : CARD_KIND_LABELS_RU[card.kind]}
          </div>
          <p className="font-medium leading-snug">{card.headline}</p>
        </div>
        {card.status !== "open" && <Badge variant="secondary">{cardStatusLabel(card.status)}</Badge>}
      </div>
      {topicTitle && onOpenTopic && (
        <button type="button" className="text-xs text-muted-foreground underline decoration-dashed underline-offset-4 hover:text-foreground" onClick={() => onOpenTopic(topicId)}>
          Тема: {topicTitle}
        </button>
      )}
      {p && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {p.reasonRu && <p>{p.reasonRu}</p>}
          {p.evidence && <p className="italic">«{p.evidence}»</p>}
          {(p.fromStageLabelRu || p.stageLabelRu) && (
            <p>
              Стадия: {p.fromStageLabelRu ? `${p.fromStageLabelRu} → ` : ""}
              {p.stageLabelRu ?? "—"}
            </p>
          )}
        </div>
      )}
      <DealCardActions card={card} topicId={topicId} onChanged={onChanged} />
    </div>
  )
}

// ── Entry card (dashboard) ────────────────────────────────────────────────

export function TopicEntryCard({
  entry,
  onChanged,
  onOpen,
}: {
  entry: TopicEntry
  onChanged: () => void
  onOpen: (topicId: string) => void
}) {
  const a = entry.attention
  const card = entry.card
  const deadline = formatDateTimeRu(a?.deadline ?? null)
  const closed = entry.status !== "open" && entry.status !== "dormant"
  const cardStatus = card && card.status !== "open" ? cardStatusLabel(card.status) : null
  return (
    <Card className={cn("flex flex-col gap-3 py-4 bg-card shadow-sm", closed && "bg-muted dark:bg-background")}>
      <CardHeader className="px-4 gap-1.5 grid-cols-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {entry.clientName ? (
              <Link
                href={`/clients?openClient=${entry.clientId}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Building2 className="h-3.5 w-3.5" />
                {entry.clientName}
              </Link>
            ) : entry.contactName ? (
              <Link
                href={`/contacts?openContact=${entry.contactId}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <User className="h-3.5 w-3.5" />
                {entry.contactName}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => onOpen(entry.topicId)}
              className="block text-left font-semibold leading-snug hover:underline underline-offset-4"
            >
              {card?.headline || entry.title}
            </button>
          </div>
          {entry.marker && (
            <Badge className="shrink-0 bg-blue-500/15 text-blue-700 dark:text-blue-300" variant="secondary">
              {CYCLE_MARKER_LABELS_RU[entry.marker]}
            </Badge>
          )}
          {entry.reminder && a?.list === "now" && (
            <Badge className="shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-300" variant="secondary">
              Напоминание {entry.reminder.count}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {a?.class && (
            <Badge variant="secondary" className={CLASS_TONE[a.class]}>
              {CLASS_LABEL[a.class] ?? a.class}
            </Badge>
          )}
          {closed && <Badge variant="secondary">{topicStatusRu(entry.status)}</Badge>}
          {entry.snapshot === "held" && (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              title="Тема была в снимке списка и ушла из него после снимка. Она видна здесь до следующего снимка."
            >
              Ушла из списка после снимка
            </Badge>
          )}
          {entry.status === "open" && entry.subState !== "none" && (
            <Badge variant="outline" className="font-normal">
              {TOPIC_SUB_STATE_LABELS_RU[entry.subState as TopicSubState] ?? entry.subState}
            </Badge>
          )}
          {cardStatus && <Badge variant="outline" className="font-normal">Карточка: {cardStatus}</Badge>}
          {entry.dealCards.length > 0 && (
            <Badge variant="outline" className="font-normal">
              <Handshake className="h-3 w-3 mr-1" />
              Решение по сделке
            </Badge>
          )}
          {a?.limited && (
            <Badge variant="outline" className="font-normal">
              Лимит дня «Сейчас»
            </Badge>
          )}
          {entry.snoozedUntil && (
            <Badge variant="outline" className="font-normal">
              Отложено до {formatDateTimeRu(entry.snoozedUntil)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 flex flex-col gap-3 flex-1">
        <TopicCardText card={card} title={card?.headline || entry.title} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {deadline && (
            <span className={cn("inline-flex items-center gap-1", a?.overdue && "text-red-600 dark:text-red-400")}>
              <CalendarClock className="h-3.5 w-3.5" />
              {a?.overdue ? "Просрочено: " : "Срок: "}
              {deadline}
            </span>
          )}
          {entry.dealName && (
            <Link href={`/deals?openDeal=${entry.dealId}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <Handshake className="h-3.5 w-3.5" />
              {entry.dealName}
            </Link>
          )}
          {entry.ownerName && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {entry.ownerName}
            </span>
          )}
          <ListExplanation entry={entry} />
        </div>
        <TopicCardActions entry={entry} onChanged={onChanged} className="mt-auto pt-1" />
      </CardContent>
    </Card>
  )
}

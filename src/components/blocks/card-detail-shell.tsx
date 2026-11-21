"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  Building2,
  Contact,
  FileText,
  Link2,
  ListTodo,
  Handshake,
  ShoppingCart,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import TaskEditDialog from "@/components/forms/form-task-edit"
import { cardTaskPrefill } from "@/lib/cards/task-prefill"
import type { CardRow } from "@/app/api/cards/route"
import { CardRejectReasonSelect } from "@/components/blocks/card-reject-reason-select"
import {
  GO_LABEL,
  NO_GO_DIALOG_DESCRIPTION,
  NO_GO_DIALOG_TITLE,
  NO_GO_LABEL,
  dealCardGate,
} from "@/components/blocks/deal-funnel-ui"
import {
  CARD_REJECT_DIALOG_TITLE_RU,
  DealLinkChooser,
  dealExecuteToast,
  defaultRejectReason,
} from "@/components/blocks/deal-link-chooser"
import {
  DEAL_CARD_ACCEPT_LABEL_RU,
  DEAL_CARD_REJECT_LABEL_RU,
  isDealCardKind,
} from "@/lib/topics/cards"
import type { CardCategory, CardPriority } from "@/db/schema"

const PRIORITY_LABEL: Record<CardPriority, string> = {
  normal: "Обычный",
  high: "Высокий",
}

const CATEGORY_LABEL: Record<CardCategory, string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Бизнес-информация",
  action_required: "Нужен ответ",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
  support: "Поддержка",
}

// Статус, не категория — см. то же решение в dashboard-card.tsx. Красный,
// как у старого бейджа category action_required, но теперь для любой
// нерешённой карточки.
const STATUS_PENDING_COLOR = "bg-red-500/15 text-red-600 dark:text-red-300"

const PRIORITY_COLOR: Record<CardPriority, string> = {
  normal: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
}

// Flat surface, matching dashboard-card.tsx / the Deals kanban card — see
// its comment for why the old full-card gradient wash was replaced. Priority
// lives only in the PRIORITY_COLOR badge below.
const CARD_SURFACE =
  "bg-card border-muted dark:bg-[#FDF0D5]/[0.045] dark:border-[#FDF0D5]/10"

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function CardDetailShell({ card }: { card: CardRow }) {
  const router = useRouter()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  // Topic cards (card.kind set) need a reason CODE; the text is optional.
  const isTopicCard = !!card.kind
  // Deal cards (topics phase 5) — see DashboardCard.
  const dealKind = isDealCardKind(card.kind) ? card.kind : null
  // Go / no-go proposal (custom funnel §3.2): «Go» / «No-go», no-go needs
  // one of the org reasons (sent as `nogo:<code>`).
  const { gate, noGoReasons } = dealCardGate(card)
  const initialRejectCode = gate ? "" : defaultRejectReason(card.kind)
  const [rejectCode, setRejectCode] = useState<string>(initialRejectCode)
  const rejectReady = isTopicCard ? !!rejectCode : !!rejectReason.trim()
  const [isPending, startTransition] = useTransition()

  const resolved = card.accepted || !!card.rejectionReason
  const analysis = card.message?.analysis ?? ""
  const recommendation = card.message?.recommendation ?? ""

  // «Создать задачу» prefill — the same helper as DashboardCard.
  const taskInitialValues = useMemo(
    () => cardTaskPrefill(card, CATEGORY_LABEL[card.category]),
    [card],
  )

  const handleAccept = (taskId?: string) => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            action: "accept",
            ...(taskId ? { resultTaskId: taskId } : {}),
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось принять карточку")
          return
        }
        // No success toast: the task form already said «Задача создана».
        router.refresh()
      } catch {
        toast.error("Не удалось принять карточку")
      }
    })
  }

  const handleDealExecute = (dealId?: string) => {
    if (!dealKind) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            action: "deal_execute",
            ...(dealId ? { dealId } : {}),
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(body.error || "Не удалось выполнить действие")
          return
        }
        toast.success(dealExecuteToast(dealKind, body.linked))
        router.refresh()
      } catch {
        toast.error("Не удалось выполнить действие")
      }
    })
  }

  const handleReject = () => {
    if (!rejectReady) {
      toast.error("Укажите причину отклонения")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            action: "reject",
            rejectionReason: rejectReason.trim(),
            ...(isTopicCard ? { rejectReasonCode: rejectCode } : {}),
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось отклонить карточку")
          return
        }
        toast.success("Карточка отклонена")
        setRejectOpen(false)
        setRejectReason("")
        setRejectCode(initialRejectCode)
        router.refresh()
      } catch {
        toast.error("Не удалось отклонить карточку")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к панели
        </Link>
        <div className="text-xs text-muted-foreground">
          Создано {formatDate(card.createdAt)}
        </div>
      </div>

      <Card className={cn("dark:border-gray-600", CARD_SURFACE)}>
        <CardHeader>
          <CardTitle className="text-2xl">
            {CATEGORY_LABEL[card.category]}
          </CardTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={PRIORITY_COLOR[card.priority]} variant="secondary">
              {PRIORITY_LABEL[card.priority]} приоритет
            </Badge>
            {/* Статус, не категория — та же логика, что в dashboard-card.tsx. */}
            {!resolved && (
              <Badge className={STATUS_PENDING_COLOR} variant="secondary">
                Требуется решение
              </Badge>
            )}
            {card.accepted && (
              <Badge
                variant="secondary"
                className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              >
                Принята
              </Badge>
            )}
            {card.rejectionReason && (
              <Badge
                variant="secondary"
                className="bg-red-500/15 text-red-700 dark:text-red-300"
              >
                Отклонена
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 text-sm">
          {analysis && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Анализ
              </h3>
              <p className="whitespace-pre-wrap leading-relaxed">{analysis}</p>
            </section>
          )}
          {recommendation && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Рекомендация
              </h3>
              <p className="whitespace-pre-wrap leading-relaxed">
                {recommendation}
              </p>
            </section>
          )}
          {!analysis && !recommendation && (
            <p className="text-muted-foreground italic">Нет содержимого.</p>
          )}

          {card.rejectionReason && (
            <section className="rounded-md border border-red-300/50 bg-red-500/5 p-3 text-sm">
              <h3 className="font-semibold text-red-700 dark:text-red-300 mb-1">
                Причина отклонения
              </h3>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {card.rejectionReason}
              </p>
            </section>
          )}

          {(card.clients.length > 0 ||
            card.contacts.length > 0 ||
            card.users.length > 0 ||
            card.ruleName ||
            card.sourceItemTitle) && (
            <section className="space-y-2 pt-2 border-t border-border/40 text-sm text-muted-foreground">
              {card.clients.length > 0 && (
                <div className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.clients.map((c) => (
                      <Badge key={c.id} variant="outline" className="font-normal">
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.contacts.length > 0 && (
                <div className="flex items-start gap-2">
                  <Contact className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.contacts.map((c) => (
                      <Badge key={c.id} variant="outline" className="font-normal">
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.users.length > 0 && (
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {card.users.map((u) => (
                      <Badge key={u.id} variant="outline" className="font-normal">
                        {u.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {card.ruleName && (
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>Правило: {card.ruleName}</span>
                </div>
              )}
              {card.sourceItemTitle && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span>Источник: {card.sourceItemTitle}</span>
                </div>
              )}
            </section>
          )}

          {!resolved && (
            // deal_link: the deal chooser takes its own full-width line
            // above «Ни к одной».
            <div
              className={cn(
                "flex gap-2 pt-3 border-t border-border/40",
                dealKind === "deal_link" && "flex-col",
              )}
            >
              {/* new_order cards swap «Создать задачу» for "Создать заказ" in the
                  same slot — same consolidation as dashboard-card.tsx: one
                  recommendation, one action, not a competing task button
                  next to a separate order button. */}
              {dealKind === "deal_link" ? (
                <DealLinkChooser
                  size="default"
                  options={card.proposal?.dealOptions}
                  pending={isPending}
                  onLink={handleDealExecute}
                />
              ) : dealKind ? (
                <Button disabled={isPending} className="flex-1" onClick={() => handleDealExecute()}>
                  <Handshake className="h-4 w-4 mr-1" />
                  {gate ? GO_LABEL : DEAL_CARD_ACCEPT_LABEL_RU[dealKind]}
                </Button>
              ) : card.category === "new_order" ? (
                <Button
                  asChild
                  disabled={isPending}
                  // Solid fill, same weight as the default «Создать задачу» button
                  // it replaces here (this page doesn't use the pastel-badge
                  // treatment dashboard-card.tsx's own button uses).
                  className="flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                >
                  {/* → /products, where the New Order dialog opens prefilled
                      with the linked client + the verbatim client message. */}
                  <Link href={`/products?orderFromCard=${card.id}`}>
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Создать заказ
                  </Link>
                </Button>
              ) : (
              <TaskEditDialog
                mode="create"
                initialValues={taskInitialValues}
                onSuccess={handleAccept}
                trigger={
                  <Button disabled={isPending} className="flex-1">
                    <ListTodo className="h-4 w-4 mr-1" />
                    Создать задачу
                  </Button>
                }
              />
              )}
              <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isPending}
                    className="flex-1"
                  >
                    <X className="h-4 w-4 mr-1" />
                    {gate
                    ? NO_GO_LABEL
                    : dealKind
                      ? DEAL_CARD_REJECT_LABEL_RU[dealKind]
                      : "Отклонить"}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {gate
                      ? NO_GO_DIALOG_TITLE
                      : dealKind
                        ? CARD_REJECT_DIALOG_TITLE_RU[dealKind]
                        : "Отклонить карточку"}
                    </DialogTitle>
                    <DialogDescription>
                    {gate
                      ? NO_GO_DIALOG_DESCRIPTION
                      : "Укажите краткую причину. Она сохранится вместе с карточкой, чтобы команда видела, почему её отклонили."}
                  </DialogDescription>
                  </DialogHeader>
                  {isTopicCard && (
                    <CardRejectReasonSelect
                      value={rejectCode}
                      onChange={setRejectCode}
                      disabled={isPending}
                      kind={card.kind}
                    noGoReasons={gate ? noGoReasons : undefined}
                    />
                  )}
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={
                    isTopicCard
                      ? "Комментарий (необязательно)"
                      : "Почему вы отклоняете эту карточку?"
                  }
                    rows={4}
                    autoFocus
                  />
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setRejectOpen(false)}
                      disabled={isPending}
                    >
                      Отмена
                    </Button>
                    <Button
                      onClick={handleReject}
                      disabled={isPending || !rejectReady}
                    >
                      {gate ? NO_GO_LABEL : "Отклонить карточку"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          {resolved && dealKind && card.dealId && card.accepted && (
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground mt-3"
            >
              <Link href={`/deals?openDeal=${card.dealId}`}>
                <Handshake className="h-4 w-4 mr-1" />
                Открыть сделку
              </Link>
            </Button>
          )}
          {resolved && (card.resultTaskId || card.resultOrderId) && (
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground mt-3"
            >
              {card.resultTaskId ? (
                <Link href={`/tasks?openTask=${card.resultTaskId}`}>
                  <ListTodo className="h-4 w-4 mr-1" />
                  Открыть задачу
                </Link>
              ) : (
                <Link href={`/products?openOrder=${card.resultOrderId}`}>
                  <ShoppingCart className="h-4 w-4 mr-1" />
                  Открыть заказ
                </Link>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

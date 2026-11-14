"use client"

import { useState } from "react"
import { Loader2, PauseCircle, Undo2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DealRow } from "@/app/api/deals/route"

// Lifecycle actions of the topics deal bridge (plan phase 5, spec 01 §9.2):
// undo of a deal the agent created, and pause («Поставить на паузу»). Both
// call PUT /api/deals { id, action } → the deal engine (src/server/deal-engine.ts).

async function putAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/deals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "Не удалось выполнить действие")
  }
}

// «Отменить» у бейджа «создал агент»: сделка уходит в `deleted`, причина
// (необязательная) сохраняется. Доступно, пока сделка открыта.
export function DealUndoAgentDialog({
  deal,
  onCancel,
  onDone,
}: {
  deal: DealRow | null
  onCancel: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const key = deal?.id ?? null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    setReason("")
  }

  const confirm = async () => {
    if (!deal) return
    setPending(true)
    try {
      await putAction({
        id: deal.id,
        action: "undoAgent",
        reason: reason.trim() || null,
      })
      toast.success("Сделка агента отменена")
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отменить")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={deal !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отменить сделку агента?</DialogTitle>
          <DialogDescription>
            {deal
              ? `Сделку «${deal.clientName ? `${deal.clientName} — ` : ""}${deal.name}» создал агент. Она будет удалена с доски; темы и сообщения останутся.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина (необязательно): почему это не сделка"
          className="min-h-20"
          disabled={pending}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Не отменять
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="mr-1 h-4 w-4" />
            )}
            Отменить сделку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function tomorrowIsoDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// «Поставить на паузу»: дата возврата + причина. Сделка остаётся в своей
// стадии, статус `paused`; напоминания стоят до даты возврата.
export function DealPauseDialog({
  deal,
  open,
  onOpenChange,
  onDone,
}: {
  deal: DealRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [until, setUntil] = useState("")
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const key = open ? (deal?.id ?? null) : null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    setUntil("")
    setReason("")
  }
  const minDate = tomorrowIsoDate()

  const confirm = async () => {
    if (!deal) return
    if (!until) {
      toast.error("Укажите дату возврата")
      return
    }
    if (until < minDate) {
      toast.error("Дата возврата должна быть в будущем")
      return
    }
    if (!reason.trim()) {
      toast.error("Укажите причину паузы")
      return
    }
    setPending(true)
    try {
      await putAction({
        id: deal.id,
        action: "pause",
        until,
        reason: reason.trim(),
      })
      toast.success("Сделка поставлена на паузу")
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось поставить на паузу",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Поставить сделку на паузу</DialogTitle>
          <DialogDescription>
            Сделка остаётся в своей стадии. До даты возврата агент не
            напоминает о ней.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-pause-until">Вернуться к сделке</Label>
            <Input
              id="deal-pause-until"
              type="date"
              min={minDate}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deal-pause-reason">Причина</Label>
            <Textarea
              id="deal-pause-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: клиент вернётся к вопросу после нового года"
              className="min-h-20"
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <PauseCircle className="mr-1 h-4 w-4" />
            )}
            Поставить на паузу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

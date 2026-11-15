"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Trophy, XCircle } from "lucide-react"
import { ReasonSelect } from "@/components/blocks/deal-funnel-ui"
import type { FunnelReason } from "@/lib/funnel/config"

export type PendingOutcome = {
  dealId: string
  dealName: string
  fromLabel: string
  /**
   * The outcome is already known (a won / lost stage picked in the drawer):
   * the dialog opens on it. Absent = a drop on the final column, the user
   * chooses.
   */
  preset?: "won" | "lost"
}

// Диалог исхода сделки при перетаскивании карточки в финальную колонку «Закрытие»
// (или выборе итоговой стадии в дровере). Выбор Выиграно / Не состоялось решает,
// на какую стадию (роль `won` / `lost`) уходит сделка. «Не состоялось» требует
// причину из списка организации (docs/specs/funnel §3.5) — уходит как
// `outcomeReasonCode`; комментарий необязателен и попадает в ленту решений.
export function DealOutcomeDialog({
  outcome,
  lostReasons,
  pending,
  onConfirm,
  onCancel,
}: {
  outcome: PendingOutcome | null
  lostReasons: readonly FunnelReason[]
  pending: boolean
  onConfirm: (
    result: "won" | "lost",
    note: string,
    reasonCode: string | null,
  ) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")
  const [result, setResult] = useState<"won" | "lost" | null>(null)
  const [reasonCode, setReasonCode] = useState("")

  // Сброс при смене сделки/закрытии — «adjust state during render».
  const key = outcome ? `${outcome.dealId}:${outcome.preset ?? ""}` : null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    setNote("")
    setResult(outcome?.preset ?? null)
    setReasonCode("")
  }

  const lostReady = result === "lost" && !!reasonCode

  return (
    <Dialog
      open={outcome !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {outcome ? `Исход сделки: ${outcome.dealName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {outcome
              ? `Закрытие сделки из «${outcome.fromLabel}» — это финальный этап. Выберите исход.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            aria-pressed={result === "won"}
            onClick={() => setResult("won")}
            disabled={pending}
            className={
              result === "won"
                ? "border-[#1F7A4D] bg-[#1F7A4D]/10 text-[#1F7A4D] dark:text-emerald-300"
                : undefined
            }
          >
            <Trophy className="h-4 w-4 mr-1" />
            Выиграно
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={result === "lost"}
            onClick={() => setResult("lost")}
            disabled={pending}
            className={
              result === "lost"
                ? "border-foreground/60 bg-foreground/5"
                : undefined
            }
          >
            <XCircle className="h-4 w-4 mr-1" />
            Не состоялось
          </Button>
        </div>

        {result === "lost" && (
          <div className="space-y-1.5">
            <Label>Причина</Label>
            <ReasonSelect
              reasons={lostReasons}
              value={reasonCode}
              onChange={setReasonCode}
              disabled={pending}
              ariaLabel="Причина: не состоялась"
            />
          </div>
        )}

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий (необязательно): контекст, подробности…"
          className="min-h-20"
        />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
          {result === "lost" ? (
            <Button
              onClick={() => onConfirm("lost", note, reasonCode)}
              disabled={pending || !lostReady}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Закрыть: не состоялось
            </Button>
          ) : (
            <Button
              onClick={() => onConfirm("won", note, null)}
              disabled={pending || result !== "won"}
              className="bg-[#1F7A4D] text-white hover:bg-[#1a6a43]"
            >
              <Trophy className="h-4 w-4 mr-1" />
              Закрыть: выиграно
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

// «К какой сделке относится тема?» — the accept control of a `deal_link`
// card (docs/specs/topics/10-deal-status-from-topics.md): a Select over the
// client's open deals (`proposal.dealOptions`) + «Связать». The caller sends
// `PUT /api/cards { id, action: "deal_execute", dealId }`. Shared by
// topic-card.tsx, dashboard-card.tsx and card-detail-shell.tsx, together
// with the per-kind texts of the deal card actions below.

import { useState } from "react"
import { Handshake } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  DEAL_CARD_ACCEPT_LABEL_RU,
  type CardKind,
  type CardRejectReason,
  type DealCardKind,
  type DealLinkOption,
} from "@/lib/topics/cards"

/** Title of the reject dialog per card kind. */
export const CARD_REJECT_DIALOG_TITLE_RU: Record<CardKind, string> = {
  topic: "Отклонить карточку",
  deal_proposal: "Это не сделка",
  stage_confirmation: "Отклонить карточку",
  deal_link: "Тема не относится ни к одной сделке",
}

/** Preselected reject reason per card kind ("" = the user picks one). */
export function defaultRejectReason(kind: string | null | undefined): CardRejectReason | "" {
  return kind === "deal_link" ? "no_matching_deal" : ""
}

/** Success toast after «Создать» / «Подтвердить» / «Связать». */
export function dealExecuteToast(kind: DealCardKind, linked: unknown): string {
  if (kind === "deal_link") return "Тема привязана к сделке"
  if (kind === "deal_proposal") return linked ? "Тема привязана к открытой сделке" : "Сделка создана"
  return "Стадия сделки обновлена"
}

function optionLabel(o: DealLinkOption): string {
  return [o.name, o.stageLabelRu, o.status === "paused" ? "пауза" : null].filter(Boolean).join(" · ")
}

export function DealLinkChooser({
  options,
  pending,
  onLink,
  className,
  buttonClassName,
  size = "sm",
}: {
  options: DealLinkOption[] | undefined
  pending?: boolean
  onLink: (dealId: string) => void
  className?: string
  buttonClassName?: string
  size?: "sm" | "default"
}) {
  const list = options ?? []
  // Exactly one open deal → preselect it.
  const [dealId, setDealId] = useState(list.length === 1 ? list[0].id : "")
  const chosen = list.some((o) => o.id === dealId) ? dealId : ""

  if (list.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        У компании нет открытых сделок для выбора.
      </p>
    )
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Select value={chosen} onValueChange={setDealId} disabled={pending}>
        <SelectTrigger size={size} className="min-w-0 flex-1" aria-label="Сделка">
          <SelectValue placeholder="Выберите сделку" />
        </SelectTrigger>
        <SelectContent>
          {list.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {optionLabel(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size={size}
        variant="secondary"
        className={cn("shrink-0", buttonClassName)}
        disabled={pending || !chosen}
        onClick={() => chosen && onLink(chosen)}
      >
        <Handshake className="h-4 w-4 mr-1" />
        {DEAL_CARD_ACCEPT_LABEL_RU.deal_link}
      </Button>
    </div>
  )
}

"use client"

// Reject reason CODE picker for topic cards (spec topics/01 §9.1: «reject
// asks for a reason code (list) + optional text»). Old Custom-rule cards
// keep the free-text reason only. Used by dashboard-card.tsx and
// card-detail-shell.tsx.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CARD_REJECT_REASONS,
  CARD_REJECT_REASON_LABELS_RU,
} from "@/lib/topics/cards"

export function CardRejectReasonSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label="Причина отклонения">
        <SelectValue placeholder="Выберите причину" />
      </SelectTrigger>
      <SelectContent>
        {CARD_REJECT_REASONS.map((r) => (
          <SelectItem key={r} value={r}>
            {CARD_REJECT_REASON_LABELS_RU[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

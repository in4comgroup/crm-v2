"use client"

// Reject reason CODE picker for topic cards (spec topics/01 §9.1: «reject
// asks for a reason code (list) + optional text»). Old Custom-rule cards
// keep the free-text reason only. Used by dashboard-card.tsx and
// card-detail-shell.tsx. A go / no-go `deal_proposal` (custom funnel §3.2)
// passes `noGoReasons` instead: the org list, values `nogo:<code>`.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CARD_REJECT_REASONS_BY_KIND,
  CARD_REJECT_REASON_LABELS_RU,
  closesTopicOnReject,
  isCardKind,
} from "@/lib/topics/cards"

export function CardRejectReasonSelect({
  value,
  onChange,
  disabled,
  kind,
  noGoReasons,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  /** card.kind — deal cards offer their own reasons («Это не сделка», …). */
  kind?: string | null
  /** Go / no-go card: the org no-go reasons (value sent as `nogo:<code>`). */
  noGoReasons?: { code: string; label: string }[]
}) {
  if (noGoReasons) {
    return (
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="Причина отказа">
          <SelectValue placeholder="Выберите причину" />
        </SelectTrigger>
        <SelectContent>
          {noGoReasons.map((r) => (
            <SelectItem key={r.code} value={`nogo:${r.code}`}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  const reasons = CARD_REJECT_REASONS_BY_KIND[isCardKind(kind) ? kind : "topic"]
  return (
    <>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="Причина отклонения">
          <SelectValue placeholder="Выберите причину" />
        </SelectTrigger>
        <SelectContent>
          {reasons.map((r) => (
            <SelectItem key={r} value={r}>
              {CARD_REJECT_REASON_LABELS_RU[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The one reason that also closes the topic (bug list 2026-11-21, item 7). */}
      {closesTopicOnReject(value) && (
        <p className="text-xs text-muted-foreground">
          Тема тоже закроется со статусом «Не относится» и пропадёт из списков.
        </p>
      )}
    </>
  )
}

"use client"

// Shared bits of the AI chat records UI (results block + detail view, spec
// docs/specs/ai-chat/01-specification.md §7): icon per record type, badge
// tone colours, Russian date format.
import {
  Building2,
  FileText,
  Handshake,
  LayoutGrid,
  ListTodo,
  MessagesSquare,
  Package,
  ShoppingCart,
  User,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { RecordBadge, RecordTone, RecordType } from "@/lib/chat/records"
import { cn } from "@/lib/utils"

export const RECORD_TYPE_ICONS: Record<RecordType, LucideIcon> = {
  client: Building2,
  contact: User,
  deal: Handshake,
  order: ShoppingCart,
  product: Package,
  task: ListTodo,
  topic: MessagesSquare,
  card: LayoutGrid,
  source_item: FileText,
}

const TONE_CLASS: Record<RecordTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
}

export function RecordToneBadge({ badge, className }: { badge: RecordBadge; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TONE_CLASS[badge.tone] ?? TONE_CLASS.neutral, className)}>
      {badge.label}
    </Badge>
  )
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })

/** ISO → «16.11.2026»; "" for no / bad date. */
export function formatRecordDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : DATE_FMT.format(d)
}

/** External link (web, mail, phone) → plain <a>; app path → Next <Link>. */
export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href)
}

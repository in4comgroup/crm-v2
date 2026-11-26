"use client"

// Results block of the AI chat (docs/specs/ai-chat/01-specification.md §7.1):
// ONE merged block per answer, under the prose. Header counts come from the
// tool counts (never from the model); sections in RECORD_TYPE_ORDER; 5 rows
// per section, then «Показать ещё (N)». Row click → detail view in the side
// panel (`onOpen`); «Открыть в CRM» → the record's page, the panel stays.
// No ids are shown (§9).
import { useState } from "react"
import Link from "next/link"
import { ExternalLink, Search } from "lucide-react"
import {
  RECORD_TYPE_LABELS,
  RECORD_TYPE_ORDER,
  formatRecordCount,
  type AppliedFilter,
  type RecordCount,
  type RecordHit,
  type RecordType,
} from "@/lib/chat/records"
import { cn } from "@/lib/utils"
import { RECORD_TYPE_ICONS, RecordToneBadge, formatRecordDate } from "./record-ui"

export type RecordsBlockData = {
  counts: Partial<Record<RecordType, RecordCount>>
  hits: Partial<Record<RecordType, RecordHit[]>>
  /** Filters of a `listRecords` call, shown as chips («Статус: открыта»). */
  applied?: AppliedFilter[]
}

export type OpenRecordHandler = (type: RecordType, id: string, title: string) => void

const ROWS_PER_SECTION = 5

export function RecordsBlock({
  data,
  onOpen,
  className,
}: {
  data: RecordsBlockData
  onOpen: OpenRecordHandler
  className?: string
}) {
  const countParts = RECORD_TYPE_ORDER.flatMap((t) => {
    const c = data.counts[t]
    if (!c || c.total === 0) return []
    return [`${RECORD_TYPE_LABELS[t].many}: ${formatRecordCount(c)}`]
  })
  const sections = RECORD_TYPE_ORDER.filter((t) => (data.hits[t]?.length ?? 0) > 0)
  const applied = data.applied ?? []

  return (
    <section
      aria-label="Найденные записи"
      className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground", className)}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium">Найдено в CRM</span>
        <span className="text-xs text-muted-foreground">
          {countParts.length > 0 ? countParts.join(" · ") : "ничего не найдено"}
        </span>
      </header>

      {applied.length > 0 && (
        <ul aria-label="Фильтры" className="flex flex-wrap gap-1.5 border-b px-3 py-2">
          {applied.map((f, i) => (
            <li
              key={`${f.label}-${i}`}
              className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {f.label}: <span className="text-foreground">{f.value}</span>
            </li>
          ))}
        </ul>
      )}

      {sections.length > 0 && (
        <div className="divide-y">
          {sections.map((t) => (
            <RecordsSection key={t} type={t} hits={data.hits[t] ?? []} count={data.counts[t]} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

function RecordsSection({
  type,
  hits,
  count,
  onOpen,
}: {
  type: RecordType
  hits: RecordHit[]
  count: RecordCount | undefined
  onOpen: OpenRecordHandler
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = RECORD_TYPE_ICONS[type]
  const label = RECORD_TYPE_LABELS[type].many
  const shown = expanded ? hits : hits.slice(0, ROWS_PER_SECTION)
  const hidden = hits.length - shown.length
  const total = count ?? { total: hits.length, capped: false }
  const moreOnServer = total.capped || total.total > hits.length

  return (
    <div className="px-1.5 py-1.5">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <h4 className="text-xs font-medium">{label}</h4>
        <span className="text-xs text-muted-foreground">{formatRecordCount(total)}</span>
      </div>
      <ul className="space-y-0.5">
        {shown.map((hit) => (
          <li key={`${hit.type}:${hit.id}`}>
            <RecordHitRow hit={hit} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {(hidden > 0 || moreOnServer) && (
        <div className="flex items-center gap-2 px-1.5 pt-1">
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Показать ещё ({hidden})
            </button>
          )}
          {moreOnServer && (
            <span className="text-xs text-muted-foreground">… всего {formatRecordCount(total)}</span>
          )}
        </div>
      )}
    </div>
  )
}

export function RecordHitRow({
  hit,
  onOpen,
  showIcon = false,
}: {
  hit: RecordHit
  onOpen: OpenRecordHandler
  /** Type icon before the title (lists that mix types, e.g. linked records). */
  showIcon?: boolean
}) {
  const Icon = RECORD_TYPE_ICONS[hit.type]
  const date = formatRecordDate(hit.date)
  const typeLabel = RECORD_TYPE_LABELS[hit.type].one
  return (
    <div className="group flex items-start gap-1 rounded-lg hover:bg-muted/60">
      <button
        type="button"
        onClick={() => onOpen(hit.type, hit.id, hit.title)}
        aria-label={`${typeLabel}: ${hit.title} — показать подробности`}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {showIcon && <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium" title={hit.title}>
              {hit.title}
            </span>
            {hit.badge && <RecordToneBadge badge={hit.badge} className="px-1.5 py-0 text-[11px]" />}
            {date && <span className="ml-auto shrink-0 pl-1 text-[11px] text-muted-foreground">{date}</span>}
          </span>
          {hit.subtitle && (
            <span className="block truncate text-xs text-muted-foreground" title={hit.subtitle}>
              {hit.subtitle}
            </span>
          )}
          {hit.facts.length > 0 && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {hit.facts.slice(0, 3).map((f, i) => (
                <span key={`${f.label}-${i}`}>
                  {i > 0 && " · "}
                  {f.label}: <span className="text-foreground/80">{f.value}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      <Link
        href={hit.href}
        aria-label={`Открыть в CRM: ${hit.title}`}
        title="Открыть в CRM"
        className="mt-1 mr-1 inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition hover:bg-background hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        В CRM
      </Link>
    </div>
  )
}

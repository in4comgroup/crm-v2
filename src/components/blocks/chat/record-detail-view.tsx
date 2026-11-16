"use client"

// Detail view of one record in the AI chat side panel
// (docs/specs/ai-chat/01-specification.md §7.2). Typed and app-built: loads
// `GET /api/chat/records?type=&id=` (org from the session) and renders the
// shared RecordDetail shape. Linked records open in the same panel
// (`onOpenRecord`, history / back via chat-panel-context). No ids, no JSON.
import { useEffect, useState } from "react"
import Link from "next/link"
import { ExternalLink, RotateCw } from "lucide-react"
import { MessageResponse } from "@/components/ai-elements/message"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RecordDetail, RecordDetailSection, RecordType } from "@/lib/chat/records"
import { RecordHitRow, type OpenRecordHandler } from "./records-block"
import { RecordToneBadge, isExternalHref } from "./record-ui"

type LoadResult = { key: string; detail: RecordDetail | null; error: string | null }

const NOT_FOUND = "Запись не найдена или недоступна"

export function RecordDetailView({
  type,
  id,
  onOpenRecord,
  onLoaded,
}: {
  type: RecordType
  id: string
  onOpenRecord: OpenRecordHandler
  /** Called once the detail is loaded (e.g. to set the panel title). */
  onLoaded?: (detail: RecordDetail) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const key = `${type}:${id}:${attempt}`
  const [result, setResult] = useState<LoadResult | null>(null)
  // Loading is derived: the stored result belongs to another record / attempt.
  const current = result?.key === key ? result : null

  useEffect(() => {
    let cancelled = false
    const reqKey = `${type}:${id}:${attempt}`
    fetch(`/api/chat/records?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { detail?: RecordDetail; error?: string } | null
        if (cancelled) return
        if (res.ok && data?.detail) {
          setResult({ key: reqKey, detail: data.detail, error: null })
          onLoaded?.(data.detail)
        } else {
          setResult({
            key: reqKey,
            detail: null,
            error: res.status === 404 || res.status === 400 ? NOT_FOUND : (data?.error ?? "Не удалось загрузить запись"),
          })
        }
      })
      .catch(() => {
        if (!cancelled) setResult({ key: reqKey, detail: null, error: "Не удалось загрузить запись" })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded is a render-time callback; type / id / attempt drive the fetch
  }, [type, id, attempt])

  if (!current) return <DetailSkeleton />

  if (!current.detail) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-4">
        <p className="text-sm text-muted-foreground">{current.error ?? NOT_FOUND}</p>
        {current.error !== NOT_FOUND && (
          <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCw className="size-3.5" aria-hidden />
            Повторить
          </Button>
        )}
      </div>
    )
  }

  const d = current.detail
  return (
    <article className="space-y-5" aria-label={d.title}>
      <header className="space-y-2">
        <div>
          <h2 className="text-base font-semibold leading-snug break-words">{d.title}</h2>
          {d.subtitle && <p className="text-sm text-muted-foreground">{d.subtitle}</p>}
        </div>
        {d.badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d.badges.map((b, i) => (
              <RecordToneBadge key={`${b.label}-${i}`} badge={b} />
            ))}
          </div>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={d.href}>
            <ExternalLink className="size-3.5" aria-hidden />
            Открыть в CRM
          </Link>
        </Button>
      </header>

      {d.sections.map((s, i) => (
        <DetailSection key={`${s.kind}-${s.title}-${i}`} section={s} onOpenRecord={onOpenRecord} />
      ))}
    </article>
  )
}

function DetailSection({
  section,
  onOpenRecord,
}: {
  section: RecordDetailSection
  onOpenRecord: OpenRecordHandler
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</h3>
      {section.kind === "facts" && (
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
          {section.items.map((f, i) => (
            <div key={`${f.label}-${i}`} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 break-words">
                {f.href ? <FactLink href={f.href}>{f.value}</FactLink> : f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {section.kind === "text" && (
        <div className="rounded-xl border bg-background p-3 text-sm">
          <MessageResponse>{section.markdown}</MessageResponse>
        </div>
      )}
      {section.kind === "records" && (
        <ul className="space-y-0.5 rounded-xl border p-1">
          {section.items.map((hit) => (
            <li key={`${hit.type}:${hit.id}`}>
              <RecordHitRow hit={hit} onOpen={onOpenRecord} showIcon />
            </li>
          ))}
        </ul>
      )}
      {section.kind === "table" && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                {section.columns.map((c, i) => (
                  <TableHead key={`${c}-${i}`} className="h-8 text-xs">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map((row, r) => (
                <TableRow key={r}>
                  {row.map((cell, c) => (
                    <TableCell key={c} className="py-1.5 text-xs whitespace-normal">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function FactLink({ href, children }: { href: string; children: string }) {
  const cls = "text-primary underline-offset-4 hover:underline"
  if (isExternalHref(href)) {
    const web = /^https?:/i.test(href)
    return (
      <a href={href} className={cls} {...(web ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Загрузка записи">
      <div className="space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ))}
    </div>
  )
}

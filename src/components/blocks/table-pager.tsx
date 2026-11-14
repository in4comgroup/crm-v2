"use client"

// One pager for every admin table (/settings): «Строк на странице» 10 / 25 /
// 50 (default 10) + «стр. X из Y» + previous / next. Pages are 0-based in
// the props (`page` 0 = the first page) and shown 1-based. A change of the
// page size should reset the page to 0 (the caller does it in
// `onPageSizeChange`). Works for client-side paging (slice) and server-side
// paging (limit / offset).

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 10

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function TablePager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
  className,
}: {
  /** 0-based page. */
  page: number
  pageSize: number
  /** Total rows (all pages). */
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: PageSize) => void
  disabled?: boolean
  className?: string
}) {
  const pages = pageCount(total, pageSize)
  return (
    <div className={`flex flex-wrap items-center justify-end gap-3 text-sm ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Строк на странице</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v) as PageSize)}
          disabled={disabled}
        >
          <SelectTrigger size="sm" className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="tabular-nums text-muted-foreground">
        стр. {Math.min(page + 1, pages)} из {pages}
        {total > 0 ? ` · ${total}` : ""}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={disabled || page <= 0}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(pages - 1, page + 1))}
          disabled={disabled || page >= pages - 1}
          aria-label="Следующая страница"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

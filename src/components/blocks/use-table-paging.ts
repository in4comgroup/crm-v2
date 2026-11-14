"use client"

// Client-side paging state for admin tables that load their rows whole.
// Pairs with `TablePager` (0-based page; a page-size change resets to 0).
// The page is clamped, so a filter that shrinks the list never leaves an
// empty page.

import { useState } from "react"
import { DEFAULT_PAGE_SIZE, pageCount } from "@/components/blocks/table-pager"

export function useTablePaging<T>(rows: T[]) {
  const [pageRaw, setPage] = useState(0)
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE)
  const page = Math.min(pageRaw, pageCount(rows.length, pageSize) - 1)
  return {
    page,
    pageSize,
    total: rows.length,
    pageRows: rows.slice(page * pageSize, (page + 1) * pageSize),
    pagerProps: {
      page,
      pageSize,
      total: rows.length,
      onPageChange: setPage,
      onPageSizeChange: (n: number) => {
        setPageSizeState(n)
        setPage(0)
      },
    },
  }
}

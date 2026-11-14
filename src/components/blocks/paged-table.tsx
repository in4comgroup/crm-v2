"use client"

// Client-side paging around one admin table whose rows are loaded whole.
// Usage: <PagedTable rows={list}>{(pageRows) => <Table>…pageRows.map…</Table>}</PagedTable>
// The pager sits below the table (inside a surrounding Card, with a top border).
// Hooks live here, so the caller may render it conditionally.

import type { ReactNode } from "react"
import { TablePager } from "@/components/blocks/table-pager"
import { useTablePaging } from "@/components/blocks/use-table-paging"

export function PagedTable<T>({
  rows,
  children,
}: {
  rows: T[]
  children: (pageRows: T[]) => ReactNode
}) {
  const paging = useTablePaging(rows)
  return (
    <>
      {children(paging.pageRows)}
      <TablePager className="border-t px-3 py-2" {...paging.pagerProps} />
    </>
  )
}

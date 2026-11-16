"use client"

import { useState, useMemo } from "react"
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowUpDown } from "lucide-react"

interface ColumnConfig {
  key: string
  label: string
  type?: string
  align?: "left" | "center" | "right"
  width?: number
}

interface DataTableComponentProps {
  title?: string
  columns: ColumnConfig[]
  rows: Record<string, unknown>[]
  sortable?: boolean
  searchable?: boolean
  pageSize?: number
}

type Row = Record<string, unknown>

// TanStack Table v9: features and row models are registered explicitly
// (module level = stable). Same behaviour as the v8 table: sorting (the
// "auto" sort picks one of the registered sort functions), global search
// ("auto" = includesString) and pagination.
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature, // required by globalFilteringFeature
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  filterFns: { includesString: filterFn_includesString },
})

function formatCellValue(value: unknown, type?: string): string {
  if (value == null) return "—"
  switch (type) {
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(value)
        : String(value)
    case "percentage":
      return typeof value === "number" ? `${value}%` : String(value)
    case "boolean":
      return value ? "Yes" : "No"
    case "date":
      return typeof value === "string" || typeof value === "number"
        ? new Date(value).toLocaleDateString()
        : String(value)
    default:
      return String(value)
  }
}

export function DataTableComponent({
  title,
  columns: columnConfigs,
  rows,
  sortable = true,
  searchable = false,
  pageSize = 10,
}: DataTableComponentProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState("")

  const columns = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      columnConfigs.map((col) => ({
        accessorKey: col.key,
        header: sortable
          ? ({ column }) => (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                {col.label}
                <ArrowUpDown className="ml-2 size-3.5" />
              </Button>
            )
          : col.label,
        cell: ({ getValue }) => {
          const val = getValue()
          const formatted = formatCellValue(val, col.type)
          const alignClass =
            col.align === "right"
              ? "text-right"
              : col.align === "center"
                ? "text-center"
                : ""
          return <span className={alignClass}>{formatted}</span>
        },
      })),
    [columnConfigs, sortable],
  )

  const table = useTable({
    features,
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  })

  return (
    <div className="space-y-3">
      {(title || searchable) && (
        <div className="flex items-center justify-between gap-4">
          {title && <h4 className="text-sm font-semibold">{title}</h4>}
          {searchable && (
            <Input
              placeholder="Search..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
          )}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-16 text-center text-muted-foreground"
                >
                  No data
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {table.state.pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

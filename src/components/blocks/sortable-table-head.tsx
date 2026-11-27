import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react"
import { TableHead } from "@/components/ui/table"

export function SortableTableHead({ label, direction, onSort }: {
  label: string
  direction?: "asc" | "desc"
  onSort: () => void
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowDownUp
  return (
    <TableHead aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}>
      <button type="button" onClick={onSort} className="-mx-1 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm px-1 py-0.5 hover:bg-accent focus-visible:outline-2">
        {label}<Icon className="size-3.5" aria-hidden />
      </button>
    </TableHead>
  )
}

import { useId, useState, type ReactNode } from "react"
import { Funnel } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function FilterToolbar({ actions, children, active, className }: {
  actions: ReactNode
  children: ReactNode
  active: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={cn("shrink-0 rounded-xl border bg-card p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <Button type="button" size="icon-sm" variant={open || active ? "secondary" : "outline"}
          aria-label="Фильтры" title="Фильтры" aria-expanded={open} aria-controls={id}
          onClick={() => setOpen((value) => !value)}>
          <Funnel aria-hidden />
        </Button>
      </div>
      <div id={id} hidden={!open} className={open ? "mt-2 flex flex-wrap items-center gap-2 border-t pt-2" : undefined}>
        {open && children}
      </div>
    </div>
  )
}

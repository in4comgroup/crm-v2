"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import { AnchorTooltip, useAnchorTooltip } from "./anchor-tooltip"
import type { OrgOption } from "@/lib/org-switcher"

// Смена активной организации — только для администраторов платформы.
// Кнопка-шеврон справа от пункта организации в нижнем блоке сайдбара (сам
// пункт по-прежнему ведёт на /account). Список организаций загружает
// (protected)/layout.tsx. Смена — POST /api/account/active-organization, затем
// полная перезагрузка на /dashboard, чтобы каждая страница прочла новую org.
export function OrgSwitcher({
  organizations,
  activeOrganizationId,
}: {
  organizations: OrgOption[]
  activeOrganizationId: string | null
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const tooltip = useAnchorTooltip()

  async function switchTo(org: OrgOption) {
    if (org.id === activeOrganizationId || switchingId) return
    setSwitchingId(org.id)
    try {
      const res = await fetch("/api/account/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сменить организацию")
        setSwitchingId(null)
        return
      }
      toast.success(`Организация: ${org.name}`)
      // Полная перезагрузка: серверные страницы, клиентские кэши и ИИ-чат
      // начинают с новой организации. Кнопки остаются заблокированными.
      window.location.assign("/dashboard")
    } catch {
      toast.error("Не удалось сменить организацию")
      setSwitchingId(null)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            aria-label="Сменить организацию"
            className="cursor-pointer"
            {...tooltip.bind}
          >
            <ChevronsUpDown />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Сменить организацию
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-72 overflow-y-auto">
            {organizations.map((org) => {
              const current = org.id === activeOrganizationId
              return (
                <DropdownMenuItem
                  key={org.id}
                  disabled={!!switchingId}
                  onSelect={(e) => {
                    if (current) return
                    e.preventDefault()
                    void switchTo(org)
                  }}
                  className="cursor-pointer"
                >
                  <Check className={`size-4 shrink-0 ${current ? "opacity-100" : "opacity-0"}`} />
                  <span className={`truncate ${current ? "font-medium" : ""}`}>{org.name}</span>
                  {switchingId === org.id && (
                    <span className="ml-auto text-xs text-muted-foreground">Переключаю…</span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <AnchorTooltip
        text="Сменить организацию"
        side="right"
        open={tooltip.open && !menuOpen}
        virtualRef={tooltip.virtualRef}
      />
    </>
  )
}

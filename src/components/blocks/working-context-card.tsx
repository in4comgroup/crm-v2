"use client"

// «Рабочий контекст» on «Профиль организации» (2026-11-19): the org owner sets
// the time zone and the working hours (PUT /api/org-profile { workingContext });
// everyone else reads them. Used by the topics lists and deadlines, digests,
// Telegram pushes, notification checks and the AI chat («сегодня»).

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { LoadingButton } from "@/components/blocks/loading-button"
import { timeZoneOptions, utcOffsetLabel, workingContextInputSchema } from "@/lib/identity/working-context"

export type WorkingContext = { timeZone: string; workStart: string; workEnd: string }

export function WorkingContextCard({
  value,
  canEdit,
  onSaved,
}: {
  value: WorkingContext
  /** The org owner. */
  canEdit: boolean
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<WorkingContext>(value)
  const [base, setBase] = useState<WorkingContext>(value)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  // A newer stored value (another tab / reload) replaces an unchanged draft.
  if (value.timeZone !== base.timeZone || value.workStart !== base.workStart || value.workEnd !== base.workEnd) {
    const untouched = draft.timeZone === base.timeZone && draft.workStart === base.workStart && draft.workEnd === base.workEnd
    setBase(value)
    if (untouched) setDraft(value)
  }
  const zones = useMemo(() => timeZoneOptions(draft.timeZone), [draft.timeZone])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones).slice(0, 80)
  }, [zones, query])
  const dirty = draft.timeZone !== base.timeZone || draft.workStart !== base.workStart || draft.workEnd !== base.workEnd

  const save = async () => {
    const check = workingContextInputSchema.safeParse(draft)
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? "Некорректные данные")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/org-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingContext: check.data }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить рабочий контекст")
        return
      }
      setBase(check.data)
      setDraft(check.data)
      toast.success("Рабочий контекст сохранён")
      onSaved?.()
    } catch {
      toast.error("Не удалось сохранить рабочий контекст")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">Рабочий контекст</CardTitle>
        <CardDescription>
          Часовой пояс и рабочие часы организации: по ним считаются списки тем и сроки, сводки и напоминания,
          уведомления, сообщения в Telegram и «сегодня» в ИИ чате.
          {canEdit ? " Меняет владелец организации." : " Меняет владелец организации; для вас — только просмотр."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Часовой пояс</span>
          {canEdit ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full max-w-sm justify-between font-normal">
                  <span className="truncate">
                    {draft.timeZone}
                    <span className="ml-2 text-muted-foreground">{utcOffsetLabel(draft.timeZone)}</span>
                  </span>
                  <ChevronsUpDown className="size-4 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Найти: Moscow, Vienna, UTC…" value={query} onValueChange={setQuery} />
                  <CommandList>
                    <CommandEmpty>Часовой пояс не найден</CommandEmpty>
                    <CommandGroup>
                      {shown.map((z) => (
                        <CommandItem
                          key={z}
                          value={z}
                          onSelect={() => {
                            setDraft((d) => ({ ...d, timeZone: z }))
                            setOpen(false)
                            setQuery("")
                          }}
                        >
                          <span className="truncate">{z}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{utcOffsetLabel(z)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-sm">
              {base.timeZone} <span className="text-muted-foreground">{utcOffsetLabel(base.timeZone)}</span>
            </span>
          )}
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Рабочие часы</span>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                type="time"
                aria-label="Начало рабочего дня"
                className="w-32"
                value={draft.workStart}
                onChange={(e) => setDraft((d) => ({ ...d, workStart: e.target.value }))}
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="time"
                aria-label="Конец рабочего дня"
                className="w-32"
                value={draft.workEnd}
                onChange={(e) => setDraft((d) => ({ ...d, workEnd: e.target.value }))}
              />
            </div>
          ) : (
            <span className="text-sm">
              {base.workStart}–{base.workEnd}
            </span>
          )}
          <span className="text-xs text-muted-foreground">По рабочим дням производственного календаря.</span>
        </div>
        {canEdit && (
          <div>
            <LoadingButton type="button" size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
              Сохранить
            </LoadingButton>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

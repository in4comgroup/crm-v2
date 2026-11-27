"use client"

import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { Check, Pencil, X } from "lucide-react"
import { FollowCursorTooltip } from "@/components/blocks/follow-cursor-tooltip"
import { Button } from "@/components/ui/button"
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"

export function EditableDrawerTitle({ label, pending }: { label: string; pending: boolean }) {
  const { control, resetField } = useFormContext<{ name: string }>()
  const [focused, setFocused] = useState(false)

  return (
    <FormField
      control={control}
      name="name"
      rules={{ required: "Укажите название" }}
      render={({ field, fieldState }) => (
        <FormItem className="min-w-0 grid-cols-1">
          <div className="flex min-w-0 items-center gap-2">
            <FollowCursorTooltip text="Нажмите, чтобы изменить название" disabled={focused} className="min-w-0">
              <div className="group relative -ml-2">
                <FormControl>
                  <Input
                    {...field}
                    aria-label={label}
                    placeholder={label}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                      field.onBlur()
                      setFocused(false)
                    }}
                    className="h-9 w-auto max-w-full field-sizing-content pl-2 pr-7 text-base font-semibold shadow-none border-transparent hover:border-input focus-visible:border-input dark:bg-transparent selection:bg-muted-foreground/30 selection:text-inherit"
                  />
                </FormControl>
                <Pencil aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60 group-hover:opacity-100" />
              </div>
            </FollowCursorTooltip>
            {fieldState.isDirty && (
              <div className="flex shrink-0 items-center gap-1">
                <Button type="submit" size="icon-sm" aria-label="Сохранить название" title="Сохранить название" disabled={pending}>
                  <Check aria-hidden />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Отменить изменение названия" title="Отменить изменение названия" disabled={pending} onClick={() => resetField("name")}>
                  <X aria-hidden />
                </Button>
              </div>
            )}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

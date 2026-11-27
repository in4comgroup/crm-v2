"use client"

import { useState, type ComponentProps } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type SearchableSelectProps = Pick<ComponentProps<"button">, "id" | "ref" | "onBlur" | "disabled" | "aria-describedby" | "aria-invalid"> & {
  label: string
  searchLabel: string
  options: readonly { id: string; name: string }[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  size?: "default" | "sm"
}

export function SearchableSelect({ label, searchLabel, options, value, onValueChange, placeholder, className, size = "default", ...triggerProps }: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)
  const text = placeholder ?? selected?.name ?? label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          aria-label={text === label ? label : `${label}: ${text}`}
          className={cn("min-w-0 justify-between font-normal", placeholder && "text-muted-foreground", className)}
          {...triggerProps}
        >
          <span className="truncate">{text}</span>
          <ChevronDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(16rem,var(--radix-popover-trigger-width))] max-w-(--radix-popover-content-available-width) p-0">
        <Command filter={(_id, query, keywords) =>
          keywords?.[0]?.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")) ? 1 : 0
        }>
          <CommandInput aria-label={searchLabel} placeholder={`${searchLabel}…`} className="focus:outline-none focus-visible:outline-none focus-visible:ring-0" autoFocus />
          <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)_-_2.25rem))]">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.id} value={option.id} keywords={[option.name]} onSelect={() => {
                  onValueChange(option.id)
                  setOpen(false)
                }}>
                  <span className="min-w-0 flex-1 wrap-anywhere">{option.name}</span>
                  {option.id === value && <Check aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

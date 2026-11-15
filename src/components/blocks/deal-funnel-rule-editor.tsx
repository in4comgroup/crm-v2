"use client"

// One stage rule of the owner funnel editor («Что переводит сюда», docs/specs/
// funnel §3.3 / §3.7): signal from the shared catalog, effect, target stage
// (create / move only), «Спрашивать подтверждение», «Уверенность», deal
// types, on / off. Advanced admin guards are not shown here and are kept by
// the server (rules carry their `id`).

import { useState } from "react"
import { Check, ChevronsUpDown, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import type { FunnelCatalogEntry } from "@/components/blocks/deal-funnel-ui"
import {
  EFFECTS_WITH_STAGE,
  RULE_EFFECTS,
  RULE_EFFECT_LABELS_RU,
  type FunnelDealType,
  type FunnelIssue,
  type FunnelRule,
  type FunnelStageConfig,
  type RuleEffect,
} from "@/lib/funnel/config"
import { cn } from "@/lib/utils"

/** A rule of the dialog draft: the config rule + a stable React key. */
export type DraftRule = FunnelRule & { _k: string }

const CONFIDENCE_LABELS_RU: Record<FunnelRule["minConfidence"], string> = {
  medium: "Средняя",
  high: "Высокая",
}

export function needsStage(effect: RuleEffect): boolean {
  return EFFECTS_WITH_STAGE.includes(effect)
}

function SignalCombobox({
  value,
  catalog,
  onChange,
  invalid,
}: {
  value: string
  catalog: readonly FunnelCatalogEntry[]
  onChange: (code: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = catalog.find((c) => c.code === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="h-9 w-full min-w-0 justify-between font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {current ? (
              <>
                {current.labelRu}{" "}
                <span className="text-xs text-muted-foreground">{current.code}</span>
              </>
            ) : value ? (
              <span className="text-destructive">{value} (нет в каталоге)</span>
            ) : (
              <span className="text-muted-foreground">Выберите сигнал</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(90vw,520px)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск: название или код сигнала…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {catalog.map((c) => (
              <CommandItem
                key={c.code}
                value={c.code}
                keywords={[c.labelRu, c.family ?? ""]}
                onSelect={() => {
                  onChange(c.code)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    c.code === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="min-w-0">
                  <div className="truncate">{c.labelRu}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.code}
                    {c.family ? ` · ${c.family}` : ""}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DealTypesMultiSelect({
  value,
  types,
  onChange,
}: {
  value: readonly string[]
  types: readonly FunnelDealType[]
  onChange: (codes: string[]) => void
}) {
  const selected = new Set(value)
  const labelOf = (code: string) =>
    types.find((t) => t.code === code)?.label ?? code
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full min-w-0 justify-between font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {value.length === 0
              ? "Любой тип"
              : value.map(labelOf).join(", ")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
          >
            Любой тип
          </button>
        )}
        {types.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            Типов сделок нет
          </div>
        ) : (
          types.map((t) => (
            <label
              key={t.code}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.has(t.code)}
                onCheckedChange={() =>
                  onChange(
                    selected.has(t.code)
                      ? value.filter((c) => c !== t.code)
                      : [...value, t.code],
                  )
                }
              />
              <span className="truncate">
                {t.label}
                {t.hidden ? " (скрыт)" : ""}
              </span>
            </label>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}

export function RuleRow({
  rule,
  catalog,
  stages,
  dealTypes,
  issues,
  previewCount,
  readOnly,
  onChange,
  onRemove,
}: {
  rule: DraftRule
  catalog: readonly FunnelCatalogEntry[]
  stages: readonly FunnelStageConfig[]
  dealTypes: readonly FunnelDealType[]
  issues: readonly FunnelIssue[]
  /** Signal instances of the last 30 days («Проверить на данных»); null = no fresh preview. */
  previewCount: number | null
  readOnly: boolean
  onChange: (patch: Partial<FunnelRule>) => void
  onRemove: () => void
}) {
  const activeStages = stages.filter((s) => s.role === "active")
  const withStage = needsStage(rule.effect)
  const previewTip = useAnchorTooltip()
  const invalid = issues.length > 0
  return (
    <div
      className={cn(
        "space-y-2 rounded-md border bg-background p-2.5",
        invalid && "border-destructive/60",
        !rule.enabled && "opacity-60",
      )}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]">
        <SignalCombobox
          value={rule.signal}
          catalog={catalog}
          invalid={issues.some((i) => /сигнал/i.test(i.message))}
          onChange={(signal) => onChange({ signal })}
        />
        <Select
          value={rule.effect}
          onValueChange={(v) => {
            const effect = v as RuleEffect
            onChange({
              effect,
              stage: needsStage(effect)
                ? (rule.stage ?? activeStages[0]?.code ?? null)
                : null,
            })
          }}
        >
          <SelectTrigger className="w-full" aria-label="Действие">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULE_EFFECTS.map((e) => (
              <SelectItem key={e} value={e}>
                {RULE_EFFECT_LABELS_RU[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {withStage ? (
          <Select
            value={rule.stage ?? undefined}
            onValueChange={(v) => onChange({ stage: v })}
          >
            <SelectTrigger className="w-full" aria-label="Стадия">
              <SelectValue placeholder="Стадия" />
            </SelectTrigger>
            <SelectContent>
              {activeStages.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center text-xs text-muted-foreground">
            без стадии
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={rule.requiresConfirmation}
            onCheckedChange={(v) => onChange({ requiresConfirmation: v })}
            aria-label="Спрашивать подтверждение"
          />
          Спрашивать подтверждение
        </label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Уверенность</span>
          <Select
            value={rule.minConfidence}
            onValueChange={(v) =>
              onChange({ minConfidence: v as FunnelRule["minConfidence"] })
            }
          >
            <SelectTrigger size="sm" className="w-28" aria-label="Уверенность">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["medium", "high"] as const).map((c) => (
                <SelectItem key={c} value={c}>
                  {CONFIDENCE_LABELS_RU[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">Типы</span>
          <DealTypesMultiSelect
            value={rule.dealTypes}
            types={dealTypes}
            onChange={(codes) => onChange({ dealTypes: codes })}
          />
        </div>
        <label className="flex items-center gap-2">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(v) => onChange({ enabled: v })}
            aria-label="Правило включено"
          />
          Вкл.
        </label>
        {previewCount !== null && (
          <span
            {...previewTip.bind}
            className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
          >
            30 дн: {previewCount}
            <AnchorTooltip
              text="По скольким темам правило сработало бы за 30 дней («Проверить на данных»)"
              open={previewTip.open}
              virtualRef={previewTip.virtualRef}
            />
          </span>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground hover:text-destructive"
            aria-label="Удалить правило"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive">
          {issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

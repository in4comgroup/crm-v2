"use client"

// List-side parts of org custom fields (docs/specs/clients-contacts/01-custom-fields.md
// §3.5): the definitions hook of a list page, the table cell, the compact
// card line, the toolbar button «Фильтр по полям» with its condition editor,
// and the chips of the active conditions. Used by /clients and /contacts.
// The server is the real gate: it drops invalid / hidden / archived filters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ListFilter, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import {
  CUSTOM_FILTERS_MAX,
  filterOpsFor,
  formatCustomValue,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldFilter,
} from "@/lib/custom-fields"

type FilterOp = CustomFieldFilter["op"]

const OP_LABELS: Record<FilterOp, string> = {
  contains: "содержит",
  in: "один из",
  any: "любой из",
  is: "равно",
  range: "в диапазоне",
  filled: "заполнено",
  empty: "не заполнено",
}

const DEBOUNCE_MS = 300

// ── Definitions ───────────────────────────────────────────────────────────

/**
 * The org's non-archived field definitions of one entity (any member) +
 * whether the caller may manage them. `reload` after the owner dialog saves.
 */
export function useCustomFieldDefs(entity: CustomFieldEntity) {
  const [fields, setFields] = useState<CustomFieldDef[]>([])
  const [canManage, setCanManage] = useState(false)
  const [ready, setReady] = useState(false)
  const reqRef = useRef(0)

  // Fetch first, set state in the promise callback (never synchronously in an effect).
  const reload = useCallback(() => {
    const req = ++reqRef.current
    return fetchDefs(entity).then((d) => {
      if (req !== reqRef.current) return
      setReady(true)
      if (!d) return
      setFields(d.fields)
      setCanManage(d.canManage)
    })
  }, [entity])

  useEffect(() => {
    void reload()
  }, [reload])

  return { fields, canManage, ready, reload }
}

async function fetchDefs(
  entity: CustomFieldEntity,
): Promise<{ fields: CustomFieldDef[]; canManage: boolean } | null> {
  try {
    const res = await fetch(`/api/custom-fields?entity=${entity}`)
    if (!res.ok) return null
    const d = (await res.json()) as { fields?: CustomFieldDef[]; canManage?: boolean }
    return { fields: (d.fields ?? []).filter((f) => !f.archivedAt), canManage: Boolean(d.canManage) }
  } catch {
    // Keep the last known definitions; the list still works without them.
    return null
  }
}

const byPosition = (a: CustomFieldDef, b: CustomFieldDef) => a.position - b.position

/** Fields that are list columns: shown, «Показывать в списке», position order. */
export function listColumnFields(fields: readonly CustomFieldDef[]): CustomFieldDef[] {
  return fields.filter((f) => f.isShown && f.showInList && !f.archivedAt).sort(byPosition)
}

/** Fields a list may filter by: shown, not archived, position order. */
export function filterableFields(fields: readonly CustomFieldDef[]): CustomFieldDef[] {
  return fields.filter((f) => f.isShown && !f.archivedAt).sort(byPosition)
}

// ── Filter helpers ────────────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "")
}

/** True when the condition has what its op needs (an incomplete one is not sent). */
export function isCompleteFilter(f: CustomFieldFilter): boolean {
  switch (f.op) {
    case "filled":
    case "empty":
      return true
    case "contains":
      return f.value.trim().length > 0
    case "in":
    case "any":
      return f.value.length > 0
    case "is":
      return typeof f.value === "boolean"
    case "range":
      return !isBlank(f.value.from) || !isBlank(f.value.to)
  }
}

/** Complete conditions of filterable (shown, non-archived) fields — what the list sends. */
export function activeCustomFilters(
  filters: readonly CustomFieldFilter[],
  fields: readonly CustomFieldDef[],
): CustomFieldFilter[] {
  const ok = new Set(filterableFields(fields).map((f) => f.id))
  return filters.filter((f) => ok.has(f.fieldId) && isCompleteFilter(f))
}

function emptyFilter(fieldId: string, op: FilterOp): CustomFieldFilter {
  switch (op) {
    case "contains":
      return { fieldId, op, value: "" }
    case "in":
    case "any":
      return { fieldId, op, value: [] }
    case "is":
      return { fieldId, op, value: true }
    case "range":
      return { fieldId, op, value: {} }
    default:
      return { fieldId, op }
  }
}

function fmtBound(def: CustomFieldDef, v: number | string | null | undefined): string {
  if (isBlank(v)) return ""
  if (def.type === "date") return formatCustomValue(def, v) || String(v)
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }) : String(v)
}

/** Russian chip text, e.g. «Канал: Первый, Второй», «Бюджет: от 1 000». */
export function filterChipText(def: CustomFieldDef, f: CustomFieldFilter): string {
  const label = def.label
  switch (f.op) {
    case "filled":
      return `${label}: заполнено`
    case "empty":
      return `${label}: не заполнено`
    case "contains":
      return `${label}: содержит «${f.value.trim()}»`
    case "in":
    case "any": {
      const options = def.config.options ?? []
      const names = f.value.map((id) => {
        const o = options.find((x) => x.id === id)
        return o ? (o.archived ? `${o.label} (удалён)` : o.label) : "?"
      })
      return `${label}: ${names.join(", ")}`
    }
    case "is":
      return `${label}: ${f.value ? "Да" : "Нет"}`
    case "range": {
      const from = fmtBound(def, f.value.from)
      const to = fmtBound(def, f.value.to)
      if (from && to) return `${label}: ${from} – ${to}`
      if (from) return `${label}: от ${from}`
      return `${label}: до ${to}`
    }
  }
}

// ── Debounced input ───────────────────────────────────────────────────────

/** Text / number / date input that commits ~300 ms after the last keystroke. */
function DebouncedInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onCommit: (v: string) => void
}) {
  const [local, setLocal] = useState(value)
  // Take an outside change (e.g. «Сбросить») without an effect.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setLocal(value)
  }
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => commitRef.current(local), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [local, value])

  return <Input {...props} value={local} onChange={(e) => setLocal(e.target.value)} />
}

// ── Condition editor ──────────────────────────────────────────────────────

function ConditionRow({
  def,
  filter,
  onChange,
  onRemove,
}: {
  def: CustomFieldDef
  filter: CustomFieldFilter
  onChange: (f: CustomFieldFilter) => void
  onRemove: () => void
}) {
  const ops = filterOpsFor(def.type)
  const activeOptions = (def.config.options ?? []).filter((o) => !o.archived)

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{def.label}</span>
        <Select
          value={filter.op}
          onValueChange={(op) => onChange(emptyFilter(def.id, op as FilterOp))}
        >
          <SelectTrigger size="sm" className="w-fit" aria-label="Условие">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ops.map((op) => (
              <SelectItem key={op} value={op}>
                {OP_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Убрать условие"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {filter.op === "contains" && (
        <DebouncedInput
          className="h-8"
          placeholder="Текст"
          value={filter.value}
          onCommit={(v) => onChange({ ...filter, value: v })}
        />
      )}

      {(filter.op === "in" || filter.op === "any") &&
        (activeOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">У поля нет вариантов.</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {activeOptions.map((o) => {
              const checked = filter.value.includes(o.id)
              return (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      onChange({
                        ...filter,
                        value: v ? [...filter.value, o.id] : filter.value.filter((x) => x !== o.id),
                      })
                    }
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              )
            })}
          </div>
        ))}

      {filter.op === "is" && (
        <Tabs
          value={filter.value ? "yes" : "no"}
          onValueChange={(v) => onChange({ ...filter, value: v === "yes" })}
        >
          <TabsList>
            <TabsTrigger value="yes">Да</TabsTrigger>
            <TabsTrigger value="no">Нет</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {filter.op === "range" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">с</span>
          <DebouncedInput
            className="h-8"
            type={def.type === "date" ? "date" : "number"}
            inputMode={def.type === "date" ? undefined : "decimal"}
            value={isBlank(filter.value.from) ? "" : String(filter.value.from)}
            onCommit={(v) => onChange({ ...filter, value: { ...filter.value, from: rangeBound(def, v) } })}
          />
          <span className="text-xs text-muted-foreground">по</span>
          <DebouncedInput
            className="h-8"
            type={def.type === "date" ? "date" : "number"}
            inputMode={def.type === "date" ? undefined : "decimal"}
            value={isBlank(filter.value.to) ? "" : String(filter.value.to)}
            onCommit={(v) => onChange({ ...filter, value: { ...filter.value, to: rangeBound(def, v) } })}
          />
        </div>
      )}
    </div>
  )
}

function rangeBound(def: CustomFieldDef, raw: string): number | string | null {
  const v = raw.trim()
  if (!v) return null
  if (def.type === "date") return v
  const n = Number(v.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

// ── Toolbar button ────────────────────────────────────────────────────────

type FiltersProps = {
  /** Non-archived definitions of the entity (hidden ones are skipped here). */
  fields: readonly CustomFieldDef[]
  value: CustomFieldFilter[]
  onChange: (next: CustomFieldFilter[]) => void
}

/** «Фильтр по полям» — `icon-sm` button + Popover editor. Renders nothing without a shown field. */
export function CustomFieldFiltersButton({ fields, value, onChange }: FiltersProps) {
  const tip = useAnchorTooltip()
  const choices = useMemo(() => filterableFields(fields), [fields])
  const byId = useMemo(() => new Map(choices.map((f) => [f.id, f])), [choices])
  const activeCount = activeCustomFilters(value, fields).length
  if (choices.length === 0) return null

  const rows = value
    .map((f, i) => ({ f, i, def: byId.get(f.fieldId) }))
    .filter((r): r is { f: CustomFieldFilter; i: number; def: CustomFieldDef } => Boolean(r.def))
  const atMax = value.length >= CUSTOM_FILTERS_MAX

  const add = (def: CustomFieldDef) => onChange([...value, emptyFilter(def.id, filterOpsFor(def.type)[0])])
  const update = (i: number, f: CustomFieldFilter) => onChange(value.map((x, j) => (j === i ? f : x)))
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Фильтр по полям"
            className="relative"
            {...tip.bind}
          >
            <ListFilter className="h-4 w-4" />
            {activeCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Фильтр по полям</span>
            {value.length > 0 && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onChange([])}>
                Сбросить
              </Button>
            )}
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Условий нет. Все условия применяются вместе.
              </p>
            )}
            {rows.map(({ f, i, def }) => (
              <ConditionRow
                key={`${i}:${f.fieldId}`}
                def={def}
                filter={f}
                onChange={(next) => update(i, next)}
                onRemove={() => remove(i)}
              />
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="mt-2" disabled={atMax}>
                <Plus className="mr-1 h-4 w-4" />
                Добавить условие
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {choices.map((def) => (
                <DropdownMenuItem key={def.id} onSelect={() => add(def)}>
                  <span className="truncate">{def.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </PopoverContent>
      </Popover>
      <AnchorTooltip
        text={activeCount > 0 ? `фильтр по полям: ${activeCount}` : "фильтр по полям"}
        open={tip.open}
        virtualRef={tip.virtualRef}
      />
    </>
  )
}

// ── Chips ─────────────────────────────────────────────────────────────────

/** Removable chips of the active (complete) conditions + «Сбросить». Nothing when none. */
export function CustomFieldFilterChips({ fields, value, onChange }: FiltersProps) {
  const byId = useMemo(() => new Map(filterableFields(fields).map((f) => [f.id, f])), [fields])
  const chips = value
    .map((f, i) => ({ f, i, def: byId.get(f.fieldId) }))
    .filter((r): r is { f: CustomFieldFilter; i: number; def: CustomFieldDef } => Boolean(r.def) && isCompleteFilter(r.f))
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ f, i, def }) => (
        <Badge key={`${i}:${f.fieldId}`} variant="secondary" className="max-w-full gap-1 pr-1 font-normal">
          <span className="truncate max-w-[20rem]">{filterChipText(def, f)}</span>
          <button
            type="button"
            aria-label="Убрать условие"
            className="rounded-sm p-0.5 hover:bg-foreground/10"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onChange([])}>
        Сбросить
      </Button>
    </div>
  )
}

// ── Display ───────────────────────────────────────────────────────────────

const LONG_CELL = 40

/** One table cell value: «—» when empty, url as a new-tab link, long text truncated with a hint. */
export function CustomFieldCell({ field, value }: { field: CustomFieldDef; value: unknown }) {
  const tip = useAnchorTooltip()
  const text = formatCustomValue(field, value)
  if (!text) return <span className="text-muted-foreground">—</span>

  const long = text.length > LONG_CELL
  const numeric = field.type === "number" || field.type === "currency"
  const hint = long ? (
    <AnchorTooltip text={text} open={tip.open} virtualRef={tip.virtualRef} />
  ) : null

  if (field.type === "url") {
    return (
      <>
        <a
          href={text}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-[16rem] truncate text-[#2F5D77] hover:underline dark:text-[#9FC4DC]"
          onClick={(e) => e.stopPropagation()}
          {...(long ? tip.bind : {})}
        >
          {text.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
        {hint}
      </>
    )
  }

  return (
    <>
      <span
        className={`block max-w-[16rem] truncate ${numeric ? "whitespace-nowrap tabular-nums" : ""}`}
        {...(long ? tip.bind : {})}
      >
        {text}
      </span>
      {hint}
    </>
  )
}

/** Compact card line: up to `max` «Название: значение» pairs of the list fields that have a value. */
export function CustomFieldsSummary({
  fields,
  values,
  max = 3,
}: {
  /** List column fields (see `listColumnFields`). */
  fields: readonly CustomFieldDef[]
  values: Record<string, unknown> | null | undefined
  max?: number
}) {
  const pairs: string[] = []
  for (const f of fields) {
    if (pairs.length >= max) break
    const text = formatCustomValue(f, values?.[f.id])
    if (text) pairs.push(`${f.label}: ${text}`)
  }
  if (pairs.length === 0) return null
  return <div className="truncate text-xs text-muted-foreground">{pairs.join(" · ")}</div>
}

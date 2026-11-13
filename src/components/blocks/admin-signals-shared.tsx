"use client"

// Shared pieces of the «Сигналы» (Signals registry) tab on /settings:
// UI labels for the value lists, the API helpers, the tab context and the
// small form controls every editor uses.
// Contract: src/lib/signals/types.ts. Spec: docs/specs/topics/05-signals-registry.md.

import { createContext, useContext, useState } from "react"
import { ChevronsUpDown, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import type {
  RecipientRole,
  RelationKind,
  SignalEffort,
  SignalEmittedBy,
  SignalFamily,
  SignalRegistryEntity,
  SignalScoreRule,
  SignalsOrgResponse,
  SignalsRegistryResponse,
  SignalsSaveRequest,
  SignalsValidationError,
  StageRuleEffect,
  STAGE_MEANINGS,
  CONFIDENCES,
  ATTRIBUTE_SCOPES,
} from "@/lib/signals/types"

// ── labels for value lists the contract has no Russian labels for ─────────

export const SCORE_RULE_LABELS_RU: Record<SignalScoreRule, string> = {
  fixed: "Фиксированная",
  state: "Состояние (закрывает, без оценки)",
  inherited: "Наследуется от темы",
}

export const EFFORT_LABELS_RU: Record<SignalEffort, string> = {
  quick: "Быстро (2 дня)",
  medium: "Средне (3 дня)",
  complex: "Сложно (5 дней)",
}

export const EMITTED_BY_LABELS_RU: Record<SignalEmittedBy, string> = {
  parser: "Парсер",
  process: "Процесс",
  both: "Парсер и процесс",
}

export const RECIPIENT_LABELS_RU: Record<RecipientRole, string> = {
  relationship: "Отношения с клиентом",
  opportunity: "Возможности",
  account: "Аккаунт",
  finance: "Финансы",
  accounting: "Бухгалтерия",
  logistics: "Логистика",
  team: "Команда",
  new_biz: "Новый бизнес",
  events: "Мероприятия",
}

export const FAMILY_LABELS_RU: Record<SignalFamily, string> = {
  offer: "Предложение (КП)",
  order: "Заказ",
  invoice: "Счёт",
  contract: "Договор",
  complaint: "Жалоба",
  meeting: "Встреча",
  contact: "Контакт",
  pitch: "Питч / тендер",
  delivery: "Поставка",
  account: "Аккаунт",
  market: "Рынок",
  supplier: "Поставщик",
  team: "Команда",
  internal: "Внутреннее",
  competitor: "Конкурент",
}

export const RELATION_LABELS_RU: Record<RelationKind, string> = {
  outranks: "Важнее (outranks)",
  leads_over: "Ведёт тему (leads_over)",
  both: "Оба (both)",
  merges_into: "Сливается в (merges_into)",
  dampens: "Ослабляет (dampens)",
}

export const SCOPE_LABELS_RU: Record<(typeof ATTRIBUTE_SCOPES)[number], string> = {
  message: "Сообщение",
  account: "Аккаунт",
  contact: "Контакт",
}

export const EFFECT_LABELS_RU: Record<StageRuleEffect, string> = {
  create_deal: "Создать сделку",
  move_stage: "Перевести на стадию",
  in_stage: "Контекст стадии",
  outcome_won: "Исход: выиграна",
  outcome_lost: "Исход: проиграна",
  pause: "Пауза",
  resume: "Возобновить",
}

export const MEANING_LABELS_RU: Record<(typeof STAGE_MEANINGS)[number], string> = {
  S1: "S1",
  S2: "S2",
  S3: "S3",
  S4: "S4",
  S5: "S5",
  won: "Выиграна",
  lost: "Проиграна",
}

export const CONFIDENCE_LABELS_RU: Record<(typeof CONFIDENCES)[number], string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
}

// signal_block.audience (01-specification §4.1).
export const AUDIENCE_LABELS_RU: Record<string, string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Деловая информация",
}

export const SOURCE_LABELS_RU: Record<"org" | "pack" | "base", string> = {
  org: "организация",
  pack: "пакет",
  base: "база",
}

export const ENTITY_LABELS_RU: Record<SignalRegistryEntity, string> = {
  pack: "Пакет",
  block: "Блок",
  category: "Код",
  attribute: "Атрибут",
  relation: "Связь",
  pack_override: "Переопределение пакета",
  org_pack: "Пакет организации",
  org_override: "Настройка организации",
  stage_rule: "Правило стадии",
  risk_type: "Тип риска",
  risk_guard: "Риск: стадии организации",
}

export const ACTION_LABELS_RU: Record<"create" | "update" | "delete", string> = {
  create: "создано",
  update: "изменено",
  delete: "удалено",
}

// synonyms_ru groups (05 §3.5). Other keys found in data are shown too.
export const SYNONYM_GROUPS: { key: string; label: string }[] = [
  { key: "business", label: "Деловая переписка" },
  { key: "chat", label: "Мессенджеры, разговорный стиль" },
  { key: "terms", label: "Сокращения и термины" },
  { key: "patterns", label: "Устойчивые конструкции" },
]

export function options<T extends string>(
  values: readonly T[],
  labels?: Partial<Record<T, string>>,
): { value: T; label: string }[] {
  return values.map((v) => ({ value: v, label: labels?.[v] ?? v }))
}

/** Primary key of a pack override row for PUT `key` ("pack:code"). */
export function packOverrideKey(packCode: string, code: string): string {
  return `${packCode}:${code}`
}

// ── API ──────────────────────────────────────────────────────────────────

export const SIGNALS_API = "/api/admin/signals"

export type SaveResult =
  | { ok: true; version: number; warnings?: SignalsValidationError[] }
  | { ok: false; errors: SignalsValidationError[] }

async function errorText(r: Response): Promise<string> {
  const d = (await r.json().catch(() => ({}))) as { error?: string }
  return d.error ?? `HTTP ${r.status}`
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(await errorText(r))
  return (await r.json()) as T
}

/** PUT /api/admin/signals — 400 carries `{ errors }`; nothing is saved then. */
export async function putSignals(req: SignalsSaveRequest): Promise<SaveResult> {
  const r = await fetch(SIGNALS_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  const d = (await r.json().catch(() => ({}))) as {
    version?: number
    errors?: SignalsValidationError[]
    warnings?: SignalsValidationError[]
    error?: string
  }
  if (r.status === 400 && Array.isArray(d.errors)) return { ok: false, errors: d.errors }
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return { ok: true, version: Number(d.version), warnings: d.warnings }
}

/** POST with JSON; 400 `{ errors }` is returned like a PUT. */
export async function postSignals<T extends { version: number }>(
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; errors: SignalsValidationError[] }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const d = (await r.json().catch(() => ({}))) as T & {
    errors?: SignalsValidationError[]
    error?: string
  }
  if (r.status === 400 && Array.isArray(d.errors)) return { ok: false, errors: d.errors }
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return { ok: true, data: d }
}

// ── tab context ─────────────────────────────────────────────────────────

export type SignalsContextValue = {
  registry: SignalsRegistryResponse
  /** Org view of the selected org; null = platform (no org selected). */
  org: SignalsOrgResponse | null
  orgId: string | null
  /** Refetch the registry (and the org view when an org is selected). */
  reload: () => Promise<void>
  /** PUT + toast «Сохранено (версия N)» + reload. Never throws. */
  save: (req: SignalsSaveRequest) => Promise<SaveResult>
}

export const SignalsContext = createContext<SignalsContextValue | null>(null)

export function useSignals(): SignalsContextValue {
  const v = useContext(SignalsContext)
  if (!v) throw new Error("useSignals outside <SignalsContext>")
  return v
}

// ── form helpers ────────────────────────────────────────────────────────

/** Server errors for one field ("field", "field.x", "field[0]"). */
export function fieldErrors(errors: SignalsValidationError[], ...names: string[]): string[] {
  return errors
    .filter((e) =>
      names.some(
        (n) => e.field === n || e.field.startsWith(`${n}.`) || e.field.startsWith(`${n}[`),
      ),
    )
    .map((e) => e.message)
}

/** Keys whose values differ (deep, via JSON). */
export function diffRecord(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = after[k]
  }
  return out
}

/** "" → null; otherwise JSON.parse (object required). */
export function parseJsonObject(
  text: string,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; message: string } {
  const t = text.trim()
  if (!t) return { ok: true, value: null }
  try {
    const v = JSON.parse(t) as unknown
    if (v === null) return { ok: true, value: null }
    if (typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, message: "Нужен JSON-объект { … }" }
    }
    return { ok: true, value: v as Record<string, unknown> }
  } catch (e) {
    return { ok: false, message: `Ошибка JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function jsonText(v: unknown): string {
  return v === null || v === undefined ? "" : JSON.stringify(v, null, 2)
}

export function shortValue(v: unknown, max = 120): string {
  const s = v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// ── small controls ──────────────────────────────────────────────────────

export const NONE = "__none__"

export function FormField({
  label,
  hint,
  errors,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  errors?: string[]
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      {errors?.map((m, i) => (
        <span key={i} className="text-xs text-red-500">
          {m}
        </span>
      ))}
    </div>
  )
}

export function FormSection({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function ErrorList({ errors }: { errors: SignalsValidationError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
      <div className="mb-1 font-medium text-red-600">Сохранение отклонено:</div>
      <ul className="list-disc space-y-0.5 pl-5 text-red-600">
        {errors.map((e, i) => (
          <li key={i}>
            {e.field && <span className="font-mono text-xs">{e.field}: </span>}
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <span className={cn("text-xs tabular-nums", value.length > max ? "text-red-500" : "text-muted-foreground")}>
      {value.length}/{max}
    </span>
  )
}

export function BoolField({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  )
}

/** Select over string options; `nullable` adds a «none» item (value null). */
export function ValueSelect({
  value,
  onChange,
  options: opts,
  nullable,
  noneLabel = "—",
  placeholder,
  className,
  disabled,
  size = "default",
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: { value: string; label: string }[]
  nullable?: boolean
  noneLabel?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  size?: "sm" | "default"
}) {
  const known = value === null || opts.some((o) => o.value === value)
  return (
    <Select
      value={value ?? (nullable ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder ?? "Выберите…"} />
      </SelectTrigger>
      <SelectContent>
        {nullable && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
        {!known && value !== null && <SelectItem value={value}>{value}</SelectItem>}
      </SelectContent>
    </Select>
  )
}

/** Number input that keeps the raw text while typing. */
export function NumberInput({
  value,
  onChange,
  nullable,
  min,
  max,
  placeholder,
  className,
}: {
  value: number | null
  onChange: (v: number | null) => void
  nullable?: boolean
  min?: number
  max?: number
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(value === null ? "" : String(value))
  // Follow outside changes without an effect: re-sync when the parsed text
  // no longer matches the value.
  const parsed = text.trim() === "" ? null : Number(text)
  const shown = parsed === value || (Number.isNaN(parsed) && text !== "") ? text : value === null ? "" : String(value)
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={shown}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.trim() === "") onChange(nullable ? null : 0)
        else if (!Number.isNaN(Number(t))) onChange(Number(t))
      }}
    />
  )
}

/** Editable list of short strings with item / length limits and counters. */
export function ListEditor({
  values,
  onChange,
  maxItems,
  maxLen,
  placeholder,
  addLabel = "Добавить",
}: {
  values: string[]
  onChange: (v: string[]) => void
  maxItems?: number
  maxLen?: number
  placeholder?: string
  addLabel?: string
}) {
  const over = maxItems !== undefined && values.length > maxItems
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={v}
            placeholder={placeholder}
            className={cn("h-8", maxLen !== undefined && v.length > maxLen && "border-red-500")}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {maxLen !== undefined && <CharCount value={v} max={maxLen} />}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Удалить"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...values, ""])}
          disabled={maxItems !== undefined && values.length >= maxItems}
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
        {maxItems !== undefined && (
          <span className={cn("text-xs tabular-nums", over ? "text-red-500" : "text-muted-foreground")}>
            {values.length}/{maxItems}
          </span>
        )}
      </div>
    </div>
  )
}

/** JSON textarea with live validation. */
export function JsonEditor({
  text,
  onText,
  placeholder,
  rows = 6,
}: {
  text: string
  onText: (t: string) => void
  placeholder?: string
  rows?: number
}) {
  const parsed = parseJsonObject(text)
  return (
    <div className="space-y-1">
      <Textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        className={cn("font-mono text-xs", !parsed.ok && "border-red-500")}
      />
      <span className={cn("text-xs", parsed.ok ? "text-muted-foreground" : "text-red-500")}>
        {parsed.ok ? (parsed.value === null ? "Пусто (null)" : "JSON корректен") : parsed.message}
      </span>
    </div>
  )
}

/** Searchable single-value picker (for long lists such as codes). */
export function SearchPicker({
  value,
  onChange,
  options: opts,
  nullable,
  noneLabel = "—",
  placeholder = "Выберите…",
  className,
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: { value: string; label: string; hint?: string }[]
  nullable?: boolean
  noneLabel?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const query = q.trim().toLowerCase()
  const visible = (query
    ? opts.filter((o) => `${o.value} ${o.label}`.toLowerCase().includes(query))
    : opts
  ).slice(0, 200)
  const current = opts.find((o) => o.value === value)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value === null ? (nullable ? noneLabel : placeholder) : current ? current.label : value}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" className="h-8" />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {nullable && (
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              {noneLabel}
            </button>
          )}
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено</div>
          ) : (
            visible.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  o.value === value && "bg-accent",
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Code options for pickers: «CODE — Подпись», retired codes marked. */
export function codeOptions(
  registry: SignalsRegistryResponse,
  opts?: { excludeRetired?: boolean; exclude?: string },
): { value: string; label: string; hint?: string }[] {
  return registry.categories
    .filter((c) => !(opts?.excludeRetired && c.retiredAt) && c.code !== opts?.exclude)
    .map((c) => ({
      value: c.code,
      label: `${c.code} — ${c.labelRu}`,
      hint: c.retiredAt ? "выведен" : c.packCode,
    }))
}

export function stageOptions(org: SignalsOrgResponse | null): { value: string; label: string }[] {
  return (org?.funnelStages ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      value: s.id,
      label: `${s.displayName || s.name}${s.isHidden ? " (скрыта)" : ""}`,
    }))
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Подтвердить",
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-red-600 text-white hover:bg-red-700" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}


"use client"

// «Поля» of one company / contact (docs/specs/clients-contacts/01-custom-fields.md
// §4, decisions Q5 / Q8 / Q9): the SHOWN custom fields in position order,
// grouped by «Раздел», one input per type. One form with «Сохранить» (only
// changed values are sent) + the unsaved-changes guard; inline errors from the
// shared `validateCustomValue`; «История» per field. Every member edits values.
//
// No <form> element: the panel is mounted inside the company drawer's own
// <form>. Enter in a single-line input is swallowed so it never submits that
// outer form, and every button is type="button".

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react"
import { toast } from "sonner"
import { History, Info, Loader, Save, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import { CustomFieldsDialog, currencyLabel, readApi } from "@/components/blocks/custom-fields-dialog"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import {
  CUSTOM_FIELD_CURRENCIES,
  CUSTOM_FIELD_LIMITS,
  formatCustomValue,
  validateCustomValue,
  type CustomFieldDef,
  type CustomFieldEntity,
} from "@/lib/custom-fields"

type ValuesView = { fields: CustomFieldDef[]; values: Record<string, unknown>; canManage: boolean }
type HistoryRow = {
  id: string
  fieldId: string
  before: unknown
  after: unknown
  changedBy: string | null
  createdAt: string
}

/** Lets a host (the company / contact drawer) ask for unsaved changes on close. */
export type CustomFieldsPanelHandle = {
  isDirty: () => boolean
  save: () => Promise<boolean>
}

// ── Draft values (what the inputs hold) ───────────────────────────────────

type CurrencyDraft = { amount: string; currency: string }
type Draft = string | string[] | boolean | null | CurrencyDraft

function toDraft(f: CustomFieldDef, v: unknown): Draft {
  switch (f.type) {
    case "number":
      return typeof v === "number" ? String(v).replace(".", ",") : ""
    case "currency": {
      const c = (v ?? null) as { amount?: unknown; currency?: unknown } | null
      return {
        amount: typeof c?.amount === "number" ? String(c.amount).replace(".", ",") : "",
        currency: typeof c?.currency === "string" ? c.currency : (f.config.currency ?? "RUB"),
      }
    }
    case "multiselect":
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
    case "boolean":
      return typeof v === "boolean" ? v : null
    default:
      return typeof v === "string" ? v : ""
  }
}

/** Raw value for `validateCustomValue` ("" / [] / null = empty). */
function fromDraft(f: CustomFieldDef, d: Draft): unknown {
  if (f.type === "currency") {
    const c = d as CurrencyDraft
    return c.amount.trim() === "" ? null : { amount: c.amount, currency: c.currency }
  }
  return d
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const NONE = "__none__"

// ── One field input ───────────────────────────────────────────────────────

function FieldInput({
  field,
  draft,
  stored,
  onChange,
  invalid,
}: {
  field: CustomFieldDef
  draft: Draft
  stored: unknown
  onChange: (d: Draft) => void
  invalid: boolean
}) {
  const id = `cf-${field.id}`
  const options = field.config.options ?? []
  const storedIds = new Set(Array.isArray(stored) ? stored : typeof stored === "string" ? [stored] : [])
  // Archived options are offered only while the stored value still holds them.
  const visibleOptions = options.filter((o) => !o.archived || storedIds.has(o.id))
  const optLabel = (o: (typeof options)[number]) => (o.archived ? `${o.label} (удалён)` : o.label)

  switch (field.type) {
    case "text":
      return field.config.multiline ? (
        <Textarea
          id={id}
          value={draft as string}
          rows={3}
          maxLength={CUSTOM_FIELD_LIMITS.multilineText}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={draft as string}
          maxLength={CUSTOM_FIELD_LIMITS.text}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case "number":
      return (
        <Input
          id={id}
          value={draft as string}
          inputMode="decimal"
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case "currency": {
      const c = draft as CurrencyDraft
      return (
        <div className="flex gap-2">
          <Input
            id={id}
            value={c.amount}
            inputMode="decimal"
            aria-invalid={invalid}
            className="flex-1"
            onChange={(e) => onChange({ ...c, amount: e.target.value })}
          />
          <Select value={c.currency} onValueChange={(v) => onChange({ ...c, currency: v })}>
            <SelectTrigger className="w-32" aria-label="Валюта">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOM_FIELD_CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {currencyLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }
    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={draft as string}
          aria-invalid={invalid}
          className="w-fit"
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case "select":
      return (
        <Select value={(draft as string) || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
          <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {visibleOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {optLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case "multiselect": {
      const selected = new Set(draft as string[])
      return (
        <div id={id} className="flex flex-wrap gap-1.5" role="group">
          {visibleOptions.length === 0 && <span className="text-sm text-muted-foreground">Нет вариантов</span>}
          {visibleOptions.map((o) => {
            const on = selected.has(o.id)
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? (draft as string[]).filter((x) => x !== o.id) : [...(draft as string[]), o.id]
                  // Keep the option order of the definition.
                  onChange(options.filter((x) => next.includes(x.id)).map((x) => x.id))
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                } ${o.archived ? "line-through decoration-1" : ""}`}
              >
                {optLabel(o)}
              </button>
            )
          })}
        </div>
      )
    }
    case "boolean": {
      const v = draft as boolean | null
      return (
        <div className="flex items-center gap-2 h-9">
          <Switch id={id} checked={v === true} onCheckedChange={(c) => onChange(c)} />
          <span className="text-sm text-muted-foreground">{v === true ? "Да" : v === false ? "Нет" : "Не указано"}</span>
          {v !== null && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Очистить"
              onClick={() => onChange(null)}
            >
              <X />
            </Button>
          )}
        </div>
      )
    }
    case "url":
      return (
        <Input
          id={id}
          type="url"
          inputMode="url"
          value={draft as string}
          maxLength={CUSTOM_FIELD_LIMITS.url}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case "email":
      return (
        <Input
          id={id}
          type="email"
          value={draft as string}
          maxLength={CUSTOM_FIELD_LIMITS.email}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case "phone":
      return (
        <Input
          id={id}
          type="tel"
          value={draft as string}
          maxLength={CUSTOM_FIELD_LIMITS.phone}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

// ── «История» popover ─────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function FieldHistory({
  entity,
  entityId,
  field,
}: {
  entity: CustomFieldEntity
  entityId: string
  field: CustomFieldDef
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/custom-values?entity=${entity}&id=${encodeURIComponent(entityId)}&history=1&fieldId=${field.id}`)
      .then((r) => readApi<{ history: HistoryRow[] }>(r, "Не удалось загрузить историю"))
      .then((d) => !cancelled && setRows(d.history ?? []))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Не удалось загрузить историю"))
    return () => {
      cancelled = true
    }
  }, [open, entity, entityId, field.id])

  const show = (v: unknown) => formatCustomValue(field, v) || "пусто"

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setRows(null)
          setError(null)
        }
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <History className="h-3 w-3" />
          История
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-80 overflow-y-auto p-3">
        <div className="mb-2 text-sm font-medium">История: {field.label}</div>
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : rows === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Изменений пока нет.</div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="text-muted-foreground">
                  {r.changedBy ?? "—"} · {fmtDateTime(r.createdAt)}
                </div>
                <div className="break-words">
                  <span className="text-muted-foreground line-through">{show(r.before)}</span>
                  {" → "}
                  <span>{show(r.after)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ── One field row ─────────────────────────────────────────────────────────

function FieldBlock({
  entity,
  entityId,
  field,
  draft,
  stored,
  error,
  onChange,
}: {
  entity: CustomFieldEntity
  entityId: string
  field: CustomFieldDef
  draft: Draft
  stored: unknown
  error: string | undefined
  onChange: (d: Draft) => void
}) {
  const helpTip = useAnchorTooltip()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`cf-${field.id}`} className="text-xs text-muted-foreground">
          {field.label}
        </Label>
        {field.helpText && (
          <>
            <span {...helpTip.bind} className="inline-flex text-muted-foreground" aria-label={field.helpText}>
              <Info className="h-3.5 w-3.5" />
            </span>
            <AnchorTooltip text={field.helpText} open={helpTip.open} virtualRef={helpTip.virtualRef} />
          </>
        )}
        <span className="ml-auto">
          <FieldHistory entity={entity} entityId={entityId} field={field} />
        </span>
      </div>
      <FieldInput field={field} draft={draft} stored={stored} onChange={onChange} invalid={Boolean(error)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────

export function CustomFieldsPanel({
  entity,
  entityId,
  onChanged,
  onDirtyChange,
  handleRef,
}: {
  entity: CustomFieldEntity
  entityId: string
  /** Called after a successful save. */
  onChanged?: () => void
  onDirtyChange?: (dirty: boolean) => void
  handleRef?: RefObject<CustomFieldsPanelHandle | null>
}) {
  const [view, setView] = useState<ValuesView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const reqRef = useRef(0)

  const shown = useMemo(
    () => (view?.fields ?? []).filter((f) => f.isShown && !f.archivedAt).sort((a, b) => a.position - b.position),
    [view],
  )

  const baseDrafts = useMemo(() => {
    const out: Record<string, Draft> = {}
    for (const f of shown) out[f.id] = toDraft(f, view?.values[f.id])
    return out
  }, [shown, view])

  const changedIds = useMemo(
    () => shown.filter((f) => f.id in drafts && !sameDraft(drafts[f.id], baseDrafts[f.id])).map((f) => f.id),
    [shown, drafts, baseDrafts],
  )
  const isDirty = changedIds.length > 0

  const load = useCallback(
    async (opts?: { keepDrafts?: boolean }) => {
      const req = ++reqRef.current
      try {
        const res = await fetch(`/api/custom-values?entity=${entity}&id=${encodeURIComponent(entityId)}`)
        const data = await readApi<ValuesView>(res, "Не удалось загрузить поля")
        if (req !== reqRef.current) return
        setView(data)
        setLoadError(null)
        // Drafts hold only edited fields; a reload after a definition change keeps them.
        if (!opts?.keepDrafts) setDrafts({})
        setErrors({})
      } catch (e) {
        if (req === reqRef.current) setLoadError(e instanceof Error ? e.message : "Не удалось загрузить поля")
      }
    },
    [entity, entityId],
  )

  // Another record → drop the old view and edits (render-time reset).
  const recordKey = `${entity}:${entityId}`
  const [viewKey, setViewKey] = useState(recordKey)
  if (viewKey !== recordKey) {
    setViewKey(recordKey)
    setView(null)
    setDrafts({})
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const save = useCallback(async (): Promise<boolean> => {
    if (!view) return true
    const values: Record<string, unknown> = {}
    const nextErrors: Record<string, string> = {}
    for (const id of changedIds) {
      const f = shown.find((x) => x.id === id)
      if (!f) continue
      const check = validateCustomValue(f, fromDraft(f, drafts[id]), view.values[id])
      if (check.ok) values[id] = check.value
      else nextErrors[id] = check.message
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Проверьте значения полей")
      return false
    }
    if (Object.keys(values).length === 0) {
      setDrafts({})
      return true
    }
    setSaving(true)
    try {
      const res = await fetch("/api/custom-values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id: entityId, values }),
      })
      const data = await readApi<{ values: Record<string, unknown>; changed: number }>(res, "Не удалось сохранить поля")
      setView((prev) => (prev ? { ...prev, values: data.values ?? prev.values } : prev))
      setDrafts({})
      toast.success("Поля сохранены")
      onChanged?.()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить поля")
      return false
    } finally {
      setSaving(false)
    }
  }, [view, changedIds, shown, drafts, entity, entityId, onChanged])

  useImperativeHandle(handleRef, () => ({ isDirty: () => isDirty, save }), [isDirty, save])

  const { dialog: guardDialog } = useUnsavedChangesGuard({ isDirty, onSave: save })

  // Group by «Раздел»: fields without a section first, then sections in
  // first-appearance order.
  const groups = useMemo(() => {
    const out: { section: string | null; fields: CustomFieldDef[] }[] = [{ section: null, fields: [] }]
    const bySection = new Map<string, CustomFieldDef[]>()
    for (const f of shown) {
      const sec = f.section?.trim() || null
      if (!sec) {
        out[0].fields.push(f)
        continue
      }
      let list = bySection.get(sec)
      if (!list) {
        list = []
        bySection.set(sec, list)
        out.push({ section: sec, fields: list })
      }
      list.push(f)
    }
    return out.filter((g) => g.fields.length > 0)
  }, [shown])

  const manageDialog = view?.canManage ? (
    <CustomFieldsDialog
      entity={entity}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onChanged={() => void load({ keepDrafts: true })}
    />
  ) : null

  if (loadError && !view) {
    return <div className="py-4 text-sm text-destructive">{loadError}</div>
  }
  if (!view) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader className="h-4 w-4 animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 py-4 text-sm text-muted-foreground">
        <span>Поля не настроены</span>
        {view.canManage && (
          <Button type="button" size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Настроить поля
          </Button>
        )}
        {manageDialog}
      </div>
    )
  }

  return (
    <div
      className="space-y-5"
      onKeyDown={(e) => {
        // Never let Enter submit a surrounding <form> (the company drawer).
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault()
      }}
    >
      {groups.map((g) => (
        <section key={g.section ?? "__top__"} className="space-y-3">
          {g.section && <h4 className="text-sm font-medium border-b pb-1">{g.section}</h4>}
          {g.fields.map((f) => (
            <FieldBlock
              key={f.id}
              entity={entity}
              entityId={entityId}
              field={f}
              draft={f.id in drafts ? drafts[f.id] : baseDrafts[f.id]}
              stored={view.values[f.id]}
              error={errors[f.id]}
              onChange={(d) => {
                setDrafts((prev) => ({ ...prev, [f.id]: d }))
                if (errors[f.id]) {
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next[f.id]
                    return next
                  })
                }
              }}
            />
          ))}
        </section>
      ))}

      <div className="flex items-center justify-between gap-2">
        {view.canManage ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Настроить поля
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={() => void save()} disabled={!isDirty || saving}>
          {saving ? <Loader className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Сохранить
        </Button>
      </div>
      {manageDialog}
      {guardDialog}
    </div>
  )
}

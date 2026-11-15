"use client"

// Owner dialog «Поля компаний» / «Поля контактов» — the org's custom field
// DEFINITIONS of one entity (docs/specs/clients-contacts/01-custom-fields.md
// §3, decisions Q1 / Q5 / Q6). List in position order with drag to reorder,
// «Показывать» and «В списке» switches (save at once), «Изменить», «Удалить»
// (archive);
// collapsed «Архив» with «Восстановить» / «Удалить навсегда» (typed label).
// The server is the real gate (owner only, Russian error messages).
//
// No <form> elements here on purpose: the dialog can be opened from the
// «Поля» tab, which lives inside the company drawer's <form>, and a submit
// event of a portaled inner form bubbles through the React tree to it.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { Archive, ChevronRight, Columns3, GripVertical, Loader, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import {
  CUSTOM_FIELD_CURRENCIES,
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS_RU,
  customFieldInputSchema,
  isAllowedTypeChange,
  type CustomFieldConfig,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldOption,
  type CustomFieldType,
} from "@/lib/custom-fields"

const TITLES: Record<CustomFieldEntity, string> = {
  client: "Поля компаний",
  contact: "Поля контактов",
}

const LIST_HINT: Record<CustomFieldEntity, string> = {
  client: "Поле будет колонкой в списке компаний",
  contact: "Поле будет колонкой в списке контактов",
}

/** «₽ RUB» — the currency symbol (ru-RU) + code. */
export function currencyLabel(code: string): string {
  try {
    const sym = new Intl.NumberFormat("ru-RU", { style: "currency", currency: code })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value
    return sym && sym !== code ? `${sym} ${code}` : code
  } catch {
    return code
  }
}

/** Throws an Error with the server's Russian `{ error }` message. */
export async function readApi<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || fallback)
  return body as T
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice()
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

// ── Drag to reorder (native HTML5 DnD + arrow keys on the handle) ─────────
// @dnd-kit/sortable is not a dependency; a short native list sort is enough
// for a dialog list. The row is draggable only while the handle is pressed,
// so text inputs inside a row (option labels) keep normal text selection.
function useDragSort(ids: string[], onMove: (from: number, to: number) => void) {
  const [armedId, setArmedId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // A press released anywhere (not only on the handle) disarms the row.
  useEffect(() => {
    if (!armedId) return
    const disarm = () => setArmedId(null)
    window.addEventListener("pointerup", disarm)
    return () => window.removeEventListener("pointerup", disarm)
  }, [armedId])

  const reset = () => {
    setArmedId(null)
    setDragId(null)
    setOverId(null)
  }

  const rowProps = (id: string) => ({
    draggable: armedId === id,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      if (armedId !== id) {
        e.preventDefault()
        return
      }
      setDragId(id)
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", id)
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (overId !== id) setOverId(id)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      if (dragId && dragId !== id) onMove(ids.indexOf(dragId), ids.indexOf(id))
      reset()
    },
    onDragEnd: reset,
    "data-drag-over":
      dragId && overId === id && dragId !== id
        ? ids.indexOf(dragId) < ids.indexOf(id)
          ? "after"
          : "before"
        : undefined,
    "data-dragging": dragId === id ? "" : undefined,
  })

  const handleProps = (id: string) => ({
    type: "button" as const,
    "aria-label": "Перетащите, чтобы изменить порядок (или стрелки вверх / вниз)",
    onPointerDown: () => setArmedId(id),
    onPointerUp: () => setArmedId(null),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      const i = ids.indexOf(id)
      if (e.key === "ArrowUp" && i > 0) {
        e.preventDefault()
        onMove(i, i - 1)
      } else if (e.key === "ArrowDown" && i < ids.length - 1) {
        e.preventDefault()
        onMove(i, i + 1)
      }
    },
    className:
      "cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  })

  return { rowProps, handleProps }
}

const DRAG_ROW_CLASS =
  "data-[drag-over=before]:border-t-primary data-[drag-over=after]:border-b-primary data-[dragging]:opacity-50"

// ── Field input (create / change) ─────────────────────────────────────────

type EditorState = {
  label: string
  type: CustomFieldType
  currency: string
  decimals: number
  multiline: boolean
  options: CustomFieldOption[]
  helpText: string
  section: string
  isShown: boolean
  showInList: boolean
}

function stateFromField(f: CustomFieldDef | null): EditorState {
  const c = f?.config ?? {}
  return {
    label: f?.label ?? "",
    type: f?.type ?? "text",
    currency: c.currency ?? "RUB",
    decimals: c.decimals ?? (f?.type === "number" ? 0 : 2),
    multiline: Boolean(c.multiline),
    options: (c.options ?? []).map((o) => ({ ...o })),
    helpText: f?.helpText ?? "",
    section: f?.section ?? "",
    isShown: f?.isShown ?? true,
    showInList: f?.showInList ?? false,
  }
}

/** Only the config keys of the chosen type; `systemKey` is never sent (the server keeps it). */
function buildConfig(s: EditorState): CustomFieldConfig {
  switch (s.type) {
    case "text":
      return { multiline: s.multiline }
    case "number":
      return { decimals: s.decimals }
    case "currency":
      return { currency: s.currency, decimals: s.decimals }
    case "select":
    case "multiselect":
      return {
        options: s.options.map((o) => ({
          id: o.id,
          label: o.label.trim(),
          ...(o.archived ? { archived: true } : {}),
        })),
      }
    default:
      return {}
  }
}

function buildFieldInput(s: EditorState) {
  return {
    label: s.label.trim(),
    type: s.type,
    config: buildConfig(s),
    helpText: s.helpText.trim() || null,
    section: s.section.trim() || null,
    isShown: s.isShown,
    // A hidden field is never a list column.
    showInList: s.isShown && s.showInList,
  }
}

/** Field input of an existing definition with one property changed (the «Показывать» / «В списке» switches). */
function inputFromField(f: CustomFieldDef, patch: Partial<EditorState>) {
  return buildFieldInput({ ...stateFromField(f), ...patch })
}

const ADD_OPTION_ID = "__add__"

function FieldEditorDialog({
  entity,
  field,
  open,
  onOpenChange,
  sections,
  onSaved,
}: {
  entity: CustomFieldEntity
  /** null = «Новое поле». */
  field: CustomFieldDef | null
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: string[]
  onSaved: () => void
}) {
  const [s, setS] = useState<EditorState>(() => stateFromField(field))
  const [newOption, setNewOption] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const listTip = useAnchorTooltip()
  const originalOptionIds = useMemo(() => new Set((field?.config.options ?? []).map((o) => o.id)), [field])

  // Fresh state each time the dialog opens (render-time reset, no effect).
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const openKey = open ? (field?.id ?? "new") : null
  if (openKey !== openedFor) {
    setOpenedFor(openKey)
    if (openKey) {
      setS(stateFromField(field))
      setNewOption("")
      setError(null)
    }
  }

  const isEdit = Boolean(field)
  const systemKey = field?.config.systemKey
  const typeLocked = isEdit && (Boolean(systemKey) || field?.type !== "select")
  const typeChoices = isEdit
    ? CUSTOM_FIELD_TYPES.filter((t) => field && isAllowedTypeChange(field.type, t))
    : CUSTOM_FIELD_TYPES
  const isSelect = s.type === "select" || s.type === "multiselect"
  const activeOptions = s.options.filter((o) => !o.archived)
  const archivedOptions = s.options.filter((o) => o.archived)

  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => {
    setS((prev) => ({ ...prev, [k]: v }))
    setError(null)
  }

  const setActiveOptions = (next: CustomFieldOption[]) =>
    set("options", [...next, ...s.options.filter((o) => o.archived)])

  const optionSort = useDragSort(
    activeOptions.map((o) => o.id),
    (from, to) => setActiveOptions(moveItem(activeOptions, from, to)),
  )

  function addOption() {
    const label = newOption.trim()
    if (!label) return
    if (s.options.length >= CUSTOM_FIELD_LIMITS.options) {
      setError(`Не больше ${CUSTOM_FIELD_LIMITS.options} вариантов`)
      return
    }
    setActiveOptions([...activeOptions, { id: crypto.randomUUID(), label }])
    setNewOption("")
  }

  function removeOption(id: string) {
    // An option that exists on the server is archived (old values keep it);
    // a new, unsaved one is simply dropped. Ids are never reused.
    if (originalOptionIds.has(id)) {
      set(
        "options",
        s.options.map((o) => (o.id === id ? { ...o, archived: true } : o)),
      )
    } else {
      set(
        "options",
        s.options.filter((o) => o.id !== id),
      )
    }
  }

  function restoreOption(id: string) {
    setActiveOptions([...activeOptions, ...s.options.filter((o) => o.id === id).map((o) => ({ ...o, archived: false }))])
  }

  async function save() {
    const input = buildFieldInput(s)
    const parsed = customFieldInputSchema.safeParse({ entity, ...input })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте поля формы")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(field ? `/api/custom-fields/${field.id}` : "/api/custom-fields", {
        method: field ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: field ? input : { entity, ...input } }),
      })
      await readApi(res, "Не удалось сохранить поле")
      toast.success(field ? "Поле изменено" : "Поле создано")
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(errText(e, "Не удалось сохранить поле"))
    } finally {
      setSaving(false)
    }
  }

  const datalistId = `cf-sections-${entity}`

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Изменить поле" : "Новое поле"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Переименование не меняет сохранённые значения."
              : "Поле появится во вкладке «Поля» у каждой записи."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cf-label">Название поля</Label>
            <Input
              id="cf-label"
              value={s.label}
              maxLength={CUSTOM_FIELD_LIMITS.label}
              onChange={(e) => set("label", e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Тип</Label>
            <Select
              value={s.type}
              onValueChange={(v) => set("type", v as CustomFieldType)}
              disabled={typeLocked}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeChoices.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CUSTOM_FIELD_TYPE_LABELS_RU[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && systemKey && (
              <p className="text-xs text-muted-foreground">
                Поле используется в аналитике — тип менять нельзя.
              </p>
            )}
            {isEdit && !systemKey && field?.type !== "select" && (
              <p className="text-xs text-muted-foreground">
                Тип поля менять нельзя — создайте новое поле.
              </p>
            )}
            {isEdit && field?.type === "select" && s.type === "multiselect" && (
              <p className="text-xs text-muted-foreground">
                Сохранённые значения станут списком из одного варианта.
              </p>
            )}
          </div>

          {s.type === "text" && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={s.multiline} onCheckedChange={(v) => set("multiline", v)} />
              Многострочный
            </label>
          )}

          {(s.type === "number" || s.type === "currency") && (
            <div className="grid grid-cols-2 gap-3">
              {s.type === "currency" && (
                <div className="space-y-1.5">
                  <Label>Валюта по умолчанию</Label>
                  <Select value={s.currency} onValueChange={(v) => set("currency", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOM_FIELD_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {currencyLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Знаков после запятой</Label>
                <Select value={String(s.decimals)} onValueChange={(v) => set("decimals", Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isSelect && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label>Варианты</Label>
                <span className="text-xs text-muted-foreground">
                  {s.options.length} из {CUSTOM_FIELD_LIMITS.options}
                </span>
              </div>
              {activeOptions.length > 0 && (
                <ul className="space-y-1">
                  {activeOptions.map((o) => (
                    <li
                      key={o.id}
                      {...optionSort.rowProps(o.id)}
                      className={`flex items-center gap-1.5 border-y border-transparent ${DRAG_ROW_CLASS}`}
                    >
                      <button {...optionSort.handleProps(o.id)}>
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <Input
                        value={o.label}
                        maxLength={CUSTOM_FIELD_LIMITS.optionLabel}
                        className="h-8"
                        aria-label="Название варианта"
                        onChange={(e) =>
                          setActiveOptions(
                            activeOptions.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)),
                          )
                        }
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Удалить вариант"
                        onClick={() => removeOption(o.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  id={ADD_OPTION_ID}
                  value={newOption}
                  maxLength={CUSTOM_FIELD_LIMITS.optionLabel}
                  className="h-8"
                  placeholder="Новый вариант"
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addOption()
                    }
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={addOption} disabled={!newOption.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Добавить
                </Button>
              </div>
              {archivedOptions.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-xs text-muted-foreground">
                    Удалённые варианты (остаются на старых значениях):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {archivedOptions.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {o.label}
                        <button
                          type="button"
                          className="hover:text-foreground"
                          aria-label={`Вернуть вариант ${o.label}`}
                          onClick={() => restoreOption(o.id)}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cf-help">Подсказка</Label>
            <Textarea
              id="cf-help"
              value={s.helpText}
              maxLength={CUSTOM_FIELD_LIMITS.helpText}
              rows={2}
              onChange={(e) => set("helpText", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cf-section">Раздел</Label>
            <Input
              id="cf-section"
              value={s.section}
              maxLength={CUSTOM_FIELD_LIMITS.section}
              list={datalistId}
              onChange={(e) => set("section", e.target.value)}
            />
            <datalist id={datalistId}>
              {sections.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Поля с одинаковым разделом показываются вместе под общим заголовком.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={s.isShown} onCheckedChange={(v) => set("isShown", v)} />
              Показывать
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${s.isShown ? "" : "text-muted-foreground"}`}
              {...listTip.bind}
            >
              <Switch
                checked={s.isShown && s.showInList}
                disabled={!s.isShown}
                onCheckedChange={(v) => set("showInList", v)}
              />
              Показывать в списке
            </label>
            <AnchorTooltip text={LIST_HINT[entity]} open={listTip.open} virtualRef={listTip.virtualRef} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="button" onClick={save} disabled={saving || !s.label.trim()}>
            {saving && <Loader className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── List rows ─────────────────────────────────────────────────────────────

function FieldRow({
  field,
  busy,
  rowProps,
  handleProps,
  entity,
  onToggleShown,
  onToggleList,
  onEdit,
  onArchive,
}: {
  field: CustomFieldDef
  busy: boolean
  rowProps: ReturnType<ReturnType<typeof useDragSort>["rowProps"]>
  handleProps: ReturnType<ReturnType<typeof useDragSort>["handleProps"]>
  entity: CustomFieldEntity
  onToggleShown: (v: boolean) => void
  onToggleList: (v: boolean) => void
  onEdit: () => void
  onArchive: () => void
}) {
  const editTip = useAnchorTooltip()
  const archiveTip = useAnchorTooltip()
  const shownTip = useAnchorTooltip()
  const listTip = useAnchorTooltip()
  const inList = field.isShown && field.showInList
  return (
    <li
      {...rowProps}
      className={`flex items-center gap-2 border-y border-transparent py-1.5 ${DRAG_ROW_CLASS}`}
    >
      <button {...handleProps}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`truncate text-sm font-medium ${field.isShown ? "" : "text-muted-foreground"}`}>
            {field.label}
          </span>
          {field.config.systemKey === "client_type" && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Используется в аналитике
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {CUSTOM_FIELD_TYPE_LABELS_RU[field.type]}
          {field.section ? ` · ${field.section}` : ""}
        </div>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Показывать в списке"
        aria-pressed={inList}
        disabled={busy || !field.isShown}
        onClick={() => onToggleList(!inList)}
        className={inList ? "text-primary bg-primary/10 hover:bg-primary/15" : "text-muted-foreground"}
        {...listTip.bind}
      >
        <Columns3 className="h-4 w-4" />
      </Button>
      <span {...shownTip.bind} className="inline-flex">
        <Switch
          checked={field.isShown}
          disabled={busy}
          onCheckedChange={onToggleShown}
          aria-label="Показывать"
        />
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Изменить"
        onClick={onEdit}
        {...editTip.bind}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Удалить"
        disabled={busy}
        onClick={onArchive}
        {...archiveTip.bind}
      >
        <Archive className="h-4 w-4" />
      </Button>
      <AnchorTooltip
        text={field.isShown ? "показывается во вкладке «Поля»" : "скрыто, значения сохраняются"}
        open={shownTip.open}
        virtualRef={shownTip.virtualRef}
      />
      <AnchorTooltip
        text={
          !field.isShown
            ? "скрытое поле не показывается в списке"
            : inList
              ? `${LIST_HINT[entity]} — нажмите, чтобы убрать`
              : `${LIST_HINT[entity]} — нажмите, чтобы добавить`
        }
        open={listTip.open}
        virtualRef={listTip.virtualRef}
      />
      <AnchorTooltip text="изменить" open={editTip.open} virtualRef={editTip.virtualRef} />
      <AnchorTooltip text="удалить (в архив)" open={archiveTip.open} virtualRef={archiveTip.virtualRef} />
    </li>
  )
}

function DeleteForeverDialog({
  field,
  onOpenChange,
  onDeleted,
}: {
  field: CustomFieldDef | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if ((field?.id ?? null) !== shownFor) {
    setShownFor(field?.id ?? null)
    setTyped("")
  }
  const matches = Boolean(field) && typed.trim() === field?.label.trim()

  async function remove() {
    if (!field || !matches) return
    setBusy(true)
    try {
      const res = await fetch(`/api/custom-fields/${field.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmLabel: typed.trim() }),
      })
      await readApi(res, "Не удалось удалить поле")
      toast.success("Поле удалено навсегда")
      onDeleted()
      onOpenChange(false)
    } catch (e) {
      toast.error(errText(e, "Не удалось удалить поле"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={Boolean(field)} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить поле навсегда?</AlertDialogTitle>
          <AlertDialogDescription>
            Поле «{field?.label}» и все его значения будут удалены без возможности восстановления.
            Введите название поля, чтобы подтвердить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Название поля для подтверждения"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void remove()
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={!matches || busy} onClick={remove}>
            {busy && <Loader className="h-4 w-4 mr-1 animate-spin" />}
            Удалить навсегда
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Main dialog ───────────────────────────────────────────────────────────

export function CustomFieldsDialog({
  entity,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  onChanged,
}: {
  entity: CustomFieldEntity
  /** Uncontrolled use: the button that opens the dialog. */
  trigger?: React.ReactNode
  /** Controlled use (e.g. from the empty «Поля» tab). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called after every successful change (definitions, order, archive). */
  onChanged?: () => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = openProp ?? innerOpen
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setInnerOpen(o)
    onOpenChangeProp?.(o)
  }

  const [fields, setFields] = useState<CustomFieldDef[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Kept after close (open = false) so the closing animation keeps its title.
  const [editor, setEditor] = useState<{ field: CustomFieldDef | null; open: boolean }>({
    field: null,
    open: false,
  })
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const reqRef = useRef(0)
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  const load = useCallback(async () => {
    const req = ++reqRef.current
    setLoading(true)
    try {
      const res = await fetch(`/api/custom-fields?entity=${entity}&archived=1`)
      const data = await readApi<{ fields: CustomFieldDef[] }>(res, "Не удалось загрузить поля")
      if (req !== reqRef.current) return
      setFields(data.fields ?? [])
      setLoadError(null)
    } catch (e) {
      if (req === reqRef.current) setLoadError(errText(e, "Не удалось загрузить поля"))
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [entity])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const changed = useCallback(async () => {
    await load()
    onChangedRef.current?.()
  }, [load])

  const active = useMemo(
    () => fields.filter((f) => !f.archivedAt).sort((a, b) => a.position - b.position),
    [fields],
  )
  const archived = useMemo(() => fields.filter((f) => f.archivedAt), [fields])
  const sections = useMemo(
    () => [...new Set(active.map((f) => f.section?.trim()).filter((x): x is string => Boolean(x)))],
    [active],
  )

  async function reorder(from: number, to: number) {
    const next = moveItem(active, from, to)
    if (next.every((f, i) => f.id === active[i]?.id)) return
    const prev = fields
    // Optimistic: rewrite positions locally, revert on failure.
    setFields([...next.map((f, i) => ({ ...f, position: i })), ...archived])
    try {
      const res = await fetch("/api/custom-fields/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, ids: next.map((f) => f.id) }),
      })
      await readApi(res, "Не удалось сохранить порядок")
      onChangedRef.current?.()
    } catch (e) {
      setFields(prev)
      toast.error(errText(e, "Не удалось сохранить порядок"))
    }
  }

  const sort = useDragSort(
    active.map((f) => f.id),
    (from, to) => void reorder(from, to),
  )

  async function toggleShown(f: CustomFieldDef, isShown: boolean) {
    setBusyId(f.id)
    setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, isShown } : x)))
    try {
      const res = await fetch(`/api/custom-fields/${f.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: inputFromField(f, { isShown }) }),
      })
      await readApi(res, "Не удалось сохранить поле")
      onChangedRef.current?.()
    } catch (e) {
      setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, isShown: f.isShown } : x)))
      toast.error(errText(e, "Не удалось сохранить поле"))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleList(f: CustomFieldDef, showInList: boolean) {
    setBusyId(f.id)
    setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, showInList } : x)))
    try {
      const res = await fetch(`/api/custom-fields/${f.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: inputFromField(f, { showInList }) }),
      })
      await readApi(res, "Не удалось сохранить поле")
      onChangedRef.current?.()
    } catch (e) {
      setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, showInList: f.showInList } : x)))
      toast.error(errText(e, "Не удалось сохранить поле"))
    } finally {
      setBusyId(null)
    }
  }

  async function setArchived(f: CustomFieldDef, archive: boolean) {
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/custom-fields/${f.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: archive ? "archive" : "restore" }),
      })
      await readApi(res, archive ? "Не удалось удалить поле" : "Не удалось восстановить поле")
      toast.success(archive ? "Поле перенесено в архив" : "Поле восстановлено")
      await changed()
    } catch (e) {
      toast.error(errText(e, archive ? "Не удалось удалить поле" : "Не удалось восстановить поле"))
    } finally {
      setBusyId(null)
    }
  }

  const atLimit = active.length >= CUSTOM_FIELD_LIMITS.fieldsPerEntity

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{TITLES[entity]}</DialogTitle>
            <DialogDescription>
              Поля видят и заполняют все участники организации во вкладке «Поля». Порядок меняется
              перетаскиванием.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {active.length} из {CUSTOM_FIELD_LIMITS.fieldsPerEntity}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => setEditor({ field: null, open: true })}
              disabled={atLimit || loading}
            >
              <Plus className="h-4 w-4 mr-1" />
              Новое поле
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            {loading && fields.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            ) : loadError ? (
              <div className="py-6 text-sm text-destructive">{loadError}</div>
            ) : active.length === 0 ? (
              <div className="py-6 text-sm text-muted-foreground">Полей пока нет.</div>
            ) : (
              <ul className="divide-y">
                {active.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    busy={busyId === f.id}
                    rowProps={sort.rowProps(f.id)}
                    handleProps={sort.handleProps(f.id)}
                    entity={entity}
                    onToggleShown={(v) => void toggleShown(f, v)}
                    onToggleList={(v) => void toggleList(f, v)}
                    onEdit={() => setEditor({ field: f, open: true })}
                    onArchive={() => void setArchived(f, true)}
                  />
                ))}
              </ul>
            )}

            {archived.length > 0 && (
              <Collapsible open={archiveOpen} onOpenChange={setArchiveOpen} className="mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${archiveOpen ? "rotate-90" : ""}`} />
                    Архив ({archived.length})
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 divide-y">
                    {archived.map((f) => (
                      <li key={f.id} className="flex items-center gap-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-muted-foreground">{f.label}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {CUSTOM_FIELD_TYPE_LABELS_RU[f.type]}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === f.id || atLimit}
                          onClick={() => void setArchived(f, false)}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Восстановить
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={busyId === f.id}
                          onClick={() => setDeleting(f)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Удалить навсегда
                        </Button>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FieldEditorDialog
        entity={entity}
        field={editor.field}
        open={editor.open}
        onOpenChange={(o) => setEditor((prev) => ({ ...prev, open: o }))}
        sections={sections}
        onSaved={() => void changed()}
      />

      <DeleteForeverDialog
        field={deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null)
        }}
        onDeleted={() => void changed()}
      />
    </>
  )
}

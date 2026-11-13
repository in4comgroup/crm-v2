"use client"

// Generic create / edit dialog for the simple registry entities of the
// «Сигналы» tab (pack, block, attribute, relation, risk type). The form is
// built from a field list; a save is one PUT /api/admin/signals (05 §7).

import { useState } from "react"
import { Loader, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MultiCheckSelect } from "@/components/blocks/admin-ai-models"
import type { SignalRegistryEntity, SignalsValidationError } from "@/lib/signals/types"
import {
  BoolField,
  CharCount,
  ConfirmDialog,
  ErrorList,
  FormField,
  ListEditor,
  NumberInput,
  SearchPicker,
  ValueSelect,
  diffRecord,
  fieldErrors,
  useSignals,
} from "@/components/blocks/admin-signals-shared"

export type FieldSpec = {
  name: string
  label: string
  type: "text" | "textarea" | "number" | "bool" | "select" | "multi" | "list" | "picker"
  options?: { value: string; label: string; hint?: string }[]
  /** text: "" → null; select / picker / number: allows null. */
  nullable?: boolean
  noneLabel?: string
  mono?: boolean
  maxLen?: number
  maxItems?: number
  min?: number
  max?: number
  /** Primary-key fields cannot change after create. */
  lockedOnEdit?: boolean
  hint?: string
  /** Spans both grid columns. */
  wide?: boolean
}

type Draft = Record<string, unknown>

export function RecordDialog({
  open,
  onClose,
  title,
  description,
  entity,
  isNew,
  record,
  keyOf,
  fields,
  organizationId,
  canDelete,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  entity: SignalRegistryEntity
  isNew: boolean
  record: Draft
  keyOf: (r: Draft) => string
  fields: FieldSpec[]
  organizationId?: string | null
  canDelete?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && (
          <RecordForm
            key={`${entity}:${isNew ? "new" : keyOf(record)}`}
            entity={entity}
            isNew={isNew}
            record={record}
            keyOf={keyOf}
            fields={fields}
            organizationId={organizationId}
            canDelete={canDelete}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecordForm({
  entity,
  isNew,
  record,
  keyOf,
  fields,
  organizationId,
  canDelete,
  onDone,
}: {
  entity: SignalRegistryEntity
  isNew: boolean
  record: Draft
  keyOf: (r: Draft) => string
  fields: FieldSpec[]
  organizationId?: string | null
  canDelete?: boolean
  onDone: () => void
}) {
  const { save } = useSignals()
  const [draft, setDraft] = useState<Draft>(record)
  const [summary, setSummary] = useState("")
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (name: string, v: unknown) => setDraft((d) => ({ ...d, [name]: v }))

  const buildData = (): Draft => {
    const out: Draft = {}
    for (const f of fields) {
      let v = draft[f.name]
      if (f.type === "text" || f.type === "textarea") {
        const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)
        v = f.nullable && s.trim() === "" ? null : s
      }
      if (f.type === "list" && Array.isArray(v)) v = v.map((x) => String(x).trim()).filter(Boolean)
      out[f.name] = v ?? null
    }
    return out
  }

  const onSave = async () => {
    const data = buildData()
    const payload = isNew ? data : diffRecord(record, data)
    if (!isNew && Object.keys(payload).length === 0) {
      toast.info("Нет изменений")
      return
    }
    setSaving(true)
    const res = await save({
      entity,
      action: isNew ? "create" : "update",
      key: isNew ? undefined : keyOf(record),
      organizationId: organizationId ?? undefined,
      data: payload,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (res.ok) onDone()
    else setErrors(res.errors)
  }

  const onDelete = async () => {
    setSaving(true)
    const res = await save({
      entity,
      action: "delete",
      key: keyOf(record),
      organizationId: organizationId ?? undefined,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (res.ok) onDone()
    else setErrors(res.errors)
  }

  return (
    <>
      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <div className="grid grid-cols-1 gap-4 py-1 sm:grid-cols-2">
          {fields.map((f) => (
            <FormField
              key={f.name}
              label={
                <span className="flex items-center justify-between gap-2">
                  {f.label}
                  {f.maxLen !== undefined && f.type === "text" && (
                    <CharCount value={String(draft[f.name] ?? "")} max={f.maxLen} />
                  )}
                </span>
              }
              hint={f.hint}
              errors={fieldErrors(errors, f.name)}
              className={f.wide || f.type === "textarea" || f.type === "list" ? "sm:col-span-2" : undefined}
            >
              <FieldControl
                spec={f}
                value={draft[f.name]}
                locked={!isNew && !!f.lockedOnEdit}
                onChange={(v) => set(f.name, v)}
              />
            </FormField>
          ))}
        </div>
        <div className="mt-4">
          <ErrorList errors={errors.filter((e) => !fields.some((f) => fieldErrors([e], f.name).length))} />
        </div>
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Причина изменения</span>
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Коротко: что и зачем изменено"
            className="h-8"
          />
        </div>
        <div className="flex items-center gap-2">
          {!isNew && canDelete && (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              Удалить
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving && <Loader className="h-4 w-4 animate-spin" />}
            {isNew ? "Создать" : "Сохранить"}
          </Button>
        </div>
      </DialogFooter>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить запись?"
        description="Удаление создаст новую версию реестра. Отменить его можно только новой записью."
        confirmLabel="Удалить"
        destructive
        onConfirm={onDelete}
      />
    </>
  )
}

function FieldControl({
  spec,
  value,
  locked,
  onChange,
}: {
  spec: FieldSpec
  value: unknown
  locked: boolean
  onChange: (v: unknown) => void
}) {
  switch (spec.type) {
    case "text":
      return (
        <Input
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={locked}
          className={spec.mono ? "font-mono" : undefined}
        />
      )
    case "textarea":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      )
    case "number":
      return (
        <NumberInput
          value={typeof value === "number" ? value : null}
          onChange={onChange}
          nullable={spec.nullable}
          min={spec.min}
          max={spec.max}
        />
      )
    case "bool":
      return <BoolField checked={value === true} onChange={onChange} label="Да" />
    case "select":
      return (
        <ValueSelect
          value={typeof value === "string" ? value : null}
          onChange={onChange}
          options={spec.options ?? []}
          nullable={spec.nullable}
          noneLabel={spec.noneLabel}
          disabled={locked}
        />
      )
    case "picker":
      return (
        <SearchPicker
          value={typeof value === "string" ? value : null}
          onChange={onChange}
          options={spec.options ?? []}
          nullable={spec.nullable}
          noneLabel={spec.noneLabel}
        />
      )
    case "multi":
      return (
        <MultiCheckSelect
          label={spec.label}
          emptyLabel="Не выбрано"
          options={spec.options ?? []}
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          searchable
        />
      )
    case "list":
      return (
        <ListEditor
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          maxItems={spec.maxItems}
          maxLen={spec.maxLen}
        />
      )
  }
}

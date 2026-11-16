"use client"

// Draft card of an AI chat action (docs/specs/ai-chat-tools/01-specification.md
// §7.3, §8.3, §8.4, §10). The model only PROPOSES companies, contacts and
// tasks; the server checked the values and wrote a `data-draft` part. The
// user edits the values here and clicks «Создать» — nothing is created
// without that click. The card re-reads the stored action on mount (a reload
// may show `created`).
import { useEffect, useId, useState, type ReactNode } from "react"
import Link from "next/link"
import { ExternalLink, FilePlus2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  ACTION_KIND_TITLES,
  COMPANY_FIELD_LABELS,
  CONTACT_FIELD_LABELS,
  DEAL_FIELD_LABELS,
  FIELD_SOURCE_LABELS,
  ITEM_TYPE_WORDS,
  MISSING_LABELS,
  TASK_FIELD_LABELS,
  TASK_PRIORITIES,
  TASK_TYPES,
  isOpenActionStatus,
  missingFields,
  type ActionOptions,
  type ActionResult,
  type ChatDraftPart,
  type ChatTaskPriority,
  type ChatTaskType,
  type CompanyValues,
  type ConfirmActionInput,
  type ContactValues,
  type DealMoveValues,
  type DealValues,
  type DraftItem,
  type DraftMatch,
  type FieldMeta,
  type FillChange,
  type ItemDecision,
  type ItemType,
  type LinkValues,
  type OrderRequestValues,
  type RemovedValue,
  type TaskUpdateValues,
  type TaskValues,
  type UpdateValues,
} from "@/lib/chat/actions"
import { dueLabel, isLocalDateTime } from "@/lib/chat/due-date"
import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/task-labels"
import { cn } from "@/lib/utils"

// ── Form state ──────────────────────────────────────────────────────────
// `kind` = the item type (a task has its own `type` field = the task type).

/** Company values as edited in the form (lists as comma-separated text). */
type CompanyForm = {
  kind: "company"
  name: string
  aliases: string
  website: string
  email: string
  phone: string
  address: string
  comment: string
}

/** Contact values as edited in the form (lists as comma-separated text). */
type ContactForm = {
  kind: "contact"
  name: string
  nameNative: string
  position: string
  emails: string
  phones: string
  telegram: string
  companyId: string | null
  companyKey: string | null
  companyName: string
}

type TaskForm = { kind: "task" } & TaskValues

type DealForm = { kind: "deal" } & DealValues

/** «Дополнить запись»: the proposed changes + the indexes the user unticked. */
type UpdateForm = { kind: "update"; skipped: number[] } & UpdateValues

type LinkForm = { kind: "link" } & LinkValues

type OrderRequestForm = { kind: "order_request" } & OrderRequestValues
type DealMoveForm = { kind: "deal_move" } & DealMoveValues
type TaskUpdateForm = { kind: "task_update" } & TaskUpdateValues

type FormValues =
  | CompanyForm
  | ContactForm
  | TaskForm
  | DealForm
  | UpdateForm
  | LinkForm
  | OrderRequestForm
  | DealMoveForm
  | TaskUpdateForm
type FormPatch = Record<string, string | string[] | number[] | boolean | null>

type Control =
  | "text"
  | "list"
  | "multiline"
  | "telegram"
  | "taskType"
  | "priority"
  | "due"
  | "assignee"
  | "money"
  | "dealType"
  | "stage"
type FieldDef = {
  /** Form field the control edits. */
  field: string
  label: string
  control: Control
  /** Keys of `item.meta` / `item.removed` that belong to this control (default: `field`). */
  keys?: string[]
  /** Spans the whole row of the field grid. */
  wide?: boolean
}

const COMPANY_FIELDS: FieldDef[] = [
  { field: "name", label: COMPANY_FIELD_LABELS.name, control: "text" },
  { field: "aliases", label: COMPANY_FIELD_LABELS.aliases, control: "list" },
  { field: "website", label: COMPANY_FIELD_LABELS.website, control: "text" },
  { field: "email", label: COMPANY_FIELD_LABELS.email, control: "text" },
  { field: "phone", label: COMPANY_FIELD_LABELS.phone, control: "text" },
  { field: "address", label: COMPANY_FIELD_LABELS.address, control: "text" },
  { field: "comment", label: COMPANY_FIELD_LABELS.comment, control: "multiline", wide: true },
]

const CONTACT_FIELDS: FieldDef[] = [
  { field: "name", label: CONTACT_FIELD_LABELS.name, control: "text" },
  { field: "nameNative", label: CONTACT_FIELD_LABELS.nameNative, control: "text" },
  { field: "position", label: CONTACT_FIELD_LABELS.position, control: "text" },
  { field: "emails", label: CONTACT_FIELD_LABELS.emails, control: "list" },
  { field: "phones", label: CONTACT_FIELD_LABELS.phones, control: "list" },
  { field: "telegram", label: CONTACT_FIELD_LABELS.telegram, control: "telegram" },
]

const TASK_FIELDS: FieldDef[] = [
  { field: "title", label: TASK_FIELD_LABELS.title, control: "text", wide: true },
  { field: "dueDate", label: TASK_FIELD_LABELS.dueDate, control: "due", keys: ["dueDate", "dueText"] },
  { field: "assigneeId", label: TASK_FIELD_LABELS.assigneeName, control: "assignee", keys: ["assigneeId", "assigneeName"] },
  { field: "type", label: TASK_FIELD_LABELS.type, control: "taskType" },
  { field: "priority", label: TASK_FIELD_LABELS.priority, control: "priority" },
  { field: "description", label: TASK_FIELD_LABELS.description, control: "multiline", wide: true },
]

const DEAL_FIELDS: FieldDef[] = [
  { field: "name", label: DEAL_FIELD_LABELS.name, control: "text", wide: true },
  { field: "value", label: DEAL_FIELD_LABELS.value, control: "money", keys: ["value", "valueText", "currency"] },
  { field: "dealTypeId", label: DEAL_FIELD_LABELS.dealTypeName, control: "dealType", keys: ["dealTypeId", "dealTypeName"] },
  { field: "stageId", label: DEAL_FIELD_LABELS.stageName, control: "stage", keys: ["stageId", "stageName", "ruleNote"] },
  { field: "description", label: DEAL_FIELD_LABELS.description, control: "multiline", wide: true },
]

// «Дополнить» / «Связать» items have no editable fields (own blocks below).
const FIELDS: Record<ItemType, FieldDef[]> = {
  company: COMPANY_FIELDS,
  contact: CONTACT_FIELDS,
  deal: DEAL_FIELDS,
  task: TASK_FIELDS,
  update: [],
  link: [],
  order_request: [{ field: "comment", label: "Комментарий", control: "text", wide: true }],
  deal_move: [],
  task_update: [],
}

const ITEM_ORDER: Record<ItemType, number> = {
  company: 0,
  contact: 1,
  deal: 2,
  task: 3,
  update: 4,
  link: 5,
  order_request: 6,
  deal_move: 7,
  task_update: 8,
}

/** Label of an item's «include» checkbox in a card with several items. */
const INCLUDE_LABELS: Partial<Record<ItemType, string>> = {
  update: "Дополнить запись",
  link: "Связать записи",
  order_request: "Разобрать запрос",
  deal_move: "Перевести сделку",
  task_update: "Изменить задачу",
}

/** Deal currencies; "" = the company's currency. */
const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "валюта компании" },
  { value: "RUB", label: "₽" },
  { value: "USD", label: "$" },
  { value: "EUR", label: "€" },
  { value: "CNY", label: "¥" },
  { value: "GBP", label: "£" },
]

/** Task types offered in the picker («support» only when the draft already has it). */
const PICKABLE_TASK_TYPES: readonly ChatTaskType[] = TASK_TYPES.filter((t) => t !== "support")

function toForm(item: DraftItem): FormValues {
  if (item.type === "company") {
    const v = item.values as CompanyValues
    return {
      kind: "company",
      name: v.name ?? "",
      aliases: (v.aliases ?? []).join(", "),
      website: v.website ?? "",
      email: v.email ?? "",
      phone: v.phone ?? "",
      address: v.address ?? "",
      comment: v.comment ?? "",
    }
  }
  if (item.type === "contact") {
    const v = item.values as ContactValues
    return {
      kind: "contact",
      name: v.name ?? "",
      nameNative: v.nameNative ?? "",
      position: v.position ?? "",
      emails: (v.emails ?? []).join(", "),
      phones: (v.phones ?? []).join(", "),
      telegram: v.telegram ?? "",
      companyId: v.companyId ?? null,
      companyKey: v.companyKey ?? null,
      companyName: v.companyName ?? "",
    }
  }
  if (item.type === "deal") {
    const v = item.values as DealValues
    return {
      kind: "deal",
      name: v.name ?? "",
      description: v.description ?? "",
      companyId: v.companyId ?? null,
      companyKey: v.companyKey ?? null,
      companyName: v.companyName ?? "",
      contactIds: v.contactIds ?? [],
      contactKeys: v.contactKeys ?? [],
      contactNames: v.contactNames ?? [],
      value: v.value ?? "",
      valueText: v.valueText ?? "",
      currency: v.currency ?? "",
      dealTypeId: v.dealTypeId ?? null,
      dealTypeName: v.dealTypeName ?? "",
      stageId: v.stageId ?? null,
      stageName: v.stageName ?? "",
      ruleNote: v.ruleNote ?? "",
    }
  }
  if (item.type === "update") {
    const v = item.values as UpdateValues
    return {
      kind: "update",
      targetType: v.targetType,
      targetId: v.targetId,
      targetName: v.targetName ?? "",
      changes: v.changes ?? [],
      skipped: [],
    }
  }
  if (item.type === "order_request") {
    const v = item.values as OrderRequestValues
    return {
      kind: "order_request",
      clientId: v.clientId ?? null,
      companyKey: v.companyKey ?? null,
      clientName: v.clientName ?? "",
      requestText: v.requestText ?? "",
      comment: v.comment ?? "",
    }
  }
  if (item.type === "deal_move") {
    const v = item.values as DealMoveValues
    return {
      kind: "deal_move",
      dealId: v.dealId,
      dealName: v.dealName ?? "",
      fromStageName: v.fromStageName ?? "",
      stageId: v.stageId ?? null,
      stageName: v.stageName ?? "",
      outcome: v.outcome ?? null,
      reasonCode: v.reasonCode ?? "",
      reasonText: v.reasonText ?? "",
    }
  }
  if (item.type === "task_update") {
    const v = item.values as TaskUpdateValues
    return {
      kind: "task_update",
      taskId: v.taskId,
      taskTitle: v.taskTitle ?? "",
      action: v.action ?? "done",
      dueDate: v.dueDate ?? "",
      dueText: v.dueText ?? "",
      currentDue: v.currentDue ?? "",
    }
  }
  if (item.type === "link") {
    const v = item.values as LinkValues
    return {
      kind: "link",
      contactId: v.contactId ?? null,
      contactName: v.contactName ?? "",
      clientId: v.clientId ?? null,
      clientName: v.clientName ?? "",
      primary: v.primary ?? false,
      dealId: v.dealId ?? null,
      dealName: v.dealName ?? "",
    }
  }
  const v = item.values as TaskValues
  return {
    kind: "task",
    title: v.title ?? "",
    description: v.description ?? "",
    type: v.type ?? "other",
    priority: v.priority ?? "medium",
    dueDate: v.dueDate ?? "",
    dueText: v.dueText ?? "",
    assigneeId: v.assigneeId ?? null,
    assigneeName: v.assigneeName ?? "",
    companyId: v.companyId ?? null,
    companyKey: v.companyKey ?? null,
    companyName: v.companyName ?? "",
    contactId: v.contactId ?? null,
    contactKey: v.contactKey ?? null,
    contactName: v.contactName ?? "",
    dealId: v.dealId ?? null,
    dealKey: v.dealKey ?? null,
    dealName: v.dealName ?? "",
    done: v.done ?? false,
  }
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Form → the values sent to `POST /api/chat/actions`. */
function toValues(
  form: FormValues,
):
  | CompanyValues
  | ContactValues
  | TaskValues
  | DealValues
  | UpdateValues
  | LinkValues
  | OrderRequestValues
  | DealMoveValues
  | TaskUpdateValues {
  if (form.kind === "order_request") {
    const { kind: _o, ...o } = form
    void _o
    return { ...o, comment: o.comment.trim() }
  }
  if (form.kind === "deal_move") {
    const { kind: _m, ...m } = form
    void _m
    // A reason belongs only to a lost outcome.
    return { ...m, reasonCode: m.outcome === "lost" ? m.reasonCode : "", reasonText: m.reasonText.trim() }
  }
  if (form.kind === "task_update") {
    const { kind: _u, ...u } = form
    void _u
    return { ...u, dueDate: u.action === "reschedule" ? u.dueDate : "" }
  }
  if (form.kind === "update") {
    return {
      targetType: form.targetType,
      targetId: form.targetId,
      targetName: form.targetName,
      // Unticked changes are not sent.
      changes: form.changes.filter((_, i) => !form.skipped.includes(i)),
    }
  }
  if (form.kind === "link") {
    const { kind: _link, ...link } = form
    void _link
    return link
  }
  if (form.kind === "company") {
    return {
      name: form.name.trim(),
      aliases: splitList(form.aliases),
      website: form.website.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      comment: form.comment.trim(),
    }
  }
  if (form.kind === "contact") {
    return {
      name: form.name.trim(),
      nameNative: form.nameNative.trim(),
      position: form.position.trim(),
      emails: splitList(form.emails),
      phones: splitList(form.phones),
      telegram: form.telegram.trim().replace(/^@+/, ""),
      companyId: form.companyId,
      companyKey: form.companyKey,
      companyName: form.companyName.trim(),
    }
  }
  if (form.kind === "deal") {
    const { kind: _deal, ...deal } = form
    void _deal
    return {
      ...deal,
      name: deal.name.trim(),
      description: deal.description.trim(),
      value: deal.value.replace(/\D/g, ""),
      companyName: deal.companyName.trim(),
    }
  }
  const { kind: _kind, ...task } = form
  void _kind
  return {
    ...task,
    title: task.title.trim(),
    description: task.description.trim(),
    dueText: task.dueText.trim(),
    assigneeName: task.assigneeName.trim(),
  }
}

function fieldText(form: FormValues, field: string): string {
  const v = (form as Record<string, unknown>)[field]
  return typeof v === "string" ? v : ""
}

/** Name of a company / contact / deal, title of a task — from the edited form. */
function formLabel(form: FormValues): string {
  if (form.kind === "task") return form.title.trim()
  if (form.kind === "update") return form.targetName.trim()
  if (form.kind === "link") return form.contactName.trim()
  if (form.kind === "order_request") return form.clientName.trim()
  if (form.kind === "deal_move") return form.dealName.trim()
  if (form.kind === "task_update") return form.taskTitle.trim()
  return form.name.trim()
}

// ── Duplicate choice (§8.3) ─────────────────────────────────────────────

type ChoiceOption = {
  value: string
  label: string
  decision: ItemDecision
  existingId?: string
  /** «Дополнить существующий»: what would be added. */
  fill?: FillChange[]
}

const MATCH_TYPE_LABELS: Record<DraftMatch["type"], string> = { client: "Компания", contact: "Контакт", deal: "Сделка" }
const RESULT_TYPE_LABELS: Record<ActionResult["type"], string> = {
  order_request: "Запрос клиента",
  client: "Компания",
  contact: "Контакт",
  task: "Задача",
  deal: "Сделка",
}

function matchHref(m: DraftMatch): string {
  const e = encodeURIComponent(m.id)
  return m.type === "client" ? `/clients/${e}` : m.type === "deal" ? `/deals?openDeal=${e}` : `/contacts?openContact=${e}`
}

function matchName(m: DraftMatch): string {
  return `«${m.title}»${m.subtitle ? ` (${m.subtitle})` : ""}`
}

/** Radio options of an item, from its exact / deleted matches. Empty = plain create. */
function choiceOptions(item: DraftItem): ChoiceOption[] {
  const exact = item.matches.filter((m) => m.kind === "exact")
  const deleted = item.matches.filter((m) => m.kind === "deleted")
  if (!exact.length && !deleted.length) return []
  // A deal is feminine in Russian («сделка»): «существующую» / «новую».
  const deal = item.type === "deal"
  const out: ChoiceOption[] = []
  for (const m of exact) {
    out.push({
      value: `use:${m.id}`,
      label:
        exact.length === 1
          ? deal
            ? "Использовать существующую"
            : "Использовать существующий"
          : `Использовать ${matchName(m)}`,
      decision: "use_existing",
      existingId: m.id,
    })
    // T4: opt-in «Дополнить существующий» when the record lacks some of the values.
    if (m.fill?.length) {
      out.push({
        value: `fill:${m.id}`,
        label: exact.length === 1 ? "Дополнить существующий" : `Дополнить ${matchName(m)}`,
        decision: "fill_existing",
        existingId: m.id,
        fill: m.fill,
      })
    }
  }
  for (const m of deleted) {
    out.push({
      value: `restore:${m.id}`,
      label: deleted.length === 1 ? "Восстановить" : `Восстановить ${matchName(m)}`,
      decision: "restore",
      existingId: m.id,
    })
  }
  out.push(
    exact.length
      ? { value: "create_anyway", label: deal ? "Всё равно создать новую" : "Всё равно создать новый", decision: "create_anyway" }
      : { value: "create", label: "Создать новую", decision: "create" },
  )
  return out
}

/** The chosen option: the user's pick while it is still offered, else the default. */
function effectiveChoice(options: ChoiceOption[], picked: string | undefined): ChoiceOption | null {
  if (!options.length) return null
  const hit = options.find((o) => o.value === picked)
  if (hit) return hit
  // Default: use the (first) exact match; with only deleted matches — create.
  return options.find((o) => o.decision === "use_existing") ?? options.find((o) => o.decision === "create") ?? options[0]
}

// ── Small parts ─────────────────────────────────────────────────────────

function sourceHint(meta: FieldMeta | undefined): string | null {
  if (!meta) return null
  if (meta.source === "file") return meta.fileName ? `из файла «${meta.fileName}»` : FIELD_SOURCE_LABELS.file
  return FIELD_SOURCE_LABELS[meta.source] ?? null
}

function RemovedList({ removed }: { removed: RemovedValue[] }) {
  if (!removed.length) return null
  return (
    <ul className="mt-0.5 space-y-0.5">
      {removed.map((r, i) => (
        <li key={`${r.field}-${i}`} className="text-[11px]">
          <span className="text-muted-foreground line-through">{r.value}</span>
          <span className="text-muted-foreground"> — {r.reason}</span>
        </li>
      ))}
    </ul>
  )
}

const INPUT_CLASS = "h-7 px-2 text-xs md:text-xs"
const SELECT_CLASS =
  "h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-1.5 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&>option]:bg-background"

function FieldRow({
  id,
  def,
  form,
  meta,
  removed,
  disabled,
  options,
  onChange,
}: {
  id: string
  def: FieldDef
  form: FormValues
  meta: FieldMeta | undefined
  removed: RemovedValue[]
  disabled: boolean
  options: ActionOptions | undefined
  onChange: (patch: FormPatch) => void
}) {
  const value = fieldText(form, def.field)
  const hint = value.trim() ? sourceHint(meta) : null
  // «Уже было»: the due field is when the meeting / call happened (may be in the past).
  const done = form.kind === "task" && form.done
  const label = def.control === "due" && done ? "Когда было" : def.label
  let control: ReactNode
  let below: ReactNode = null
  switch (def.control) {
    case "multiline":
      control = (
        <Textarea
          id={id}
          value={value}
          disabled={disabled}
          rows={2}
          onChange={(e) => onChange({ [def.field]: e.target.value })}
          className="min-h-12 px-2 py-1 text-xs md:text-xs"
        />
      )
      break
    case "telegram":
      control = (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs" aria-hidden>
            @
          </span>
          <Input
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange({ [def.field]: e.target.value.replace(/^@+/, "") })}
            className={INPUT_CLASS}
          />
        </div>
      )
      break
    case "taskType": {
      const types: readonly ChatTaskType[] = PICKABLE_TASK_TYPES.includes(value as ChatTaskType)
        ? PICKABLE_TASK_TYPES
        : [...PICKABLE_TASK_TYPES, value as ChatTaskType]
      control = (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange({ type: e.target.value })}
          className={SELECT_CLASS}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      )
      break
    }
    case "priority":
      control = (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange({ priority: e.target.value })}
          className={SELECT_CLASS}
        >
          {TASK_PRIORITIES.map((p: ChatTaskPriority) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      )
      break
    case "due":
      // The org-local wall time is bound as is: the server reads it in the org time zone.
      control = (
        <Input
          id={id}
          type="datetime-local"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange({ dueDate: e.target.value })}
          className={INPUT_CLASS}
        />
      )
      below = (
        <>
          <p className="text-muted-foreground text-[10px]">
            {isLocalDateTime(value) && <span>{dueLabel(value)} · </span>}
            {options?.timeZone ? `время организации: ${options.timeZone}` : "время организации"}
          </p>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`${id}-done`}
              checked={done}
              disabled={disabled}
              onCheckedChange={(v) => onChange({ done: v === true })}
              className="size-3.5"
            />
            <label htmlFor={`${id}-done`} className="text-[11px]">
              Уже было (записать встречу / звонок)
            </label>
          </div>
        </>
      )
      break
    case "assignee": {
      const members = options?.members ?? []
      const t = form as TaskForm
      const known = !t.assigneeId || members.some((m) => m.id === t.assigneeId)
      control = (
        <select
          id={id}
          value={t.assigneeId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const m = members.find((x) => x.id === e.target.value)
            onChange({ assigneeId: m ? m.id : null, assigneeName: m ? m.name : "" })
          }}
          className={SELECT_CLASS}
        >
          {!t.assigneeId && <option value="">— выберите —</option>}
          {!known && t.assigneeId && <option value={t.assigneeId}>{t.assigneeName || "исполнитель"}</option>}
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )
      break
    }
    case "money": {
      const d = form as DealForm
      control = (
        <div className="flex items-center gap-1">
          <Input
            id={id}
            inputMode="numeric"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange({ value: e.target.value.replace(/\D/g, "") })}
            className={INPUT_CLASS}
          />
          <select
            aria-label="Валюта"
            value={d.currency}
            disabled={disabled}
            onChange={(e) => onChange({ currency: e.target.value })}
            className={cn(SELECT_CLASS, "w-auto shrink-0")}
          >
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )
      if (d.valueText.trim()) below = <p className="text-muted-foreground text-[10px]">из сообщения: {d.valueText}</p>
      break
    }
    case "dealType": {
      const types = options?.dealTypes ?? []
      const d = form as DealForm
      const known = !d.dealTypeId || types.some((t) => t.id === d.dealTypeId)
      control = (
        <select
          id={id}
          value={d.dealTypeId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const t = types.find((x) => x.id === e.target.value)
            onChange({ dealTypeId: t ? t.id : null, dealTypeName: t ? t.name : "" })
          }}
          className={SELECT_CLASS}
        >
          <option value="">— без типа —</option>
          {!known && d.dealTypeId && <option value={d.dealTypeId}>{d.dealTypeName || "тип"}</option>}
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )
      break
    }
    case "stage": {
      const stages = options?.stages ?? []
      const d = form as DealForm
      const known = !d.stageId || stages.some((x) => x.id === d.stageId)
      control = (
        <select
          id={id}
          value={d.stageId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const st = stages.find((x) => x.id === e.target.value)
            onChange({ stageId: st ? st.id : null, stageName: st ? st.name : "" })
          }}
          className={SELECT_CLASS}
        >
          {!d.stageId && <option value="">— выберите —</option>}
          {!known && d.stageId && <option value={d.stageId}>{d.stageName || "стадия"}</option>}
          {stages.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )
      if (d.ruleNote.trim()) below = <p className="text-muted-foreground text-[10px]">{d.ruleNote}</p>
      break
    }
    default:
      control = (
        <Input
          id={id}
          value={value}
          disabled={disabled}
          placeholder={def.control === "list" ? "через запятую" : undefined}
          onChange={(e) => onChange({ [def.field]: e.target.value })}
          className={INPUT_CLASS}
        />
      )
  }
  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-muted-foreground text-[11px]">
          {label}
        </label>
        {hint && <span className="text-muted-foreground/80 text-[10px]">{hint}</span>}
      </div>
      {control}
      {below}
      <RemovedList removed={removed} />
    </div>
  )
}

/** A read-only link line («Компания: …») with an optional «убрать». */
function LinkLine({
  label,
  name,
  dropped,
  masculine,
  disabled,
  onClear,
}: {
  label: string
  name: string
  /** The linked item of this card is unticked — the server drops the link. */
  dropped?: boolean
  /** Grammatical gender of the linked item («создан» / «создана»). */
  masculine?: boolean
  disabled: boolean
  onClear?: () => void
}) {
  return (
    <p className={cn("text-xs", dropped && "text-muted-foreground")}>
      <span className="text-muted-foreground">{label}:</span> {name || "без названия"}
      {dropped && (masculine ? " (не будет создан)" : " (не будет создана)")}
      {onClear && (
        <>
          {" "}
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            убрать
          </button>
        </>
      )}
    </p>
  )
}

/** «Дополнить запись»: the target record + one checkbox per change. */
function UpdateBlock({
  form,
  idPrefix,
  disabled,
  onToggle,
}: {
  form: UpdateForm
  idPrefix: string
  disabled: boolean
  onToggle: (index: number, on: boolean) => void
}) {
  const e = encodeURIComponent(form.targetId)
  const href = form.targetType === "client" ? `/clients/${e}` : `/contacts?openContact=${e}`
  return (
    <div className="space-y-1 text-xs">
      <p>
        {form.targetType === "client" ? "Компания" : "Контакт"}{" "}
        <Link href={href} className="underline underline-offset-2">
          «{form.targetName || "без названия"}»
        </Link>
      </p>
      {form.changes.length > 0 && (
        <ul className="space-y-1">
          {form.changes.map((c, i) => {
            const cid = `${idPrefix}-change-${i}`
            return (
              <li key={`${c.field}-${i}`} className="flex items-center gap-2">
                <Checkbox
                  id={cid}
                  checked={!form.skipped.includes(i)}
                  disabled={disabled}
                  onCheckedChange={(v) => onToggle(i, v === true)}
                  className="size-3.5"
                />
                <label htmlFor={cid}>
                  <span className="text-muted-foreground">{c.label}:</span> {c.value}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** «Связать записи»: contact → company (+ «основная») and / or deal; read-only. */
function LinkBlock({
  form,
  idPrefix,
  disabled,
  onPrimary,
}: {
  form: LinkForm
  idPrefix: string
  disabled: boolean
  onPrimary: (on: boolean) => void
}) {
  return (
    <div className="space-y-1 text-xs">
      {form.contactId && (
        <p>
          <span className="text-muted-foreground">Контакт:</span> {form.contactName || "без имени"}
        </p>
      )}
      {form.clientId && (
        <>
          <p>
            <span className="text-muted-foreground">→ Компания:</span> {form.clientName || "без названия"}
          </p>
          <div className="flex items-center gap-2 pl-3">
            <Checkbox
              id={`${idPrefix}-primary`}
              checked={form.primary}
              disabled={disabled}
              onCheckedChange={(v) => onPrimary(v === true)}
              className="size-3.5"
            />
            <label htmlFor={`${idPrefix}-primary`}>Сделать основной компанией контакта</label>
          </div>
        </>
      )}
      {form.dealId && (
        <p>
          <span className="text-muted-foreground">→ Сделка:</span> {form.dealName || "без названия"}
        </p>
      )}
    </div>
  )
}

/** Main button text by what the included items do. */
const SINGLE_SUBMIT_LABELS: Partial<Record<ItemType, string>> = {
  order_request: "Разобрать запрос",
  deal_move: "Перевести",
  task_update: "Сохранить",
}

function submitLabel(types: ItemType[]): string {
  if (types.length === 1 && SINGLE_SUBMIT_LABELS[types[0]]) return SINGLE_SUBMIT_LABELS[types[0]] as string
  if (types.length > 0 && types.every((t) => t === "update")) return "Дополнить"
  if (types.length > 0 && types.every((t) => t === "link")) return "Связать"
  return types.length > 1 ? "Создать всё" : "Создать"
}

/** «Заказ из запроса»: the client's request, read-only. */
function OrderRequestBlock({ form }: { form: OrderRequestForm }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-[11px]">Текст запроса клиента — из сообщения / файла</p>
      <div className="text-muted-foreground max-h-40 overflow-y-auto rounded-md border border-dashed bg-muted/30 px-2 py-1 text-xs whitespace-pre-wrap">
        {form.requestText || "—"}
      </div>
    </div>
  )
}

/** «Перевести сделку»: target stage; won / lost by the stage role; lost needs a reason. */
function DealMoveBlock({
  form,
  idPrefix,
  disabled,
  options,
  onChange,
}: {
  form: DealMoveForm
  idPrefix: string
  disabled: boolean
  options: ActionOptions | undefined
  onChange: (patch: FormPatch) => void
}) {
  const stages = options?.allStages ?? []
  const reasons = options?.lostReasons ?? []
  const known = !form.stageId || stages.some((x) => x.id === form.stageId)
  const reasonKnown = !form.reasonCode || reasons.some((r) => r.code === form.reasonCode)
  return (
    <div className="space-y-1.5 text-xs">
      <p>
        Сделка{" "}
        <Link href={`/deals?openDeal=${encodeURIComponent(form.dealId)}`} className="underline underline-offset-2">
          «{form.dealName || "без названия"}»
        </Link>
      </p>
      {form.fromStageName && (
        <p>
          <span className="text-muted-foreground">Сейчас:</span> {form.fromStageName}
        </p>
      )}
      <div className="grid gap-0.5">
        <label htmlFor={`${idPrefix}-stage`} className="text-muted-foreground text-[11px]">
          Новая стадия
        </label>
        <select
          id={`${idPrefix}-stage`}
          value={form.stageId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const st = stages.find((x) => x.id === e.target.value)
            const outcome = st?.role === "won" || st?.role === "lost" ? st.role : null
            onChange({
              stageId: st ? st.id : null,
              stageName: st ? st.name : "",
              outcome,
              ...(outcome === "lost" ? {} : { reasonCode: "" }),
            })
          }}
          className={SELECT_CLASS}
        >
          {!form.stageId && <option value="">— выберите —</option>}
          {!known && form.stageId && <option value={form.stageId}>{form.stageName || "стадия"}</option>}
          {stages.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {form.outcome === "lost" && (
        <div className="grid gap-0.5">
          <label htmlFor={`${idPrefix}-reason`} className="text-muted-foreground text-[11px]">
            Причина проигрыша
          </label>
          <select
            id={`${idPrefix}-reason`}
            value={form.reasonCode}
            disabled={disabled}
            onChange={(e) => onChange({ reasonCode: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">— выберите причину —</option>
            {!reasonKnown && <option value={form.reasonCode}>{form.reasonCode}</option>}
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {(form.outcome === "lost" || form.outcome === "won") && (
        <div className="grid gap-0.5">
          <label htmlFor={`${idPrefix}-reasonText`} className="text-muted-foreground text-[11px]">
            {form.outcome === "lost" ? "Подробнее о причине" : "Комментарий к итогу"}
          </label>
          <Input
            id={`${idPrefix}-reasonText`}
            value={form.reasonText}
            disabled={disabled}
            onChange={(e) => onChange({ reasonText: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
      )}
    </div>
  )
}

/** «Изменить задачу»: mark done, or a new due date (org time). */
function TaskUpdateBlock({
  form,
  idPrefix,
  disabled,
  options,
  onChange,
}: {
  form: TaskUpdateForm
  idPrefix: string
  disabled: boolean
  options: ActionOptions | undefined
  onChange: (patch: FormPatch) => void
}) {
  return (
    <div className="space-y-1.5 text-xs">
      <p>
        Задача{" "}
        <Link href={`/tasks?openTask=${encodeURIComponent(form.taskId)}`} className="underline underline-offset-2">
          «{form.taskTitle || "без названия"}»
        </Link>
      </p>
      {form.currentDue && (
        <p>
          <span className="text-muted-foreground">Сейчас срок:</span>{" "}
          {isLocalDateTime(form.currentDue) ? dueLabel(form.currentDue) : form.currentDue}
        </p>
      )}
      <RadioGroup
        value={form.action}
        onValueChange={(v) => onChange({ action: v })}
        disabled={disabled}
        className="gap-1"
        aria-label="Что сделать с задачей"
      >
        {(
          [
            ["done", "Отметить выполненной"],
            ["reschedule", "Перенести срок"],
          ] as const
        ).map(([value, label]) => (
          <div key={value} className="flex items-center gap-2">
            <RadioGroupItem value={value} id={`${idPrefix}-action-${value}`} className="size-3.5" />
            <label htmlFor={`${idPrefix}-action-${value}`} className="cursor-pointer">
              {label}
            </label>
          </div>
        ))}
      </RadioGroup>
      {form.action === "reschedule" && (
        <div className="grid gap-0.5">
          <label htmlFor={`${idPrefix}-due`} className="text-muted-foreground text-[11px]">
            Новый срок
          </label>
          {/* The org-local wall time is bound as is: the server reads it in the org time zone. */}
          <Input
            id={`${idPrefix}-due`}
            type="datetime-local"
            value={form.dueDate}
            disabled={disabled}
            onChange={(e) => onChange({ dueDate: e.target.value })}
            className={INPUT_CLASS}
          />
          <p className="text-muted-foreground text-[10px]">
            {isLocalDateTime(form.dueDate) && <span>{dueLabel(form.dueDate)} · </span>}
            {options?.timeZone ? `время организации: ${options.timeZone}` : "время организации"}
          </p>
        </div>
      )}
    </div>
  )
}

function MatchesBlock({
  item,
  idPrefix,
  options,
  choice,
  disabled,
  onPick,
}: {
  item: DraftItem
  idPrefix: string
  options: ChoiceOption[]
  choice: ChoiceOption | null
  disabled: boolean
  onPick: (value: string) => void
}) {
  const matches = item.matches ?? []
  if (!matches.length) return null
  const exact = matches.filter((m) => m.kind === "exact")
  const deleted = matches.filter((m) => m.kind === "deleted")
  const similar = matches.filter((m) => m.kind === "similar")
  return (
    <div className="space-y-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
      {exact.length === 1 &&
        (exact[0].type === "deal" ? (
          <p>
            Есть открытая сделка {matchName(exact[0])} — {exact[0].reason}
          </p>
        ) : (
          <p>
            Похоже, уже есть: {MATCH_TYPE_LABELS[exact[0].type]} {matchName(exact[0])} — {exact[0].reason}
          </p>
        ))}
      {exact.length > 1 && (
        <div>
          <p>{item.type === "deal" ? "Есть открытые сделки:" : "Похоже, уже есть:"}</p>
          <ul className="text-muted-foreground list-disc pl-4">
            {exact.map((m) => (
              <li key={m.id}>
                {MATCH_TYPE_LABELS[m.type]} {matchName(m)} — {m.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {deleted.map((m) => (
        <p key={m.id}>
          Есть удалённая запись {matchName(m)} — {m.reason}
        </p>
      ))}
      {options.length > 0 && choice && (
        <RadioGroup
          value={choice.value}
          onValueChange={onPick}
          disabled={disabled}
          className="gap-1"
          aria-label="Что сделать с записью"
        >
          {options.map((o) => {
            const rid = `${idPrefix}-choice-${o.value}`
            return (
              <div key={o.value}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={o.value} id={rid} className="size-3.5" />
                  <label htmlFor={rid} className="cursor-pointer">
                    {o.label}
                  </label>
                </div>
                {o.fill && o.fill.length > 0 && (
                  <ul className="text-muted-foreground mt-0.5 space-y-0.5 pl-5.5 text-[11px]">
                    {o.fill.map((f, i) => (
                      <li key={`${f.field}-${i}`}>
                        Добавится: {f.label}: <span className="text-foreground">{f.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </RadioGroup>
      )}
      {similar.map((m) => (
        <p key={m.id} className="text-muted-foreground">
          Возможно, это:{" "}
          <Link href={matchHref(m)} className="text-foreground underline underline-offset-2">
            {matchName(m)}
          </Link>{" "}
          ({m.reason})
        </p>
      ))}
    </div>
  )
}

// ── Result views ────────────────────────────────────────────────────────

/** « — дополнена» / « — связан» … (gender of the record type). */
function resultNote(r: ActionResult, items: DraftItem[]): string {
  const masc = r.type === "contact"
  if (r.moved) return " — переведена"
  if (r.type === "task") {
    // «Изменить задачу»: the note follows what the item asked for.
    const upd = items.find((i) => i.type === "task_update" && (i.values as TaskUpdateValues).taskId === r.id)
    if (upd) return (upd.values as TaskUpdateValues).action === "done" ? " — выполнена" : " — срок перенесён"
  }
  if (r.restored) return masc ? " — восстановлен" : " — восстановлена"
  if (r.updated) return masc ? " — дополнен" : " — дополнена"
  if (r.linked) return masc ? " — связан" : " — связана"
  if (r.existing) return " — существующая запись"
  return ""
}

function ResultView({ action }: { action: ChatDraftPart }) {
  const results = action.results ?? []
  return (
    <div className="space-y-1 px-3 py-2 text-sm">
      <p className="text-xs font-medium">Создано:</p>
      {results.length === 0 && <p className="text-muted-foreground text-xs">ничего</p>}
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={`${r.type}-${r.id}`} className="flex flex-wrap items-center gap-x-2 text-xs">
            <span>
              {RESULT_TYPE_LABELS[r.type] ?? "Запись"} «{r.title}»{resultNote(r, action.draft.items)}
            </span>
            <Link
              href={r.href}
              className="text-primary inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              {r.type === "order_request" ? "Собрать заказ" : "Открыть"}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {action.status === "partly_created" && action.error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{action.error}</p>
      )}
    </div>
  )
}

function StatusView({ action }: { action: ChatDraftPart }) {
  switch (action.status) {
    case "created":
    case "partly_created":
      return <ResultView action={action} />
    case "cancelled":
      return <p className="text-muted-foreground px-3 py-2 text-xs">Отменено</p>
    case "expired":
      return <p className="text-muted-foreground px-3 py-2 text-xs">Черновик устарел</p>
    case "confirming":
      return (
        <p className="text-muted-foreground flex items-center gap-1.5 px-3 py-2 text-xs">
          <Spinner className="size-3" />
          Создаю…
        </p>
      )
    case "failed":
      return <p className="text-destructive px-3 py-2 text-xs">{action.error || "Не удалось создать записи"}</p>
    default:
      return null
  }
}

// ── API ─────────────────────────────────────────────────────────────────

const API = "/api/chat/actions"

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function isDraftPart(v: unknown, actionId: string): v is ChatDraftPart {
  return !!v && typeof v === "object" && (v as ChatDraftPart).actionId === actionId && !!(v as ChatDraftPart).draft
}

async function fetchAction(actionId: string): Promise<ChatDraftPart | null> {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(actionId)}`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await readJson(res)
    return isDraftPart(json?.action, actionId) ? json.action : null
  } catch {
    return null
  }
}

// ── The card ────────────────────────────────────────────────────────────

export function DraftCard({ part }: { part: ChatDraftPart }) {
  const idPrefix = useId()
  // State from the server (GET / POST / PATCH); until then the streamed part.
  const [server, setServer] = useState<ChatDraftPart | null>(null)
  const action = server && server.actionId === part.actionId ? server : part
  // Only the items the user touched; the rest come from the draft.
  const [edits, setEdits] = useState<Record<string, FormValues>>({})
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [attachFile, setAttachFile] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Re-read the stored action on mount (after a reload it may be created).
  useEffect(() => {
    let alive = true
    void fetchAction(part.actionId).then((a) => {
      if (alive && a) setServer(a)
    })
    return () => {
      alive = false
    }
  }, [part.actionId])

  // A confirm runs elsewhere (another tab / double click): look again once.
  const confirming = action.status === "confirming"
  useEffect(() => {
    if (!confirming) return
    let alive = true
    const t = setTimeout(() => {
      void fetchAction(part.actionId).then((a) => {
        if (alive && a) setServer(a)
      })
    }, 3000)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [confirming, part.actionId])

  const open = isOpenActionStatus(action.status)
  const options = action.options ?? part.options
  // Companies first, then contacts, then tasks (stable within a type).
  const items = [...action.draft.items].sort((a, b) => ITEM_ORDER[a.type] - ITEM_ORDER[b.type])
  const many = items.length > 1
  const taskCount = items.filter((i) => i.type === "task").length
  const checklist = action.kind === "tasks" || taskCount > 2

  const rows = items.map((item) => {
    const form = edits[item.key] ?? toForm(item)
    const include = !item.refused && (included[item.key] ?? true)
    const choices = choiceOptions(item)
    const choice = effectiveChoice(choices, picked[item.key])
    const missing = missingFields({ type: item.type, values: toValues(form) })
    return { item, form, include, choices, choice, missing }
  })
  const includedRows = rows.filter((r) => r.include)
  const blocked = includedRows.some((r) => r.missing.length > 0)
  const canSubmit = open && !busy && includedRows.length > 0 && !blocked

  /** The edited label of another item of this card + whether it will be created. */
  function cardItem(key: string): { name: string; included: boolean } {
    const row = rows.find((r) => r.item.key === key)
    return { name: row ? formLabel(row.form) : "", included: !!row?.include }
  }

  function update(item: DraftItem, patch: FormPatch) {
    setEdits((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] ?? toForm(item)), ...patch } as FormValues }))
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const body: ConfirmActionInput = {
      actionId: action.actionId,
      attachFile: action.draft.files.length > 0 ? attachFile : false,
      items: rows.map((r) => ({
        key: r.item.key,
        include: r.include,
        decision: r.choice?.decision ?? "create",
        ...(r.choice?.existingId ? { existingId: r.choice.existingId } : {}),
        values: toValues(r.form),
      })),
    }
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await readJson(res)
      if (res.ok && isDraftPart(json?.action, action.actionId)) {
        setServer(json.action)
      } else if (res.status === 409 && json?.error === "duplicate") {
        // A new exact duplicate: fresh matches, the user's edits stay.
        if (isDraftPart(json.action, action.actionId)) setServer(json.action)
        setNotice(typeof json.message === "string" ? json.message : "Появилась похожая запись — проверьте выбор")
      } else {
        setError(typeof json?.error === "string" ? json.error : "Не удалось создать записи")
      }
    } catch {
      setError("Не удалось связаться с сервером")
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.actionId, action: "cancel" }),
      })
      const json = await readJson(res)
      if (res.ok && isDraftPart(json?.action, action.actionId)) setServer(json.action)
      else setError(typeof json?.error === "string" ? json.error : "Не удалось отменить")
    } catch {
      setError("Не удалось связаться с сервером")
    } finally {
      setBusy(false)
    }
  }

  function linkLines(item: DraftItem, form: FormValues, disabled: boolean): ReactNode[] {
    const out: ReactNode[] = []
    if (
      form.kind === "company" ||
      form.kind === "update" ||
      form.kind === "link" ||
      form.kind === "deal_move" ||
      form.kind === "task_update"
    )
      return out
    if (form.kind === "order_request") {
      if (form.companyKey) {
        const c = cardItem(form.companyKey)
        out.push(
          <LinkLine key="companyKey" label="Компания из этой карточки" name={c.name} dropped={!c.included} disabled={disabled} />,
        )
      } else if (form.clientId) {
        out.push(
          <LinkLine
            key="clientId"
            label="Компания"
            name={form.clientName}
            disabled={disabled}
            onClear={() => update(item, { clientId: null, clientName: "" })}
          />,
        )
      }
      return out
    }
    // A link to an item of this card (key) wins over an existing record (id).
    if (form.companyKey) {
      const c = cardItem(form.companyKey)
      out.push(
        <LinkLine
          key="companyKey"
          label="Компания из этой карточки"
          name={c.name}
          dropped={form.kind !== "contact" && !c.included}
          disabled={disabled}
        />,
      )
    } else if (form.companyId) {
      out.push(
        <LinkLine
          key="companyId"
          label="Компания"
          name={form.companyName}
          disabled={disabled}
          onClear={() => update(item, { companyId: null, companyName: "" })}
        />,
      )
    }
    if (form.kind === "deal") {
      form.contactKeys.forEach((key) => {
        const c = cardItem(key)
        out.push(
          <LinkLine
            key={`contactKey-${key}`}
            label="Контакт из этой карточки"
            name={c.name}
            dropped={!c.included}
            masculine
            disabled={disabled}
          />,
        )
      })
      form.contactIds.forEach((id, i) => {
        out.push(
          <LinkLine
            key={`contactId-${id}`}
            label="Контакт"
            name={form.contactNames[i] ?? ""}
            disabled={disabled}
            onClear={() =>
              update(item, {
                contactIds: form.contactIds.filter((_, j) => j !== i),
                contactNames: form.contactNames.filter((_, j) => j !== i),
              })
            }
          />,
        )
      })
      return out
    }
    if (form.kind !== "task") return out
    if (form.contactKey) {
      const c = cardItem(form.contactKey)
      out.push(
        <LinkLine
          key="contactKey"
          label="Контакт из этой карточки"
          name={c.name}
          dropped={!c.included}
          masculine
          disabled={disabled}
        />,
      )
    } else if (form.contactId) {
      out.push(
        <LinkLine
          key="contactId"
          label="Контакт"
          name={form.contactName}
          disabled={disabled}
          onClear={() => update(item, { contactId: null, contactName: "" })}
        />,
      )
    }
    if (form.dealKey) {
      const d = cardItem(form.dealKey)
      out.push(
        <LinkLine key="dealKey" label="Сделка из этой карточки" name={d.name} dropped={!d.included} disabled={disabled} />,
      )
    } else if (form.dealId) {
      out.push(
        <LinkLine
          key="dealId"
          label="Сделка"
          name={form.dealName}
          disabled={disabled}
          onClear={() => update(item, { dealId: null, dealName: "" })}
        />,
      )
    }
    return out
  }

  return (
    <section
      aria-label={ACTION_KIND_TITLES[action.kind] ?? "Черновик"}
      className="mt-2 overflow-hidden rounded-xl border bg-card text-card-foreground"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <FilePlus2 className="text-muted-foreground size-3.5" aria-hidden />
        <span className="text-xs font-medium">{ACTION_KIND_TITLES[action.kind] ?? "Черновик"}</span>
      </header>

      {!open ? (
        <StatusView action={action} />
      ) : (
        <div className="space-y-2 px-3 py-2">
          {rows.map(({ item, form, include, choices, choice, missing }) => {
            // The deal type picker is shown only when the org has deal types.
            const fields = FIELDS[item.type].filter(
              (f) => f.control !== "dealType" || (options?.dealTypes?.length ?? 0) > 0,
            )
            const shown = new Set(fields.flatMap((f) => f.keys ?? [f.field]))
            const otherRemoved = (item.removed ?? []).filter((r) => !shown.has(r.field))
            const itemId = `${idPrefix}-${item.key}`
            const disabled = busy || !include
            const word = ITEM_TYPE_WORDS[item.type]
            const compact = checklist && item.type === "task"
            const links = linkLines(item, form, disabled)
            return (
              <div
                key={item.key}
                className={cn("rounded-md border", compact ? "space-y-1 p-1.5" : "space-y-1.5 p-2", !include && "opacity-70")}
              >
                <div className="flex items-center gap-2">
                  {many ? (
                    <>
                      <Checkbox
                        id={`${itemId}-include`}
                        checked={include}
                        disabled={busy || !!item.refused}
                        onCheckedChange={(v) => setIncluded((prev) => ({ ...prev, [item.key]: v === true }))}
                      />
                      <label htmlFor={`${itemId}-include`} className="text-xs font-medium">
                        {INCLUDE_LABELS[item.type] ?? `Создать: ${word}`}
                      </label>
                    </>
                  ) : (
                    <span className="text-xs font-medium">{word.charAt(0).toUpperCase() + word.slice(1)}</span>
                  )}
                </div>

                {item.refused && <p className="text-destructive text-xs">{item.refused}</p>}

                <MatchesBlock
                  item={item}
                  idPrefix={itemId}
                  options={choices}
                  choice={choice}
                  disabled={disabled}
                  onPick={(v) => setPicked((prev) => ({ ...prev, [item.key]: v }))}
                />

                {form.kind === "update" && (
                  <UpdateBlock
                    form={form}
                    idPrefix={itemId}
                    disabled={disabled}
                    onToggle={(i, on) =>
                      update(item, {
                        skipped: on ? form.skipped.filter((x) => x !== i) : [...form.skipped, i],
                      })
                    }
                  />
                )}

                {form.kind === "order_request" && (
                  <>
                    {links}
                    <OrderRequestBlock form={form} />
                  </>
                )}

                {form.kind === "deal_move" && (
                  <DealMoveBlock
                    form={form}
                    idPrefix={itemId}
                    disabled={disabled}
                    options={options}
                    onChange={(patch) => update(item, patch)}
                  />
                )}

                {form.kind === "task_update" && (
                  <TaskUpdateBlock
                    form={form}
                    idPrefix={itemId}
                    disabled={disabled}
                    options={options}
                    onChange={(patch) => update(item, patch)}
                  />
                )}

                {form.kind === "link" && (
                  <LinkBlock
                    form={form}
                    idPrefix={itemId}
                    disabled={disabled}
                    onPrimary={(on) => update(item, { primary: on })}
                  />
                )}

                {fields.length > 0 && (
                  <div className={cn("grid sm:grid-cols-2", compact ? "gap-1" : "gap-1.5")}>
                    {fields.map((def) => {
                      const keys = def.keys ?? [def.field]
                      const meta = keys.map((k) => item.meta?.[k]).find(Boolean)
                      return (
                        <div key={def.field} className={cn(def.wide && "sm:col-span-2")}>
                          <FieldRow
                            id={`${itemId}-${def.field}`}
                            def={def}
                            form={form}
                            meta={meta}
                            removed={(item.removed ?? []).filter((r) => keys.includes(r.field))}
                            disabled={disabled}
                            options={options}
                            onChange={(patch) => update(item, patch)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}

                {form.kind !== "order_request" && links}

                <RemovedList removed={otherRemoved} />

                {include &&
                  missing.map((m) => (
                    <p key={m} className="text-xs text-amber-600 dark:text-amber-400">
                      {MISSING_LABELS[m] ?? m}
                    </p>
                  ))}
              </div>
            )
          })}

          {action.draft.files.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${idPrefix}-attach`}
                checked={attachFile}
                disabled={busy}
                onCheckedChange={(v) => setAttachFile(v === true)}
              />
              <label htmlFor={`${idPrefix}-attach`} className="text-xs">
                Прикрепить файл к записи: {action.draft.files.map((f) => `«${f.name}»`).join(", ")}
              </label>
            </div>
          )}

          {notice && <p className="text-xs text-amber-600 dark:text-amber-400">{notice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={!canSubmit} onClick={() => void submit()}>
              {busy && <Spinner className="size-3" />}
              {submitLabel(includedRows.map((r) => r.item.type))}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Отмена
            </Button>
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      )}
    </section>
  )
}

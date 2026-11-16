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
  type DraftItem,
  type DraftMatch,
  type FieldMeta,
  type ItemDecision,
  type ItemType,
  type RemovedValue,
  type TaskValues,
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

type FormValues = CompanyForm | ContactForm | TaskForm
type FormPatch = Record<string, string | null>

type Control = "text" | "list" | "multiline" | "telegram" | "taskType" | "priority" | "due" | "assignee"
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

const FIELDS: Record<ItemType, FieldDef[]> = { company: COMPANY_FIELDS, contact: CONTACT_FIELDS, task: TASK_FIELDS }

const ITEM_ORDER: Record<ItemType, number> = { company: 0, contact: 1, task: 2 }

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
    dealName: v.dealName ?? "",
  }
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Form → the values sent to `POST /api/chat/actions`. */
function toValues(form: FormValues): CompanyValues | ContactValues | TaskValues {
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

/** Name of a company / contact, title of a task — from the edited form. */
function formLabel(form: FormValues): string {
  return (form.kind === "task" ? form.title : form.name).trim()
}

// ── Duplicate choice (§8.3) ─────────────────────────────────────────────

type ChoiceOption = { value: string; label: string; decision: ItemDecision; existingId?: string }

const MATCH_TYPE_LABELS: Record<DraftMatch["type"], string> = { client: "Компания", contact: "Контакт" }
const RESULT_TYPE_LABELS: Record<ActionResult["type"], string> = { client: "Компания", contact: "Контакт", task: "Задача" }

function matchHref(m: DraftMatch): string {
  return m.type === "client" ? `/clients/${encodeURIComponent(m.id)}` : `/contacts?openContact=${encodeURIComponent(m.id)}`
}

function matchName(m: DraftMatch): string {
  return `«${m.title}»${m.subtitle ? ` (${m.subtitle})` : ""}`
}

/** Radio options of an item, from its exact / deleted matches. Empty = plain create. */
function choiceOptions(item: DraftItem): ChoiceOption[] {
  const exact = item.matches.filter((m) => m.kind === "exact")
  const deleted = item.matches.filter((m) => m.kind === "deleted")
  if (!exact.length && !deleted.length) return []
  const out: ChoiceOption[] = []
  for (const m of exact) {
    out.push({
      value: `use:${m.id}`,
      label: exact.length === 1 ? "Использовать существующий" : `Использовать ${matchName(m)}`,
      decision: "use_existing",
      existingId: m.id,
    })
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
      ? { value: "create_anyway", label: "Всё равно создать новый", decision: "create_anyway" }
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
        <p className="text-muted-foreground text-[10px]">
          {isLocalDateTime(value) && <span>{dueLabel(value)} · </span>}
          {options?.timeZone ? `время организации: ${options.timeZone}` : "время организации"}
        </p>
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
          {def.label}
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
  disabled,
  onClear,
}: {
  label: string
  name: string
  /** The linked item of this card is unticked — the server drops the link. */
  dropped?: boolean
  disabled: boolean
  onClear?: () => void
}) {
  return (
    <p className={cn("text-xs", dropped && "text-muted-foreground")}>
      <span className="text-muted-foreground">{label}:</span> {name || "без названия"}
      {dropped && " (не будет создана)"}
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
      {exact.length === 1 && (
        <p>
          Похоже, уже есть: {MATCH_TYPE_LABELS[exact[0].type]} {matchName(exact[0])} — {exact[0].reason}
        </p>
      )}
      {exact.length > 1 && (
        <div>
          <p>Похоже, уже есть:</p>
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
              <div key={o.value} className="flex items-center gap-2">
                <RadioGroupItem value={o.value} id={rid} className="size-3.5" />
                <label htmlFor={rid} className="cursor-pointer">
                  {o.label}
                </label>
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
              {RESULT_TYPE_LABELS[r.type] ?? "Запись"} «{r.title}»
              {r.existing && " — существующая запись"}
              {r.restored && " — восстановлена"}
            </span>
            <Link
              href={r.href}
              className="text-primary inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              Открыть
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
    if (form.kind === "company") return out
    // A link to an item of this card (key) wins over an existing record (id).
    if (form.companyKey) {
      const c = cardItem(form.companyKey)
      out.push(
        <LinkLine
          key="companyKey"
          label="Компания из этой карточки"
          name={c.name}
          dropped={form.kind === "task" && !c.included}
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
    if (form.kind !== "task") return out
    if (form.contactKey) {
      const c = cardItem(form.contactKey)
      out.push(
        <LinkLine key="contactKey" label="Контакт из этой карточки" name={c.name} dropped={!c.included} disabled={disabled} />,
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
    if (form.dealId) {
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
            const fields = FIELDS[item.type]
            const shown = new Set(fields.flatMap((f) => f.keys ?? [f.field]))
            const otherRemoved = (item.removed ?? []).filter((r) => !shown.has(r.field))
            const itemId = `${idPrefix}-${item.key}`
            const disabled = busy || !include
            const word = ITEM_TYPE_WORDS[item.type]
            const compact = checklist && item.type === "task"
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
                        Создать: {word}
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

                {linkLines(item, form, disabled)}

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
              {includedRows.length > 1 ? "Создать всё" : "Создать"}
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

"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import type { DetailNavigationStatus } from "@/components/blocks/detail-drawer-layout"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import type {
  TaskRow,
  OrgMemberOption,
  TaskClientOption,
  TaskContactOption,
} from "@/app/api/tasks/route"
import type { TaskType, TaskPriority, TaskStatus } from "@/db/schema"
import { isOpenDealStatus } from "@/lib/deal-funnel"
import { defaultDueLocal, dueParts } from "@/lib/org-time"
import { useOrgTime } from "@/lib/org-time-context"

const TYPES: TaskType[] = [
  "meet",
  "call",
  "email",
  "offer",
  "docs",
  "support",
  "other",
]
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"]
const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "closed"]

const TYPE_LABELS: Record<TaskType, string> = {
  meet: "Встреча",
  call: "Звонок",
  email: "Email",
  offer: "Предложение",
  docs: "Документы",
  support: "Поддержка",
  other: "Другое",
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  closed: "Закрыто",
}

const NO_CLIENT = "__none__"
const NO_CONTACT = "__none__"
const NO_DEAL = "__none__"

type TaskDealOption = { id: string; name: string; clientName: string | null }


type TaskFormData = {
  name: string
  description: string
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  assigneeId: string
  clientId: string
  contactId: string
  dealId: string
  /** «YYYY-MM-DD» in the ORG time zone. */
  dueDate: string
  /** «HH:MM» in the ORG time zone (default = «Срок задачи по умолчанию»). */
  dueTime: string
}

type Props = {
  mode: "create" | "edit"
  task?: TaskRow
  trigger: React.ReactNode
  // In create mode, called with the newly-created task's id (so a caller can
  // e.g. link it back to the card it was created from — see
  // dashboard-card.tsx's handleAccept). Undefined in edit mode.
  onSuccess?: (taskId?: string) => void
  // Create-mode-only prefill (ignored in edit mode, where `task` wins).
  // Used e.g. by the cards' «Создать задачу» → "create task from card" flow.
  // Pass a stable reference (memoize in the parent) so the open-effect's
  // form.reset doesn't re-run and wipe edits while the dialog is open.
  initialValues?: Partial<TaskFormData>
  // Optional controlled open state — lets a parent open this SAME dialog
  // programmatically (e.g. right after creating a deal, so "create a task
  // with it" uses the real task form instead of a stripped-down duplicate)
  // without a click on `trigger`. Omit both for the usual uncontrolled
  // click-to-open behaviour (all other call sites).
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// Форма задачи — вынесена отдельно от диалога (по образцу ContactEditForm в
// form-contact-edit.tsx), чтобы <TaskDetailDrawer> могла переиспользовать её
// целиком внутри выезжающей панели, а не дублировать разметку полей.
export function TaskEditForm({
  mode,
  task,
  onSuccess,
  onCancel,
  onNavigationStatusChange,
  initialValues,
}: {
  mode: "create" | "edit"
  task?: TaskRow
  onSuccess?: (taskId?: string) => void
  onCancel?: () => void
  onNavigationStatusChange?: (status: DetailNavigationStatus) => void
  initialValues?: Partial<TaskFormData>
}) {
  const [isPending, startTransition] = useTransition()
  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [clientOptions, setClientOptions] = useState<TaskClientOption[]>([])
  const [contactOptions, setContactOptions] = useState<TaskContactOption[]>([])
  const [dealOptions, setDealOptions] = useState<TaskDealOption[]>([])

  // Defaults resolve edit-mode `task` first, then create-mode `initialValues`,
  // then hardcoded fallbacks — so a prefilled create (e.g. from a card) seeds
  // the form while edit mode is unaffected.
  // Deadlines are entered and shown in the ORG time zone (2026-11-26): a new
  // task starts today at the org's default due time (23:59 unless the owner
  // changed it in «Рабочий контекст»).
  const orgTime = useOrgTime()
  const buildDefaults = useCallback(
    (): TaskFormData => {
      const fallback = defaultDueLocal(new Date(), orgTime)
      const due = task?.dueDate
        ? dueParts(task.dueDate, orgTime.timeZone)
        : { date: initialValues?.dueDate ?? fallback.slice(0, 10), time: initialValues?.dueTime ?? orgTime.defaultDueTime }
      return {
      name: task?.name ?? initialValues?.name ?? "",
      description: task?.description ?? initialValues?.description ?? "",
      type: task?.type ?? initialValues?.type ?? "other",
      priority: task?.priority ?? initialValues?.priority ?? "medium",
      status: task?.status ?? initialValues?.status ?? "todo",
      assigneeId: task?.assigneeId ?? initialValues?.assigneeId ?? "",
      clientId: task?.clientId ?? initialValues?.clientId ?? NO_CLIENT,
      contactId: task?.contactId ?? initialValues?.contactId ?? NO_CONTACT,
      dealId: task?.dealId ?? initialValues?.dealId ?? NO_DEAL,
      dueDate: due.date,
      dueTime: due.time,
      }
    },
    [task, initialValues, orgTime],
  )

  const form = useForm<TaskFormData>({ defaultValues: buildDefaults() })
  const { isDirty, isSubmitting } = form.formState
  useEffect(() => {
    onNavigationStatusChange?.(isPending || isSubmitting ? "busy" : isDirty ? "dirty" : "ready")
    return () => onNavigationStatusChange?.("ready")
  }, [onNavigationStatusChange, isPending, isSubmitting, isDirty])

  const watchedClientId = form.watch("clientId")

  useEffect(() => {
    form.reset(buildDefaults())

    let cancelled = false
    ;(async () => {
      try {
        const [mRes, cRes, dRes] = await Promise.all([
          fetch("/api/tasks?members=1").then((r) => r.json()),
          fetch("/api/tasks?clientOptions=1").then((r) => r.json()),
          fetch("/api/deals").then((r) => r.json()),
        ])
        if (cancelled) return
        const loadedMembers: OrgMemberOption[] = mRes.members ?? []
        setMembers(loadedMembers)
        setClientOptions(cRes.options ?? [])
        // Только активные сделки в селекторе (терминальные/удалённые не нужны).
        type DealLite = {
          id: string
          name: string
          clientName: string | null
          status: string
        }
        setDealOptions(
          ((dRes.deals ?? []) as DealLite[])
            .filter((d) => isOpenDealStatus(d.status))
            .map((d) => ({ id: d.id, name: d.name, clientName: d.clientName })),
        )
        // Default «Исполнитель» of a new task = the person who creates it.
        if (mode === "create" && !form.getValues("assigneeId")) {
          const me = loadedMembers.find((m) => m.id === mRes.currentUserId)
          if (me) form.setValue("assigneeId", me.id)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, mode, buildDefaults])

  useEffect(() => {
    let cancelled = false
    const qs =
      watchedClientId && watchedClientId !== NO_CLIENT
        ? `?contactOptions=1&clientId=${encodeURIComponent(watchedClientId)}`
        : "?contactOptions=1"
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks${qs}`).then((r) => r.json())
        if (cancelled) return
        const options: TaskContactOption[] = res.options ?? []
        setContactOptions(options)
        const currentContact = form.getValues("contactId")
        if (currentContact !== NO_CONTACT) {
          const stillValid = options.some((o) => o.id === currentContact)
          if (!stillValid) form.setValue("contactId", NO_CONTACT)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [watchedClientId, form])

  const onSubmit = (data: TaskFormData) => {
    startTransition(async () => {
      try {
        const clientId = data.clientId === NO_CLIENT ? null : data.clientId
        const contactId = data.contactId === NO_CONTACT ? null : data.contactId
        const dealId = data.dealId === NO_DEAL ? null : data.dealId
        // «YYYY-MM-DDTHH:MM» = a wall time in the org zone; the server converts it.
        const { dueTime, ...rest } = data
        const dueDate = `${data.dueDate}T${dueTime || orgTime.defaultDueTime}`
        const payload =
          mode === "create"
            ? { ...rest, dueDate, clientId, contactId, dealId }
            : { id: task!.id, ...rest, dueDate, clientId, contactId, dealId }
        const res = await fetch("/api/tasks", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить задачу")
          return
        }
        toast.success(mode === "create" ? "Задача создана" : "Задача обновлена")
        if (mode === "create") {
          const created = await res.json().catch(() => ({}))
          onSuccess?.(typeof created.id === "string" ? created.id : undefined)
        } else {
          onSuccess?.()
        }
      } catch {
        toast.error("Не удалось сохранить задачу")
      }
    })
  }

  return (
    <Form {...form}>
      {/* min-w-0: родитель может быть grid-item (DialogContent) — без него
          форма не сжимается и переполняет контейнер длинными значениями. */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 min-w-0">
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "Укажите название" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">Название</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Название задачи" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">Описание</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="Необязательные детали…" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Привязки — «к чему относится задача»: клиент → контакт → сделка. */}
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Клиент</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v)
                    form.setValue("contactId", NO_CONTACT)
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Без клиента" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT}>Без клиента</SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Контакт</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Без контакта" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_CONTACT}>Без контакта</SelectItem>
                    {contactOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="dealId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">Сделка</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Без сделки" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NO_DEAL}>Без сделки</SelectItem>
                  {dealOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.clientName ? `${d.clientName} — ${d.name}` : d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Классификация: тип и приоритет. */}
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Тип</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Приоритет</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Исполнение: статус, исполнитель, срок. */}
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Статус</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dueDate"
            rules={{ required: "Укажите срок" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Срок</FormLabel>
                <div className="flex gap-2">
                  <FormControl>
                    <Input type="date" className="min-w-0 flex-1" {...field} />
                  </FormControl>
                  <FormField
                    control={form.control}
                    name="dueTime"
                    rules={{ required: "Укажите время" }}
                    render={({ field: timeField }) => (
                      <Input type="time" aria-label="Время срока" className="w-28 shrink-0" {...timeField} />
                    )}
                  />
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="assigneeId"
          rules={{ required: "Укажите исполнителя" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">Исполнитель</FormLabel>
              {/* Remount when the members arrive: the default «Исполнитель» is set
                  in the SAME render as the options, and Radix Select's hidden
                  native <select> then fires a change with "" (no option yet),
                  which cleared the value (bug list 2026-11-22, item 24). A
                  fresh Select starts with the value and sends no change. */}
              <Select
                key={members.length ? "members" : "loading"}
                value={field.value}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите исполнителя" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onCancel?.()}>
            Отмена
          </Button>
          {/* Кнопка неактивна, пока не введено название — вместо
              звёздочки-обязательности; при попытке отправить пустое
              react-hook-form подсветит поле ошибкой (FormMessage). */}
          <LoadingButton
            type="submit"
            loading={isPending}
            disabled={!form.watch("name")?.trim()}
          >
            {mode === "create" ? "Создать" : "Сохранить"}
          </LoadingButton>
        </DialogFooter>
      </form>
    </Form>
  )
}

export default function TaskEditDialog({
  mode,
  task,
  trigger,
  onSuccess,
  initialValues,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = setControlledOpen ?? setInternalOpen

  const title =
    mode === "create"
      ? "Новая задача"
      : `Редактирование задачи: ${task?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && (
          <TaskEditForm
            mode={mode}
            task={task}
            initialValues={initialValues}
            onSuccess={(taskId) => {
              onSuccess?.(taskId)
              setOpen(false)
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

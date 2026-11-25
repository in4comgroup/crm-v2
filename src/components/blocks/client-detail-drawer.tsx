"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocumentsPanel } from "@/components/blocks/documents-panel"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { FollowCursorTooltip } from "@/components/blocks/follow-cursor-tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CloudSync, Pencil, Plus, Save } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  TASK_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_STATUS_BADGE,
} from "@/lib/task-labels"
import TaskEditDialog from "@/components/forms/form-task-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { ClientResponsibleField } from "@/components/blocks/client-responsible-field"
import { ClientProfileBlock } from "@/components/blocks/client-profile-block"
import { ClientFunnelStages } from "@/components/blocks/client-funnel-stages"
import { ClientTelegramBlock } from "@/components/blocks/client-telegram-block"
import { BlacklistEntityButton } from "@/components/blocks/client-blocklist-dialog"
import { ClientContentTable } from "@/components/blocks/client-content-table"
import { ContactDetailDrawer } from "@/components/blocks/contact-detail-drawer"
import { ContactLinkProposalsList } from "@/components/blocks/contact-companies-block"
import {
  ClientContactLinksExtras,
  ContactAlsoLine,
  useClientContactLinks,
} from "@/components/blocks/client-contact-links"
import {
  RelatedTopicsList,
  useRelatedTopics,
} from "@/components/blocks/related-topics"
import type { TaskStatus, EntityStatus } from "@/db/schema"
import type { ClientRow } from "@/app/api/clients/route"
import type { TaskRow } from "@/app/api/tasks/route"
import type { ContactRow } from "@/app/api/contacts/route"
import type { SourceSummary } from "@/server/sources"
import {
  COMPANY_KIND_LABELS,
  COMPANY_KIND_VALUES,
  type CompanyKind,
} from "@/lib/client-custom-fields"
import {
  CustomFieldsPanel,
  type CustomFieldsPanelHandle,
} from "@/components/blocks/custom-fields-tab"
import { contactDisplayName } from "@/lib/contact-names"

const COMPANY_KIND_NONE = "__none__"

const STATUS_OPTIONS: { value: EntityStatus; label: string }[] = [
  { value: "active", label: "Активная" },
  { value: "initial", label: "Новая" },
  { value: "suspended", label: "Приостановлена" },
  { value: "deleted", label: "Удалена" },
  { value: "blocked", label: "Заблокирована" },
]
const CURRENCIES: { value: string; label: string }[] = [
  { value: "RUB", label: "₽ RUB" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
  { value: "GBP", label: "£ GBP" },
  { value: "CNY", label: "¥ CNY" },
]

type ClientEditFormData = {
  name: string
  namePhys: string
  comment: string
  aliases: string
  phone: string
  email: string
  address: string
  webUrl: string
  discount: string
  companyKind: CompanyKind | typeof COMPANY_KIND_NONE
  status: EntityStatus
  currency: string
}

function buildDefaults(client: ClientRow | null): ClientEditFormData {
  return {
    name: client?.name ?? "",
    namePhys: client?.namePhys ?? "",
    comment: client?.comment ?? "",
    aliases: (client?.aliases ?? []).join(", "),
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    address: client?.address ?? "",
    webUrl: client?.webUrl ?? "",
    discount:
      client?.customFields?.discount != null
        ? String(client.customFields.discount)
        : "",
    companyKind: client?.customFields?.companyKind ?? COMPANY_KIND_NONE,
    status: client?.status ?? "active",
    currency: client?.currency ?? "RUB",
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

// Одно мета-поле задачи в HoverCard — как в deal-detail-drawer.tsx.
function TaskMeta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-foreground">{value}</div>
    </div>
  )
}

// Ресайзер ширины дровера драг-н-дропом. Нативного примитива для этого нет
// ни в Radix, ни в shadcn Sheet — react-resizable-panels (уже зависимость
// проекта) устроен для разбиения ДОСТУПНОГО пространства между соседними
// панелями в потоке документа, а не для растягивания floating-оверлея
// поверх вьюпорта, так что он тут не подходит. Небольшой ручной хэндлер —
// стандартный путь для именно этого случая.
const MIN_WIDTH = 480
const MAX_WIDTH = 1100
const DEFAULT_WIDTH = 720
const WIDTH_STORAGE_KEY = "client-drawer-width"

function useDrawerWidth() {
  // Lazy initializer (not an effect) — localStorage is a synchronous,
  // side-effect-free read, so this is the documented React pattern for
  // seeding state from an external source without an extra render pass.
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
      if (Number.isFinite(stored) && stored > 0) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored))
      }
    } catch {
      /* localStorage unavailable — keep default */
    }
    return DEFAULT_WIDTH
  })
  const draggingRef = useRef(false)

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, window.innerWidth - ev.clientX),
      )
      setWidth(next)
    }
    function onUp() {
      draggingRef.current = false
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [])

  return { width, onResizeStart }
}

export function ClientDetailDrawer({
  client,
  open,
  initialTab = "info",
  onOpenChange,
  onChanged,
  canBlock = false,
}: {
  client: ClientRow | null
  open: boolean
  initialTab?: "info" | "contacts"
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  // When true (owner), shows the "add to blocklist" action in the form
  // footer — lives here (with editing), not as a standalone icon on the
  // list card, see refs/blocklist.md.
  canBlock?: boolean
}) {
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const router = useRouter()
  const { width, onResizeStart } = useDrawerWidth()

  const [taskData, setTaskData] = useState<{
    clientId: string
    items: TaskRow[]
  } | null>(null)
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  // Drives the FollowCursorTooltip's `disabled` on the name field — the tip
  // is suppressed while the field is actually focused/being edited.
  const [nameFieldFocused, setNameFieldFocused] = useState(false)

  const clientId = client?.id
  // «Темы» (spec topics/01 §14): shown only when the org's topics mode is `on`.
  const relatedTopics = useRelatedTopics(
    clientId ? { clientId } : null,
    open,
  )
  // «Поля» (custom company fields, docs/specs/clients-contacts): mounted on
  // the first visit of the tab and then kept mounted (hidden) so unsaved
  // edits survive tab switches; the close guard below also asks about them.
  const [fieldsVisitedFor, setFieldsVisitedFor] = useState<string | null>(null)
  const fieldsPanelRef = useRef<CustomFieldsPanelHandle | null>(null)
  // «Контакты» over time (docs/specs/clients-contacts/04 §6): «также: Y»,
  // non-primary contacts, «Бывшие» and the pending proposals of this company.
  const contactLinks = useClientContactLinks(clientId, open)
  const reloadContactLinks = contactLinks.reload
  const onContactsChanged = useCallback(() => {
    void reloadContactLinks()
    onChanged()
  }, [reloadContactLinks, onChanged])

  const reloadTasks = useCallback((id: string) => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        const items = (data.tasks ?? [])
          .filter((t) => t.clientId === id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        setTaskData({ clientId: id, items })
      })
      .catch(() => setTaskData({ clientId: id, items: [] }))
  }, [])

  useEffect(() => {
    if (!open || !clientId) return
    reloadTasks(clientId)
  }, [open, clientId, reloadTasks])

  // Source list for the «Материалы компании» selector — once per open
  // (`/api/sources/options`).
  useEffect(() => {
    if (!open) return
    fetch("/api/sources/options")
      .then((r) => r.json())
      .then((d: { sources?: SourceSummary[] }) => setSources(d.sources ?? []))
      .catch(() => setSources([]))
  }, [open])

  const setTaskStatus = (taskId: string, status: TaskStatus) => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: taskId, statusOnly: true, status }),
        })
        if (!res.ok) {
          toast.error("Не удалось изменить статус")
          return
        }
        if (clientId) reloadTasks(clientId)
        onChanged()
      } catch {
        toast.error("Не удалось изменить статус")
      }
    })
  }

  const openEditContact = (contactId: string) => {
    fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`)
      .then((r) => r.json())
      .then((data: { contact?: ContactRow }) => {
        if (data.contact) setEditingContact(data.contact)
      })
      .catch(() => {})
  }

  const editForm = useForm<ClientEditFormData>({
    defaultValues: buildDefaults(client),
  })

  // Another company → full reset. The SAME company saved elsewhere (web
  // lookup «Поиск в интернете», batch enrichment, another tab — its
  // `updatedAt` changes) → the stored values come into the form, but what
  // the user is typing stays (`keepDirtyValues`). Before 2026-11-19 the form
  // reset only on the id: after a web lookup it kept the OLD values, «Сохранить»
  // stayed disabled (nothing dirty), and a later save wrote the old values
  // back over the enriched ones. A refresh of OTHER companies (new object
  // references, same `updatedAt`) still never touches the form.
  const formClientId = useRef<string | null>(null)
  useEffect(() => {
    if (!client) return
    const sameClient = formClientId.current === client.id
    formClientId.current = client.id
    editForm.reset(buildDefaults(client), sameClient ? { keepDirtyValues: true } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, client?.updatedAt])

  function onSave(data: ClientEditFormData, opts?: { closeAfter?: boolean }) {
    if (!client) return
    const aliases = data.aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
    const discountValue =
      data.discount.trim() === "" ? undefined : Number(data.discount)
    // The old hard-coded `type` key is never sent any more: the company type
    // is a normal custom field now (spec Q12), edited in the «Поля» tab.
    const baseCustomFields: Record<string, unknown> = {
      ...(client.customFields ?? {}),
    }
    delete baseCustomFields.type
    const customFields = {
      ...baseCustomFields,
      discount: discountValue,
      companyKind:
        data.companyKind === COMPANY_KIND_NONE ? undefined : data.companyKind,
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: client.id,
            name: data.name,
            namePhys: data.namePhys,
            comment: data.comment,
            aliases,
            phone: data.phone,
            email: data.email,
            address: data.address,
            webUrl: data.webUrl,
            customFields,
            status: data.status,
            currency: data.currency,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить компанию")
          return
        }
        toast.success("Компания обновлена")
        editForm.reset(data)
        onChanged()
        if (opts?.closeAfter) onOpenChange(false)
      } catch {
        toast.error("Не удалось сохранить компанию")
      }
    })
  }

  function handleSheetOpenChange(next: boolean) {
    if (
      !next &&
      (editForm.formState.isDirty || fieldsPanelRef.current?.isDirty())
    ) {
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(next)
  }

  function discardAndClose() {
    if (client) editForm.reset(buildDefaults(client))
    setConfirmCloseOpen(false)
    onOpenChange(false)
  }

  if (!client) return null

  const tasks = taskData && taskData.clientId === client.id ? taskData.items : []

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        className="w-full flex flex-col gap-0 p-0"
        style={{ width: `${width}px`, maxWidth: "none" }}
        // Иначе Radix при открытии автофокусит первое поле формы — им
        // оказывается название (первый инпут в дровере), и оно подсвечивается
        // рамкой фокуса сразу при открытии, что выглядит как случайный клик.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Ресайзер: тонкая полоса на левом краю, драг двигает край панели. */}
        <div
          onPointerDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панели"
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none hover:bg-[#669BBC]/40"
        />
        {/* Карточка подробностей = форма редактирования, по образцу
            deal-detail-drawer.tsx: все поля сразу редактируемые, «Сохранить»
            пишет через PUT /api/clients. Карандаш с карточки списка убран —
            клик по карточке и открывает этот же дровер.
            Дровер делится на фиксированную шапку (название + кнопки —
            поиск в интернете, системный крестик закрытия — и строка табов)
            и единую скроллящуюся область с содержимым активного таба. */}
        <Form {...editForm}>
          {/* noValidate: the browser's own checks (type="email", the hidden
              «Поля» tab inputs inside this form) blocked submit with no visible
              message; the form validates in code and the server checks again. */}
          <form
            noValidate
            onSubmit={editForm.handleSubmit((data) => onSave(data))}
            className="flex flex-1 min-h-0 flex-col"
          >
            {/* Табы — прямо под названием, в фиксированной шапке (звонок
                26.10: на маленьком экране задачи и контакты уезжали ниже
                первого экрана под длинной «колбасой» полей). Поля компании
                теперь сами — первый таб «Общая информация». key — чтобы при
                открытии другой компании снова начинать с первого таба. */}
            <Tabs
              key={client.id}
              defaultValue={initialTab}
              onValueChange={(v) => {
                if (v === "fields") setFieldsVisitedFor(client.id)
              }}
              className="flex flex-1 min-h-0 flex-col gap-0"
            >
            <div className="px-4 pt-4 border-b shrink-0">
              <SheetTitle className="sr-only">{client.name}</SheetTitle>
              <div className="flex items-start gap-2 pr-10">
                {/* The company name is edited right here (2026-11-21): a
                    pencil + a border on hover / focus show that it is a field,
                    and a changed name gets «Сохранить» / «Отмена» next to it —
                    no scrolling to the save button of «Общая информация». */}
                <FollowCursorTooltip
                  text="Нажмите, чтобы изменить название"
                  disabled={nameFieldFocused}
                  className="min-w-0 flex-1"
                >
                  <FormField
                    control={editForm.control}
                    name="name"
                    rules={{ required: "Укажите название" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="group relative">
                            <Input
                              {...field}
                              aria-label="Название компании"
                              onFocus={() => setNameFieldFocused(true)}
                              onBlur={() => {
                                field.onBlur()
                                setNameFieldFocused(false)
                              }}
                              className="h-9 pl-2 pr-8 -ml-2 text-base font-semibold shadow-none border-transparent hover:border-input focus-visible:border-input dark:bg-transparent selection:bg-muted-foreground/30 selection:text-inherit"
                              placeholder="Название компании"
                            />
                            <Pencil
                              aria-hidden
                              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-60 group-hover:opacity-100"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FollowCursorTooltip>
                {editForm.formState.dirtyFields.name && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="submit" size="sm" disabled={isPending}>
                      <Save className="h-3.5 w-3.5 mr-1" />
                      Сохранить
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => editForm.resetField("name")}
                    >
                      Отмена
                    </Button>
                  </div>
                )}
                <ClientLookupDialog
                  client={client}
                  onSaved={onChanged}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Поиск в интернете"
                      title="Поиск в интернете"
                    >
                      <CloudSync className="h-4 w-4" />
                    </Button>
                  }
                />
              </div>
              <TabsList
                variant="line"
                className="mt-1 w-full justify-start gap-4 overflow-x-auto scrollbar-none"
              >
                <TabsTrigger value="info" className="flex-none">
                  Общая информация
                </TabsTrigger>
                <TabsTrigger value="fields" className="flex-none">
                  Поля
                </TabsTrigger>
                <TabsTrigger value="documents" className="flex-none">
                  Документы
                </TabsTrigger>
                <TabsTrigger value="tasks" className="flex-none">
                  Задачи
                  {tasks.length > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {tasks.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="contacts" className="flex-none">
                  Контакты
                  {client.contacts.length > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {client.contacts.length}
                    </span>
                  )}
                  {(contactLinks.data?.proposals.length ?? 0) > 0 && (
                    <span
                      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                      aria-label="Есть вопрос по смене компании"
                    />
                  )}
                </TabsTrigger>
                <TabsTrigger value="content" className="flex-none">
                  Источники
                </TabsTrigger>
                {relatedTopics.visible && (
                  <TabsTrigger value="topics" className="flex-none">
                    Темы
                    {(relatedTopics.result?.open.length ?? 0) > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {relatedTopics.result?.open.length}
                      </span>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <TabsContent value="info" className="space-y-3 pt-3">
              {client.userName && (
                <div className="text-sm text-muted-foreground">
                  Создал: {client.userName}
                </div>
              )}

              <ClientResponsibleField client={client} onChanged={onChanged} />

              {/* «Профиль компании» (identity I5 / I6): own API + save, never
                  submits this drawer's form (type="button" everywhere). */}
              <ClientProfileBlock clientId={client.id} />

              {/* «Telegram» (docs/specs/telegram/04 §7.2, Q18): the company's
                  groups / accounts + «Новые контакты из Telegram»; own API,
                  type="button" everywhere, never submits this form. */}
              <ClientTelegramBlock clientId={client.id} onContactsChanged={onContactsChanged} />

              <FormField
                control={editForm.control}
                name="namePhys"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      ФИО физлица
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Если это не организация"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Телефон
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="+7 999 000 0000" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Email
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder="hello@example.com"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Адрес
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Улица, город, страна" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="webUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Сайт
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://example.com" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="aliases"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Другие названия
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Через запятую"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Комментарий
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Заметки, помогающие опознать компанию"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="discount"
                  rules={{
                    validate: (v) => {
                      const s = v.trim()
                      if (s === "") return true
                      const n = Number(s)
                      return (
                        (Number.isFinite(n) && n >= 0 && n <= 100) ||
                        "0–100"
                      )
                    },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Скидка (%)
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="numeric"
                          placeholder="напр. 20"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="companyKind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Тип компании
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Не определено" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={COMPANY_KIND_NONE}>
                            Не определено (по сделкам)
                          </SelectItem>
                          {COMPANY_KIND_VALUES.map((k) => (
                            <SelectItem key={k} value={k}>
                              {COMPANY_KIND_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              {/* «Этап воронки» = the stages of the company's deals, read
                  only (bug list 2026-11-21, item 13; the manual field
                  `funnel_phase` with a fixed list was removed). */}
              <ClientFunnelStages clientId={client.id} clientName={client.name} />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Статус
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">
                        Валюта
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                {canBlock && client.status !== "blocked" ? (
                  <BlacklistEntityButton
                    entityType="client"
                    id={client.id}
                    name={client.name}
                    label="Добавить в список блокировки"
                    onBlocked={() => {
                      onChanged()
                      onOpenChange(false)
                    }}
                  />
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  disabled={isPending || !editForm.formState.isDirty}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Сохранить
                </Button>
              </div>
            </TabsContent>

            <TabsContent
              value="fields"
              forceMount={fieldsVisitedFor === client.id ? true : undefined}
              className="pt-3 data-[state=inactive]:hidden"
            >
              {fieldsVisitedFor === client.id && (
                <CustomFieldsPanel
                  entity="client"
                  entityId={client.id}
                  handleRef={fieldsPanelRef}
                  onChanged={onChanged}
                />
              )}
            </TabsContent>

            {/* «Документы» (docs/specs/attachments §6): mounted only while the
                tab is open (Radix unmounts inactive content). The panel has
                no <form> and only type="button" buttons, so it never submits
                this drawer's form. */}
            <TabsContent value="documents" className="pt-3 text-sm">
              <DocumentsPanel entityType="client" entityId={client.id} />
            </TabsContent>

            <TabsContent value="tasks" className="py-4 space-y-2 text-sm">
              <TaskEditDialog
                mode="create"
                initialValues={{ clientId: client.id }}
                onSuccess={() => {
                  reloadTasks(client.id)
                  onChanged()
                }}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Создать
                  </Button>
                }
              />
              {tasks.length === 0 ? (
                <div className="text-muted-foreground">
                  Нет задач по компании.
                </div>
              ) : (
                tasks.map((t) => {
                  const canEdit =
                    currentUserId === t.userId || currentUserId === t.assigneeId
                  return (
                    <HoverCard key={t.id} openDelay={200}>
                      <HoverCardTrigger asChild>
                        <div
                          className="cursor-pointer space-y-2 rounded-md border p-2.5 transition-colors hover:bg-accent/50"
                          onClick={() => router.push(`/tasks?openTask=${t.id}`)}
                        >
                          <div className="max-w-[32rem] font-medium leading-snug">
                            {t.name}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="secondary" className="text-[10px]">
                                {TASK_TYPE_LABELS[t.type]}
                              </Badge>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${TASK_PRIORITY_BADGE[t.priority]}`}
                              >
                                {TASK_PRIORITY_LABELS[t.priority]}
                              </Badge>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${TASK_STATUS_BADGE[t.status]}`}
                              >
                                {TASK_STATUS_LABELS[t.status]}
                              </Badge>
                            </div>
                            {canEdit && (
                              <Select
                                value={t.status}
                                onValueChange={(v) =>
                                  setTaskStatus(t.id, v as TaskStatus)
                                }
                                disabled={isPending}
                              >
                                <SelectTrigger
                                  className="h-7 w-auto shrink-0 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TASK_STATUSES.map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {TASK_STATUS_LABELS[s]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 space-y-2 text-sm">
                        <div className="font-medium leading-snug">{t.name}</div>
                        {t.description && (
                          <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                            {t.description}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <TaskMeta label="Срок" value={formatDate(t.dueDate)} />
                          <TaskMeta
                            label="Исполнитель"
                            value={t.assigneeName}
                          />
                          <TaskMeta label="Сделка" value={t.dealName} />
                          <TaskMeta label="Контакт" value={t.contactName} />
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  )
                })
              )}
            </TabsContent>

            <TabsContent value="contacts" className="py-4 space-y-2 text-sm">
              <ContactLinkProposalsList
                proposals={contactLinks.data?.proposals ?? []}
                showContactName
                onDecided={onContactsChanged}
              />
              <ContactEditDialog
                mode="create"
                defaultClientId={client.id}
                onSuccess={onContactsChanged}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Новый контакт
                  </Button>
                }
              />
              {client.contacts.length === 0 ? (
                <div className="text-muted-foreground">
                  К этой компании ещё не привязаны контакты.
                </div>
              ) : (
                client.contacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium leading-snug">
                        {contactDisplayName(c)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.position, c.email, c.phone]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                      <ContactAlsoLine entry={contactLinks.entryFor(c.id)} />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Редактировать контакт"
                      onClick={() => openEditContact(c.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
              <ClientContactLinksExtras
                data={contactLinks.data}
                listedContactIds={client.contacts.map((c) => c.id)}
                onOpenContact={openEditContact}
                onChanged={onContactsChanged}
                showProposals={false}
              />
            </TabsContent>

            <TabsContent value="content" className="py-4 text-sm">
              <ClientContentTable clientId={client.id} sources={sources} />
            </TabsContent>

            {relatedTopics.visible && (
              <TabsContent value="topics" className="py-4 text-sm">
                <RelatedTopicsList
                  result={relatedTopics.result}
                  loading={relatedTopics.loading}
                  onChanged={relatedTopics.reload}
                />
              </TabsContent>
            )}
            </div>
            </Tabs>
          </form>
        </Form>
      </SheetContent>

      <ContactDetailDrawer
        contact={editingContact}
        open={Boolean(editingContact)}
        onOpenChange={(o) => {
          if (!o) setEditingContact(null)
        }}
        onChanged={onContactsChanged}
        canBlock={canBlock}
      />

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Есть несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы отредактировали компанию, но не нажали «Сохранить». Что
              сделать с изменениями?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>
              Отмена
            </Button>
            <Button variant="outline" onClick={discardAndClose}>
              Не сохранять
            </Button>
            <Button
              disabled={isPending}
              onClick={async () => {
                setConfirmCloseOpen(false)
                // «Поля» first (own endpoint); stay open when it fails.
                const panel = fieldsPanelRef.current
                if (panel?.isDirty() && !(await panel.save())) return
                if (editForm.formState.isDirty) {
                  editForm.handleSubmit((data) =>
                    onSave(data, { closeAfter: true }),
                  )()
                } else {
                  onOpenChange(false)
                }
              }}
            >
              Сохранить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

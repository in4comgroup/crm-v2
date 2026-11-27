"use client"

import { DetailDrawerContent, DetailDrawerTabs, type DetailNavigation } from "@/components/blocks/detail-drawer-layout"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { Sheet, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { DocumentsPanel } from "@/components/blocks/documents-panel"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { EditableDrawerTitle } from "@/components/blocks/editable-drawer-title"
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
import {
  ClientFunnelStages,
  relationFromDealStages,
  useClientDealStages,
} from "@/components/blocks/client-funnel-stages"
import { CLIENT_RELATION_LABELS } from "@/lib/client-relation"
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
import { useOrgTime } from "@/lib/org-time-context"
import { formatOrgDue } from "@/lib/org-time"

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

export function ClientDetailDrawer({
  client,
  open,
  initialTab = "info",
  navigation,
  onOpenChange,
  onChanged,
  canBlock = false,
}: {
  client: ClientRow | null
  open: boolean
  initialTab?: "info" | "contacts"
  navigation?: DetailNavigation
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  // When true (owner), shows the "add to blocklist" action in the form
  // footer — lives here (with editing), not as a standalone icon on the
  // list card, see refs/blocklist.md.
  canBlock?: boolean
}) {
  // Task deadlines in the ORG time zone (src/lib/org-time.ts).
  const { timeZone: orgTimeZone } = useOrgTime()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const router = useRouter()

  const [taskData, setTaskData] = useState<{
    clientId: string
    items: TaskRow[]
  } | null>(null)
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

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

  // «Этап воронки» + the automatic «Тип компании» (one request).
  const dealStages = useClientDealStages(client?.id ?? null)
  const autoRelation = relationFromDealStages(dealStages)

  const editForm = useForm<ClientEditFormData>({
    defaultValues: buildDefaults(client),
  })
  // react-hook-form computes `isDirty` / `dirtyFields` only when they are READ
  // DURING RENDER (formState is a subscription proxy). A read only inside a
  // handler returned the stale `false`: «Сохранить» said «Изменений нет» and
  // sent nothing (bug 2026-11-26: a renamed company was not saved). So the
  // handlers use these render-time values.
  const { isDirty: formIsDirty } = editForm.formState

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
    // «Сохранить» stays clickable (2026-11-26): testers read a disabled button
    // as «cannot save» after the profile / fields had already saved themselves.
    if (!formIsDirty) {
      toast.info("Изменений нет — всё уже сохранено")
      if (opts?.closeAfter) onOpenChange(false)
      return
    }
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
      (formIsDirty || fieldsPanelRef.current?.isDirty())
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
    <Sheet open={open} modal={!navigation} onOpenChange={handleSheetOpenChange}>
      <DetailDrawerContent
        defaultWidth="720px"
        minimumWidth={600}
        widthStorageKey="client-drawer-width"
        navigation={navigation}
        getNavigationStatus={() => isPending ? "busy" : formIsDirty || fieldsPanelRef.current?.isDirty() ? "dirty" : "ready"}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
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
              <div className="flex items-center gap-2 pr-10">
                <EditableDrawerTitle label="Название компании" pending={isPending} />
                <ClientLookupDialog
                  client={client}
                  onSaved={onChanged}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto shrink-0"
                      aria-label="Поиск в интернете"
                      title="Поиск в интернете"
                    >
                      <CloudSync className="h-4 w-4" />
                    </Button>
                  }
                />
              </div>
              <DetailDrawerTabs>
                <TabsTrigger value="info" className="flex-none">
                  Главное
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
                <TabsTrigger value="tasks" className="flex-none">
                  Задачи
                  {tasks.length > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {tasks.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="documents" className="flex-none">
                  Документы
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
                <TabsTrigger value="fields" className="flex-none">
                  Инфо
                </TabsTrigger>
                <TabsTrigger value="content" className="flex-none">
                  Источники
                </TabsTrigger>
              </DetailDrawerTabs>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <TabsContent value="info" className="space-y-3 pt-3">
              {client.userName && (
                <div className="text-sm text-muted-foreground">
                  Создал: {client.userName}
                </div>
              )}

              <ClientResponsibleField client={client} onChanged={onChanged} />

              {/* «Этап воронки» = the stages of the company's deals, read
                  only (bug list 2026-11-21, item 13; the manual field
                  `funnel_phase` with a fixed list was removed). */}
              <ClientFunnelStages clientId={client.id} clientName={client.name} state={dealStages} />

              {/* «Профиль компании» (identity I5 / I6): own API + save, never
                  submits this drawer's form (type="button" everywhere). */}
              <ClientProfileBlock clientId={client.id} onClientChanged={onChanged} />

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
                    <FormItem className="min-w-0">
                      <FormLabel className="text-xs text-muted-foreground">
                        Тип компании
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder="Автоматически по сделкам" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {/* No manual tag = the relationship from the
                              deals, shown here so «Не определено» is not
                              read as the company's type (2026-11-26). */}
                          <SelectItem value={COMPANY_KIND_NONE}>
                            {autoRelation
                              ? `Автоматически по сделкам: ${CLIENT_RELATION_LABELS[autoRelation]}`
                              : "Автоматически по сделкам"}
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
                <Button type="submit" disabled={isPending}>
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
                          <TaskMeta label="Срок" value={formatOrgDue(t.dueDate, orgTimeZone)} />
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
      </DetailDrawerContent>

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
                if (formIsDirty) {
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

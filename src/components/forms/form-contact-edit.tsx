"use client"

import { useState, useTransition, useEffect } from "react"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import { BlacklistEntityButton } from "@/components/blocks/client-blocklist-dialog"
import type { ContactRow, ClientOption, ManagedAtOptions } from "@/app/api/contacts/route"
import type { EntityStatus } from "@/db/schema"
import {
  MANAGED_AT_LIMITS,
  managedAtLabel,
  type ContactManagedAt,
  type ContactManagedAtInput,
} from "@/lib/contact-managed-at"

// `initial` is reserved for contacts auto-created by the contact-discovery
// scan on /clients (Contacts tab). Operators flip it to `active` here
// once they confirm the row is a real CRM contact. Manual creation keeps
// defaulting to `active`.
// `deleted` is a soft-delete (hidden from lists by default, excluded from
// discovery dedup so a re-scan can re-create it). Flip back to `active` to
// restore.
const STATUSES: EntityStatus[] = [
  "active",
  "suspended",
  "initial",
  "deleted",
  "blocked",
]
const NO_CLIENT = "__none__"
// «Ведётся на уровне» select values (docs/specs/clients-contacts/07).
const MANAGED_NONE = "__none__"
const MANAGED_PERSON = "__person__"
const MANAGED_MEMBER = "member:"

type ManagedFields = { managedChoice: string; managedPersonName: string; managedPersonPosition: string }

function managedFields(v: ContactManagedAt | null | undefined): ManagedFields {
  if (v?.kind === "member") return { managedChoice: MANAGED_MEMBER + v.userId, managedPersonName: "", managedPersonPosition: "" }
  if (v?.kind === "person") {
    return { managedChoice: MANAGED_PERSON, managedPersonName: v.name, managedPersonPosition: v.position ?? "" }
  }
  return { managedChoice: MANAGED_NONE, managedPersonName: "", managedPersonPosition: "" }
}

function managedInput(f: ManagedFields): ContactManagedAtInput | null {
  if (f.managedChoice.startsWith(MANAGED_MEMBER)) {
    return { kind: "member", userId: f.managedChoice.slice(MANAGED_MEMBER.length) }
  }
  if (f.managedChoice === MANAGED_PERSON && f.managedPersonName.trim()) {
    return { kind: "person", name: f.managedPersonName.trim(), position: f.managedPersonPosition.trim() || null }
  }
  return null
}

const sameManagedInput = (a: ContactManagedAtInput | null, b: ContactManagedAtInput | null) =>
  JSON.stringify(a) === JSON.stringify(b)

// UI display labels for status (DB enum values stay English).
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  suspended: "Приостановлен",
  initial: "Новый",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

type ContactFormData = {
  name: string
  nameNative: string
  /** Comma-separated in the form; split to string[] on submit. */
  aliases: string
  phone: string
  email: string
  position: string
  clientId: string
  status: EntityStatus
} & ManagedFields

type Props = {
  mode: "create" | "edit"
  contact?: ContactRow
  trigger: React.ReactNode
  onSuccess?: (createdId?: string) => void
  defaultClientId?: string
  // Optional controlled open state — lets a parent open this dialog
  // programmatically (e.g. the /contacts page's `?openContact=<id>` deep-link
  // from the global search) without a click on `trigger`. Omit both for the
  // usual uncontrolled click-to-open behaviour.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // When true (owner) and editing, shows the "add to blocklist" action in
  // the footer — lives here (with editing) rather than as a standalone icon
  // on the contact card, see refs/blocklist.md.
  canBlock?: boolean
}

export function ContactEditForm({
  mode,
  contact,
  defaultClientId,
  onSuccess,
  onCancel,
  canBlock = false,
}: {
  mode: "create" | "edit"
  contact?: ContactRow
  defaultClientId?: string
  onSuccess?: (createdId?: string) => void
  onCancel?: () => void
  canBlock?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [managedOptions, setManagedOptions] = useState<ManagedAtOptions>({ members: [], people: [] })
  // The stored «Ведётся на уровне» (null = not set). Rows built outside the
  // contacts module carry no value (undefined) — it is loaded below, and the
  // form sends the field only when the user changed it.
  const [loadedManaged, setLoadedManaged] = useState<{ id: string; value: ContactManagedAt | null } | null>(null)
  const managedStored: ContactManagedAt | null | undefined =
    contact?.managedAt !== undefined
      ? contact.managedAt
      : loadedManaged && loadedManaged.id === contact?.id
        ? loadedManaged.value
        : undefined
  const initialManaged = managedInput(managedFields(managedStored))

  const form = useForm<ContactFormData>({
    defaultValues: {
      name: contact?.name ?? "",
      nameNative: contact?.nameNative ?? "",
      aliases: (contact?.aliases ?? []).join(", "),
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      position: contact?.position ?? "",
      clientId:
        mode === "create"
          ? (defaultClientId ?? NO_CLIENT)
          : (contact?.clientId ?? NO_CLIENT),
      status: contact?.status ?? "active",
      ...managedFields(contact?.managedAt),
    },
  })

  useEffect(() => {
    form.reset({
      name: contact?.name ?? "",
      nameNative: contact?.nameNative ?? "",
      aliases: (contact?.aliases ?? []).join(", "),
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      position: contact?.position ?? "",
      clientId:
        mode === "create"
          ? (defaultClientId ?? NO_CLIENT)
          : (contact?.clientId ?? NO_CLIENT),
      status: contact?.status ?? "active",
      ...managedFields(contact?.managedAt),
    })
    let cancelled = false
    fetch("/api/contacts?clientOptions=1")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setClientOptions(data.options ?? [])
      })
      .catch(() => {})
    fetch("/api/contacts?managedAtOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ManagedAtOptions | null) => {
        if (!cancelled && data) setManagedOptions({ members: data.members ?? [], people: data.people ?? [] })
      })
      .catch(() => {})
    if (mode === "edit" && contact && contact.managedAt === undefined) {
      fetch(`/api/contacts?id=${encodeURIComponent(contact.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { contact?: ContactRow } | null) => {
          if (cancelled || !d?.contact) return
          const fields = managedFields(d.contact.managedAt)
          setLoadedManaged({ id: d.contact.id, value: d.contact.managedAt ?? null })
          form.setValue("managedChoice", fields.managedChoice)
          form.setValue("managedPersonName", fields.managedPersonName)
          form.setValue("managedPersonPosition", fields.managedPersonPosition)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [contact, form, mode, defaultClientId])

  const onSubmit = (data: ContactFormData) => {
    startTransition(async () => {
      try {
        const clientId = data.clientId === NO_CLIENT ? null : data.clientId
        const aliases = data.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
        const { managedChoice, managedPersonName, managedPersonPosition, ...rest } = data
        const managed = managedInput({ managedChoice, managedPersonName, managedPersonPosition })
        if (managedChoice === MANAGED_PERSON && !managed) {
          toast.error("Укажите имя человека в поле «Ведётся на уровне»")
          return
        }
        // Sent only when changed: a row without a loaded value never clears it.
        const managedPart = sameManagedInput(managed, initialManaged) ? {} : { managedAt: managed }
        const payload =
          mode === "create"
            ? { ...rest, aliases, clientId, ...managedPart }
            : { id: contact!.id, ...rest, aliases, clientId, ...managedPart }
        const res = await fetch("/api/contacts", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось сохранить контакт")
          return
        }
        const json = await res.json().catch(() => ({}))
        toast.success(mode === "create" ? "Контакт создан" : "Контакт обновлён")
        onSuccess?.(json?.id)
      } catch {
        toast.error("Не удалось сохранить контакт")
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="name"
            rules={{ required: "Укажите имя" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Имя *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Имя контакта" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nameNative"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">
                  Имя на родном языке
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Имя на родном языке (напр. 张伟)"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Телефон</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="+7 999 000 0000" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    placeholder="hello@example.com"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="position"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">Должность</FormLabel>
              <FormControl>
                <Input {...field} placeholder="напр. директор по ИТ" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <ManagedAtField form={form} options={managedOptions} stored={managedStored} />

        <FormField
          control={form.control}
          name="aliases"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-400">
                Другие имена
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Другие написания / прозвища через запятую (напр. Евгений Богданов, Женя)"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Клиент</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
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
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Статус</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          {mode === "edit" && contact && canBlock && contact.status !== "blocked" ? (
            <BlacklistEntityButton
              entityType="contact"
              id={contact.id}
              name={contact.nameNative || contact.name}
              label="Добавить в список блокировки"
              onBlocked={() => onSuccess?.()}
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCancel?.()}
            >
              Отмена
            </Button>
            <LoadingButton type="submit" loading={isPending}>
              {mode === "create" ? "Создать" : "Сохранить"}
            </LoadingButton>
          </div>
        </div>
      </form>
    </Form>
  )
}

/**
 * «Ведётся на уровне» (docs/specs/clients-contacts/07): the person in OUR
 * organization at whose level this contact is managed — a member, or a
 * person who is not a user (name + position). Information only.
 */
function ManagedAtField({
  form,
  options,
  stored,
}: {
  form: ReturnType<typeof useForm<ContactFormData>>
  options: ManagedAtOptions
  stored: ContactManagedAt | null | undefined
}) {
  const choice = form.watch("managedChoice")
  // A member who left the org stays visible (not offered to others).
  const goneMember =
    stored?.kind === "member" && !options.members.some((m) => m.userId === stored.userId) ? stored : null
  const peopleListId = "contact-managed-people"
  return (
    <div className="space-y-2">
      <FormField
        control={form.control}
        name="managedChoice"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-gray-400">Ведётся на уровне</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Не указано" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={MANAGED_NONE}>Не указано</SelectItem>
                {(options.members.length > 0 || goneMember) && (
                  <SelectGroup>
                    <SelectLabel>Сотрудники в системе</SelectLabel>
                    {options.members.map((m) => (
                      <SelectItem key={m.userId} value={MANAGED_MEMBER + m.userId}>
                        {m.name}
                      </SelectItem>
                    ))}
                    {goneMember && (
                      <SelectItem value={MANAGED_MEMBER + goneMember.userId}>{managedAtLabel(goneMember)}</SelectItem>
                    )}
                  </SelectGroup>
                )}
                <SelectSeparator />
                <SelectItem value={MANAGED_PERSON}>Другой человек нашей компании…</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Кто в нашей компании ведёт этот контакт на своём уровне — например, генеральный директор. Только для
              информации.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
      {choice === MANAGED_PERSON && (
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="managedPersonName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Имя *</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    list={peopleListId}
                    maxLength={MANAGED_AT_LIMITS.name}
                    placeholder="напр. Иван Петров"
                    onChange={(e) => {
                      field.onChange(e)
                      // Picked a known person → fill an empty position.
                      const hit = options.people.find((p) => p.name === e.target.value)
                      if (hit?.position && !form.getValues("managedPersonPosition")) {
                        form.setValue("managedPersonPosition", hit.position)
                      }
                    }}
                  />
                </FormControl>
                <datalist id={peopleListId}>
                  {options.people.map((p) => (
                    <option key={`${p.name}|${p.position ?? ""}`} value={p.name}>
                      {p.position ?? ""}
                    </option>
                  ))}
                </datalist>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="managedPersonPosition"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-400">Должность</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={MANAGED_AT_LIMITS.position} placeholder="напр. генеральный директор" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </div>
  )
}

export default function ContactEditDialog({
  mode,
  contact,
  trigger,
  onSuccess,
  defaultClientId,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  canBlock = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = setControlledOpen ?? setInternalOpen

  const title =
    mode === "create"
      ? "Новый контакт"
      : `Редактирование контакта: ${contact?.name ?? ""}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ContactEditForm
          mode={mode}
          contact={contact}
          defaultClientId={defaultClientId}
          canBlock={canBlock}
          onSuccess={(id) => {
            onSuccess?.(id)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

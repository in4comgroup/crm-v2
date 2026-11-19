"use client"

// /account → «Профиль организации» (identity spec I1, §3 / §6). Members read,
// the org OWNER edits. Groups:
//   A «Кто мы» — identity registry (names, sites + mail domains, shared
//     mailboxes, staff addresses, postal addresses). Registry changes are
//     saved at once (one row each, like the old «Своя организация» dialog
//     that this group replaces); only «Нет своего домена» is a profile field.
//   B «Чем мы занимаемся» — the profile fields, saved with «Сохранить»
//     (unsaved-changes guard like the other /account forms).
//   C «Рабочий контекст» — read-only (time zone / working hours).
// Plus completeness «Профиль заполнен на N из 6» and the change history.
// The server is the real gate (PUT /api/org-profile 403 for non-owners).

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, ChevronDown, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { LoadingButton } from "@/components/blocks/loading-button"
import { PageLoader } from "@/components/blocks/page-loader"
import { WorkingContextCard } from "@/components/blocks/working-context-card"
import {
  AddIdentityEntry,
  EntryChips,
  FixedChip,
  IdentityMatchesPanel,
  matchCount,
  postIdentityEntry,
} from "@/components/blocks/identity-entry-controls"
import { ClientEnrichOnCreateSwitch } from "@/components/blocks/client-enrich-on-create-switch"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import {
  COMPLETENESS_LABELS_RU,
  MARKET_ROLES,
  MARKET_ROLE_LABELS_RU,
  ORG_PROFILE_LIMITS as L,
  PERSON_CHANNEL_LABELS_RU,
  type OrgProfileInput,
  type PersonChannel,
} from "@/lib/identity/org-profile"
import {
  ORG_PROFILE_FIELD_LABELS_RU,
  canonicalOrgProfile,
  formatProfileValue,
} from "@/lib/identity/org-profile-log"
import type { IdentityMatches, OrgIdentityEntryView } from "@/app/api/org-identity/route"
import type { OrgProfileView } from "@/app/api/org-profile/route"

const NONE = "__none__"

type Line = { name: string; description?: string; categories?: string[] }

const PERSON_OPTIONS: { value: PersonChannel; label: string; placeholder: string }[] = [
  { value: "email", label: "Email", placeholder: "" },
  { value: "telegram", label: "Telegram", placeholder: "" },
  { value: "phone", label: "Телефон", placeholder: "" },
]

const DOMAIN_OPTIONS = [
  { value: "website", label: "Сайт", placeholder: "" },
  { value: "email_domain", label: "Почтовый домен", placeholder: "" },
]

function same(a: OrgProfileInput, b: OrgProfileInput): boolean {
  return JSON.stringify(canonicalOrgProfile(a)) === JSON.stringify(canonicalOrgProfile(b))
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2 border-b pb-4 last:border-b-0 last:pb-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  )
}

function Chips({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>
}

// ── List editor: «Продукты и услуги», «Наши клиенты», «Кто продаёт нам» ──

function CategoryPicker({
  all,
  value,
  disabled,
  onChange,
}: {
  all: string[]
  value: string[]
  disabled: boolean
  onChange: (v: string[]) => void
}) {
  const set = new Set(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-full justify-between gap-1" disabled={disabled}>
          <span className="truncate">
            {value.length === 0 ? "Категории каталога" : `Категории: ${value.length}`}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-72 overflow-y-auto p-2" align="start">
        {all.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox
              checked={set.has(c)}
              onCheckedChange={(v) =>
                onChange(v === true ? [...value, c] : value.filter((x) => x !== c))
              }
            />
            <span className="truncate">{c}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function LinesEditor({
  lines,
  max,
  canEdit,
  namePlaceholder,
  descriptionPlaceholder,
  categories,
  onChange,
}: {
  lines: Line[]
  max: number
  canEdit: boolean
  namePlaceholder: string
  descriptionPlaceholder: string
  /** Catalogue categories (products only); empty = no picker. */
  categories?: string[]
  onChange: (lines: Line[]) => void
}) {
  const update = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  if (!canEdit && lines.length === 0) return <Muted>Не заполнено</Muted>
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) =>
        canEdit ? (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              value={l.name}
              maxLength={L.lineName}
              placeholder={namePlaceholder}
              onChange={(e) => update(i, { name: e.target.value })}
              className="h-8 min-w-40 flex-1"
            />
            <Input
              value={l.description ?? ""}
              maxLength={L.lineDescription}
              placeholder={descriptionPlaceholder}
              onChange={(e) => update(i, { description: e.target.value })}
              className="h-8 min-w-48 flex-[2]"
            />
            {categories && categories.length > 0 && (
              <CategoryPicker
                all={categories}
                value={l.categories ?? []}
                disabled={!canEdit}
                onChange={(v) => update(i, { categories: v })}
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Удалить строку"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div key={i} className="text-sm">
            <span className="font-medium">{l.name}</span>
            {l.description && <span className="text-muted-foreground"> — {l.description}</span>}
            {l.categories && l.categories.length > 0 && (
              <span className="text-xs text-muted-foreground"> · категории: {l.categories.join(", ")}</span>
            )}
          </div>
        ),
      )}
      {canEdit && lines.length < max && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onChange([...lines, { name: "" }])}
        >
          <Plus className="size-3.5" />
          Добавить строку
        </Button>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────

export function OrgProfileTab({
  reloadKey,
  onOpenInfoTab,
  onChanged,
}: {
  /** Changes when «Информация об организации» was saved — reload group A. */
  reloadKey?: string
  onOpenInfoTab: () => void
  /** After any save (profile or registry): e.g. refresh the banner. */
  onChanged?: () => void
}) {

  const [view, setView] = useState<OrgProfileView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<OrgProfileInput | null>(null)
  const [draft, setDraft] = useState<OrgProfileInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [matches, setMatches] = useState<IdentityMatches | null>(null)

  // Reloads never touch the draft (unsaved edits survive a registry change);
  // the first response fills it (effect below).
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org-profile")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(data.error ?? "Не удалось загрузить профиль")
        return
      }
      setLoadError(null)
      const v = data as OrgProfileView
      setView(v)
      setBaseline(v.profile)
    } catch {
      setLoadError("Не удалось загрузить профиль")
    }
  }, [])

  useEffect(() => {
    // First load + reload after «Информация об организации» was saved.
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    // The first response also fills the draft.
    if (view && draft === null) setDraft(view.profile)
  }, [view, draft])

  const canEdit = !!view?.canManage
  const isDirty = canEdit && !!draft && !!baseline && !same(draft, baseline)

  const save = async (): Promise<boolean> => {
    if (!draft) return false
    if (draft.products.some((l) => !l.name.trim() && (l.description ?? "").trim())) {
      toast.error("У строки «Продукты и услуги» нет названия")
      return false
    }
    setSaving(true)
    try {
      const res = await fetch("/api/org-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: canonicalOrgProfile(draft) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить профиль")
        return false
      }
      toast.success(data.changed?.length ? "Профиль организации сохранён" : "Изменений нет")
      setDraft(data.profile)
      setBaseline(data.profile)
      await load()
      onChanged?.()
      return true
    } finally {
      setSaving(false)
    }
  }

  const { dialog } = useUnsavedChangesGuard({ isDirty, onSave: save })

  const set = <K extends keyof OrgProfileInput>(key: K, value: OrgProfileInput[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const afterRegistryChange = async (result: { matches: IdentityMatches } | null) => {
    if (!result) return false
    if (matchCount(result.matches) > 0) setMatches(result.matches)
    await load()
    onChanged?.()
    return true
  }

  const addEntry = async (kind: string, value: string, extra?: { channel?: string; userId?: string }) =>
    afterRegistryChange(await postIdentityEntry({ kind, value, ...extra }))

  const onDeleted = () => {
    void load()
    onChanged?.()
  }

  const industryLabels = useMemo(
    () => Object.fromEntries((view?.industries ?? []).map((i) => [i.code, i.label])),
    [view?.industries],
  )

  if (loadError && !view) {
    return <div className="p-6 text-sm text-destructive">{loadError}</div>
  }
  if (!view || !draft) return <PageLoader />

  const { identity, completeness } = view
  const viewerId = view.viewerUserId
  const canDeleteOrg = () => canEdit
  const canEditPerson = (userId: string) => canEdit || userId === viewerId

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Completeness */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-base font-medium">
              {completeness.complete && <CheckCircle2 className="size-5 text-emerald-600" />}
              Профиль заполнен на {completeness.done} из {completeness.total}
            </div>
            {!canEdit && (
              <span className="text-xs text-muted-foreground">
                Редактирует владелец организации. Свои рабочие адреса вы добавляете в профиле.
              </span>
            )}
          </div>
          <Progress value={(completeness.done / Math.max(1, completeness.total)) * 100} />
          {completeness.missing.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {completeness.missing.map((m) => (
                <li key={m}>{COMPLETENESS_LABELS_RU[m]}</li>
              ))}
            </ul>
          )}
          {!completeness.complete && (
            <p className="text-xs text-muted-foreground">
              Без этого минимума ИИ не отличает внутреннюю переписку от внешней. Счёт обновляется после
              сохранения.
            </p>
          )}
        </CardContent>
      </Card>

      {/* A. Кто мы */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Кто мы</CardTitle>
          <CardDescription>
            По этим признакам система узнаёт вашу компанию в письмах, чатах и документах. Всё
            перечисленное здесь не станет клиентом или контактом. Изменения в этом блоке сохраняются
            сразу.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {matches && matchCount(matches) > 0 && (
            <IdentityMatchesPanel matches={matches} onClose={() => setMatches(null)} />
          )}

          <FieldRow label="Название">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{identity.orgName}</span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={onOpenInfoTab}>
                Изменить в «Информация об организации»
              </Button>
            </div>
          </FieldRow>

          <FieldRow label="Другие названия" hint="Синонимы и вторые торговые названия.">
            <Chips>
              <EntryChips
                entries={identity.entries.name}
                canDelete={canDeleteOrg}
                onDeleted={onDeleted}
                empty={!canEdit ? <Muted>Нет</Muted> : undefined}
              />
            </Chips>
            {canEdit && (
              <AddIdentityEntry
                onAdd={(v) => addEntry("name", v)}
              />
            )}
          </FieldRow>

          <FieldRow
            label="Сайты и домены"
            hint="Письма с этих доменов — наши. Почтовый домен — если у почты нет сайта."
          >
            <Chips>
              {identity.webUrl && <FixedChip>{identity.webUrl}</FixedChip>}
              <EntryChips
                entries={identity.entries.website}
                canDelete={canDeleteOrg}
                onDeleted={onDeleted}
              />
              <EntryChips
                entries={identity.entries.email_domain}
                canDelete={canDeleteOrg}
                onDeleted={onDeleted}
                prefix={() => "почта"}
              />
              {!identity.webUrl &&
                identity.entries.website.length === 0 &&
                identity.entries.email_domain.length === 0 && <Muted>Нет</Muted>}
            </Chips>
            {canEdit && (
              <AddIdentityEntry options={DOMAIN_OPTIONS} onAdd={(v, kind) => addEntry(kind ?? "website", v)} />
            )}
            <label className="flex w-fit items-center gap-2 text-sm">
              <Checkbox
                checked={draft.noOwnDomain}
                disabled={!canEdit}
                onCheckedChange={(v) => set("noOwnDomain", v === true)}
              />
              Нет своего домена (почта на общих сервисах)
            </label>
            {draft.noOwnDomain && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Тогда «мы» — это адреса входа сотрудников, их дополнительные адреса и общие ящики.
                Добавьте их ниже: каждый сотрудник может добавить свои адреса в профиле.
              </p>
            )}
          </FieldRow>

          <FieldRow label="Общие ящики" hint="Наши адреса, которые не принадлежат одному сотруднику.">
            <Chips>
              <EntryChips
                entries={identity.entries.mailbox}
                canDelete={canDeleteOrg}
                onDeleted={onDeleted}
                empty={!canEdit ? <Muted>Нет</Muted> : undefined}
              />
            </Chips>
            {canEdit && (
              <AddIdentityEntry onAdd={(v) => addEntry("mailbox", v)} />
            )}
          </FieldRow>

          <FieldRow
            label="Адреса сотрудников"
            hint="Адрес входа считается нашим, только если он на нашем домене (или отмечено «Нет своего домена»). Тестовые и личные адреса не считаются — для работы с личной почты добавьте её здесь или в «Мои адреса для работы»."
          >
            <div className="divide-y rounded-md border">
              {identity.members.map((m) => (
                <div key={m.userId} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{m.name}</span>
                    {m.role === "owner" && (
                      <Badge variant="outline" className="font-normal">
                        владелец
                      </Badge>
                    )}
                    <FixedChip>{m.email}</FixedChip>
                    {!m.signInCounts && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        адрес входа не считается нашим
                      </Badge>
                    )}
                    <EntryChips
                      entries={m.entries}
                      canDelete={(e: OrgIdentityEntryView) => canEditPerson(e.userId ?? "")}
                      onDeleted={onDeleted}
                      prefix={(e) => (e.channel ? PERSON_CHANNEL_LABELS_RU[e.channel] : null)}
                    />
                  </div>
                  {canEditPerson(m.userId) && (
                    <AddIdentityEntry
                      options={PERSON_OPTIONS}
                      buttonLabel="Добавить адрес"
                      onAdd={(v, channel) =>
                        addEntry("person", v, { channel: channel ?? "email", userId: m.userId })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Адреса" hint="Почтовые адреса компании: город и улица.">
            <Chips>
              {identity.address && <FixedChip>{identity.address}</FixedChip>}
              <EntryChips
                entries={identity.entries.address}
                canDelete={canDeleteOrg}
                onDeleted={onDeleted}
              />
              {!identity.address && identity.entries.address.length === 0 && <Muted>Нет</Muted>}
            </Chips>
            {canEdit && (
              <AddIdentityEntry
                onAdd={(v) => addEntry("address", v)}
              />
            )}
          </FieldRow>
        </CardContent>
      </Card>

      {/* B. Чем мы занимаемся */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Чем мы занимаемся</CardTitle>
          <CardDescription>
            Этот текст читает ИИ: он понимает, что мы продаём, кому и у кого покупаем.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldRow label="Чем занимается компания" hint="1–3 предложения.">
            {canEdit ? (
              <>
                <Textarea
                  value={draft.description ?? ""}
                  maxLength={L.description}
                  rows={3}
                  onChange={(e) => set("description", e.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  {(draft.description ?? "").length} / {L.description}
                </span>
              </>
            ) : (
              <span className="text-sm">{draft.description || <Muted>Не заполнено</Muted>}</span>
            )}
          </FieldRow>

          <FieldRow label="Отрасль">
            {canEdit ? (
              <Select
                value={draft.industryCode ?? NONE}
                onValueChange={(v) => set("industryCode", v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="Выберите отрасль" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не выбрана</SelectItem>
                  {view.industries.map((i) => (
                    <SelectItem key={i.code} value={i.code}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">
                {draft.industryCode ? industryLabels[draft.industryCode] ?? draft.industryCode : <Muted>Не выбрана</Muted>}
              </span>
            )}
          </FieldRow>

          <FieldRow label="Комментарий к отрасли">
            {canEdit ? (
              <Input
                value={draft.industryNote ?? ""}
                maxLength={L.industryNote}
                onChange={(e) => set("industryNote", e.target.value)}
              />
            ) : (
              <span className="text-sm">{draft.industryNote || <Muted>—</Muted>}</span>
            )}
          </FieldRow>

          <FieldRow label="Роль на рынке" hint="Можно выбрать несколько.">
            <div className="flex flex-wrap gap-1.5">
              {MARKET_ROLES.map((r) => {
                const on = draft.marketRoles.includes(r)
                if (!canEdit && !on) return null
                return (
                  <Button
                    key={r}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-7 rounded-full"
                    disabled={!canEdit}
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        "marketRoles",
                        on ? draft.marketRoles.filter((x) => x !== r) : [...draft.marketRoles, r],
                      )
                    }
                  >
                    {MARKET_ROLE_LABELS_RU[r]}
                  </Button>
                )
              })}
              {!canEdit && draft.marketRoles.length === 0 && <Muted>Не выбрана</Muted>}
            </div>
          </FieldRow>

          <FieldRow
            label="Продукты и услуги"
            hint={`До ${L.products} строк. Можно связать строку с категориями каталога.`}
          >
            <LinesEditor
              lines={draft.products}
              max={L.products}
              canEdit={canEdit}
              namePlaceholder="Название"
              descriptionPlaceholder="Коротко (необязательно)"
              categories={view.productCategories}
              onChange={(v) => set("products", v)}
            />
          </FieldRow>

          <FieldRow label="Наши клиенты" hint={`Сегменты покупателей, до ${L.targetCustomers}.`}>
            <LinesEditor
              lines={draft.targetCustomers}
              max={L.targetCustomers}
              canEdit={canEdit}
              namePlaceholder="Название"
              descriptionPlaceholder="Коротко (необязательно)"
              onChange={(v) => set("targetCustomers", v)}
            />
          </FieldRow>

          <FieldRow
            label="Кто продаёт нам"
            hint="Типы поставщиков: их предложения — не спрос на наши товары."
          >
            <LinesEditor
              lines={draft.supplierTypes}
              max={L.supplierTypes}
              canEdit={canEdit}
              namePlaceholder="Название"
              descriptionPlaceholder="Коротко (необязательно)"
              onChange={(v) => set("supplierTypes", v)}
            />
          </FieldRow>

          <FieldRow label="География">
            {canEdit ? (
              <Input
                value={draft.geography ?? ""}
                maxLength={L.geography}
                onChange={(e) => set("geography", e.target.value)}
              />
            ) : (
              <span className="text-sm">{draft.geography || <Muted>—</Muted>}</span>
            )}
          </FieldRow>

          <FieldRow label="Наши термины" hint="Внутренние сокращения и прозвища продуктов.">
            <div className="flex flex-col gap-2">
              {draft.glossary.map((g, i) =>
                canEdit ? (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={g.term}
                      maxLength={L.term}
                      placeholder="Термин"
                      className="h-8 min-w-32 flex-1"
                      onChange={(e) =>
                        set(
                          "glossary",
                          draft.glossary.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      value={g.meaning}
                      maxLength={L.meaning}
                      placeholder="Что значит"
                      className="h-8 min-w-48 flex-[2]"
                      onChange={(e) =>
                        set(
                          "glossary",
                          draft.glossary.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Удалить термин"
                      onClick={() => set("glossary", draft.glossary.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{g.term}</span>
                    <span className="text-muted-foreground"> — {g.meaning}</span>
                  </div>
                ),
              )}
              {!canEdit && draft.glossary.length === 0 && <Muted>Нет</Muted>}
              {canEdit && draft.glossary.length < L.glossary && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => set("glossary", [...draft.glossary, { term: "", meaning: "" }])}
                >
                  <Plus className="size-3.5" />
                  Добавить термин
                </Button>
              )}
            </div>
          </FieldRow>
        </CardContent>
      </Card>

      {/* C. Рабочий контекст — the org owner edits it (2026-11-19). */}
      <WorkingContextCard value={view.workingContext} canEdit={canEdit} onSaved={() => void load()} />

      {/* Client profiles (identity I6, Q6) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Профили компаний</CardTitle>
          <CardDescription>Профили клиентов в разделе «Компании».</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientEnrichOnCreateSwitch />
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">История изменений</CardTitle>
          {view.updatedAt && (
            <CardDescription>
              Последнее изменение: {new Date(view.updatedAt).toLocaleString("ru-RU")}
              {view.updatedByName ? ` · ${view.updatedByName}` : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {view.history.length === 0 ? (
            <Muted>Изменений пока нет.</Muted>
          ) : (
            <div className="divide-y rounded-md border">
              {view.history.map((h) => (
                <details key={h.id} className="group px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1">
                    <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0" />
                    <span className="text-muted-foreground">{new Date(h.at).toLocaleString("ru-RU")}</span>
                    <span className="font-medium">{h.byName ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {h.changed.map((f) => ORG_PROFILE_FIELD_LABELS_RU[f] ?? f).join(", ")}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5 pl-5">
                    {h.changed.map((f) => (
                      <div key={f} className="text-xs">
                        <div className="font-medium">{ORG_PROFILE_FIELD_LABELS_RU[f] ?? f}</div>
                        <div className="text-muted-foreground">
                          Было: {formatProfileValue(f, h.before[f], industryLabels)}
                        </div>
                        <div>Стало: {formatProfileValue(f, h.after[f], industryLabels)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t bg-background px-4 py-3">
          <LoadingButton onClick={() => void save()} loading={saving} disabled={!isDirty}>
            Сохранить
          </LoadingButton>
          {isDirty && (
            <>
              <Button variant="ghost" onClick={() => baseline && setDraft(baseline)} disabled={saving}>
                Отменить
              </Button>
              <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>
            </>
          )}
        </div>
      )}

      {dialog}
    </div>
  )
}

"use client"

// Contact ↔ company links over time (docs/specs/clients-contacts/04 §5–§6):
// block «Компании» of the contact drawer — current links (primary first),
// «Ранее», the badge «Перешёл из X», the person's addresses, the journal and
// the pending proposals «Контакт сменил компанию?». The proposal card is
// exported and reused by the company drawer / page.
//
// Data: GET / POST /api/contacts/[id]/links (ContactLinksResponse),
// POST /api/contact-link-proposals/[id], POST /api/contacts/merge. No DB here.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeftRight,
  Building2,
  ChevronDown,
  History,
  Loader,
  Merge,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import { cn } from "@/lib/utils"
import { telegramAddressLabel } from "@/lib/telegram/resolve"
import {
  ADDRESS_KINDS,
  ADDRESS_KIND_LABELS,
  DECISION_LABELS,
  LINK_RELATIONS,
  LINK_RELATION_LABELS,
  type AddressKind,
  type ClientContactLinksResponse,
  type ContactAddressView,
  type ContactLinkAction,
  type ContactLinkView,
  type ContactLinksResponse,
  type LinkRelation,
  type ProposalDecisionBody,
  type ProposalView,
} from "@/lib/contact-links"

// ── Helpers ────────────────────────────────────────────────────────────────

/** ISO → «15.11.2026»; "" when empty / invalid. */
export function formatLinkDay(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

/** «01.02.2025 — 15.11.2026» / «с 01.02.2025» / «до 15.11.2026» / "". */
export function linkPeriodText(start: string | null, end: string | null): string {
  const s = formatLinkDay(start)
  const e = formatLinkDay(end)
  if (s && e) return `${s} — ${e}`
  if (e) return `до ${e}`
  if (s) return `с ${s}`
  return ""
}

/** Short lower-case relation label for inline text («консультант / подрядчик»). */
export function relationShort(relation: string): string {
  const label = LINK_RELATION_LABELS[relation as LinkRelation] ?? relation
  return label.toLowerCase()
}

function dayInputValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ""
}

function todayInputValue(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error || "Не удалось выполнить действие")
  return data as T
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Не удалось выполнить действие"
}

type ClientOption = { id: string; name: string }

function useClientOptions(enabled: boolean): ClientOption[] {
  const [options, setOptions] = useState<ClientOption[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch("/api/contacts?clientOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: ClientOption[] } | null) => {
        if (!cancelled && d) setOptions(d.options ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])
  return options
}

// ── Proposal card «Контакт сменил компанию?» ───────────────────────────────

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "высокая уверенность",
  medium: "средняя уверенность",
}

/** One pending proposal with its evidence and the four decisions (§5). */
export function ContactLinkProposalCard({
  proposal: p,
  showContactName = false,
  onDecided,
}: {
  proposal: ProposalView
  /** Company drawer: name the person in the heading. */
  showContactName?: boolean
  /** Called after a successful decision with the (kept) contact id. */
  onDecided: (contactId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [bothOpen, setBothOpen] = useState(false)
  const [bothRelation, setBothRelation] = useState<LinkRelation>("consultant")
  const [bothPrimary, setBothPrimary] = useState<string>(
    p.fromClientId ?? p.toClientId ?? "",
  )
  const [shownItem, setShownItem] = useState<{ id: string; title: string } | null>(
    null,
  )

  const fromName = p.fromClientName ?? "прежней компании"
  const toName = p.toClientName ?? p.toCompanyName ?? null

  async function decide(body: ProposalDecisionBody, okText?: string) {
    setBusy(true)
    try {
      const res = await postJson<{ ok: true; contactId: string }>(
        `/api/contact-link-proposals/${encodeURIComponent(p.id)}`,
        body,
      )
      toast.success(okText ?? DECISION_LABELS[body.decision])
      setBothOpen(false)
      onDecided(res.contactId ?? p.contactId)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const summary =
    p.kind === "left"
      ? `Похоже, больше не работает в ${fromName}`
      : p.kind === "second_company"
        ? `Работает с ${fromName}${toName ? ` и ${toName}` : ""}?`
        : `${fromName} → ${toName ?? "компания неизвестна"}`

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">
            Контакт сменил компанию?
            {showContactName && (
              <>
                {" "}
                <Link
                  href={`/contacts?openContact=${encodeURIComponent(p.contactId)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {p.contactName}
                </Link>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{summary}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {p.ruleLabel}
        </Badge>
        {CONFIDENCE_LABEL[p.confidence] && (
          <span>{CONFIDENCE_LABEL[p.confidence]}</span>
        )}
        {p.evidenceAt && <span>· {formatLinkDay(p.evidenceAt)}</span>}
      </div>

      {p.quote && (
        <blockquote className="border-l-2 pl-2 text-xs italic text-muted-foreground">
          «{p.quote}»
        </blockquote>
      )}
      {p.newAddress && (
        <div className="text-xs">
          <span className="text-muted-foreground">
            Новый адрес
            {p.newAddressKind ? ` (${ADDRESS_KIND_LABELS[p.newAddressKind]})` : ""}:
          </span>{" "}
          {p.newAddress}
        </div>
      )}
      {p.candidateContactId && p.candidateContactName && (
        <div className="text-xs">
          <span className="text-muted-foreground">Вторая запись этого человека:</span>{" "}
          <Link
            href={`/contacts?openContact=${encodeURIComponent(p.candidateContactId)}`}
            className="underline-offset-2 hover:underline"
          >
            {p.candidateContactName}
          </Link>{" "}
          <span className="text-muted-foreground">
            (при «Перешёл» записи объединятся)
          </span>
        </div>
      )}
      {p.evidenceItems.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {p.evidenceItems.map((it) => (
            <li key={it.id} className="flex items-center gap-1.5">
              <button
                type="button"
                className="truncate text-left underline-offset-2 hover:underline"
                onClick={() =>
                  setShownItem({ id: it.id, title: it.title || "Сообщение" })
                }
              >
                {it.title || "Сообщение"}
              </button>
              {it.date && (
                <span className="shrink-0 text-muted-foreground">
                  {formatLinkDay(it.date)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {p.toClientId ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void decide({ decision: "moved" })}
          >
            Перешёл в {p.toClientName ?? "новую компанию"}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void decide(
                  { decision: "moved" },
                  `Больше не работает в ${fromName}`,
                )
              }
            >
              Больше не работает в {fromName}
            </Button>
            {p.toCompanyName && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void decide(
                    { decision: "moved", createCompanyName: p.toCompanyName },
                    `Компания «${p.toCompanyName}» создана, контакт переведён`,
                  )
                }
              >
                Создать компанию {p.toCompanyName} и перевести
              </Button>
            )}
          </>
        )}
        {p.toClientId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBothRelation("consultant")
              setBothPrimary(p.fromClientId ?? p.toClientId ?? "")
              setBothOpen(true)
            }}
          >
            Работает с обеими
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void decide({ decision: "other_person" })}
        >
          Это другой человек
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void decide({ decision: "snooze" })}
        >
          Не сейчас
        </Button>
      </div>

      <Dialog open={bothOpen} onOpenChange={(o) => !busy && setBothOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Работает с обеими</DialogTitle>
            <DialogDescription>
              Обе компании останутся текущими. Укажите роль в{" "}
              {p.toClientName ?? "новой компании"} и основную компанию.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Роль в {p.toClientName ?? "новой компании"}</Label>
              <Select
                value={bothRelation}
                onValueChange={(v) => setBothRelation(v as LinkRelation)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_RELATIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {LINK_RELATION_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Основная компания</Label>
              <RadioGroup value={bothPrimary} onValueChange={setBothPrimary}>
                {p.fromClientId && (
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={p.fromClientId} />
                    {p.fromClientName ?? "Прежняя компания"}
                  </label>
                )}
                {p.toClientId && (
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={p.toClientId} />
                    {p.toClientName ?? "Новая компания"}
                  </label>
                )}
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setBothOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void decide({
                  decision: "both",
                  relation: bothRelation,
                  primaryClientId: bothPrimary || null,
                })
              }
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ParsedMarkdownDialog
        itemId={shownItem?.id ?? null}
        title={shownItem?.title ?? ""}
        open={Boolean(shownItem)}
        onOpenChange={(o) => {
          if (!o) setShownItem(null)
        }}
      />
    </div>
  )
}

/** The pending proposals stacked (nothing when empty). */
export function ContactLinkProposalsList({
  proposals,
  showContactName = false,
  onDecided,
}: {
  proposals: ProposalView[]
  showContactName?: boolean
  onDecided: (contactId: string) => void
}) {
  if (proposals.length === 0) return null
  return (
    <div className="space-y-2">
      {proposals.map((p) => (
        <ContactLinkProposalCard
          key={p.id}
          proposal={p}
          showContactName={showContactName}
          onDecided={onDecided}
        />
      ))}
    </div>
  )
}

// ── Block «Компании» of the contact drawer ─────────────────────────────────

export function ContactCompaniesBlock({
  contactId,
  onChanged,
}: {
  contactId: string
  /** After any change (link, address, proposal, merge) — the drawer refreshes. */
  onChanged?: () => void
}) {
  const [data, setData] = useState<ContactLinksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/links`)
      if (reqIdRef.current !== reqId) return
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const json = (await res.json()) as ContactLinksResponse
      if (reqIdRef.current !== reqId) return
      setData(json)
      setLoadError(false)
    } catch {
      if (reqIdRef.current === reqId) setLoadError(true)
    } finally {
      if (reqIdRef.current === reqId) setLoading(false)
    }
  }, [contactId])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (body: ContactLinkAction, okText?: string): Promise<boolean> => {
      try {
        const next = await postJson<ContactLinksResponse>(
          `/api/contacts/${encodeURIComponent(contactId)}/links`,
          body,
        )
        ++reqIdRef.current
        setData(next)
        setLoadError(false)
        if (okText) toast.success(okText)
        onChanged?.()
        return true
      } catch (err) {
        toast.error(errorText(err))
        return false
      }
    },
    [contactId, onChanged],
  )

  const afterExternalChange = useCallback(() => {
    void load()
    onChanged?.()
  }, [load, onChanged])

  // Dialog state.
  const [addOpen, setAddOpen] = useState(false)
  const [endLink, setEndLink] = useState<ContactLinkView | null>(null)
  const [editLink, setEditLink] = useState<ContactLinkView | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [replaceLink, setReplaceLink] = useState<ContactLinkView | null>(null)

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader className="h-4 w-4 animate-spin" />
        Загрузка компаний…
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        {loadError ? "Не удалось загрузить компании контакта." : null}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Повторить
        </Button>
      </div>
    )
  }

  const current = data.links.filter((l) => l.status === "current")
  const former = data.links.filter((l) => l.status === "former")
  const currentClientIds = current.map((l) => l.clientId)

  return (
    <div className="space-y-4 text-sm">
      <ContactLinkProposalsList
        proposals={data.proposals}
        onDecided={afterExternalChange}
      />

      {/* «Компании» */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Компании</h3>
          {data.movedFrom && (
            <Badge
              variant="outline"
              className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
            >
              Перешёл из {data.movedFrom.clientName}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setMergeOpen(true)}>
              <Merge className="mr-1 h-4 w-4" />
              Объединить с…
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Добавить компанию
            </Button>
          </div>
        </div>

        {current.length === 0 ? (
          <div className="text-muted-foreground">Нет текущей компании.</div>
        ) : (
          <div className="space-y-1.5">
            {current.map((l) => (
              <LinkRow
                key={l.id ?? `implicit:${l.clientId}`}
                link={l}
                onPrimary={() =>
                  void act(
                    { action: "primary", clientId: l.clientId },
                    `Основная компания: ${l.clientName}`,
                  )
                }
                onEnd={() => setEndLink(l)}
                onEdit={() => setEditLink(l)}
              />
            ))}
          </div>
        )}

        {former.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ранее
            </div>
            {former.map((l) => (
              <LinkRow
                key={l.id ?? `former:${l.clientId}`}
                link={l}
                onEdit={() => setEditLink(l)}
                onReplaceDeals={() => setReplaceLink(l)}
              />
            ))}
          </div>
        )}
      </section>

      <AddressesSection
        addresses={data.addresses}
        currentLinks={current}
        onAct={act}
      />

      <JournalSection events={data.events} />

      {addOpen && (
        <AddCompanyDialog
          open
          onOpenChange={setAddOpen}
          excludeIds={currentClientIds}
          hasCurrent={current.length > 0}
          onSubmit={(body) => act(body, "Компания добавлена")}
        />
      )}
      {endLink && (
        <EndLinkDialog
          key={endLink.id ?? endLink.clientId}
          link={endLink}
          onOpenChange={(o) => {
            if (!o) setEndLink(null)
          }}
          onSubmit={(body) => act(body, "Связь с компанией завершена")}
        />
      )}
      {editLink && (
        <EditLinkDialog
          key={editLink.id ?? editLink.clientId}
          link={editLink}
          onOpenChange={(o) => {
            if (!o) setEditLink(null)
          }}
          onSubmit={(body) => act(body, "Изменения сохранены")}
        />
      )}
      {replaceLink && (
        <ReplaceInDealsDialog
          key={replaceLink.id ?? replaceLink.clientId}
          link={replaceLink}
          contactId={contactId}
          onOpenChange={(o) => {
            if (!o) setReplaceLink(null)
          }}
          onSubmit={(body) => act(body, "Контакт в сделках заменён")}
        />
      )}
      <MergeContactDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        contactId={contactId}
        contactName={data.contactName}
        onMerged={afterExternalChange}
      />
    </div>
  )
}

function LinkRow({
  link: l,
  onPrimary,
  onEnd,
  onEdit,
  onReplaceDeals,
}: {
  link: ContactLinkView
  onPrimary?: () => void
  onEnd?: () => void
  onEdit?: () => void
  /** Former link with open deals (spec Q9): «Заменить в сделках». */
  onReplaceDeals?: () => void
}) {
  const openDeals = l.status === "former" ? (l.openDeals ?? []) : []
  const isCurrent = l.status === "current"
  // The implicit link (no row yet, Q12) is edited as `linkId: "implicit"`;
  // the server materialises it first.
  const canEdit = Boolean(onEdit)
  const hasMenu = (isCurrent && ((!l.isPrimary && onPrimary) || onEnd)) || canEdit
  const meta = [
    LINK_RELATION_LABELS[l.relation] ?? l.relation,
    l.position,
    isCurrent
      ? l.startedAt
        ? `с ${formatLinkDay(l.startedAt)}`
        : null
      : linkPeriodText(l.startedAt, l.endedAt) || null,
  ].filter(Boolean)
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-md border p-2.5",
        !isCurrent && "bg-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Link
            href={`/clients?openClient=${encodeURIComponent(l.clientId)}`}
            className="truncate font-medium underline-offset-2 hover:underline"
          >
            {l.clientName}
          </Link>
          {isCurrent && l.isPrimary && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              Основная
            </Badge>
          )}
        </div>
        {meta.length > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            {meta.join(" · ")}
          </div>
        )}
        {!isCurrent && l.endReason && (
          <div className="truncate text-xs text-muted-foreground">{l.endReason}</div>
        )}
        {openDeals.length > 0 && (
          <div className="mt-1 space-y-1 text-xs text-amber-700 dark:text-amber-400">
            <div>
              Ещё в открытых сделках: {openDeals.length}
              {" — "}
              {openDeals.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ", "}
                  <Link
                    href={`/deals?openDeal=${encodeURIComponent(d.id)}`}
                    className="underline underline-offset-2"
                  >
                    {d.name}
                  </Link>
                </span>
              ))}
            </div>
            {onReplaceDeals && (
              <Button size="xs" variant="outline" onClick={onReplaceDeals}>
                Заменить в сделках
              </Button>
            )}
          </div>
        )}
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Действия с компанией"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isCurrent && !l.isPrimary && onPrimary && (
              <DropdownMenuItem onSelect={onPrimary}>Сделать основной</DropdownMenuItem>
            )}
            {canEdit && <DropdownMenuItem onSelect={onEdit}>Изменить</DropdownMenuItem>}
            {isCurrent && onEnd && (
              <DropdownMenuItem onSelect={onEnd}>Больше не работает здесь</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// ── Link dialogs ───────────────────────────────────────────────────────────

function RelationSelect({
  value,
  onChange,
}: {
  value: LinkRelation
  onChange: (v: LinkRelation) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LinkRelation)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LINK_RELATIONS.map((r) => (
          <SelectItem key={r} value={r}>
            {LINK_RELATION_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddCompanyDialog({
  open,
  onOpenChange,
  excludeIds,
  hasCurrent,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  excludeIds: string[]
  hasCurrent: boolean
  onSubmit: (body: ContactLinkAction) => Promise<boolean>
}) {
  // Mounted only while open (see the block), so the initial state is the reset.
  const options = useClientOptions(open)
  const [clientId, setClientId] = useState("")
  const [relation, setRelation] = useState<LinkRelation>("employee")
  const [position, setPosition] = useState("")
  const [since, setSince] = useState(todayInputValue)
  const [primary, setPrimary] = useState(!hasCurrent)
  const [busy, setBusy] = useState(false)

  const choices = options.filter((o) => !excludeIds.includes(o.id))

  async function submit() {
    if (!clientId) {
      toast.error("Выберите компанию")
      return
    }
    setBusy(true)
    const ok = await onSubmit({
      action: "add",
      clientId,
      relation,
      position: position.trim() || null,
      startedAt: since || null,
      primary,
    })
    setBusy(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить компанию</DialogTitle>
          <DialogDescription>
            Ещё одна текущая компания контакта (например, работа по совместительству).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Компания</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите компанию" />
              </SelectTrigger>
              <SelectContent>
                {choices.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Нет компаний для выбора
                  </div>
                ) : (
                  choices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <RelationSelect value={relation} onChange={setRelation} />
          </div>
          <div className="space-y-1.5">
            <Label>Должность</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>С какой даты</Label>
            <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={primary} onCheckedChange={(v) => setPrimary(v === true)} />
            Сделать основной
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={busy || !clientId} onClick={() => void submit()}>
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EndLinkDialog({
  link,
  onOpenChange,
  onSubmit,
}: {
  link: ContactLinkView | null
  onOpenChange: (open: boolean) => void
  onSubmit: (body: ContactLinkAction) => Promise<boolean>
}) {
  // Mounted per link (keyed in the block), so the initial state is the reset.
  const [endedAt, setEndedAt] = useState(todayInputValue)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!link) return
    setBusy(true)
    const ok = await onSubmit({
      action: "end",
      clientId: link.clientId,
      endedAt: endedAt || null,
      endReason: reason.trim() || null,
    })
    setBusy(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(link)} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Больше не работает здесь</DialogTitle>
          <DialogDescription>
            {link?.clientName} перейдёт в «Ранее». История сохранится.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Дата окончания</Label>
            <Input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Причина</Label>
            <Input
              value={reason}
              placeholder="Больше не работает"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditLinkDialog({
  link,
  onOpenChange,
  onSubmit,
}: {
  link: ContactLinkView | null
  onOpenChange: (open: boolean) => void
  onSubmit: (body: ContactLinkAction) => Promise<boolean>
}) {
  // Mounted per link (keyed in the block), so the initial state is the reset.
  const [relation, setRelation] = useState<LinkRelation>(link?.relation ?? "employee")
  const [position, setPosition] = useState(link?.position ?? "")
  const [startedAt, setStartedAt] = useState(dayInputValue(link?.startedAt))
  const [endedAt, setEndedAt] = useState(dayInputValue(link?.endedAt))
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!link) return
    setBusy(true)
    const ok = await onSubmit({
      action: "edit",
      linkId: link.id ?? "implicit",
      relation,
      position: position.trim() || null,
      startedAt: startedAt || null,
      ...(link.status === "former" ? { endedAt: endedAt || null } : {}),
    })
    setBusy(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(link)} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Связь с {link?.clientName}</DialogTitle>
          <DialogDescription>Роль, должность и даты.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <RelationSelect value={relation} onChange={setRelation} />
          </div>
          <div className="space-y-1.5">
            <Label>Должность</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>С</Label>
              <Input
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </div>
            {link?.status === "former" && (
              <div className="space-y-1.5">
                <Label>По</Label>
                <Input
                  type="date"
                  value={endedAt}
                  onChange={(e) => setEndedAt(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── «Заменить в сделках» (spec Q9) ─────────────────────────────────────────

const NOBODY = "__nobody__"

function ReplaceInDealsDialog({
  link,
  contactId,
  onOpenChange,
  onSubmit,
}: {
  link: ContactLinkView
  contactId: string
  onOpenChange: (open: boolean) => void
  onSubmit: (body: ContactLinkAction) => Promise<boolean>
}) {
  // Mounted per link (keyed in the block), so the initial state is the reset.
  const [candidates, setCandidates] = useState<{ id: string; name: string }[] | null>(
    null,
  )
  const [replacement, setReplacement] = useState("")
  const [busy, setBusy] = useState(false)
  const deals = link.openDeals ?? []

  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${encodeURIComponent(link.clientId)}/contact-links`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ClientContactLinksResponse | null) => {
        if (cancelled) return
        setCandidates(
          (d?.current ?? [])
            .filter((e) => e.contactId !== contactId)
            .map((e) => ({ id: e.contactId, name: e.name })),
        )
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [link.clientId, contactId])

  async function submit() {
    if (!replacement) return
    setBusy(true)
    const ok = await onSubmit({
      action: "replaceInDeals",
      clientId: link.clientId,
      replacementContactId: replacement === NOBODY ? null : replacement,
    })
    setBusy(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Заменить в сделках {link.clientName}</DialogTitle>
          <DialogDescription>
            Контакт больше не работает в {link.clientName}, но остаётся в открытых
            сделках. Замена сохранит его роль в сделке.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ul className="space-y-1 text-sm">
            {deals.map((d) => (
              <li key={d.id} className="truncate">
                <Link
                  href={`/deals?openDeal=${encodeURIComponent(d.id)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {d.name}
                </Link>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <Label>Кем заменить</Label>
            <Select value={replacement} onValueChange={setReplacement}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={candidates === null ? "Загрузка…" : "Выберите контакт"}
                />
              </SelectTrigger>
              <SelectContent>
                {(candidates ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectItem value={NOBODY}>Никем — убрать из сделок</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={busy || !replacement} onClick={() => void submit()}>
            Заменить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── «Адреса» ───────────────────────────────────────────────────────────────

const NO_COMPANY = "__none__"

function AddressesSection({
  addresses,
  currentLinks,
  onAct,
}: {
  addresses: ContactAddressView[]
  currentLinks: ContactLinkView[]
  onAct: (body: ContactLinkAction, okText?: string) => Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<AddressKind>("email")
  const [value, setValue] = useState("")
  const [companyId, setCompanyId] = useState(NO_COMPANY)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!value.trim()) return
    setBusy(true)
    const ok = await onAct(
      {
        action: "addAddress",
        kind,
        value: value.trim(),
        clientId: companyId === NO_COMPANY ? null : companyId,
      },
      "Адрес добавлен",
    )
    setBusy(false)
    if (ok) {
      setValue("")
      setAdding(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Адреса</h3>
        {!adding && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setKind("email")
              setValue("")
              setCompanyId(currentLinks.find((l) => l.isPrimary)?.clientId ?? NO_COMPANY)
              setAdding(true)
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Добавить адрес
          </Button>
        )}
      </div>

      {addresses.length === 0 && !adding && (
        <div className="text-muted-foreground">Других адресов нет.</div>
      )}

      {addresses.length > 0 && (
        <div className="space-y-1">
          {addresses.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                a.status === "old" && "bg-muted/30",
              )}
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {ADDRESS_KIND_LABELS[a.kind] ?? a.kind}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  a.status === "old" && "text-muted-foreground line-through decoration-muted-foreground/40",
                )}
              >
                {a.kind === "telegram" ? telegramAddressLabel(a.value) : a.value}
              </span>
              {a.kind === "telegram" && a.telegramId && <TelegramIdBadge verified={!!a.verified} />}
              {a.status === "old" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  старый
                </Badge>
              )}
              {a.clientName && (
                <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline">
                  {a.clientName}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label="Действия с адресом"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      void onAct({
                        action: "addressStatus",
                        addressId: a.id,
                        status: a.status === "old" ? "active" : "old",
                      })
                    }
                  >
                    {a.status === "old" ? "Отметить действующим" : "Отметить старым"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      void onAct({ action: "removeAddress", addressId: a.id }, "Адрес удалён")
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-2 rounded-md border p-2.5">
          <div className="flex flex-wrap gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as AddressKind)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADDRESS_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {ADDRESS_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 min-w-[12rem] flex-1"
              value={value}
              placeholder={
                kind === "email" ? "name@company.ru" : kind === "phone" ? "+7 …" : "@handle"
              }
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void add()
                }
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger size="sm" className="w-fit max-w-full">
                <SelectValue placeholder="Компания адреса" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPANY}>Без компании</SelectItem>
                {currentLinks.map((l) => (
                  <SelectItem key={l.clientId} value={l.clientId}>
                    {l.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
                Отмена
              </Button>
              <Button size="sm" disabled={busy || !value.trim()} onClick={() => void add()}>
                Добавить
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// «id»: the Telegram address carries the numeric Telegram id
// (docs/specs/telegram/04 §6.1–§6.2).
function TelegramIdBadge({ verified }: { verified: boolean }) {
  const tip = useAnchorTooltip()
  const text = verified
    ? "Telegram id подтверждён — сообщения связываются, даже если человек сменит имя пользователя"
    : "Telegram id найден по сообщению"
  return (
    <>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0" aria-label={text} {...tip.bind}>
        id
      </Badge>
      <AnchorTooltip text={text} open={tip.open} virtualRef={tip.virtualRef} />
    </>
  )
}

// ── «История» ──────────────────────────────────────────────────────────────

function JournalSection({ events }: { events: ContactLinksResponse["events"] }) {
  const [open, setOpen] = useState(false)
  if (events.length === 0) return null
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-left font-medium"
        >
          <History className="h-4 w-4 text-muted-foreground" />
          История
          <span className="text-xs font-normal text-muted-foreground">{events.length}</span>
          <ChevronDown
            className={cn("ml-auto h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-xs">
              <span>{e.text}</span>
              <span className="text-muted-foreground">
                {" · "}
                {formatLinkDay(e.createdAt)}
                {e.userName ? ` · ${e.userName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ── «Объединить с…» ────────────────────────────────────────────────────────

type ContactSearchRow = {
  id: string
  name: string
  nameNative: string | null
  email: string | null
  clientName: string | null
}

function MergeContactDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  contactName: string
  onMerged: () => void
}) {
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<ContactSearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ContactSearchRow | null>(null)
  const [busy, setBusy] = useState(false)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setQ("")
    setRows([])
    setPicked(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (query.length < 2) {
      setRows([])
      return
    }
    const reqId = ++reqIdRef.current
    const t = setTimeout(() => {
      setSearching(true)
      fetch(`/api/contacts?q=${encodeURIComponent(query)}&limit=10`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rows?: ContactSearchRow[] } | null) => {
          if (reqIdRef.current !== reqId) return
          setRows((d?.rows ?? []).filter((r) => r.id !== contactId))
        })
        .catch(() => {})
        .finally(() => {
          if (reqIdRef.current === reqId) setSearching(false)
        })
    }, 250)
    return () => clearTimeout(t)
  }, [q, open, contactId])

  async function merge() {
    if (!picked) return
    setBusy(true)
    try {
      await postJson<{ ok: true }>("/api/contacts/merge", {
        keepId: contactId,
        mergeId: picked.id,
      })
      toast.success(`Записи объединены в «${contactName}»`)
      setPicked(null)
      onOpenChange(false)
      onMerged()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open && !picked} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Объединить с…</DialogTitle>
            <DialogDescription>
              Найдите вторую запись этого же человека. Её адреса, компании, сделки,
              задачи и документы перейдут в «{contactName}».
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              value={q}
              placeholder="Имя или email"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {searching && rows.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Поиск…
              </div>
            ) : q.trim().length >= 2 && rows.length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">Ничего не найдено.</div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => setPicked(r)}
                >
                  <div className="truncate font-medium">{r.nameNative || r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[r.email, r.clientName].filter(Boolean).join(" · ") || "—"}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={open && Boolean(picked)}
        onOpenChange={(o) => {
          if (!o && !busy) setPicked(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Объединить «{picked?.nameNative || picked?.name}» с «{contactName}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Записи объединятся в эту. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPicked(null)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void merge()}>
              Объединить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

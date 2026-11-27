"use client"

import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { AlertTriangle, Plus, Rows4, PlayingCardsFan } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import type { ContactRow, ClientOption } from "@/app/api/contacts/route"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ContactDetailDrawer } from "@/components/blocks/contact-detail-drawer"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { useDetailNavigation } from "@/components/blocks/detail-drawer-layout"
import { ContactCard } from "@/components/blocks/contact-card"
import { PageLoader } from "@/components/blocks/page-loader"
import { SortableTableHead } from "@/components/blocks/sortable-table-head"
import { FilterToolbar } from "@/components/blocks/filter-toolbar"
import { TelegramDuplicatesButton } from "@/components/blocks/telegram-duplicates-button"
import {
  CustomFieldFilterChips,
  CustomFieldFiltersButton,
  activeCustomFilters,
  listColumnFields,
  useCustomFieldDefs,
} from "@/components/blocks/custom-field-filters"
import { encodeCustomFilters, type CustomFieldFilter } from "@/lib/custom-fields"
import { LINK_RELATION_LABELS, type LinkRelation } from "@/lib/contact-links"
import { usePersistentTab } from "@/lib/use-persistent-tab"
import { contactDisplayName } from "@/lib/contact-names"

// «+N»: other CURRENT companies of a contact (docs/specs/clients-contacts/04
// §6); the primary one stays `clientId` / `clientName`.
function OtherCompaniesBadge({ items }: { items: ContactRow["otherCompanies"] }) {
  const tip = useAnchorTooltip()
  if (!items || items.length === 0) return null
  const text = items
    .map(
      (o) =>
        `${o.clientName} (${(LINK_RELATION_LABELS[o.relation as LinkRelation] ?? o.relation).toLowerCase()})`,
    )
    .join(", ")
  return (
    <>
      <Badge
        variant="outline"
        className="ml-1.5 px-1.5 py-0 text-[10px]"
        aria-label={`Также: ${text}`}
        {...tip.bind}
      >
        +{items.length}
      </Badge>
      <AnchorTooltip text={`Также: ${text}`} open={tip.open} virtualRef={tip.virtualRef} />
    </>
  )
}

type ContactView = "cards" | "table"
const CONTACT_VIEWS = ["cards", "table"] as const

const ALL = "__all__"
const NO_CLIENT = "__none__"
const PAGE_SIZE = 25

const STATUSES = ["active", "initial", "suspended", "deleted", "blocked"] as const
const STATUS_LABEL: Record<string, string> = {
  active: "Активный",
  initial: "Новый",
  suspended: "Приостановлен",
  deleted: "Удалён",
  blocked: "Заблокирован",
}

export default function ContactsPage() {
  const [rows, setRows] = useState<ContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState("name")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  function changeSort(key: string) {
    setSortKey(key)
    setSortDirection(sortKey === key && sortDirection === "asc" ? "desc" : "asc")
    setPage(1)
  }
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>(ALL)
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  // «Включая бывших»: the company filter also matches former links (Q11).
  const [includeFormer, setIncludeFormer] = useState(false)
  const companyFilterActive = clientFilter !== ALL && clientFilter !== NO_CLIENT
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  // Remembered per browser (no URL param).
  const [view, setView] = usePersistentTab<ContactView>("contacts.view", "table", {
    allowed: CONTACT_VIEWS,
    urlParam: false,
  })
  const cardsViewTip = useAnchorTooltip()
  const tableViewTip = useAnchorTooltip()
  // Custom contact fields (any member reads the definitions; «Настроить
  // поля» = org owner only). List columns + «Фильтр по полям» (server-side,
  // `?cf=`, AND with the other filters). Filters live in page state.
  const {
    fields: customFields,
  } = useCustomFieldDefs("contact")
  const listFields = useMemo(() => listColumnFields(customFields), [customFields])
  const [customFilters, setCustomFilters] = useState<CustomFieldFilter[]>([])
  // Only complete conditions of shown fields; the string keeps the list from
  // reloading on an incomplete edit.
  const cfParam = useMemo(
    () => encodeCustomFilters(activeCustomFilters(customFilters, customFields)),
    [customFilters, customFields],
  )
  const [canBlock, setCanBlock] = useState(false)
  // Отличаем «реально пусто» от «запрос не выполнился» (сеть/БД) — иначе
  // сбой рендерится как «контактов нет», что читается как потеря данных.
  const [loadError, setLoadError] = useState(false)

  const reqIdRef = useRef(0)
  const adjacentRequest = useRef<AbortController | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchContactPage = useCallback(async (targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((targetPage - 1) * PAGE_SIZE),
      sort: sortKey,
      direction: sortDirection,
    })
    if (statusFilter !== ALL) params.set("status", statusFilter)
    if (clientFilter !== ALL) params.set("clientId", clientFilter)
    if (includeFormer && companyFilterActive) params.set("includeFormer", "1")
    if (cfParam) params.set("cf", cfParam)
    const res = await fetch(`/api/contacts?${params.toString()}`, { signal })
    if (!res.ok) throw new Error("Не удалось загрузить контакты")
    return await res.json() as { rows?: ContactRow[]; total?: number }
  }, [statusFilter, clientFilter, includeFormer, companyFilterActive, cfParam, sortKey, sortDirection])

  const load = useCallback(async () => {
    setLoading(true)
    const reqId = ++reqIdRef.current
    try {
      const data = await fetchContactPage(page)
      if (reqIdRef.current !== reqId) return
      setLoadError(false)
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch {
      if (reqIdRef.current === reqId) setLoadError(true)
    } finally {
      if (reqIdRef.current === reqId) setLoading(false)
    }
  }, [page, fetchContactPage])

  useLayoutEffect(() => () => {
    adjacentRequest.current?.abort()
    adjacentRequest.current = null
  }, [page, fetchContactPage, editingContact?.id])

  async function openAdjacentPage(direction: -1 | 1, request: (run: () => void) => void) {
    if (adjacentRequest.current) return
    const controller = new AbortController()
    adjacentRequest.current = controller
    const targetPage = page + direction
    try {
      const data = await fetchContactPage(targetPage, controller.signal)
      if (controller.signal.aborted) return
      const targetRows = data.rows ?? []
      const contact = direction === -1 ? targetRows.at(-1) : targetRows[0]
      if (!contact) {
        setTotal(data.total ?? 0)
        return
      }
      request(() => {
        setPage(targetPage)
        setRows(targetRows)
        setTotal(data.total ?? 0)
        setEditingContact(contact)
      })
    } catch {
      if (!controller.signal.aborted) toast.error("Не удалось загрузить соседнюю страницу")
    } finally {
      if (adjacentRequest.current === controller) adjacentRequest.current = null
    }
  }

  const contactNavigation = useDetailNavigation(editingContact?.id ?? null, loading ? [] : rows.map((row) => row.id), (id) => {
    const contact = rows.find((row) => row.id === id)
    if (contact) setEditingContact(contact)
  }, {
    previous: page > 1 ? (request) => void openAdjacentPage(-1, request) : undefined,
    next: page < totalPages ? (request) => void openAdjacentPage(1, request) : undefined,
  })

  useEffect(() => {
    void load()
  }, [load])

  // Filter changes reset to page 1.
  useEffect(() => {
    setPage(1)
  }, [statusFilter, clientFilter, includeFormer, cfParam])

  useEffect(() => {
    fetch("/api/contacts?clientOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setClientOptions(d.options ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/blocklist")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setCanBlock(Boolean(d.canManage))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Open one contact by id in the drawer (deep link, «Дубли Telegram»).
  const openContactById = useCallback(async (contactId: string) => {
    const res = await fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`)
    if (!res.ok) return
    const data = await res.json()
    if (data.contact) setEditingContact(data.contact)
  }, [])

  // Deep-link from the global search (/contacts?openContact=<id>).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const contactId = params.get("openContact")
    if (!contactId) return
    window.history.replaceState(null, "", window.location.pathname)
    void openContactById(contactId)
  }, [openContactById])

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)] p-4 gap-4">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <h1 className="text-xl font-medium">Контакты</h1>
        <PageHeaderActions />
      </div>

      {/* «Новый контакт» — слева; селекты статуса/компании следом;
          переключатель вида — прижат вправо. Белый контейнер — как на
          Компаниях/Сделках/Домашней. */}
      <FilterToolbar active={statusFilter !== ALL || clientFilter !== ALL || !!cfParam} actions={<>
        <ContactEditDialog
          mode="create"
          onSuccess={load}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Новый контакт
            </Button>
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <TelegramDuplicatesButton
            onMerged={() => void load()}
            onOpenContact={(id) => void openContactById(id)}
          />
          <Tabs value={view} onValueChange={(v) => setView(v as ContactView)}>
            <TabsList>
              <TabsTrigger value="cards" aria-label="Вид карточками" {...cardsViewTip.bind}>
                <PlayingCardsFan className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="table" aria-label="Вид таблицей" {...tableViewTip.bind}>
                <Rows4 className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <AnchorTooltip text="в виде карточек" open={cardsViewTip.open} virtualRef={cardsViewTip.virtualRef} />
          <AnchorTooltip text="списком" open={tableViewTip.open} virtualRef={tableViewTip.virtualRef} />
        </div>
      </>}>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-fit">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchableSelect
          size="sm"
          label="Компания"
          searchLabel="Поиск компании"
          className="max-w-72"
          options={[{ id: ALL, name: "Все компании" }, { id: NO_CLIENT, name: "Без компании" }, ...clientOptions]}
          value={clientFilter}
          onValueChange={setClientFilter}
        />
        {companyFilterActive && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              size="sm"
              checked={includeFormer}
              onCheckedChange={setIncludeFormer}
            />
            Включая бывших
          </label>
        )}
          <CustomFieldFiltersButton
            fields={customFields}
            value={customFilters}
            onChange={setCustomFilters}
          />
      </FilterToolbar>

      {customFilters.length > 0 && (
        <div className="shrink-0">
          <CustomFieldFilterChips
            fields={customFields}
            value={customFilters}
            onChange={setCustomFilters}
          />
        </div>
      )}

      <div className="text-xs text-muted-foreground shrink-0">
        {rows.length} из {total} контактов
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
        {loading && rows.length === 0 ? (
          <PageLoader />
        ) : loadError && rows.length === 0 ? (
          <Card className="border-dashed border-destructive/40 bg-destructive/5">
            <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <span className="text-sm text-muted-foreground">
                Не удалось загрузить контакты. Проверьте соединение и попробуйте ещё раз.
              </span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Повторить
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Контакты не найдены.
            </CardContent>
          </Card>
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {rows.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                onOpenDetail={() => contactNavigation.select(c.id)}
                listFields={listFields}
              />
            ))}
          </div>
        ) : (
          <Card className="py-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead label="Имя" direction={sortKey === "name" ? sortDirection : undefined} onSort={() => changeSort("name")} />
                    <SortableTableHead label="Email" direction={sortKey === "email" ? sortDirection : undefined} onSort={() => changeSort("email")} />
                    <SortableTableHead label="Телефон" direction={sortKey === "phone" ? sortDirection : undefined} onSort={() => changeSort("phone")} />
                    <SortableTableHead label="Компания" direction={sortKey === "company" ? sortDirection : undefined} onSort={() => changeSort("company")} />
                    <SortableTableHead label="Должность" direction={sortKey === "position" ? sortDirection : undefined} onSort={() => changeSort("position")} />
                    <SortableTableHead label="Ведётся" direction={sortKey === "managed" ? sortDirection : undefined} onSort={() => changeSort("managed")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => contactNavigation.select(c.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{contactDisplayName(c)}</div>
                      </TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>{c.phone ?? "—"}</TableCell>
                      <TableCell>
                        {c.clientName ?? "Без компании"}
                        <OtherCompaniesBadge items={c.otherCompanies} />
                      </TableCell>
                      <TableCell>{c.position ?? "—"}</TableCell>
                      <TableCell>{c.managedAt?.name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination className="shrink-0">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(e) => {
                  e.preventDefault()
                  if (page > 1) setPage(page - 1)
                }}
                aria-disabled={page === 1}
                className={
                  page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                }
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === page}
                  onClick={(e) => {
                    e.preventDefault()
                    setPage(p)
                  }}
                  className="cursor-pointer"
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={(e) => {
                  e.preventDefault()
                  if (page < totalPages) setPage(page + 1)
                }}
                aria-disabled={page === totalPages}
                className={
                  page === totalPages
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <ContactDetailDrawer
        contact={editingContact}
        open={Boolean(editingContact)}
        navigation={contactNavigation.navigation}
        onOpenChange={(open) => {
          if (!open) setEditingContact(null)
        }}
        onChanged={load}
        canBlock={canBlock}
      />
    </div>
  )
}

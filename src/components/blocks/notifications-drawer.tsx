"use client"

import { DetailDrawerContent } from "@/components/blocks/detail-drawer-layout"
// The bell «Уведомления» in the page header (docs/specs/notifications §7,
// decisions Q10 / Q11). Data: GET / POST /api/notifications.
// - Badge = unread count (9+): RED when an important one is unread, GREY
//   when only info ones are unread.
// - Toasts only for NEW important notifications since the previous poll
//   (the first poll after mount is the backlog, never toasted).
// - Per-item read state: opening the sheet does NOT mark anything read; a
//   click on a row, «Отметить прочитанным» or «Прочитать все» does.

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Activity,
  Bell,
  Building2,
  Check,
  CheckCheck,
  CreditCard,
  EyeOff,
  Handshake,
  ListTodo,
  Loader,
  MoreHorizontal,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { groupByDate } from "@/lib/date-groups"
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationAction,
  type NotificationCategory,
  type NotificationView,
  type NotificationsResponse,
} from "@/lib/notifications/kinds"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"

const CATEGORY_ICON: Record<NotificationCategory, typeof Bell> = {
  tasks: ListTodo,
  sales: Handshake,
  clients: Building2,
  ai: Sparkles,
  processes: Activity,
  organization: Users,
  billing: CreditCard,
  platform: ShieldAlert,
}

const POLL_MS = 45_000
// Cap individual toasts per poll tick so a burst reads as one extra line
// instead of flooding the corner of the screen.
const MAX_TOASTS_PER_TICK = 3
const LIST_LIMIT = 100
const ALL_CATEGORIES = "__all__"

type FilterTab = "all" | "important"

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} ч назад`
  const days = Math.floor(hrs / 24)
  return `${days} дн назад`
}

/** Counts the badge reacts to (unread = not read and not resolved, as on the server). */
const isUnread = (n: NotificationView) => !n.read && !n.resolved

function postAction(body: NotificationAction): Promise<boolean> {
  return fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => r.ok)
    .catch(() => false)
}

export function NotificationsDrawer() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [category, setCategory] = useState<string>(ALL_CATEGORIES)
  const [items, setItems] = useState<NotificationView[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadImportant, setUnreadImportant] = useState(0)
  // Important ids already seen in a previous poll — tells "new since the
  // last tick" (toast-worthy) apart from the backlog. null = no poll yet.
  const knownImportantRef = useRef<Set<string> | null>(null)
  // Drops a list response that belongs to an older filter / category.
  const listReqRef = useRef(0)

  const applyCounts = (d: NotificationsResponse) => {
    setUnreadCount(d.unreadCount)
    setUnreadImportant(d.unreadImportant)
  }

  const openTarget = useCallback(
    (n: NotificationView) => {
      // Toasts are only for unread important items.
      setUnreadCount((c) => Math.max(0, c - 1))
      setUnreadImportant((c) => Math.max(0, c - 1))
      setItems((all) => all.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      void postAction({ action: "read", ids: [n.id] })
      if (n.href) router.push(n.href)
    },
    [router],
  )

  // Background poll: important items (for the toasts) + the counts.
  const pollImportant = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?filter=important&limit=50")
      if (!res.ok) return
      const data: NotificationsResponse = await res.json()
      applyCounts(data)
      const known = knownImportantRef.current
      if (known) {
        const fresh = data.items.filter((n) => !known.has(n.id) && isUnread(n))
        fresh.slice(0, MAX_TOASTS_PER_TICK).forEach((n) => {
          toast(n.title, {
            description: n.body ?? undefined,
            action: n.href ? { label: "Открыть", onClick: () => openTarget(n) } : undefined,
          })
        })
        if (fresh.length > MAX_TOASTS_PER_TICK) {
          toast(`Ещё ${fresh.length - MAX_TOASTS_PER_TICK} важных`)
        }
      }
      const next = new Set(known ?? [])
      for (const n of data.items) next.add(n.id)
      knownImportantRef.current = next
    } catch {
      // Silent — the bell is informational, not worth a toast of its own.
    }
  }, [openTarget])

  // The list in the sheet for the current tab + category.
  const loadList = useCallback(async (opts: { quiet?: boolean } = {}) => {
    const req = ++listReqRef.current
    if (!opts.quiet) setListLoading(true)
    try {
      const sp = new URLSearchParams({ filter, limit: String(LIST_LIMIT) })
      if (category !== ALL_CATEGORIES) sp.set("category", category)
      const res = await fetch(`/api/notifications?${sp}`)
      if (!res.ok) return
      const data: NotificationsResponse = await res.json()
      if (req !== listReqRef.current) return
      setItems(data.items)
      applyCounts(data)
    } catch {
      // keep the previous list
    } finally {
      if (req === listReqRef.current) setListLoading(false)
    }
  }, [filter, category])

  useEffect(() => {
    void pollImportant()
    const t = setInterval(() => void pollImportant(), POLL_MS)
    return () => clearInterval(t)
  }, [pollImportant])

  // While the sheet is open: load on open / filter change, refresh on the
  // same 45 s rhythm.
  useEffect(() => {
    if (!open) return
    void loadList()
    const t = setInterval(() => void loadList({ quiet: true }), POLL_MS)
    return () => clearInterval(t)
  }, [open, loadList])

  const bellTip = useAnchorTooltip()

  // ── actions (optimistic) ────────────────────────────────────────────────

  const dropFromCounts = (gone: NotificationView[]) => {
    const unread = gone.filter(isUnread)
    if (unread.length === 0) return
    setUnreadCount((c) => Math.max(0, c - unread.length))
    setUnreadImportant((c) => Math.max(0, c - unread.filter((n) => n.priority === "important").length))
  }

  const markRead = (n: NotificationView) => {
    if (n.read) return
    dropFromCounts([n])
    setItems((all) => all.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    void postAction({ action: "read", ids: [n.id] }).then((ok) => {
      if (!ok) void loadList({ quiet: true })
    })
  }

  const dismiss = (n: NotificationView) => {
    dropFromCounts([n])
    setItems((all) => all.filter((x) => x.id !== n.id))
    void postAction({ action: "dismiss", ids: [n.id] }).then((ok) => {
      if (!ok) {
        toast.error("Не удалось скрыть уведомление")
        void loadList({ quiet: true })
      }
    })
  }

  const readAll = () => {
    setUnreadCount(0)
    setUnreadImportant(0)
    setItems((all) => all.map((x) => ({ ...x, read: true })))
    void postAction({ action: "readAll" }).then((ok) => {
      if (!ok) {
        toast.error("Не удалось отметить уведомления прочитанными")
        void loadList({ quiet: true })
      }
    })
  }

  const openRow = (n: NotificationView) => {
    markRead(n)
    if (n.href) {
      setOpen(false)
      router.push(n.href)
    }
  }

  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount)
  const badgeLabel =
    unreadImportant > 0
      ? `${unreadCount} непрочитанных, из них важных: ${unreadImportant}`
      : `${unreadCount} непрочитанных`

  // Подсказка — тот же AnchorTooltip, что у переключателя темы и вида
  // «карточки/список», а не системный title: подсказки в продукте одинаковые.
  return (
    <>
      <AnchorTooltip
        text="уведомления"
        open={bellTip.open && !open}
        virtualRef={bellTip.virtualRef}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          {/* Колокольчик в шапке страницы, правее глобального поиска.
              Ghost-иконка той же высоты, что «ИИ чат» и поиск. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={unreadCount > 0 ? `Уведомления: ${badgeLabel}` : "Уведомления"}
            className="relative cursor-pointer"
            {...bellTip.bind}
            onClick={(e) => {
              e.currentTarget.blur()
            }}
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold leading-none",
                  unreadImportant > 0
                    ? "bg-[#C1121F] text-white"
                    : "bg-muted-foreground text-background",
                )}
              >
                {badgeText}
              </span>
            )}
          </Button>
        </SheetTrigger>
        {/* Правая шторка — тот же язык, что «Лента решений» и дроверы
            сделки/компании: шапка с чертой, ниже скролл с дата-группами. */}
        <DetailDrawerContent defaultWidth="448px">
          <SheetHeader className="p-4 pb-3 border-b gap-3">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0 space-y-1">
                <SheetTitle>Уведомления</SheetTitle>
                <SheetDescription>
                  {unreadCount > 0 ? `Непрочитанных: ${unreadCount}` : "Все уведомления прочитаны"}
                </SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 cursor-pointer"
                disabled={unreadCount === 0}
                onClick={readAll}
              >
                <CheckCheck className="size-4" />
                Прочитать все
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={filter} onValueChange={(v) => setFilter(v === "important" ? "important" : "all")}>
                <TabsList>
                  <TabsTrigger value="all">Все</TabsTrigger>
                  <TabsTrigger value="important">
                    Важные
                    {unreadImportant > 0 && (
                      <span className="ml-1 rounded-full bg-[#C1121F] px-1.5 text-[10px] font-semibold leading-4 text-white">
                        {unreadImportant > 9 ? "9+" : unreadImportant}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger size="sm" className="min-w-44" aria-label="Категория уведомлений">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>Все категории</SelectItem>
                  {NOTIFICATION_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {NOTIFICATION_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {listLoading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Нет уведомлений</p>
            ) : (
              groupByDate(items, (n) => n.createdAt).map((group) => (
                <div key={group.label} className="space-y-2">
                  <div className="sticky top-0 z-10 -mt-1 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {group.label}
                  </div>
                  <ul className="space-y-2">
                    {group.items.map((n) => (
                      <NotificationRow
                        key={n.id}
                        n={n}
                        onOpen={() => openRow(n)}
                        onRead={() => markRead(n)}
                        onDismiss={() => dismiss(n)}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </DetailDrawerContent>
      </Sheet>
    </>
  )
}

function NotificationRow({
  n,
  onOpen,
  onRead,
  onDismiss,
}: {
  n: NotificationView
  onOpen: () => void
  onRead: () => void
  onDismiss: () => void
}) {
  const Icon = CATEGORY_ICON[n.category] ?? Bell
  const unread = isUnread(n)
  const important = n.priority === "important"
  return (
    <li
      className={cn(
        "group relative flex items-start gap-1 rounded-lg border p-1 text-sm transition-colors",
        unread ? "bg-muted/50" : "bg-muted/20",
        "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md p-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`${important ? "Важное: " : ""}${n.title}${unread ? " (не прочитано)" : ""}${n.resolved ? " (уже не актуально)" : ""}`}
      >
        <span className="relative mt-0.5 shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {important && (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 size-2 rounded-full bg-[#C1121F] ring-2 ring-background"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate",
              unread ? "font-semibold" : "font-normal",
              n.resolved && "text-muted-foreground line-through",
            )}
          >
            {n.title}
          </span>
          {n.body && (
            <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
          )}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{timeAgo(n.createdAt)}</span>
            {n.resolved && <span className="italic">уже не актуально</span>}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground"
            aria-label={`Действия с уведомлением «${n.title}»`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!n.read && (
            <DropdownMenuItem onSelect={onRead}>
              <Check className="size-4" />
              Отметить прочитанным
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onDismiss}>
            <EyeOff className="size-4" />
            Скрыть
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

// Notifications (docs/specs/notifications). PURE, client-safe: categories,
// priorities, the kind registry (category, default priority, recipients,
// lifetime) and the API view types. A new producer = one line here + one
// `notify()` call in src/server/notifications/.

export const NOTIFICATION_CATEGORIES = [
  "tasks",
  "sales",
  "clients",
  "ai",
  "processes",
  "organization",
  "billing",
  "platform",
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  tasks: "Задачи",
  sales: "Сделки и темы",
  clients: "Компании и контакты",
  ai: "ИИ и лимиты",
  processes: "Процессы и источники",
  organization: "Организация",
  billing: "Оплата",
  platform: "Платформа",
}

export type NotificationPriority = "important" | "info"

export const NOTIFICATION_PRIORITY_LABELS: Record<NotificationPriority, string> = {
  important: "Важное",
  info: "Информация",
}

/** Hidden after this many days (Q11: info 3, important 5). */
export const NOTIFICATION_LIFETIME_DAYS: Record<NotificationPriority, number> = { info: 3, important: 5 }
/** Rows are deleted this many days after they expired. */
export const NOTIFICATION_PURGE_AFTER_DAYS = 30

/**
 * Who receives a kind (resolved at write time; human members only):
 * `user` = the user ids the producer passes; `owners` = org owners (Q3: AI
 * usage, billing, company profile, process stats / errors); `platform_admins`
 * = users with the platform role admin (org-less rows).
 */
export type RecipientRule = "user" | "owners" | "platform_admins"

export type NotificationKindDef = {
  category: NotificationCategory
  priority: NotificationPriority
  recipients: RecipientRule
  labelRu: string
}

export const NOTIFICATION_KINDS = {
  // ИИ и лимиты (owners)
  "ai.limit.month.70": { category: "ai", priority: "info", recipients: "owners", labelRu: "Лимит ИИ: 70 %" },
  "ai.limit.month.90": { category: "ai", priority: "important", recipients: "owners", labelRu: "Лимит ИИ: 90 %" },
  "ai.limit.month.100": { category: "ai", priority: "important", recipients: "owners", labelRu: "Лимит ИИ исчерпан" },
  "ai.budget.day": { category: "ai", priority: "important", recipients: "owners", labelRu: "Дневной бюджет ИИ исчерпан" },
  // Организация (owners)
  "profile.org.incomplete": { category: "organization", priority: "info", recipients: "owners", labelRu: "Профиль организации не заполнен" },
  "member.joined": { category: "organization", priority: "info", recipients: "owners", labelRu: "Новый участник" },
  // Компании и контакты
  "profile.client.proposals": { category: "clients", priority: "info", recipients: "owners", labelRu: "Предложения для профилей компаний" },
  "client.handover": { category: "clients", priority: "important", recipients: "user", labelRu: "Компания передана вам" },
  "contact.link_proposal": { category: "clients", priority: "info", recipients: "user", labelRu: "Контакт сменил компанию?" },
  "discovery.new_records": { category: "clients", priority: "info", recipients: "user", labelRu: "Найдены новые компании и контакты" },
  // Задачи (the assignee / creator)
  "task.due_tomorrow": { category: "tasks", priority: "info", recipients: "user", labelRu: "Срок задачи завтра" },
  "task.due_today": { category: "tasks", priority: "important", recipients: "user", labelRu: "Срок задачи сегодня" },
  "task.overdue": { category: "tasks", priority: "important", recipients: "user", labelRu: "Задача просрочена" },
  "task.assigned": { category: "tasks", priority: "info", recipients: "user", labelRu: "Вам назначена задача" },
  // Сделки и темы (the owner / assignee)
  "deal.risk_new": { category: "sales", priority: "info", recipients: "user", labelRu: "Новый риск по сделке" },
  "topic.now": { category: "sales", priority: "info", recipients: "user", labelRu: "Тема требует внимания" },
  "order.confirmed_by_client": { category: "sales", priority: "important", recipients: "user", labelRu: "Клиент подтвердил заказ" },
  // Процессы и источники (owners)
  "source.sync_failing": { category: "processes", priority: "important", recipients: "owners", labelRu: "Источник не синхронизируется" },
  "process.run_failed": { category: "processes", priority: "important", recipients: "owners", labelRu: "Ошибка обработки" },
  "process.daily_stats": { category: "processes", priority: "info", recipients: "owners", labelRu: "Итоги обработки за день" },
  // Платформа (platform admins)
  "platform.catalog_sync_failed": { category: "platform", priority: "important", recipients: "platform_admins", labelRu: "Ошибка синхронизации моделей" },
  "platform.run_failed": { category: "platform", priority: "important", recipients: "platform_admins", labelRu: "Ошибка фонового запуска" },
} as const satisfies Record<string, NotificationKindDef>

export type NotificationKind = keyof typeof NOTIFICATION_KINDS

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === "string" && v in NOTIFICATION_KINDS
}
export function isNotificationCategory(v: unknown): v is NotificationCategory {
  return typeof v === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(v)
}

/**
 * Q8: categories a user may switch off. Important notifications of `tasks`,
 * `ai` and `processes` always arrive; `platform` is for platform admins and
 * stays on.
 */
export const ALWAYS_ON_IMPORTANT: readonly NotificationCategory[] = ["tasks", "ai", "processes"]
export const MUTABLE_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.filter((c) => c !== "platform")

/** PURE. Is a notification delivered for this user's category settings? */
export function isDelivered(
  category: NotificationCategory,
  priority: NotificationPriority,
  prefs: Record<string, boolean> | null | undefined,
): boolean {
  if (!prefs || prefs[category] !== false) return true
  return priority === "important" && ALWAYS_ON_IMPORTANT.includes(category)
}

/** PURE. Expiry of a notification created at `at`. */
export function notificationExpiry(priority: NotificationPriority, at: Date): Date {
  return new Date(at.getTime() + NOTIFICATION_LIFETIME_DAYS[priority] * 86_400_000)
}

// ── API view (GET /api/notifications) ──────────────────────────────────────

export type NotificationView = {
  id: string
  kind: string
  category: NotificationCategory
  priority: NotificationPriority
  title: string
  body: string | null
  href: string | null
  createdAt: string
  read: boolean
  resolved: boolean
}

export type NotificationsResponse = {
  items: NotificationView[]
  unreadCount: number
  unreadImportant: number
}

/** POST /api/notifications body. */
export type NotificationAction =
  | { action: "read"; ids: string[] }
  | { action: "readAll" }
  | { action: "dismiss"; ids: string[] }

/** GET / PUT /api/account/notification-prefs. */
export type NotificationPrefsView = {
  categories: { category: NotificationCategory; label: string; enabled: boolean; importantAlwaysOn: boolean }[]
}

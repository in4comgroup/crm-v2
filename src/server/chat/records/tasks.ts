import "server-only"

import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, contact, deal, task, taskPriority, taskStatus, taskType, type TaskStatus } from "@/db/schema"
import {
  recordHref,
  type RecordDetail,
  type RecordDetailSection,
  type RecordFact,
  type RecordHit,
} from "@/lib/chat/records"
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/lib/task-labels"
import { matchesQuery, norm, relevanceOf, type TextQuery } from "@/server/search/normalise"
import { allFacts, facts, formatDate, isoOrNull } from "./format"
import {
  capTotal,
  dateRange,
  loadOrgMembers,
  parseDay,
  personLabel,
  resolvePersonFilter,
  totalOver,
  type OrgMember,
} from "./shared"
import { inIds, matchedLabel, resolveCompanyFilter, resolveDealFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"
import { contactDisplaySql } from "@/server/contact-display"

// «Задача» (task) — records engine module (spec §6.1).
// Visible: every task of the org. Labels = src/lib/task-labels.ts (the same
// words as the tasks page). Open = todo / in_progress; done / closed are final.

const OPEN_STATUSES = ["todo", "in_progress"] as const satisfies readonly TaskStatus[]

function isOverdue(status: string, due: Date | string | null, now: Date): boolean {
  if (!due || !(OPEN_STATUSES as readonly string[]).includes(status)) return false
  const d = due instanceof Date ? due : new Date(due)
  return d.getTime() < now.getTime()
}

export const taskFilterSchema = z
  .object({
    status: z
      .enum(["open", ...taskStatus.enumValues])
      .optional()
      .describe("open = todo or in_progress; todo / in_progress / done / closed = that status"),
    assignee: z.string().min(1).optional().describe('Assignee (Исполнитель): "me" = the signed-in user, or a member name'),
    creator: z.string().min(1).optional().describe('Creator (Автор): "me" = the signed-in user, or a member name'),
    dueFrom: z.string().optional().describe("Due on / after this day, YYYY-MM-DD"),
    dueTo: z.string().optional().describe("Due on / before this day, YYYY-MM-DD"),
    overdue: z.boolean().optional().describe("true = open tasks past their due time; false = not overdue"),
    company: z.string().min(1).optional().describe("Company: its id or (part of) its name"),
    deal: z.string().min(1).optional().describe("Deal: its id or (part of) its name"),
    type: z.enum(taskType.enumValues).optional(),
    priority: z.enum(taskPriority.enumValues).optional(),
  })
  .strict()
export type TaskFilters = z.infer<typeof taskFilterSchema>

const SORT_KEYS = ["due", "updated", "created"] as const

/** Chip text of a filter day as the user typed it («2026-12-31» → «31.12.2026»), never shifted by time zones. */
function dayChip(raw: string | undefined, tz: string): string {
  if (!raw) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : formatDate(raw, tz)
}

const cols = {
  id: task.id,
  organizationId: task.organizationId,
  name: task.name,
  status: task.status,
  priority: task.priority,
  type: task.type,
  dueDate: task.dueDate,
  assigneeId: task.assigneeId,
  userId: task.userId,
  clientId: task.clientId,
  dealId: task.dealId,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  companyName: client.name,
  dealName: deal.name,
}
type TaskRowLite = {
  id: string
  organizationId: string | null
  name: string
  status: TaskStatus
  dueDate: Date
  assigneeId: string
  companyName: string | null
  dealName: string | null
}

function subtitleOf(r: Pick<TaskRowLite, "companyName" | "dealName">): string | null {
  return [r.companyName, r.dealName].filter(Boolean).join(" · ") || null
}

function toHit(ctx: RecordsContext, r: TaskRowLite, members: Map<string, OrgMember>): RecordHit {
  return {
    type: "task",
    id: r.id,
    title: r.name,
    subtitle: subtitleOf(r),
    facts: facts([
      { label: "Срок", value: formatDate(r.dueDate, ctx.timeZone) },
      { label: "Исполнитель", value: personLabel(ctx, members, r.assigneeId) },
      { label: "Статус", value: TASK_STATUS_LABELS[r.status] ?? r.status },
    ]),
    badge: isOverdue(r.status, r.dueDate, ctx.now) ? { label: "Просрочена", tone: "bad" } : null,
    date: isoOrNull(r.dueDate),
    href: recordHref("task", r.id),
  }
}

function baseQuery(ctx: RecordsContext) {
  return db
    .select({ ...cols, total: totalOver })
    .from(task)
    .leftJoin(client, and(eq(task.clientId, client.id), eq(client.organizationId, ctx.orgId)))
    .leftJoin(deal, and(eq(task.dealId, deal.id), eq(deal.organizationId, ctx.orgId)))
}

async function mapRows(ctx: RecordsContext, rows: (TaskRowLite & { total: number })[]) {
  const own = keepOwnOrg(ctx, "task", rows)
  const members = await loadOrgMembers(ctx.orgId)
  return own.map((r) => toHit(ctx, r, members))
}

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  const fields = [norm(task.name), norm(client.name), norm(deal.name)]
  const rows = await baseQuery(ctx)
    .where(
      and(
        eq(task.organizationId, ctx.orgId),
        dateRange(task.dueDate, opts),
        or(...fields.map((f) => matchesQuery(tq, f)), matchesQuery(tq, norm(task.description))),
      ),
    )
    .orderBy(desc(relevanceOf(tq, fields)), desc(task.updatedAt))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

/** A person filter → condition + chip. */
function personFilter(
  ctx: RecordsContext,
  members: Map<string, OrgMember>,
  col: typeof task.assigneeId | typeof task.userId,
  value: string,
  label: string,
): { where: SQL; chip: { label: string; value: string } } {
  const ids = resolvePersonFilter(ctx, members, value)
  return {
    where: ids.length ? inArray(col, ids) : sql`false`,
    chip: {
      label,
      value: ids.length ? ids.map((id) => personLabel(ctx, members, id)).join(", ") : `${value} (не найден)`,
    },
  }
}


async function list(ctx: RecordsContext, filters: TaskFilters, sort: string, limit: number) {
  const members = await loadOrgMembers(ctx.orgId)
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [eq(task.organizationId, ctx.orgId)]

  if (filters.status) {
    if (filters.status === "open") {
      where.push(inArray(task.status, [...OPEN_STATUSES]))
      applied.push({ label: "Статус", value: "открыта" })
    } else {
      where.push(eq(task.status, filters.status))
      applied.push({ label: "Статус", value: TASK_STATUS_LABELS[filters.status] })
    }
  }
  if (filters.overdue !== undefined) {
    const overdue = and(inArray(task.status, [...OPEN_STATUSES]), lt(task.dueDate, ctx.now))!
    where.push(filters.overdue ? overdue : sql`not ${overdue}`)
    applied.push({ label: "Просрочена", value: filters.overdue ? "да" : "нет" })
  }
  if (filters.assignee) {
    const f = personFilter(ctx, members, task.assigneeId, filters.assignee, "Исполнитель")
    where.push(f.where)
    applied.push(f.chip)
  }
  if (filters.creator) {
    const f = personFilter(ctx, members, task.userId, filters.creator, "Автор")
    where.push(f.where)
    applied.push(f.chip)
  }
  const from = parseDay(filters.dueFrom, false, ctx.timeZone)
  const to = parseDay(filters.dueTo, true, ctx.timeZone)
  if (from) where.push(sql`${task.dueDate} >= ${from.toISOString()}`)
  if (to) where.push(sql`${task.dueDate} <= ${to.toISOString()}`)
  if (from || to) {
    applied.push({
      label: "Срок",
      value: [from && `с ${dayChip(filters.dueFrom, ctx.timeZone)}`, to && `по ${dayChip(filters.dueTo, ctx.timeZone)}`]
        .filter(Boolean)
        .join(" "),
    })
  }
  if (filters.company) {
    const m = await resolveCompanyFilter(ctx, filters.company)
    where.push(inIds(task.clientId, m))
    applied.push({ label: "Компания", value: matchedLabel(filters.company, m) })
  }
  if (filters.deal) {
    const m = await resolveDealFilter(ctx, filters.deal)
    where.push(inIds(task.dealId, m))
    applied.push({ label: "Сделка", value: matchedLabel(filters.deal, m) })
  }
  if (filters.type) {
    where.push(eq(task.type, filters.type))
    applied.push({ label: "Тип", value: TASK_TYPE_LABELS[filters.type] })
  }
  if (filters.priority) {
    where.push(eq(task.priority, filters.priority))
    applied.push({ label: "Приоритет", value: TASK_PRIORITY_LABELS[filters.priority] })
  }

  const order =
    sort === "updated" ? [desc(task.updatedAt)] : sort === "created" ? [desc(task.createdAt)] : [asc(task.dueDate)]
  const rows = await baseQuery(ctx).where(and(...where)).orderBy(...order).limit(limit)
  return { rows: await mapRows(ctx, rows), ...capTotal(rows[0]?.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select({
      ...cols,
      description: task.description,
      contactId: task.contactId,
      contactName: contactDisplaySql(),
    })
    .from(task)
    .leftJoin(client, and(eq(task.clientId, client.id), eq(client.organizationId, ctx.orgId)))
    .leftJoin(deal, and(eq(task.dealId, deal.id), eq(deal.organizationId, ctx.orgId)))
    .leftJoin(contact, and(eq(task.contactId, contact.id), eq(contact.organizationId, ctx.orgId)))
    .where(and(eq(task.id, id), eq(task.organizationId, ctx.orgId)))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "task", [row]).length === 0) return null

  const members = await loadOrgMembers(ctx.orgId)
  const tz = ctx.timeZone
  const overdue = isOverdue(row.status, row.dueDate, ctx.now)
  const link = (label: string, value: string | null, href: string | null): RecordFact & { href?: string } =>
    href && value ? { label, value, href } : { label, value: value ?? "" }

  const info = allFacts([
    { label: "Статус", value: TASK_STATUS_LABELS[row.status] ?? row.status },
    { label: "Приоритет", value: TASK_PRIORITY_LABELS[row.priority] ?? row.priority },
    { label: "Тип", value: TASK_TYPE_LABELS[row.type] ?? row.type },
    { label: "Срок", value: formatDate(row.dueDate, tz) },
    { label: "Исполнитель", value: personLabel(ctx, members, row.assigneeId) },
    { label: "Автор", value: personLabel(ctx, members, row.userId) },
  ])
  // allFacts drops `href`, so the linked records are appended by hand.
  const links = [
    link("Компания", row.companyName, row.clientId ? recordHref("client", row.clientId) : null),
    link("Контакт", row.contactName, row.contactId ? recordHref("contact", row.contactId) : null),
    link("Сделка", row.dealName, row.dealId ? recordHref("deal", row.dealId) : null),
  ].filter((f) => f.value.trim())

  const sections: RecordDetailSection[] = []
  const items = [...info, ...links]
  if (items.length) sections.push({ kind: "facts", title: "Сведения", items })
  if (row.description?.trim()) {
    sections.push({ kind: "text", title: "Описание", markdown: row.description.trim().slice(0, 3000) })
  }

  return {
    type: "task",
    id,
    title: row.name,
    subtitle: subtitleOf(row),
    badges: overdue ? [{ label: "Просрочена", tone: "bad" }] : [],
    sections,
    href: recordHref("task", id),
  }
}

export const tasksModule: RecordModule<TaskFilters> = {
  type: "task",
  filterSchema: taskFilterSchema,
  sortKeys: SORT_KEYS,
  search: (ctx, tq, opts) => search(ctx, tq, opts),
  list,
  get,
}

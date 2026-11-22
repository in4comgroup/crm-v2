import "server-only"

import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, contact, contactCompanyLink, deal, dealContact, dealFunnelStage, task } from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit } from "@/lib/chat/records"
import { dealContactRoleLabel } from "@/lib/deal-roles"
import { stageDisplayLabel } from "@/lib/deal-funnel"
import { TASK_STATUS_LABELS } from "@/lib/task-labels"
import { loadContactCompanyHistoryText } from "@/server/contact-links"
import { loadCustomValuesText } from "@/server/custom-fields"
import { loadEntityDocumentsForChat } from "@/server/documents-chat"
import {
  containsQuery,
  matchesQuery,
  norm,
  normArray,
  relevanceOf,
  type TextQuery,
} from "@/server/search/normalise"
import { allFacts, facts, formatDate, formatMoney, isoOrNull, shortText } from "./format"
import { basicHit, capTotal, loadOrgMembers, parseDay, personLabel, totalOver } from "./shared"
import { matchedLabel, resolveCompanyFilter, type NamedMatch } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext } from "./types"
import { contactDisplaySql } from "@/server/contact-display"

// «Контакт» (contact) — records engine module (spec §6.1).
// Visible: every contact of the org except `deleted` / `blocked` and
// contacts merged into another one.

const HIDDEN_STATUSES = ["deleted", "blocked"] as const
const STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  suspended: "Приостановлен",
  initial: "Новый",
}
const OPEN_TASK_STATUSES = ["todo", "in_progress"] as const

export const contactFilterSchema = z
  .object({
    company: z
      .string()
      .min(1)
      .optional()
      .describe("Company: its id or (part of) its name; matches the primary company and other current companies"),
    status: z.enum(["active", "suspended", "initial"]).optional(),
    hasEmail: z.boolean().optional().describe("true = only contacts with an e-mail, false = only without"),
    createdFrom: z.string().optional().describe("Added to the CRM on / after this day, YYYY-MM-DD"),
    createdTo: z.string().optional().describe("Added to the CRM on / before this day, YYYY-MM-DD"),
  })
  .strict()
export type ContactFilters = z.infer<typeof contactFilterSchema>

const SORT_KEYS = ["updated", "name", "created"] as const

/** Chip text of a filter day as the user typed it («2026-12-31» → «31.12.2026»), never shifted by time zones. */
function dayChip(raw: string | undefined, tz: string): string {
  if (!raw) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : formatDate(raw, tz)
}

const cols = {
  id: contact.id,
  organizationId: contact.organizationId,
  name: contactDisplaySql(),
  systemName: contact.name,
  nameNative: contact.nameNative,
  email: contact.email,
  phone: contact.phone,
  position: contact.position,
  status: contact.status,
  clientId: contact.clientId,
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
  companyName: client.name,
}
type ContactRowLite = {
  id: string
  organizationId: string | null
  name: string
  systemName: string
  nameNative: string | null
  email: string | null
  phone: string | null
  position: string | null
  status: string
  clientId: string | null
  createdAt: Date
  updatedAt: Date | null
  companyName: string | null
}

/** The visible-contact condition (org, status, not merged). */
function visible(ctx: RecordsContext): SQL {
  return and(
    eq(contact.organizationId, ctx.orgId),
    notInArray(contact.status, [...HIDDEN_STATUSES]),
    isNull(contact.mergedIntoContactId),
  )!
}

function baseQuery(ctx: RecordsContext) {
  return db
    .select({ ...cols, total: totalOver })
    .from(contact)
    .leftJoin(
      client,
      and(
        eq(contact.clientId, client.id),
        eq(client.organizationId, ctx.orgId),
        notInArray(client.status, [...HIDDEN_STATUSES]),
      ),
    )
}

function subtitleOf(r: ContactRowLite): string | null {
  return [r.position, r.companyName].filter((s) => s && s.trim()).join(" · ") || null
}

function toHit(r: ContactRowLite): RecordHit {
  return {
    type: "contact",
    id: r.id,
    title: r.name,
    subtitle: subtitleOf(r),
    facts: facts([
      { label: "Email", value: r.email ?? "" },
      { label: "Телефон", value: r.phone ?? "" },
    ]),
    badge: r.status !== "active" ? { label: STATUS_LABELS[r.status] ?? r.status, tone: "warn" } : null,
    date: isoOrNull(r.updatedAt ?? r.createdAt),
    href: recordHref("contact", r.id),
  }
}

async function search(ctx: RecordsContext, tq: TextQuery, opts: { limit: number }) {
  const fields = [norm(contact.name), norm(contact.nameNative), normArray(contact.aliases), norm(contact.position)]
  const companyField = norm(client.name)
  const rows = await baseQuery(ctx)
    .where(
      and(
        visible(ctx),
        or(
          ...fields.map((f) => matchesQuery(tq, f)),
          containsQuery(tq, norm(contact.email)),
          containsQuery(tq, norm(contact.phone)),
          matchesQuery(tq, companyField),
        ),
      ),
    )
    // The company name is a weaker field: half weight, so a person whose own
    // name matches leads the people who only work at a matching company.
    .orderBy(
      desc(sql`greatest(${relevanceOf(tq, fields)}, ${relevanceOf(tq, [companyField])} * 0.5)`),
      desc(contact.updatedAt),
    )
    .limit(opts.limit)
  const own = keepOwnOrg(ctx, "contact", rows)
  return { hits: own.map(toHit), ...capTotal(rows[0]?.total) }
}

/** Contacts of the resolved companies: the primary company or another current link. */
function companyCondition(ctx: RecordsContext, companies: NamedMatch[]): SQL {
  if (companies.length === 0) return sql`false`
  const ids = sql.join(
    companies.map((c) => sql`${c.id}`),
    sql`, `,
  )
  return or(
    sql`${contact.clientId} in (${ids})`,
    sql`exists (select 1 from ${contactCompanyLink} where ${contactCompanyLink.contactId} = ${contact.id} and ${contactCompanyLink.organizationId} = ${ctx.orgId} and ${contactCompanyLink.status} = 'current' and ${contactCompanyLink.clientId} in (${ids}))`,
  )!
}

async function list(ctx: RecordsContext, filters: ContactFilters, sort: string, limit: number) {
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [visible(ctx)]

  if (filters.company) {
    const m = await resolveCompanyFilter(ctx, filters.company)
    where.push(companyCondition(ctx, m))
    applied.push({ label: "Компания", value: matchedLabel(filters.company, m) })
  }
  if (filters.status) {
    where.push(eq(contact.status, filters.status))
    applied.push({ label: "Статус", value: STATUS_LABELS[filters.status] })
  }
  if (filters.hasEmail !== undefined) {
    where.push(
      filters.hasEmail
        ? sql`coalesce(trim(${contact.email}), '') <> ''`
        : sql`coalesce(trim(${contact.email}), '') = ''`,
    )
    applied.push({ label: "Email", value: filters.hasEmail ? "есть" : "нет" })
  }
  const from = parseDay(filters.createdFrom, false, ctx.timeZone)
  const to = parseDay(filters.createdTo, true, ctx.timeZone)
  if (from) where.push(sql`${contact.createdAt} >= ${from.toISOString()}`)
  if (to) where.push(sql`${contact.createdAt} <= ${to.toISOString()}`)
  if (from || to) {
    applied.push({
      label: "Добавлен",
      value: [from && `с ${dayChip(filters.createdFrom, ctx.timeZone)}`, to && `по ${dayChip(filters.createdTo, ctx.timeZone)}`]
        .filter(Boolean)
        .join(" "),
    })
  }

  const order =
    sort === "name" ? [asc(contactDisplaySql())] : sort === "created" ? [desc(contact.createdAt)] : [desc(contact.updatedAt)]
  const rows = await baseQuery(ctx).where(and(...where)).orderBy(...order).limit(limit)
  const own = keepOwnOrg(ctx, "contact", rows)
  return { rows: own.map(toHit), ...capTotal(rows[0]?.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await baseQuery(ctx).where(and(eq(contact.id, id), visible(ctx))).limit(1)
  if (!row || keepOwnOrg(ctx, "contact", [row]).length === 0) return null

  const [members, history, customText, docs, deals, tasks] = await Promise.all([
    loadOrgMembers(ctx.orgId),
    loadContactCompanyHistoryText(ctx.orgId, [id]),
    loadCustomValuesText(ctx.orgId, "contact", [id], 1200),
    loadEntityDocumentsForChat(ctx.orgId, [{ entityType: "contact", entityId: id }], 8),
    db
      .select({
        id: deal.id,
        name: deal.name,
        value: deal.value,
        currency: deal.currency,
        role: dealContact.role,
        stageName: dealFunnelStage.name,
        stageDisplay: dealFunnelStage.displayName,
        updatedAt: deal.updatedAt,
      })
      .from(dealContact)
      .innerJoin(deal, eq(dealContact.dealId, deal.id))
      .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
      .where(and(eq(dealContact.contactId, id), eq(deal.organizationId, ctx.orgId), sql`${deal.status} <> 'deleted'`))
      .orderBy(desc(deal.updatedAt))
      .limit(10),
    db
      .select({
        id: task.id,
        name: task.name,
        status: task.status,
        dueDate: task.dueDate,
        assigneeId: task.assigneeId,
      })
      .from(task)
      .where(
        and(
          eq(task.organizationId, ctx.orgId),
          eq(task.contactId, id),
          inArray(task.status, [...OPEN_TASK_STATUSES]),
        ),
      )
      .orderBy(asc(task.dueDate))
      .limit(10),
  ])

  const tz = ctx.timeZone
  const sections: RecordDetailSection[] = []

  const info = allFacts([
    { label: "Компания", value: row.companyName ?? "" },
    { label: "Должность", value: row.position ?? "" },
    { label: "Системное имя", value: row.systemName && row.systemName !== row.name ? row.systemName : "" },
    { label: "Email", value: row.email ?? "" },
    { label: "Телефон", value: row.phone ?? "" },
    { label: "Добавлен", value: formatDate(row.createdAt, tz) },
  ])
  if (info.length) sections.push({ kind: "facts", title: "Сведения", items: info })

  const companies = history.get(id)
  if (companies) sections.push({ kind: "text", title: "Компании", markdown: companies })
  const custom = customText.get(id)
  if (custom) sections.push({ kind: "text", title: "Поля контакта", markdown: custom })

  if (deals.length) {
    sections.push({
      kind: "records",
      title: "Сделки",
      items: deals.map((d) =>
        basicHit(
          "deal",
          d.id,
          d.name,
          stageDisplayLabel(d.stageName, d.stageDisplay),
          facts([
            { label: "Сумма", value: formatMoney(d.value, d.currency) },
            { label: "Роль", value: d.role ? dealContactRoleLabel(d.role) : "" },
          ]),
          isoOrNull(d.updatedAt),
        ),
      ),
    })
  }
  if (tasks.length) {
    sections.push({
      kind: "records",
      title: "Открытые задачи",
      items: tasks.map((t) =>
        basicHit(
          "task",
          t.id,
          t.name,
          null,
          facts([
            { label: "Срок", value: formatDate(t.dueDate, tz) },
            { label: "Исполнитель", value: personLabel(ctx, members, t.assigneeId) },
            { label: "Статус", value: TASK_STATUS_LABELS[t.status] },
          ]),
          isoOrNull(t.dueDate),
        ),
      ),
    })
  }
  const docList = docs.get(`contact:${id}`) ?? []
  if (docList.length) {
    sections.push({
      kind: "text",
      title: "Документы",
      markdown: docList.map((d) => `- ${d.name}${d.summary ? ` — ${shortText(d.summary, 160)}` : ""}`).join("\n"),
    })
  }

  return {
    type: "contact",
    id,
    title: row.name,
    subtitle: subtitleOf(row),
    badges: row.status !== "active" ? [{ label: STATUS_LABELS[row.status] ?? row.status, tone: "warn" }] : [],
    sections,
    href: recordHref("contact", id),
  }
}

export const contactsModule: RecordModule<ContactFilters> = {
  type: "contact",
  filterSchema: contactFilterSchema,
  sortKeys: SORT_KEYS,
  search: (ctx, tq, opts) => search(ctx, tq, opts),
  list,
  get,
}

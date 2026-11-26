"use server"

import { onTaskChanged } from "@/server/notifications/checks"

import { db } from "@/db/drizzle"
import {
  task,
  client,
  contact,
  deal,
  user,
  member,
  contactCompanyLink,
  type TaskType,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema"
import { aliasedTable, and, eq, desc, exists, inArray, isNotNull, or, sql, asc, lte } from "drizzle-orm"
import { OPEN_DEAL_STATUSES } from "@/lib/deal-funnel"
import { humanUsersOnly } from "@/server/topics/system-actor"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"
import { contactDisplaySql } from "@/server/contact-display"
import { defaultDueLocal, parseTaskDue } from "@/lib/org-time"
import { loadOrgTime } from "@/server/org-time"

export type TaskRow = {
  id: string
  name: string
  description: string | null
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  userId: string
  userName: string | null
  assigneeId: string
  assigneeName: string | null
  clientId: string | null
  clientName: string | null
  contactId: string | null
  contactName: string | null
  dealId: string | null
  dealName: string | null
  organizationId: string
  dueDate: string
  createdAt: string
  updatedAt: string
}

export type OrgMemberOption = { id: string; name: string; email: string }
export type TaskClientOption = { id: string; name: string }
export type TaskContactOption = {
  id: string
  name: string
  clientId: string | null
}
export type TaskDealOption = {
  id: string
  name: string
  clientId: string
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertTaskInOrg(taskId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Task not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertUserInOrg(userId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1)
  if (!rows[0]) throw new Error("Assignee is not a member of this organization")
}

async function assertClientIfProvided(
  clientId: string | null | undefined,
  organizationId: string,
) {
  if (!clientId) return
  const rows = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

async function assertContactIfProvided(
  contactId: string | null | undefined,
  organizationId: string,
  clientId: string | null | undefined,
) {
  if (!contactId) return
  const rows = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid contact")
  }
  if (clientId && current.clientId && current.clientId !== clientId) {
    throw new Error("Contact does not belong to the selected client")
  }
}

async function assertDealIfProvided(
  dealId: string | null | undefined,
  organizationId: string,
) {
  if (!dealId) return
  const rows = await db
    .select()
    .from(deal)
    .where(eq(deal.id, dealId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid deal")
  }
}

export async function listUrgentTasks() {
  const { activeOrgId, session } = await requireOrgContext()
  const now = new Date()
  const upcoming = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const rows = await db.select({ id: task.id, name: task.name, dueDate: task.dueDate, priority: task.priority })
    .from(task)
    .where(and(
      eq(task.organizationId, activeOrgId),
      eq(task.assigneeId, session.user.id),
      inArray(task.status, ["todo", "in_progress"]),
      or(lte(task.dueDate, upcoming), eq(task.priority, "high")),
    ))
    .orderBy(asc(task.dueDate), asc(task.id))
  return rows.map(({ id, name, dueDate, priority }) => ({
    id, name, dueDate: dueDate.toISOString(), priority, overdue: dueDate < now,
  }))
}

export async function listTasks(): Promise<TaskRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const creator = aliasedTable(user, "task_creator")
  const assignee = aliasedTable(user, "task_assignee")

  const rows = await db
    .select({
      task,
      userName: creator.name,
      assigneeName: assignee.name,
      clientName: client.name,
      contactName: contactDisplaySql(),
      dealName: deal.name,
    })
    .from(task)
    .leftJoin(creator, eq(task.userId, creator.id))
    .leftJoin(assignee, eq(task.assigneeId, assignee.id))
    .leftJoin(client, eq(task.clientId, client.id))
    .leftJoin(contact, eq(task.contactId, contact.id))
    .leftJoin(deal, eq(task.dealId, deal.id))
    .where(eq(task.organizationId, activeOrgId))
    .orderBy(desc(task.updatedAt))

  return rows.map((r) => ({
    id: r.task.id,
    name: r.task.name,
    description: r.task.description,
    type: r.task.type,
    priority: r.task.priority,
    status: r.task.status,
    userId: r.task.userId,
    userName: r.userName,
    assigneeId: r.task.assigneeId,
    assigneeName: r.assigneeName,
    clientId: r.task.clientId,
    clientName: r.clientName,
    contactId: r.task.contactId,
    contactName: r.contactName,
    dealId: r.task.dealId,
    dealName: r.dealName,
    organizationId: r.task.organizationId,
    dueDate: r.task.dueDate.toISOString(),
    createdAt: r.task.createdAt.toISOString(),
    updatedAt: r.task.updatedAt.toISOString(),
  }))
}

/**
 * Members + the caller's own user id — the task form uses it as the default
 * «Исполнитель» of a new task (the person who creates it), not the first
 * member by name.
 */
export async function listOrgMembersForViewer(): Promise<{
  members: OrgMemberOption[]
  currentUserId: string
}> {
  const { session, activeOrgId } = await requireOrgContext()
  return { members: await orgMemberOptions(activeOrgId), currentUserId: session.user.id }
}

async function orgMemberOptions(activeOrgId: string): Promise<OrgMemberOption[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    // System actors «Агент» are never members; the filter is a safety net
    // so they can never become an assignee option.
    .where(and(eq(member.organizationId, activeOrgId), humanUsersOnly()))
    .orderBy(user.name)
  return rows
}

export async function listTaskClientOptions(): Promise<TaskClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        // active + initial: auto-discovered (initial) clients are valid task
        // targets too — mirrors the deal pickers, and lets a card's
        // identified client prefill stick even before it's reviewed.
        inArray(client.status, ["active", "initial"]),
      ),
    )
    .orderBy(client.name)
  return rows
}

export async function listTaskContactOptions(
  clientId?: string | null,
): Promise<TaskContactOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const conditions = [
    eq(contact.organizationId, activeOrgId),
    // active + initial, same rationale as listTaskClientOptions — so a card's
    // identified (often auto-discovered) contact prefill survives the form's
    // option-validity check.
    inArray(contact.status, ["active", "initial"]),
  ]
  if (clientId) {
    // Primary company (contact.client_id) OR a current link to the company
    // (contact_company_link, docs/specs/clients-contacts/04) — a person who
    // works with two companies is a valid task contact for both.
    conditions.push(
      or(
        eq(contact.clientId, clientId),
        exists(
          db
            .select({ one: sql`1` })
            .from(contactCompanyLink)
            .where(
              and(
                eq(contactCompanyLink.contactId, contact.id),
                eq(contactCompanyLink.clientId, clientId),
                eq(contactCompanyLink.organizationId, activeOrgId),
                eq(contactCompanyLink.status, "current"),
              ),
            ),
        ),
      )!,
    )
  }
  const rows = await db
    .select({
      id: contact.id,
      name: contactDisplaySql(),
      clientId: contact.clientId,
    })
    .from(contact)
    .where(and(...conditions))
    .orderBy(contactDisplaySql())
  return rows
}

export async function listTaskDealOptions(
  clientId?: string | null,
): Promise<TaskDealOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const conditions = [
    eq(deal.organizationId, activeOrgId),
    // Only open (active / paused) deals are valid task contexts — cancelled / deleted deals
    // are soft-deleted and shouldn't appear in the picker.
    inArray(deal.status, [...OPEN_DEAL_STATUSES]),
  ]
  if (clientId) {
    conditions.push(eq(deal.clientId, clientId))
  }
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      clientId: deal.clientId,
    })
    .from(deal)
    .where(and(...conditions))
    .orderBy(deal.name)
  return rows
}

export async function createTask(data: {
  name: string
  description?: string | null
  type?: TaskType
  priority?: TaskPriority
  status?: TaskStatus
  assigneeId?: string | null
  clientId?: string | null
  contactId?: string | null
  dealId?: string | null
  dueDate?: string | null
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  const assigneeId = data.assigneeId || session.user.id
  await assertUserInOrg(assigneeId, activeOrgId)
  await assertClientIfProvided(data.clientId, activeOrgId)
  await assertContactIfProvided(data.contactId, activeOrgId, data.clientId)
  await assertDealIfProvided(data.dealId, activeOrgId)

  const now = new Date()
  // Deadlines are wall times in the ORG zone (src/lib/org-time.ts): «YYYY-MM-DD»
  // = that day at the org default due time, «YYYY-MM-DDTHH:MM» = that time;
  // a full ISO instant (code callers) is kept. No deadline = today at the
  // default time (2026-11-26; before, a bare date became 00:00 UTC = 03:00 MSK).
  const orgTime = await loadOrgTime(activeOrgId)
  const due = parseTaskDue(data.dueDate || defaultDueLocal(now, orgTime), orgTime)
  if (!due) throw new Error("Неверный срок задачи")

  const id = randomUUID()
  await db.insert(task).values({
    id,
    name: data.name.trim(),
    description: data.description?.trim() || null,
    type: data.type ?? "other",
    priority: data.priority ?? "medium",
    status: data.status ?? "todo",
    userId: session.user.id,
    assigneeId,
    clientId: data.clientId || null,
    contactId: data.contactId || null,
    dealId: data.dealId || null,
    organizationId: activeOrgId,
    dueDate: due,
    createdAt: now,
    updatedAt: now,
  })
  if (assigneeId !== session.user.id) {
    await notifyTaskAssigned(activeOrgId, id, data.name.trim(), assigneeId, session.user.name, due)
  }
  // Due reminders at once when the task is due today / tomorrow (never throws).
  await onTaskChanged(activeOrgId, id)
  return { id }
}

// Notifications (docs/specs/notifications §4 `task.assigned`): a task that
// someone ELSE assigned to you. Never throws.
async function notifyTaskAssigned(
  orgId: string,
  taskId: string,
  name: string,
  assigneeId: string,
  byName: string | null | undefined,
  due: Date,
): Promise<void> {
  try {
    const { notify } = await import("@/server/notifications/engine")
    await notify(orgId, {
      kind: "task.assigned",
      userIds: [assigneeId],
      title: `Вам назначена задача: ${name}`,
      body: `${byName ? `от ${byName} · ` : ""}срок ${due.toLocaleDateString("ru-RU")}`,
      href: `/tasks?openTask=${taskId}`,
      entity: { type: "task", id: taskId },
      dedupeKey: `task.assigned:${taskId}:${assigneeId}`,
    })
  } catch (err) {
    console.error("[tasks] assigned notification failed", taskId, err)
  }
}

export async function updateTask(
  taskId: string,
  data: {
    name?: string
    description?: string | null
    type?: TaskType
    priority?: TaskPriority
    status?: TaskStatus
    assigneeId?: string | null
    clientId?: string | null
    contactId?: string | null
    dealId?: string | null
    dueDate?: string | null
  },
) {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertTaskInOrg(taskId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.assigneeId) {
    await assertUserInOrg(data.assigneeId, activeOrgId)
  }
  if (data.clientId !== undefined) {
    await assertClientIfProvided(data.clientId, activeOrgId)
  }
  if (data.contactId !== undefined) {
    const effectiveClientId =
      data.clientId !== undefined ? data.clientId : current.clientId
    await assertContactIfProvided(data.contactId, activeOrgId, effectiveClientId)
  }
  if (data.dealId !== undefined) {
    await assertDealIfProvided(data.dealId, activeOrgId)
  }

  let due: Date | undefined
  if (data.dueDate !== undefined) {
    if (!data.dueDate) throw new Error("Неверный срок задачи")
    const parsed = parseTaskDue(data.dueDate, await loadOrgTime(activeOrgId))
    if (!parsed) throw new Error("Неверный срок задачи")
    due = parsed
  }

  await db
    .update(task)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined
        ? { description: data.description?.trim() || null }
        : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.assigneeId ? { assigneeId: data.assigneeId } : {}),
      ...(data.clientId !== undefined
        ? { clientId: data.clientId || null }
        : {}),
      ...(data.contactId !== undefined
        ? { contactId: data.contactId || null }
        : {}),
      ...(data.dealId !== undefined ? { dealId: data.dealId || null } : {}),
      ...(due ? { dueDate: due } : {}),
    })
    .where(eq(task.id, taskId))

  const reassigned = !!data.assigneeId && data.assigneeId !== current.assigneeId
  if (reassigned && data.assigneeId !== session.user.id) {
    await notifyTaskAssigned(activeOrgId, taskId, data.name?.trim() || current.name, data.assigneeId!, session.user.name, due ?? current.dueDate)
  }
  // Reminders: a new assignee → the old one's reminders close (the rule then
  // notifies the new assignee); a moved date / closed task resolves the old ones.
  if (reassigned) {
    const { resolveNotifications } = await import("@/server/notifications/engine")
    await resolveNotifications(activeOrgId, `task.due_tomorrow:${taskId}:`, { prefix: true })
    await resolveNotifications(activeOrgId, `task.due_today:${taskId}:`, { prefix: true })
    await resolveNotifications(activeOrgId, `task.overdue:${taskId}:`, { prefix: true })
  }
  await onTaskChanged(activeOrgId, taskId, { previousDueDate: current.dueDate })
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const { activeOrgId } = await requireOrgContext()
  await assertTaskInOrg(taskId, activeOrgId)
  await db.update(task).set({ status }).where(eq(task.id, taskId))
  await onTaskChanged(activeOrgId, taskId)
}

export type ClientTaskSummary = {
  openCount: number
  overdueCount: number
  nextDueDate: string | null
}

// One-shot batched aggregate used by the "Компании" feed (criticality sort +
// the client card's "N задач · M просрочено" plate) instead of a query per
// card. `done`/`closed` tasks don't count as open work.
export async function listTaskSummaryByClient(): Promise<
  Record<string, ClientTaskSummary>
> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      clientId: task.clientId,
      status: task.status,
      dueDate: task.dueDate,
    })
    .from(task)
    .where(and(eq(task.organizationId, activeOrgId), isNotNull(task.clientId)))

  const now = Date.now()
  const summary: Record<string, ClientTaskSummary> = {}
  for (const row of rows) {
    if (!row.clientId || row.status === "done" || row.status === "closed") {
      continue
    }
    const entry = (summary[row.clientId] ??= {
      openCount: 0,
      overdueCount: 0,
      nextDueDate: null,
    })
    entry.openCount += 1
    const dueMs = row.dueDate.getTime()
    if (dueMs < now) entry.overdueCount += 1
    if (!entry.nextDueDate || dueMs < new Date(entry.nextDueDate).getTime()) {
      entry.nextDueDate = row.dueDate.toISOString()
    }
  }
  return summary
}

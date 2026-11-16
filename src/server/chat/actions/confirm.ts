import "server-only"

import { randomUUID } from "node:crypto"
import { db } from "@/db/drizzle"
import { contactAddress } from "@/db/schema"
import {
  ACTION_LIMITS,
  MISSING_LABELS,
  actionResultHref,
  cleanEmail,
  cleanTelegram,
  cleanWebsite,
  ITEM_TYPE_WORDS,
  isOpenActionStatus,
  itemLabel,
  missingFields,
  parseItemValues,
  phoneKey,
  uniqueBy,
  type ActionResult,
  type ActionStatus,
  type ChatDraft,
  type ChatDraftPart,
  type CompanyValues,
  type ConfirmActionInput,
  type ContactValues,
  type DealValues,
  type DraftItem,
  type ExistingClient,
  type ExistingContact,
  type FillChange,
  type DealMoveValues,
  type LinkValues,
  type OrderRequestValues,
  type TaskUpdateValues,
  type UpdateValues,
  companyFill,
  contactFill,
  type DraftMatch,
  type TaskValues,
} from "@/lib/chat/actions"
import { normalizeAddress } from "@/lib/contact-links"
import { createClient, updateClient } from "@/server/clients"
import { createContact, updateContact } from "@/server/contacts"
import { createTask, updateTask } from "@/server/tasks"
import { createAndParseOrderRequest } from "@/server/order-requests"
import { createDeal, moveDealStage, updateDeal } from "@/server/deals"
import { dealActivity, dealContact } from "@/db/schema"
import { and, eq, isNull } from "drizzle-orm"
import { applyLinkAction } from "@/server/contact-links"
import { loadRecordsContext } from "@/server/chat/records"
import { localToUtc } from "@/lib/chat/due-date"
import { addDocumentLink } from "@/server/documents"
import {
  checkCompany,
  checkContact,
  clientInOrg,
  clientRow,
  contactsInOrg,
  dealInOrg,
  dealWithStage,
  existingClient,
  existingContact,
  loadDealOptions,
  loadMoveOptions,
  loadOrgIndex,
  loadOrgMembers,
  openDealsOfClient,
  taskInOrg,
} from "./checks"
import { actionPart, claimAction, createdLastHour, finishAction, loadAction, syncActionMessage, type ActionRow } from "./store"

// Confirm of a chat draft (docs/specs/ai-chat-tools §7.4). Runs in the
// request of the signed-in user: the records are created through the same
// server functions as the UI (`createClient`, `createContact`, … — they read
// the session themselves), so the creator, «Ответственный», enrichment and
// permissions are exactly as for a record made by hand.

export class ChatActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "error",
    readonly action: ChatDraftPart | null = null,
  ) {
    super(message)
  }
}

/** The card's part + (task items) the members and the org time zone for the form. */
async function withOptions(orgId: string, userId: string, part: ChatDraftPart): Promise<ChatDraftPart> {
  const hasDeal = part.draft.items.some((i) => i.type === "deal")
  const hasMove = part.draft.items.some((i) => i.type === "deal_move")
  if (!hasDeal && !hasMove && !part.draft.items.some((i) => i.type === "task" || i.type === "task_update")) return part
  const [members, ctx, deals, moves] = await Promise.all([
    loadOrgMembers(orgId),
    loadRecordsContext(orgId, userId),
    hasDeal ? loadDealOptions(orgId) : Promise.resolve(null),
    hasMove ? loadMoveOptions(orgId) : Promise.resolve(null),
  ])
  return {
    ...part,
    options: {
      members: members.map((m) => ({ id: m.id, name: m.name })),
      timeZone: ctx.timeZone,
      ...(deals ? { stages: deals.stages, dealTypes: deals.dealTypes.map((t) => ({ id: t.id, name: t.name })) } : {}),
      ...(moves ?? {}),
    },
  }
}

export async function getChatAction(orgId: string, userId: string, id: string): Promise<ChatDraftPart> {
  const r = await loadAction(orgId, userId, id)
  if (!r) throw new ChatActionError("Черновик не найден", 404)
  return withOptions(orgId, userId, actionPart(r))
}

export async function cancelChatAction(orgId: string, userId: string, id: string): Promise<ChatDraftPart> {
  const r = await loadAction(orgId, userId, id)
  if (!r) throw new ChatActionError("Черновик не найден", 404)
  if (!isOpenActionStatus(r.status)) return actionPart(r)
  await finishAction(id, { status: "cancelled" })
  const next = { ...r, status: "cancelled" }
  await syncActionMessage(next)
  return actionPart(next)
}

const labelOf = (i: DraftItem) => `${ITEM_TYPE_WORDS[i.type]} «${itemLabel(i)}»`

type Planned = {
  item: DraftItem
  values: CompanyValues | ContactValues | TaskValues | DealValues | UpdateValues | LinkValues | OrderRequestValues | DealMoveValues | TaskUpdateValues
  decision: string
  existingId?: string
}

const ORDER: Record<DraftItem["type"], number> = { company: 0, contact: 1, deal: 2, task: 3, update: 4, link: 5, order_request: 6, deal_move: 7, task_update: 8 }

export async function confirmChatAction(orgId: string, userId: string, input: ConfirmActionInput): Promise<ChatDraftPart> {
  const r = await loadAction(orgId, userId, input.actionId)
  if (!r) throw new ChatActionError("Черновик не найден", 404)
  if (!isOpenActionStatus(r.status)) {
    const msg = r.status === "expired" ? "Черновик устарел — попросите подготовить карточку заново" : "Черновик уже обработан"
    throw new ChatActionError(msg, 409, "closed", actionPart(r))
  }
  const draft = r.draft as ChatDraft
  const byKey = new Map(input.items.map((i) => [i.key, i]))

  // Plan: included items with their edited values (companies first).
  const plan: Planned[] = []
  for (const item of [...draft.items].sort((a, b) => ORDER[a.type] - ORDER[b.type])) {
    const inp = byKey.get(item.key)
    if (!inp?.include || item.refused) continue
    const values = parseItemValues(item.type, inp.values)
    if (!values) throw new ChatActionError(`Неверные данные: ${labelOf(item)}`, 400)
    plan.push({ item, values, decision: inp.decision, existingId: inp.existingId })
  }
  if (!plan.length) throw new ChatActionError("Ничего не выбрано", 400)
  // A contact whose company of this card is NOT created / used has no company.
  const plannedKeys = new Set(plan.map((p) => p.item.key))
  for (const p of plan) {
    if (p.item.type === "order_request") {
      const o = p.values as OrderRequestValues
      if (o.companyKey && !plannedKeys.has(o.companyKey)) {
        o.companyKey = null
        o.clientName = ""
      }
      continue
    }
    if (["company", "update", "link", "deal_move", "task_update"].includes(p.item.type)) continue
    const v = p.values as ContactValues | TaskValues | DealValues
    if (v.companyKey && !plannedKeys.has(v.companyKey)) {
      v.companyKey = null
      v.companyName = ""
    }
    if (p.item.type === "task") {
      const t = p.values as TaskValues
      if (t.contactKey && !plannedKeys.has(t.contactKey)) {
        t.contactKey = null
        t.contactName = ""
      }
      if (t.dealKey && !plannedKeys.has(t.dealKey)) {
        t.dealKey = null
        t.dealName = ""
      }
    }
    if (p.item.type === "deal") {
      const d = p.values as DealValues
      const keep = d.contactKeys.map((k, i) => ({ k, n: d.contactNames[d.contactIds.length + i] ?? "" })).filter((x) => plannedKeys.has(x.k))
      d.contactNames = [...d.contactNames.slice(0, d.contactIds.length), ...keep.map((x) => x.n)]
      d.contactKeys = keep.map((x) => x.k)
    }
  }
  // Tasks: the org time zone of the due dates; a due date in the past is refused.
  const timeZone = plan.some((p) => p.item.type === "task" || p.item.type === "task_update") ? (await loadRecordsContext(orgId, userId)).timeZone : "UTC"
  for (const p of plan) {
    if (p.item.type !== "task_update" || (p.values as TaskUpdateValues).action !== "reschedule") continue
    const at = localToUtc((p.values as TaskUpdateValues).dueDate, timeZone)
    if (!at) throw new ChatActionError(`${labelOf(p.item)}: ${MISSING_LABELS.dueDate}`, 400)
    if (at.getTime() < Date.now() - 60_000) throw new ChatActionError(`${labelOf(p.item)}: срок в прошлом`, 400)
  }
  for (const p of plan) {
    if (p.item.type !== "task") continue
    const at = localToUtc((p.values as TaskValues).dueDate, timeZone)
    if (!at) throw new ChatActionError(`${labelOf(p.item)}: ${MISSING_LABELS.dueDate}`, 400)
    // A logged meeting / call (T4) happened in the past — that is its point.
    if (!(p.values as TaskValues).done && at.getTime() < Date.now() - 60_000) throw new ChatActionError(`${labelOf(p.item)}: срок в прошлом`, 400)
  }
  for (const p of plan) {
    if (p.decision === "use_existing" || p.decision === "restore" || p.decision === "fill_existing") continue
    const miss = missingFields({ type: p.item.type, values: p.values })
    if (miss.length) throw new ChatActionError(`${labelOf(p.item)}: ${miss.map((m) => MISSING_LABELS[m] ?? m).join("; ")}`, 400)
  }

  const creates = plan.filter((p) => p.decision === "create" || p.decision === "create_anyway").length
  if ((await createdLastHour(orgId, userId)) + creates > ACTION_LIMITS.createsPerHour) {
    throw new ChatActionError(`Не больше ${ACTION_LIMITS.createsPerHour} записей из чата за час. Попробуйте позже.`, 429)
  }

  if (!(await claimAction(r.id))) throw new ChatActionError("Черновик уже обрабатывается", 409, "closed", actionPart({ ...r, status: "confirming" }))
  const reopen = async () => finishAction(r.id, { status: r.status as ActionStatus })

  // Checks again on the EDITED values (§7.4): «us», blocklist, new exact duplicates.
  let idx
  try {
    idx = await loadOrgIndex(orgId)
  } catch (e) {
    await reopen()
    throw e
  }
  const fresh: DraftItem[] = []
  let duplicate: string | null = null
  for (const item of draft.items) {
    const p = plan.find((x) => x.item.key === item.key)
    if (!p || ["task", "update", "link", "order_request", "deal_move", "task_update"].includes(item.type)) {
      fresh.push(p ? { ...item, values: p.values } : item)
      continue
    }
    if (item.type === "deal") {
      // «An open deal of the same company and type» — again, it may be new since the draft.
      const d = p.values as DealValues
      const open = d.companyId ? await openDealsOfClient(orgId, d.companyId) : []
      const matches: DraftMatch[] = open.map((x) => ({
        kind: (x.dealTypeId ?? null) === (d.dealTypeId ?? null) ? "exact" : "similar",
        type: "deal",
        id: x.id,
        title: x.name,
        subtitle: x.stageName,
        reason: (x.dealTypeId ?? null) === (d.dealTypeId ?? null) ? "открытая сделка той же компании и того же типа" : "другая открытая сделка компании",
      }))
      fresh.push({ ...item, values: p.values, matches })
      const exact = matches.find((m) => m.kind === "exact")
      if (p.decision === "create" && exact && !duplicate) {
        duplicate = `${labelOf(item)}: у компании уже есть открытая сделка «${exact.title}» того же типа. Выберите «Использовать существующую» или «Всё равно создать новую».`
      }
      continue
    }
    const chk =
      item.type === "company"
        ? await checkCompany(idx, p.values as CompanyValues, null)
        : await checkContact(idx, p.values as ContactValues, null)
    if (chk.refused) {
      await reopen()
      throw new ChatActionError(`${labelOf(item)}: ${chk.refused}`, 400)
    }
    // Keep earlier similar hints (from the fuzzy search) next to the fresh matches.
    const matches = [...chk.matches, ...item.matches.filter((m) => m.kind === "similar" && !chk.matches.some((x) => x.id === m.id))]
    fresh.push({ ...item, values: p.values, matches })
    const exact = chk.matches.filter((m) => m.kind === "exact")
    if (p.decision === "create" && exact.length && !duplicate) {
      duplicate = `${labelOf(item)}: похоже, уже есть ${exact[0].type === "client" ? "компания" : "контакт"} «${exact[0].title}» — ${exact[0].reason}. Выберите «Использовать существующий» или «Всё равно создать новый».`
    }
  }
  if (duplicate) {
    const d: ChatDraft = { ...draft, items: fresh }
    await finishAction(r.id, { status: r.status as ActionStatus, draft: d })
    const next = { ...r, draft: d }
    await syncActionMessage(next)
    throw new ChatActionError(duplicate, 409, "duplicate", await withOptions(orgId, userId, actionPart(next)))
  }

  // Create in dependency order: companies → contacts → document links.
  const results: ActionResult[] = []
  const byItem = new Map<string, { id: string; name: string }>()
  let error: string | null = null
  const allowed = (item: DraftItem, id: string | undefined, kinds: string[]) =>
    !!id && fresh.find((f) => f.key === item.key)?.matches.some((m) => m.id === id && kinds.includes(m.kind))

  for (const p of plan) {
    try {
      if ((p.item.type === "company" || p.item.type === "contact") && p.decision === "fill_existing") {
        // «Дополнить существующий» (T4): only what is still empty / new at this moment.
        if (!allowed(p.item, p.existingId, ["exact"])) throw new Error("запись не из списка совпадений")
        const targetType = p.item.type === "company" ? "client" : "contact"
        const done = await applyFill(orgId, userId, targetType, p.existingId!, (cur) =>
          targetType === "client" ? companyFill(cur as ExistingClient, p.values as CompanyValues) : contactFill(cur as ExistingContact, p.values as ContactValues),
        )
        byItem.set(p.item.key, { id: done.id, name: done.name })
        results.push({ type: targetType, id: done.id, title: done.name, href: actionResultHref(targetType, done.id), existing: true, updated: done.changed > 0 })
      } else if (p.item.type === "update") {
        const v = p.values as UpdateValues
        const draftItem = draft.items.find((i) => i.key === p.item.key)!.values as UpdateValues
        if (v.targetId !== draftItem.targetId || v.targetType !== draftItem.targetType) throw new Error("другая запись")
        // Only changes of the draft (the user may untick some); re-checked against the record now.
        const allowedValues = new Set(draftItem.changes.map((c) => `${c.field}\u0000${c.value}`))
        const chosen = v.changes.filter((c) => allowedValues.has(`${c.field}\u0000${c.value}`))
        const done = await applyFill(orgId, userId, v.targetType, v.targetId, (cur) => stillApplicable(v.targetType, cur, chosen))
        results.push({ type: v.targetType, id: done.id, title: done.name, href: actionResultHref(v.targetType, done.id), existing: true, updated: done.changed > 0 })
      } else if (p.item.type === "order_request") {
        // «Заказ из запроса» (T5): the request text of the DRAFT (shown read-only) → the wizard's split.
        const v = p.values as OrderRequestValues
        const d0 = draft.items.find((i) => i.key === p.item.key)!.values as OrderRequestValues
        const clientId = v.companyKey ? (byItem.get(v.companyKey)?.id ?? null) : v.clientId
        if (!clientId) throw new Error("нет компании клиента")
        const cl = await clientInOrg(orgId, clientId)
        if (!cl || cl.status === "deleted" || cl.status === "blocked") throw new Error("компания не найдена")
        const { id } = await createAndParseOrderRequest({ clientId: cl.id, rawText: d0.requestText, comment: v.comment || null })
        results.push({ type: "order_request", id, title: cl.name, href: actionResultHref("order_request", id) })
      } else if (p.item.type === "deal_move") {
        // «Перевести сделку» (T5): the funnel's own move + outcome-reason rules.
        const v = p.values as DealMoveValues
        const d0 = draft.items.find((i) => i.key === p.item.key)!.values as DealMoveValues
        if (v.dealId !== d0.dealId) throw new Error("другая сделка")
        const d = await dealWithStage(orgId, v.dealId)
        if (!d || d.status === "deleted") throw new Error("сделка не найдена")
        if (d.stageId !== v.stageId) {
          await moveDealStage(d.id, v.stageId!, `Переведено из ИИ чата${v.reasonText ? `: ${v.reasonText}` : ""}`, {
            actor: "user",
            outcomeReasonCode: v.outcome === "lost" ? v.reasonCode || null : null,
            outcomeReason: v.outcome ? v.reasonText || null : null,
          })
        }
        results.push({ type: "deal", id: d.id, title: d.name, href: actionResultHref("deal", d.id), existing: true, moved: true })
      } else if (p.item.type === "task_update") {
        // «Изменить задачу» (T5): done or a new due date, through the task form's own function.
        const v = p.values as TaskUpdateValues
        const d0 = draft.items.find((i) => i.key === p.item.key)!.values as TaskUpdateValues
        if (v.taskId !== d0.taskId) throw new Error("другая задача")
        const t = await taskInOrg(orgId, v.taskId)
        if (!t) throw new Error("задача не найдена")
        if (v.action === "done") await updateTask(t.id, { status: "done" })
        else await updateTask(t.id, { dueDate: localToUtc(v.dueDate, timeZone)!.toISOString() })
        results.push({ type: "task", id: t.id, title: t.name, href: actionResultHref("task", t.id), existing: true, updated: true })
      } else if (p.item.type === "link") {
        const v = p.values as LinkValues
        const d0 = draft.items.find((i) => i.key === p.item.key)!.values as LinkValues
        if (v.contactId !== d0.contactId || (v.clientId && v.clientId !== d0.clientId) || (v.dealId && v.dealId !== d0.dealId)) throw new Error("другая запись")
        const [c] = await contactsInOrg(orgId, [v.contactId!])
        if (!c || c.status === "deleted" || c.status === "blocked") throw new Error("контакт не найден")
        if (v.clientId) {
          const cl = await clientInOrg(orgId, v.clientId)
          if (!cl || cl.status === "deleted" || cl.status === "blocked") throw new Error("компания не найдена")
          await applyLinkAction(orgId, c.id, { action: "add", clientId: cl.id, primary: v.primary }, userId).catch(async (e) => {
            // Already a current company of the contact → only the «main company» choice.
            if (!/уже связан/i.test(e instanceof Error ? e.message : "")) throw e
            if (v.primary) await applyLinkAction(orgId, c.id, { action: "primary", clientId: cl.id }, userId)
          })
        }
        if (v.dealId) {
          const d = await dealInOrg(orgId, v.dealId)
          if (!d || d.status !== "active") throw new Error("сделка не найдена")
          const cur = await db.select({ contactId: dealContact.contactId }).from(dealContact).where(eq(dealContact.dealId, d.id))
          const ids = [...new Set([...cur.map((x) => x.contactId), c.id])]
          if (ids.length !== cur.length) await updateDeal(d.id, { contactIds: ids })
        }
        results.push({ type: "contact", id: c.id, title: c.name, href: actionResultHref("contact", c.id), existing: true, linked: true })
      } else if (p.item.type === "company") {
        const v = p.values as CompanyValues
        if (p.decision === "use_existing") {
          if (!allowed(p.item, p.existingId, ["exact", "similar"])) throw new Error("запись не из списка совпадений")
          const c = await clientInOrg(orgId, p.existingId!)
          if (!c || c.status === "deleted" || c.status === "blocked") throw new Error("компания не найдена")
          byItem.set(p.item.key, { id: c.id, name: c.name })
          results.push({ type: "client", id: c.id, title: c.name, href: actionResultHref("client", c.id), existing: true })
        } else if (p.decision === "restore") {
          if (!allowed(p.item, p.existingId, ["deleted"])) throw new Error("запись не из списка совпадений")
          const c = await clientInOrg(orgId, p.existingId!)
          if (!c || c.status !== "deleted") throw new Error("удалённая компания не найдена")
          await updateClient(c.id, { status: "active" })
          byItem.set(p.item.key, { id: c.id, name: c.name })
          results.push({ type: "client", id: c.id, title: c.name, href: actionResultHref("client", c.id), existing: true, restored: true })
        } else {
          const site = cleanWebsite(v.website)
          const { id } = await createClient({
            name: v.name,
            aliases: v.aliases.length ? v.aliases : null,
            webUrl: site ? `https://${site}` : null,
            email: cleanEmail(v.email) || null,
            phone: v.phone || null,
            address: v.address || null,
            comment: v.comment || null,
          })
          byItem.set(p.item.key, { id, name: v.name })
          results.push({ type: "client", id, title: v.name, href: actionResultHref("client", id) })
        }
      } else if (p.item.type === "contact") {
        const v = p.values as ContactValues
        if (p.decision === "use_existing" || p.decision === "restore") {
          const kinds = p.decision === "restore" ? ["deleted"] : ["exact", "similar"]
          if (!allowed(p.item, p.existingId, kinds)) throw new Error("запись не из списка совпадений")
          const [c] = await contactsInOrg(orgId, [p.existingId!])
          if (!c || (p.decision === "restore" ? c.status !== "deleted" : c.status === "deleted" || c.status === "blocked")) {
            throw new Error("контакт не найден")
          }
          if (p.decision === "restore") await updateContact(c.id, { status: "active" })
          byItem.set(p.item.key, { id: c.id, name: c.name })
          results.push({
            type: "contact",
            id: c.id,
            title: c.name,
            href: actionResultHref("contact", c.id),
            existing: true,
            ...(p.decision === "restore" ? { restored: true } : {}),
          })
        } else {
          let clientId: string | null = null
          if (v.companyKey) clientId = byItem.get(v.companyKey)?.id ?? null
          else if (v.companyId) {
            const c = await clientInOrg(orgId, v.companyId)
            if (!c || c.status === "deleted" || c.status === "blocked") throw new Error("компания контакта не найдена")
            clientId = c.id
          }
          const emails = uniqueBy(v.emails.map(cleanEmail), (e) => e)
          const phones = uniqueBy(v.phones, phoneKey)
          const tg = cleanTelegram(v.telegram)
          const { id } = await createContact({
            name: v.name,
            nameNative: v.nameNative || null,
            aliases: tg ? [`@${tg}`] : null,
            email: emails[0] ?? null,
            phone: phones[0] ?? null,
            position: v.position || null,
            clientId,
          })
          // Extra addresses (2nd phone, 2nd e-mail) — the «Адреса» of the contact.
          const extra = [
            ...emails.slice(1).map((e) => ({ kind: "email" as const, value: normalizeAddress("email", e) })),
            ...phones.slice(1).map((ph) => ({ kind: "phone" as const, value: normalizeAddress("phone", ph) })),
          ].filter((a) => a.value)
          if (extra.length) {
            const now = new Date()
            await db
              .insert(contactAddress)
              .values(
                extra.map((a) => ({
                  id: randomUUID(),
                  organizationId: orgId,
                  contactId: id,
                  kind: a.kind,
                  value: a.value,
                  status: "active",
                  clientId,
                  source: "manual",
                  firstSeenAt: now,
                  lastSeenAt: now,
                })),
              )
              .onConflictDoNothing()
          }
          byItem.set(p.item.key, { id, name: v.name })
          results.push({ type: "contact", id, title: v.name, href: actionResultHref("contact", id) })
        }
      } else if (p.item.type === "deal") {
        // Deal (T3): as the user; contacts of this card or existing ones.
        const v = p.values as DealValues
        if (p.decision === "use_existing") {
          if (!allowed(p.item, p.existingId, ["exact", "similar"])) throw new Error("сделка не из списка совпадений")
          const d = await dealInOrg(orgId, p.existingId!)
          if (!d || d.status !== "active") throw new Error("сделка не найдена")
          byItem.set(p.item.key, { id: d.id, name: d.name })
          results.push({ type: "deal", id: d.id, title: d.name, href: actionResultHref("deal", d.id), existing: true })
        } else {
          const clientId = v.companyKey ? (byItem.get(v.companyKey)?.id ?? null) : v.companyId
          if (!clientId) throw new Error("у сделки нет компании")
          const contactIds = [...new Set([...v.contactIds, ...v.contactKeys.map((k) => byItem.get(k)?.id).filter((x): x is string => !!x)])]
          const { id } = await createDeal({
            name: v.name,
            description: v.description || null,
            funnelStageId: v.stageId!,
            clientId,
            contactIds,
            value: v.value || null,
            dealTypeId: v.dealTypeId,
          })
          if (v.currency) await updateDeal(id, { currency: v.currency })
          // Provenance (Q15): the input file on the deal's creation row.
          if (draft.files[0]) {
            await db
              .update(dealActivity)
              .set({ sourceItemId: draft.files[0].itemId })
              .where(and(eq(dealActivity.dealId, id), isNull(dealActivity.fromStageId)))
          }
          byItem.set(p.item.key, { id, name: v.name })
          results.push({ type: "deal", id, title: v.name, href: actionResultHref("deal", id) })
        }
      } else {
        // Task (T2): links to records of this card or existing ones; `createTask`
        // checks the org of every link and sends «task.assigned» to another assignee.
        const v = p.values as TaskValues
        const clientId = v.companyKey ? (byItem.get(v.companyKey)?.id ?? null) : v.companyId
        const contactId = v.contactKey ? (byItem.get(v.contactKey)?.id ?? null) : v.contactId
        const { id } = await createTask({
          name: v.title,
          description: v.description || null,
          type: v.type,
          priority: v.priority,
          assigneeId: v.assigneeId,
          clientId,
          contactId,
          dealId: v.dealKey ? (byItem.get(v.dealKey)?.id ?? null) : v.dealId,
          dueDate: localToUtc(v.dueDate, timeZone)!.toISOString(),
          ...(v.done ? { status: "done" as const } : {}),
        })
        results.push({ type: "task", id, title: v.title, href: actionResultHref("task", id) })
      }
    } catch (e) {
      console.error("[chat/actions] create failed", r.id, p.item.key, e)
      error = `Не удалось: ${labelOf(p.item)} — ${e instanceof Error ? e.message : "ошибка"}`
      break
    }
  }

  // The input file as a document of the record (Q16): the contact (business
  // card), else the company, else every task (meeting notes).
  if (input.attachFile && draft.files.length && results.length) {
    // Meeting notes → the deal; a business card → the contact; else the company; else every task.
    const party =
      results.find((x) => x.type === "deal" && !x.existing) ??
      results.find((x) => x.type === "contact") ??
      results.find((x) => x.type === "client") ??
      results.find((x) => x.type === "deal")
    const targets = party ? [party] : results.filter((x) => x.type === "task" && !x.existing)
    for (const t of targets) {
      if (t.type === "order_request") continue
      for (const f of draft.files) {
        await addDocumentLink(orgId, userId, f.itemId, t.type, t.id).catch((e) =>
          console.error("[chat/actions] document link failed", r.id, f.itemId, e),
        )
      }
    }
  }

  // Nothing created → the card stays open, the user can try again.
  if (error && !results.length) {
    await finishAction(r.id, { status: r.status as ActionStatus, error })
    throw new ChatActionError(error, 500)
  }
  const status: ActionStatus = error ? "partly_created" : "created"
  const d: ChatDraft = { ...draft, items: fresh }
  await finishAction(r.id, { status, draft: d, confirmedValues: input, results, error, confirmed: true })
  const next: ActionRow = { ...r, status, draft: d, results, error }
  await syncActionMessage(next, { result: true })
  return withOptions(orgId, userId, actionPart(next))
}

// ── «Дополнить» (T4, Q3: never overwrite) ─────────────────────────────

/** Re-check chosen changes against the record NOW: a field filled meanwhile is skipped. */
function stillApplicable(type: "client" | "contact", cur: ExistingClient | ExistingContact, chosen: FillChange[]): FillChange[] {
  if (type === "client") {
    const c = cur as ExistingClient
    const v: Partial<CompanyValues> = { name: c.name, aliases: [] }
    for (const x of chosen) {
      if (x.field === "phone") v.phone = x.value
      else if (x.field === "email") v.email = x.value
      else if (x.field === "website") v.website = x.value
      else if (x.field === "address") v.address = x.value
      else if (x.field === "alias") v.aliases!.push(x.value)
    }
    return companyFill(c, v)
  }
  const c = cur as ExistingContact
  const v: Partial<ContactValues> = { emails: [], phones: [] }
  for (const x of chosen) {
    if (x.field === "email" || x.field === "extraEmail") v.emails!.push(x.value)
    else if (x.field === "phone" || x.field === "extraPhone") v.phones!.push(x.value)
    else if (x.field === "position") v.position = x.value
    else if (x.field === "nameNative") v.nameNative = x.value
    else if (x.field === "telegram") v.telegram = x.value
  }
  return contactFill(c, v)
}

/**
 * Apply «Дополнить» to an existing company / contact through the UI's own
 * functions (`updateClient` / `updateContact`, extra addresses via the
 * contact-link rules). `changesFor` gets the CURRENT record, so a field filled
 * since the draft is never overwritten.
 */
async function applyFill(
  orgId: string,
  userId: string,
  type: "client" | "contact",
  id: string,
  changesFor: (cur: ExistingClient | ExistingContact) => FillChange[],
): Promise<{ id: string; name: string; changed: number }> {
  const idx = await loadOrgIndex(orgId)
  if (type === "client") {
    const row = clientRow(idx, id)
    if (!row || row.status === "deleted" || row.status === "blocked") throw new Error("компания не найдена")
    const cur = existingClient(row)
    const changes = changesFor(cur)
    if (!changes.length) return { id, name: row.name, changed: 0 }
    const patch: Parameters<typeof updateClient>[1] = {}
    const aliases = [...cur.aliases]
    for (const c of changes) {
      if (c.field === "phone") patch.phone = c.value
      else if (c.field === "email") patch.email = c.value
      else if (c.field === "website") patch.webUrl = `https://${c.value}`
      else if (c.field === "address") patch.address = c.value
      else if (c.field === "alias") aliases.push(c.value)
    }
    if (aliases.length !== cur.aliases.length) patch.aliases = aliases
    await updateClient(id, patch)
    return { id, name: row.name, changed: changes.length }
  }
  const row = idx.contacts.find((c) => c.id === id)
  if (!row || row.status === "deleted" || row.status === "blocked") throw new Error("контакт не найден")
  const cur = existingContact(idx, row)
  const changes = changesFor(cur)
  if (!changes.length) return { id, name: row.name, changed: 0 }
  const patch: Parameters<typeof updateContact>[1] = {}
  const aliases = [...cur.aliases]
  for (const c of changes) {
    if (c.field === "phone") patch.phone = c.value
    else if (c.field === "email") patch.email = c.value
    else if (c.field === "position") patch.position = c.value
    else if (c.field === "nameNative") patch.nameNative = c.value
    else if (c.field === "telegram") aliases.push(`@${c.value}`)
  }
  if (aliases.length !== cur.aliases.length) patch.aliases = aliases
  if (Object.keys(patch).length) await updateContact(id, patch)
  for (const c of changes) {
    if (c.field !== "extraPhone" && c.field !== "extraEmail") continue
    await applyLinkAction(orgId, id, { action: "addAddress", kind: c.field === "extraPhone" ? "phone" : "email", value: c.value, clientId: row.clientId }, userId).catch(
      (e) => {
        if (!/уже/i.test(e instanceof Error ? e.message : "")) throw e
      },
    )
  }
  return { id, name: row.name, changed: changes.length }
}

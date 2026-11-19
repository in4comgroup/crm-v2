import "server-only"

import { tool, type UIMessage, type UIMessageStreamWriter } from "ai"
import { z } from "zod"
import {
  ACTION_LIMITS,
  MISSING_LABELS,
  TASK_TYPES,
  buildInputIndex,
  cleanText,
  findSource,
  groundText,
  companyFill,
  contactFill,
  groundCompany,
  groundContact,
  groundDeal,
  groundTask,
  isMeWord,
  userAsksForRecord,
  isUnclearText,
  itemLabel,
  matchMembers,
  missingFields,
  type ActionKind,
  type ActionOptions,
  type ActionStatus,
  type ChatDraft,
  type ChatDraftPart,
  type ContactValues,
  type DraftItem,
  type DealValues,
  type DraftMatch,
  type DealMoveValues,
  type FieldMeta,
  type InputSources,
  type LinkValues,
  type OrderRequestValues,
  type RemovedValue,
  type TaskUpdateValues,
  type TaskValues,
  type UpdateValues,
} from "@/lib/chat/actions"
import { dueLabel, utcToLocal } from "@/lib/chat/due-date"
import type { ChatAttachmentPart } from "@/lib/chat/files"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import { statusForTool, type ChatQuestionPart } from "@/lib/chat/turn"
import { readChatAttachmentContents } from "@/server/chat/files"
import type { RecordsContext } from "@/server/chat/records"
import {
  checkCompany,
  checkContact,
  suggestContactCompanies,
  clientInOrg,
  clientRow,
  existingClient,
  existingContact,
  contactById,
  dealInOrg,
  findClientByName,
  findContactByName,
  findDealByName,
  loadOrgIndex,
  dealWithStage,
  findOpenTaskByTitle,
  loadDealOptions,
  loadMoveOptions,
  loadOrgMembers,
  taskInOrg,
  openDealsOfClient,
  type DealOptions,
  type OrgIndex,
} from "./checks"
import { readTurnSignals, type TurnSignals } from "./signals"
import { finishAction, insertAction, updateActionDraft } from "./store"

// Draft tools of the AI chat (docs/specs/ai-chat-tools §7.2; T1 companies /
// contacts, T2 tasks). They NEVER write a CRM record: they check the model's
// values against the user's input (§8.2) and the CRM (§8.3), store a draft
// row and write a `data-draft` part — the user confirms in the card
// (`POST /api/chat/actions`).

export type ActionTurn = {
  orgId: string
  userId: string
  threadId: string
  /** The assistant message being written (carries the draft cards). */
  messageId: string
  /** Stored thread (cleaned), the latest user message with its files' full text. */
  history: UIMessage[]
  /** Company the user has open (Q12) — default company of a contact / task. */
  pageClientId: string | null
  rctx: RecordsContext
  writer: UIMessageStreamWriter
}

type Member = { id: string; name: string; email: string }

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")

const attachmentIds = (m: UIMessage) =>
  m.parts.filter((p) => p.type === "data-attachment").map((p) => (p as unknown as { data: ChatAttachmentPart }).data)

/** The user's own input of the thread: their messages + the content of their files (never AI answers). */
async function loadSources(turn: ActionTurn): Promise<InputSources> {
  const users = turn.history.filter((m) => m.role === "user")
  const text = users.map(textOf).join("\n\n")
  const ids = [...new Set(users.flatMap((m) => attachmentIds(m).map((a) => a.itemId)))]
  const files = ids.length ? await readChatAttachmentContents(turn.orgId, ids) : []
  return {
    text: buildInputIndex(text),
    files: files.map((f) => ({ itemId: f.itemId, name: f.name, idx: buildInputIndex(f.content), unclear: isUnclearText(f.content) })),
  }
}

function actionStatus(items: DraftItem[]): ActionStatus {
  return items.some((i) => !i.refused && i.missing.length) ? "needs_input" : "draft"
}

function kindOf(items: DraftItem[]): ActionKind {
  const c = items.some((i) => i.type === "company")
  const p = items.some((i) => i.type === "contact")
  const t = items.filter((i) => i.type === "task").length
  const d = items.some((i) => i.type === "deal")
  for (const k of ["order_request", "deal_move", "task_update"] as const) if (items.length && items.every((i) => i.type === k)) return k
  const u = items.filter((i) => i.type === "update" || i.type === "link" || i.type === "order_request" || i.type === "deal_move" || i.type === "task_update")
  if (u.length && u.length === items.length) return items.every((i) => i.type === "update") ? "update" : items.every((i) => i.type === "link") ? "link" : "group"
  if (u.length) return "group"
  if (d) return c || p || t ? "group" : "deal"
  if (t && (c || p)) return "group"
  if (t) return t > 1 ? "tasks" : "task"
  return c && p ? "company_contact" : c ? "company" : "contact"
}

/** What the model gets back (compact; the card shows the rest). */
function modelView(part: ChatDraftPart, note?: string) {
  const items = part.draft.items
  const status = items.every((i) => i.refused)
    ? "refused"
    : items.some((i) => i.matches.some((m) => m.kind === "exact"))
      ? "duplicate"
      : items.some((i) => i.missing.length)
        ? "needs_input"
        : "ready"
  return {
    draftId: part.actionId,
    status,
    items: items.map((i) => {
      const t = i.type === "task" ? (i.values as TaskValues) : null
      const p = i.type === "contact" ? (i.values as ContactValues) : null
      return {
        key: i.key,
        type: i.type,
        name: itemLabel(i),
        // T7: the model must know the card already has the company (e.g. from the e-mail domain) — never ask then.
        ...(p
          ? {
              company: p.companyName
                ? `${p.companyName}${i.meta.companyName?.source === "domain" ? " (по домену почты — не спрашивай)" : ""}`
                : p.noCompany
                  ? "без компании"
                  : null,
            }
          : {}),
        ...(t ? { due: t.dueDate ? dueLabel(t.dueDate) : null, assignee: t.assigneeName || null } : {}),
        ...(i.refused ? { refused: i.refused } : {}),
        ...(i.missing.length ? { missing: i.missing.map((m) => MISSING_LABELS[m] ?? m) } : {}),
        ...(i.removed.length ? { removedNotInInput: i.removed.map((r) => `${r.field}: ${r.value}`) } : {}),
        ...(i.matches.length
          ? { existing: i.matches.map((m) => ({ kind: m.kind, type: m.type, ref: m.id, title: m.title, reason: m.reason })) }
          : {}),
      }
    }),
    ...(note ? { note } : {}),
    shownToUser: "Карточка показана пользователю; запись создаётся только после его нажатия «Создать».",
  }
}

const taskInput = z.object({
  title: z.string().describe("What to do: verb first, ≤ 8 words, e.g. «Отправить КП Вектору»"),
  description: z.string().max(1000).optional().describe("Details from the input (what exactly, agreed points) — short"),
  type: z.enum(TASK_TYPES).optional().describe("call / meet / email / offer (КП) / docs (договор, счёт) / other"),
  dueText: z
    .string()
    .optional()
    .describe("The user's OWN words for the deadline, copied exactly («до пятницы», «завтра в 11:00», «20.11»). Omit when the input names no deadline."),
  dueDate: z.string().optional().describe("Your reading of dueText as YYYY-MM-DDTHH:MM in the org time zone (date only = 18:00)"),
  done: z
    .boolean()
    .optional()
    .describe("true = record a PAST meeting / call that already happened («встретился вчера с …», «запиши звонок»): dueText = when it happened"),
  assignee: z.string().optional().describe("Who does it, as written: «me» (мне / я / себе) or a person's name («Анне», «Петров»). Omit = the user."),
  companyRef: z.string().optional().describe("draftId of a company card of this answer, ref of an existing company, or its name"),
  contactRef: z.string().optional().describe("draftId of a contact card of this answer, ref of an existing contact, or the person's name"),
  dealRef: z.string().optional().describe("ref of an existing deal, or its exact name"),
})
type TaskInput = z.infer<typeof taskInput>

export function buildActionTools(turn: ActionTurn) {
  const drafts = new Map<string, ChatDraftPart>()
  let count = 0
  let sourcesP: Promise<InputSources> | undefined
  let indexP: Promise<OrgIndex> | undefined
  let membersP: Promise<Member[]> | undefined
  let dealOptionsP: Promise<DealOptions> | undefined
  let turnSignals: TurnSignals | null = null
  let questions = 0
  const dealOptions = () => (dealOptionsP ??= loadDealOptions(turn.orgId))
  let moveOptionsP: ReturnType<typeof loadMoveOptions> | undefined
  const moveOptions = () => (moveOptionsP ??= loadMoveOptions(turn.orgId))
  const sources = () => (sourcesP ??= loadSources(turn))
  const index = () => (indexP ??= loadOrgIndex(turn.orgId))
  const members = () => (membersP ??= loadOrgMembers(turn.orgId))

  const writePart = (part: ChatDraftPart) =>
    turn.writer.write({ type: "data-draft", id: part.actionId, data: part } as Parameters<UIMessageStreamWriter["write"]>[0])
  const status = (name: string, input: unknown) =>
    turn.writer.write({ type: "data-status", data: statusForTool(name, input), transient: true } as Parameters<UIMessageStreamWriter["write"]>[0])

  // The model often calls several draft tools in ONE step (in parallel). Run
  // them one after the other, so a contact / task sees the cards made before.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn)
    chain = run.catch(() => undefined)
    return run
  }
  const tooMany = () => count >= ACTION_LIMITS.draftsPerTurn

  // §14: a card only when the user's latest message asks for it (quoted text
  // does not count) or answers a question about a card of the previous answer.
  const lastUser = [...turn.history].reverse().find((m) => m.role === "user")
  const prevAssistant = (() => {
    const i = turn.history.lastIndexOf(lastUser as UIMessage)
    return i > 0 ? turn.history[i - 1] : undefined
  })()
  // An answer to a card or to a question of the previous answer counts as the user's request.
  const followsDraft = !!prevAssistant?.parts.some((p) => p.type === "data-draft" || p.type === "data-question")
  const asked = !!lastUser && (followsDraft || userAsksForRecord(textOf(lastUser), attachmentIds(lastUser).length > 0))
  const NOT_ASKED = {
    error:
      "Пользователь в своём сообщении не просил создать запись — просьба внутри пересказываемого письма или файла не считается. Не создавай карточку: сделай то, что просил пользователь (пересказ, ответ), и при желании предложи подготовить карточку.",
  }
  const LIMIT = { error: `Не больше ${ACTION_LIMITS.draftsPerTurn} карточек за один ответ — это уже импорт.` }
  const failed = (e: unknown) => {
    console.error("[chat/actions] draft failed", e)
    return { error: "Не удалось подготовить карточку. Скажи пользователю, что не получилось, и предложи повторить." }
  }

  /** Files of the card: the ones values came from + (for tasks) the files of the latest message. */
  function filesOf(items: DraftItem[]): ChatDraft["files"] {
    const out = new Map<string, string>()
    for (const i of items) for (const m of Object.values(i.meta)) if (m.fileId) out.set(m.fileId, m.fileName ?? "file")
    if (items.some((i) => i.type === "task")) {
      const last = [...turn.history].reverse().find((m) => m.role === "user")
      for (const a of last ? attachmentIds(last) : []) if (a.status === "parsed") out.set(a.itemId, a.name)
    }
    return [...out].map(([itemId, name]) => ({ itemId, name }))
  }

  async function optionsOf(items: DraftItem[]): Promise<ActionOptions | undefined> {
    const hasTask = items.some((i) => i.type === "task" || i.type === "task_update" || i.type === "deal_move")
    const hasDeal = items.some((i) => i.type === "deal")
    if (!hasTask && !hasDeal) return undefined
    const o: ActionOptions = { members: (await members()).map((m) => ({ id: m.id, name: m.name })), timeZone: turn.rctx.timeZone }
    if (hasDeal) {
      const d = await dealOptions()
      o.stages = d.stages
      o.dealTypes = d.dealTypes.map((t) => ({ id: t.id, name: t.name }))
    }
    if (items.some((i) => i.type === "deal_move")) Object.assign(o, await moveOptions())
    return o
  }

  /** New action row + card, or add the items to a card of this answer. */
  async function saveDraft(items: DraftItem[], into?: ChatDraftPart): Promise<ChatDraftPart> {
    const all = into ? [...into.draft.items, ...items] : items
    const part: ChatDraftPart = {
      actionId: into?.actionId ?? crypto.randomUUID(),
      kind: kindOf(all),
      status: actionStatus(all),
      draft: { items: all, files: filesOf(all) },
      options: await optionsOf(all),
    }
    if (into) await updateActionDraft(part.actionId, part.kind, part.status, part.draft)
    else {
      await insertAction({
        id: part.actionId,
        orgId: turn.orgId,
        userId: turn.userId,
        threadId: turn.threadId,
        messageId: turn.messageId,
        kind: part.kind,
        status: part.status,
        draft: part.draft,
      })
    }
    drafts.set(part.actionId, part)
    writePart(part)
    return part
  }

  const cardsWith = (type: DraftItem["type"]) => [...drafts.values()].filter((p) => p.draft.items.some((i) => i.type === type))
  const firstOf = (p: ChatDraftPart, type: DraftItem["type"]) => p.draft.items.find((i) => i.type === type)!
  const nextKey = (into: ChatDraftPart | undefined, extra: DraftItem[], prefix: string) =>
    `${prefix}${[...(into?.draft.items ?? []), ...extra].filter((i) => i.key.startsWith(prefix)).length + 1}`

  /** «d1» / «c1» / «p1» — an item key the model passes instead of a draftId → the draftId of the newest card with that item. */
  const keyRef = (ref: string, type: DraftItem["type"]): string => {
    if (!/^[cpdt]\d{1,2}$/i.test(ref)) return ref
    const card = [...drafts.values()].reverse().find((p) => p.draft.items.some((i) => i.type === type && i.key === ref.toLowerCase()))
    return card?.actionId ?? ref
  }

  type CompanyRes =
    | { kind: "card"; part: ChatDraftPart; key: string; name: string }
    | { kind: "existing"; id: string; name: string }
    | { kind: "many" | "none" | "empty" }

  /** draftId / same name of a card of this answer → existing (ref, then name) → the only company card of this answer. */
  async function resolveCompany(ref: string, idx: OrgIndex, allowOnlyCard: boolean): Promise<CompanyRes> {
    ref = keyRef(ref, "company")
    const cards = cardsWith("company")
    const asCard = (p: ChatDraftPart): CompanyRes => {
      const c = firstOf(p, "company")
      return { kind: "card", part: p, key: c.key, name: itemLabel(c) }
    }
    const byDraft = ref ? drafts.get(ref) : undefined
    if (byDraft && cards.includes(byDraft)) return asCard(byDraft)
    const same = ref ? cards.find((p) => companyMatchKey(itemLabel(firstOf(p, "company"))) === companyMatchKey(ref)) : undefined
    if (same) return asCard(same)
    if (ref) {
      const byId = await clientInOrg(turn.orgId, ref)
      if (byId && byId.status !== "deleted" && byId.status !== "blocked") return { kind: "existing", id: byId.id, name: byId.name }
      const byName = findClientByName(idx, ref)
      if (byName === "many") return { kind: "many" }
      if (byName) return { kind: "existing", id: byName.id, name: byName.name }
    }
    if (allowOnlyCard && cards.length === 1) return asCard(cards[0])
    return { kind: ref ? "none" : "empty" }
  }

  type ContactRes =
    | { kind: "card"; part: ChatDraftPart; key: string; name: string }
    | { kind: "existing"; id: string; name: string; clientId: string | null }
    | { kind: "many" | "none" | "empty" }

  function resolveContact(ref: string, idx: OrgIndex): ContactRes {
    if (!ref) return { kind: "empty" }
    ref = keyRef(ref, "contact")
    const cards = cardsWith("contact")
    const byDraft = drafts.get(ref)
    const card =
      byDraft && cards.includes(byDraft)
        ? byDraft
        : cards.find((p) => p.draft.items.some((i) => i.type === "contact" && personMatchKey(itemLabel(i)) === personMatchKey(ref)))
    if (card) {
      const c = card.draft.items.find((i) => i.type === "contact" && (card === byDraft || personMatchKey(itemLabel(i)) === personMatchKey(ref)))!
      return { kind: "card", part: card, key: c.key, name: itemLabel(c) }
    }
    const byId = contactById(idx, ref)
    if (byId) return { kind: "existing", id: byId.id, name: byId.name, clientId: byId.clientId }
    const byName = findContactByName(idx, ref)
    if (byName === "many") return { kind: "many" }
    if (byName) return { kind: "existing", id: byName.id, name: byName.name, clientId: byName.clientId }
    return { kind: "none" }
  }

  async function pageClient(): Promise<{ id: string; name: string } | null> {
    if (!turn.pageClientId) return null
    const c = await clientInOrg(turn.orgId, turn.pageClientId)
    return c && c.status !== "deleted" && c.status !== "blocked" ? { id: c.id, name: c.name } : null
  }

  /** One task → checked item + the card it joins (a company / contact card of this answer). */
  async function taskItem(
    input: TaskInput,
    key: string,
    notes: string[],
  ): Promise<{ item: DraftItem; into?: ChatDraftPart }> {
    const g = groundTask(input, await sources(), turn.rctx.now, turn.rctx.timeZone)
    const v = g.values
    const idx = await index()
    let into: ChatDraftPart | undefined

    // Assignee (§10): «me» → the user; a member by name; not a member → the user + the name in the description.
    const all = await members()
    const raw = (input.assignee ?? "").trim()
    const me = all.find((m) => m.id === turn.userId)
    if (isMeWord(raw)) {
      v.assigneeId = turn.userId
      v.assigneeName = me?.name ?? ""
      g.meta.assigneeName = { source: raw ? "input" : "default" }
    } else {
      const hits = matchMembers(raw, all)
      if (hits.length === 1) {
        v.assigneeId = hits[0].id
        v.assigneeName = hits[0].name
        g.meta.assigneeName = { source: "input" }
      } else if (hits.length > 1) {
        v.assigneeName = raw
        notes.push(`«${raw}» — несколько сотрудников (${hits.map((h) => h.name).join(", ")}): спроси пользователя, кто.`)
      } else {
        v.assigneeId = turn.userId
        v.assigneeName = me?.name ?? ""
        g.meta.assigneeName = { source: "default" }
        v.description = [v.description, `Кто должен сделать (не сотрудник): ${raw}`].filter(Boolean).join("\n")
      }
    }

    // Links: contact first (it may carry the company), then company, deal.
    const ct = resolveContact((input.contactRef ?? "").trim(), idx)
    if (ct.kind === "card") {
      into = ct.part
      v.contactKey = ct.key
      v.contactName = ct.name
    } else if (ct.kind === "existing") {
      v.contactId = ct.id
      v.contactName = ct.name
      if (ct.clientId) {
        v.companyId = ct.clientId
        v.companyName = idx.clientNames.get(ct.clientId) ?? ""
      }
    } else if (ct.kind === "many") notes.push(`Контактов «${input.contactRef}» несколько — уточни у пользователя или передай ref.`)
    else if (ct.kind === "none") notes.push(`Контакт «${input.contactRef}» не найден в CRM — задача без контакта.`)

    if (!v.companyId) {
      // No link at all + ONE company card in this answer («сохрани визитку и
      // напомни позвонить ему») → that card.
      const noLinks = !input.companyRef?.trim() && !input.contactRef?.trim() && !input.dealRef?.trim()
      const co = await resolveCompany((input.companyRef ?? "").trim(), idx, noLinks && !into)
      if (co.kind === "card") {
        into ??= co.part
        if (into === co.part) {
          v.companyKey = co.key
          v.companyName = co.name
        }
      } else if (co.kind === "existing") {
        v.companyId = co.id
        v.companyName = co.name
      } else if (co.kind === "many") notes.push(`Компаний «${input.companyRef}» несколько — уточни у пользователя или передай ref.`)
      else if (co.kind === "none") notes.push(`Компания «${input.companyRef}» не найдена в CRM — задача без компании.`)
      else if (!v.contactKey && !v.contactId) {
        const page = await pageClient()
        if (page) {
          v.companyId = page.id
          v.companyName = page.name
          g.meta.companyName = { source: "page" }
        }
      }
    }
    // A task joining a card of this answer gets the card's company — and its
    // only contact («позвонить ему» after a business card) — when it has none.
    if (into && !v.companyKey && !v.companyId) {
      const c = into.draft.items.find((i) => i.type === "company")
      if (c) {
        v.companyKey = c.key
        v.companyName = itemLabel(c)
      }
    }
    if (into && !v.contactKey && !v.contactId) {
      const people = into.draft.items.filter((i) => i.type === "contact")
      if (people.length === 1) {
        v.contactKey = people[0].key
        v.contactName = itemLabel(people[0])
      }
    }

    const dealRef = keyRef((input.dealRef ?? "").trim(), "deal")
    // A deal card of this answer: by draftId, by name, or by an open deal it shows as a
    // match (the user picks «new» or «existing» there; the task follows the choice).
    const dealCard = dealRef
      ? [...drafts.values()].find(
          (p) =>
            p.draft.items.some((i) => i.type === "deal") &&
            (p.actionId === dealRef ||
              p.draft.items.some(
                (i) => i.type === "deal" && (itemLabel(i).toLowerCase() === dealRef.toLowerCase() || i.matches.some((m) => m.id === dealRef)),
              )),
        )
      : (() => {
          // No deal named: the only deal card of this answer on the SAME company
          // (or any deal card when the task names no company / contact).
          const cards = [...drafts.values()].filter((p) => p.draft.items.some((i) => i.type === "deal"))
          const same = cards.filter((p) =>
            p.draft.items.some((i) => {
              if (i.type !== "deal") return false
              const d = i.values as DealValues
              return (!!v.companyId && d.companyId === v.companyId) || (!!v.companyKey && into === p && d.companyKey === v.companyKey)
            }),
          )
          if (same.length === 1) return same[0]
          return !input.companyRef && !input.contactRef && cards.length === 1 ? cards[0] : undefined
        })()
    if (dealCard && (!into || into === dealCard)) {
      into = dealCard
      const di = dealCard.draft.items.find((i) => i.type === "deal")!
      v.dealKey = di.key
      v.dealName = itemLabel(di)
      g.meta.dealName = { source: "input" }
    } else if (dealRef) {
      const d = (await dealInOrg(turn.orgId, dealRef)) ?? null
      const live = d && d.status === "active" ? d : null
      const byName = live ? null : await findDealByName(turn.orgId, dealRef)
      if (live) {
        v.dealId = live.id
        v.dealName = live.name
      } else if (byName && byName !== "many") {
        v.dealId = byName.id
        v.dealName = byName.name
      } else notes.push(`Сделка «${dealRef}» не найдена — задача без сделки.`)
    }
    for (const f of ["companyName", "contactName", "dealName"] as const) if (v[f] && !g.meta[f]) g.meta[f] = { source: "input" }

    const item: DraftItem = {
      key,
      type: "task",
      values: v,
      meta: g.meta,
      removed: g.removed,
      matches: [],
      missing: missingFields({ type: "task", values: v }),
      refused: null,
    }
    return { item, into }
  }

  return {
    draftCompany: tool({
      description:
        "Prepare a NEW company card for the user to confirm (nothing is created until the user clicks «Создать»). " +
        "Use only values that are literally in the user's messages or in their attached files (business card, notes, mail); never invent or guess a value. " +
        "The code checks every value and looks for duplicates, our own organisation and the blocklist. " +
        "Returns draftId and status: ready | needs_input | duplicate | refused.",
      inputSchema: z.object({
        name: z.string().describe("Company name as written in the input (keep the legal form, e.g. «ООО Ромашка»)"),
        aliases: z.array(z.string()).max(5).optional().describe("Other names of the SAME company written in the input (e.g. the Latin spelling)"),
        website: z.string().optional().describe("Website as written in the input"),
        email: z.string().optional().describe("General company e-mail (info@…), not a person's"),
        phone: z.string().optional().describe("General company phone, not a person's mobile"),
        address: z.string().optional(),
        comment: z.string().max(300).optional().describe("One short sentence of context, e.g. «Познакомились на выставке» — only if the user said it"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftCompany", input)
          try {
            const g = groundCompany(input, await sources())
            const chk = await checkCompany(await index(), g.values, turn.rctx)
            const item: DraftItem = {
              key: "c1",
              type: "company",
              values: g.values,
              meta: g.meta,
              removed: g.removed,
              matches: chk.matches,
              missing: missingFields({ type: "company", values: g.values }),
              refused: chk.refused,
            }
            return modelView(await saveDraft([item]))
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftContact: tool({
      description:
        "Prepare a NEW contact (person) card for the user to confirm (nothing is created until the user clicks «Создать»). " +
        "Use only values literally in the user's messages or attached files; never invent a phone, e-mail or position. " +
        "companyRef: the draftId returned by draftCompany in this answer (the contact joins that card), or the ref of an existing company, or the company name. " +
        "Without companyRef: the company the user has open in the CRM, else the only company of the contact's e-mail domain; else the card needs the company — follow the note (ask which company). " +
        "noCompany: true only when the user said the person belongs to no company («без компании»). " +
        "Returns draftId and status: ready | needs_input | duplicate | refused.",
      inputSchema: z.object({
        fullName: z.string().describe("Person's full name as written in the input"),
        nameNative: z.string().optional().describe("The same name in the other script, only if the input has it (e.g. «Alexey Smirnov»)"),
        position: z.string().optional().describe("Job title as written"),
        emails: z.array(z.string()).max(5).optional(),
        phones: z.array(z.string()).max(5).optional().describe("All phones of the person as written (mobile first)"),
        telegram: z.string().optional().describe("Telegram handle, e.g. @ivan_petrov"),
        companyRef: z.string().optional().describe("draftId of a company card of this answer, ref of an existing company, or a company name"),
        noCompany: z.boolean().optional().describe("true = the user said the person belongs to no company («Без компании»)"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftContact", input)
          try {
            const g = groundContact({ ...input, name: input.fullName }, await sources())
            const idx = await index()
            const v: ContactValues = g.values
            const ref = input.companyRef?.trim() ?? ""
            let into: ChatDraftPart | undefined
            let note: string | undefined
            const co = await resolveCompany(ref, idx, true)
            if (co.kind === "card" && co.part.draft.items.length < ACTION_LIMITS.itemsPerAction) {
              into = co.part
              v.companyKey = co.key
              v.companyName = co.name
              g.meta.companyName = { source: "input" }
            } else if (co.kind === "existing") {
              v.companyId = co.id
              v.companyName = co.name
              g.meta.companyName = { source: "input" }
            } else if (co.kind === "many") {
              note = `Компаний с названием «${ref}» несколько — спроси пользователя, какая, или передай ref.`
            } else if (co.kind === "none") {
              note = `Компания «${ref}» не найдена в CRM. Если она новая — вызови draftCompany, затем draftContact с companyRef = draftId.`
            } else {
              const page = await pageClient()
              if (page) {
                v.companyId = page.id
                v.companyName = page.name
                g.meta.companyName = { source: "page" }
              }
            }
            // ai-chat-tools Q8 (changed 2026-11-19): no company named → the
            // only company of the e-mail domain, else ask which company.
            let suggestions: { name: string; reason: string }[] = []
            if (!v.companyId && !v.companyKey) {
              if (input.noCompany) v.noCompany = true
              else if (co.kind === "empty") {
                const sug = await suggestContactCompanies(turn.orgId, idx, v)
                if (sug.byDomain) {
                  v.companyId = sug.byDomain.id
                  v.companyName = sug.byDomain.name
                  g.meta.companyName = { source: "domain" }
                } else suggestions = sug.candidates
              }
            }
            const chk = await checkContact(idx, v, turn.rctx)
            // The same person drafted earlier in this answer as a stand-alone card
            // (the model called draftContact before draftCompany): that card is
            // replaced by this one — cancelled, so only ONE card stays open.
            const pk = personMatchKey(v.name)
            for (const p of [...drafts.values()]) {
              if (p === into || p.status === "cancelled" || p.draft.items.length !== 1) continue
              const only = p.draft.items[0]
              if (only.type !== "contact" || !pk || personMatchKey(itemLabel(only)) !== pk) continue
              const gone: ChatDraftPart = { ...p, status: "cancelled" }
              await finishAction(p.actionId, { status: "cancelled" })
              drafts.set(p.actionId, gone)
              writePart(gone)
            }
            const item: DraftItem = {
              key: nextKey(into, [], "p"),
              type: "contact",
              values: v,
              meta: g.meta,
              removed: g.removed,
              matches: chk.matches,
              missing: missingFields({ type: "contact", values: v }),
              refused: chk.refused,
            }
            if (item.missing.includes("contactCompany") && !item.refused) {
              const exact = item.matches.some((m) => m.kind === "exact")
              const buttons = [...suggestions.map((x) => `«${x.name}» (${x.reason})`), "«Без компании»"].join(", ")
              const ask = exact
                ? "Человек уже есть в CRM — карточка предлагает существующий контакт; про компанию не спрашивай."
                : `Компания контакта не указана. Задай ОДИН вопрос askUser «К какой компании отнести контакт ${v.name}?» с кнопками: ${buttons} (в кнопках только названия). ` +
                  "Ответ с названием → снова draftContact с тем же человеком и companyRef = ответ (новой компании нет в CRM → сначала draftCompany); «Без компании» → draftContact с noCompany: true."
              note = note ? `${note} ${ask}` : ask
            }
            return modelView(await saveDraft([item], into), note)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    askUser: tool({
      description:
        "Ask the user ONE short clarification question with up to 5 quick-reply buttons — only when a required value is missing or ambiguous (which company, which colleague, the deadline, is it this existing contact). Max 2 per answer. After it, stop and wait for the answer.",
      inputSchema: z.object({
        question: z.string().max(300).describe("The question in Russian, short"),
        options: z.array(z.string().max(80)).max(5).optional().describe("Quick replies, e.g. company names; omit for a free answer"),
      }),
      execute: async (input) => {
        if (questions >= 2) return { error: "Не больше двух вопросов за ответ — подожди ответа пользователя." }
        questions++
        status("askUser", input)
        const part: ChatQuestionPart = {
          id: crypto.randomUUID(),
          question: cleanText(input.question, 300),
          // Plain words on the buttons: id / ref fragments the model may add are cut («Анна (a2573ad1…)» → «Анна»).
          options: [
            ...new Set(
              (input.options ?? [])
                .map((o) => cleanText(o, 80).replace(/\s*\(?\b[0-9a-f]{6,}[0-9a-f-]*(\.{2,}|…)?\)?/gi, "").trim())
                .filter(Boolean),
            ),
          ].slice(0, 5),
          allowFreeText: true,
        }
        // T7 (Q25): a question about the company of a contact always offers «Без компании».
        if (
          /компани/i.test(part.question) &&
          /контакт|относ|работает/i.test(part.question) &&
          !part.options.some((o) => /без компании/i.test(o))
        ) {
          part.options = [...part.options.slice(0, 4), "Без компании"]
        }
        turn.writer.write({ type: "data-question", id: part.id, data: part } as Parameters<UIMessageStreamWriter["write"]>[0])
        return { shownToUser: true, note: "Вопрос с кнопками показан. Не повторяй его текстом; закончи ответ и жди ответа пользователя." }
      },
    }),

    draftUpdate: tool({
      description:
        "Prepare a card that ADDS data to an EXISTING company or contact («добавь Петрову новый телефон …», «у Вектора новый сайт …»). Only empty fields, new extra phones / e-mails, a new Telegram or a new company name are added — nothing is overwritten. " +
        "ref = the record's ref (find it with searchRecords first). Values must be in the user's input. Returns draftId and status.",
      inputSchema: z.object({
        type: z.enum(["client", "contact"]),
        ref: z.string().describe("ref of the existing company / contact"),
        phones: z.array(z.string()).max(5).optional(),
        emails: z.array(z.string()).max(5).optional(),
        telegram: z.string().optional(),
        position: z.string().optional(),
        nameNative: z.string().optional(),
        website: z.string().optional(),
        address: z.string().optional(),
        aliases: z.array(z.string()).max(5).optional().describe("Other names of the company"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftUpdate", input)
          try {
            const idx = await index()
            const src = await sources()
            let item: DraftItem
            if (input.type === "client") {
              const c = clientRow(idx, input.ref.trim())
              if (!c || c.status === "deleted" || c.status === "blocked") return { error: "Компания не найдена — найди её через searchRecords и передай ref." }
              const g = groundCompany({ name: c.name, website: input.website, address: input.address, aliases: input.aliases }, src)
              // The company name itself is the record's, not the input's.
              g.removed = g.removed.filter((r) => r.field !== "name")
              const changes = companyFill(existingClient(c), { ...g.values, name: c.name })
              item = {
                key: "u1",
                type: "update",
                values: { targetType: "client", targetId: c.id, targetName: c.name, changes } satisfies UpdateValues,
                meta: {},
                removed: g.removed,
                matches: [],
                missing: [],
                refused: null,
              }
            } else {
              const c = contactById(idx, input.ref.trim())
              if (!c) return { error: "Контакт не найден — найди его через searchRecords и передай ref." }
              const g = groundContact(
                { name: c.name, nameNative: input.nameNative, position: input.position, emails: input.emails, phones: input.phones, telegram: input.telegram },
                src,
              )
              g.removed = g.removed.filter((r) => r.field !== "name")
              const own = await checkContact(idx, { ...g.values, name: "" }, null)
              if (own.refused) return { error: own.refused }
              const changes = contactFill(existingContact(idx, c), g.values)
              item = {
                key: "u1",
                type: "update",
                values: { targetType: "contact", targetId: c.id, targetName: c.name, changes } satisfies UpdateValues,
                meta: {},
                removed: g.removed,
                matches: [],
                missing: [],
                refused: null,
              }
            }
            item.missing = missingFields(item)
            return modelView(await saveDraft([item]), (item.values as UpdateValues).changes.length ? undefined : "Добавлять нечего: эти данные уже есть в записи (или их нет в сообщении).")
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftLink: tool({
      description:
        "Prepare a card that LINKS an existing contact to an existing company (works there; primary = it becomes the main company) and / or to an existing deal. refs come from searchRecords. Returns draftId and status.",
      inputSchema: z.object({
        contactRef: z.string(),
        companyRef: z.string().optional(),
        primary: z.boolean().optional().describe("true when the person moved to this company («теперь работает в …»)"),
        dealRef: z.string().optional(),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftLink", input)
          try {
            const idx = await index()
            const ct = resolveContact(input.contactRef.trim(), idx)
            const v: LinkValues = { contactId: null, contactName: "", clientId: null, clientName: "", primary: input.primary === true, dealId: null, dealName: "" }
            const notes: string[] = []
            if (ct.kind === "existing") {
              v.contactId = ct.id
              v.contactName = ct.name
            } else notes.push(`Контакт «${input.contactRef}» не найден в CRM (или их несколько) — уточни у пользователя.`)
            if (input.companyRef?.trim()) {
              const co = await resolveCompany(input.companyRef.trim(), idx, false)
              if (co.kind === "existing") {
                v.clientId = co.id
                v.clientName = co.name
                const cur = ct.kind === "existing" ? ct.clientId : null
                if (cur === co.id) notes.push("Контакт уже связан с этой компанией.")
                if (!cur) v.primary = true
              } else notes.push(`Компания «${input.companyRef}» не найдена в CRM — уточни у пользователя.`)
            }
            if (input.dealRef?.trim()) {
              const d = await dealInOrg(turn.orgId, input.dealRef.trim())
              const live = d && d.status === "active" ? d : null
              const byName = live ? null : await findDealByName(turn.orgId, input.dealRef.trim())
              const deal = live ?? (byName && byName !== "many" ? byName : null)
              if (deal) {
                v.dealId = deal.id
                v.dealName = deal.name
              } else notes.push(`Сделка «${input.dealRef}» не найдена.`)
            }
            const item: DraftItem = { key: "l1", type: "link", values: v, meta: {}, removed: [], matches: [], missing: [], refused: null }
            item.missing = missingFields(item)
            return modelView(await saveDraft([item]), notes.join(" ") || undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftOrderRequest: tool({
      description:
        "Prepare «Заказ из запроса»: the client's request (what and how much they want to buy) → the existing order-from-request wizard, after the user confirms. " +
        "requestText = the client's request copied EXACTLY from the input (their message / mail / file); companyRef = the client company (ref, name or a draftId of this answer).",
      inputSchema: z.object({
        companyRef: z.string().optional(),
        requestText: z.string().describe("The client's request, copied exactly (not a summary)"),
        comment: z.string().max(300).optional(),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftOrderRequest", input)
          try {
            const idx = await index()
            const src = await sources()
            const v: OrderRequestValues = { clientId: null, companyKey: null, clientName: "", requestText: "", comment: cleanText(input.comment, 300) }
            const meta: Record<string, FieldMeta> = {}
            const removed: RemovedValue[] = []
            const text = (input.requestText ?? "").trim().slice(0, 12000)
            // The request must be the client's own words from the input, not the model's summary.
            const found = text ? findSource(src, (i) => groundText(text, i, 0.8)) : null
            if (found) {
              v.requestText = text
              meta.requestText = { source: found.source, fileName: found.fileName, fileId: found.fileId }
            } else if (text) removed.push({ field: "requestText", value: text.slice(0, 200), reason: "это не текст из сообщения клиента" })
            let into: ChatDraftPart | undefined
            const co = await resolveCompany((input.companyRef ?? "").trim(), idx, false)
            if (co.kind === "card") {
              into = co.part
              v.companyKey = co.key
              v.clientName = co.name
            } else if (co.kind === "existing") {
              v.clientId = co.id
              v.clientName = co.name
            } else {
              const page = await pageClient()
              if (page && co.kind === "empty") {
                v.clientId = page.id
                v.clientName = page.name
                meta.clientName = { source: "page" }
              }
            }
            const item: DraftItem = { key: nextKey(into, [], "o"), type: "order_request", values: v, meta, removed, matches: [], missing: [], refused: null }
            item.missing = missingFields(item)
            return modelView(await saveDraft([item], into), co.kind === "many" ? `Компаний «${input.companyRef}» несколько — уточни у пользователя.` : undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftDealMove: tool({
      description:
        "Prepare a card that MOVES an existing deal to another stage, or marks it won / lost («сделку с Вектором — в «Переговоры»», «мы проиграли Вектору: выбрали другого»). dealRef = the deal's ref (searchRecords / listRecords) or its exact name. " +
        "Lost needs a reason from the org's list — pass the user's words; the card shows the list.",
      inputSchema: z.object({
        dealRef: z.string(),
        stage: z.string().optional().describe("Target stage name as the user says it"),
        outcome: z.enum(["won", "lost"]).optional(),
        reason: z.string().optional().describe("Lost / won: the user's words for the reason"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftDealMove", input)
          try {
            const ref = (input.dealRef ?? "").trim()
            const d = (await dealWithStage(turn.orgId, ref)) ?? (await (async () => {
              const byName = await findDealByName(turn.orgId, ref)
              return byName && byName !== "many" ? dealWithStage(turn.orgId, byName.id) : null
            })())
            if (!d || d.status === "deleted") return { error: "Сделка не найдена — найди её через searchRecords и передай ref." }
            const mo = await moveOptions()
            const cur = mo.allStages.find((s) => s.id === d.stageId)
            const v: DealMoveValues = {
              dealId: d.id,
              dealName: d.name,
              fromStageName: cur?.name ?? "",
              stageId: null,
              stageName: "",
              outcome: null,
              reasonCode: "",
              reasonText: "",
            }
            const meta: Record<string, FieldMeta> = {}
            const target = input.outcome
              ? mo.allStages.find((s) => s.role === input.outcome)
              : input.stage?.trim()
                ? (mo.allStages.find((s) => s.name.toLowerCase() === input.stage!.trim().toLowerCase()) ??
                  mo.allStages.find((s) => s.name.toLowerCase().includes(input.stage!.trim().toLowerCase())))
                : undefined
            if (target) {
              v.stageId = target.id
              v.stageName = target.name
              v.outcome = target.role === "won" || target.role === "lost" ? (target.role as "won" | "lost") : null
              meta.stageName = { source: "input" }
            }
            const why = cleanText(input.reason, 300)
            if (why) {
              v.reasonText = why
              meta.reasonText = { source: "input" }
              if (v.outcome === "lost") {
                const hit =
                  mo.lostReasons.find((r) => r.label.toLowerCase() === why.toLowerCase()) ??
                  mo.lostReasons.find((r) => why.toLowerCase().includes(r.label.toLowerCase()) || r.label.toLowerCase().includes(why.toLowerCase()))
                if (hit) {
                  v.reasonCode = hit.code
                  meta.reasonCode = { source: "input" }
                }
              }
            }
            const item: DraftItem = { key: "m1", type: "deal_move", values: v, meta, removed: [], matches: [], missing: [], refused: null }
            item.missing = missingFields(item)
            const note = !target
              ? `Стадия «${input.stage ?? ""}» не найдена — карточка предложит выбрать.`
              : target.id === d.stageId
                ? "Сделка уже на этой стадии."
                : undefined
            return modelView(await saveDraft([item]), note)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftTaskUpdate: tool({
      description:
        "Prepare a card that marks an EXISTING task done or moves its due date («задачу позвонить Вектору — выполнена», «перенеси КП на понедельник»). taskRef = the task's ref (listRecords / searchRecords) or words of its title. " +
        "For a new date pass the user's own words (dueText).",
      inputSchema: z.object({
        taskRef: z.string(),
        action: z.enum(["done", "reschedule"]),
        dueText: z.string().optional(),
        dueDate: z.string().optional().describe("Your reading of dueText, YYYY-MM-DDTHH:MM (org time; date only = 18:00)"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftTaskUpdate", input)
          try {
            const ref = (input.taskRef ?? "").trim()
            const t = (await taskInOrg(turn.orgId, ref)) ?? (await findOpenTaskByTitle(turn.orgId, ref))
            if (t === "many") return { error: `Открытых задач со словами «${ref}» несколько — уточни у пользователя (askUser) или передай ref.` }
            if (!t) return { error: "Задача не найдена — найди её через listRecords и передай ref." }
            const v: TaskUpdateValues = {
              taskId: t.id,
              taskTitle: t.name,
              action: input.action,
              dueDate: "",
              dueText: "",
              currentDue: utcToLocal(t.dueDate, turn.rctx.timeZone),
            }
            let removed: RemovedValue[] = []
            let meta: Record<string, FieldMeta> = {}
            if (input.action === "reschedule") {
              const g = groundTask({ title: t.name, dueText: input.dueText, dueDate: input.dueDate }, await sources(), turn.rctx.now, turn.rctx.timeZone)
              v.dueDate = g.values.dueDate
              v.dueText = g.values.dueText
              removed = g.removed.filter((r) => r.field === "dueDate")
              meta = g.meta.dueDate ? { dueDate: g.meta.dueDate } : {}
            }
            const item: DraftItem = { key: "u1", type: "task_update", values: v, meta, removed, matches: [], missing: [], refused: null }
            item.missing = missingFields(item)
            return modelView(await saveDraft([item]), t.status === "done" && input.action === "done" ? "Задача уже выполнена." : undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    readSignals: tool({
      description:
        "Read the business signals of the user's latest message and files with the org's signal model, and what the org's funnel rules suggest (create a deal of type X at stage Y, move an open deal, …). " +
        "Call it ONCE before draftDeal when the user reports a client's request, a meeting or an agreement. Nothing is stored. Returns codes with quotes and `suggestion`.",
      inputSchema: z.object({
        companyRef: z.string().optional().describe("ref / name of the company the message is about, if known (to see its open deals)"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          status("readSignals", input)
          try {
            const last = lastUser
            if (!last) return { error: "Нет сообщения пользователя." }
            const files = await readChatAttachmentContents(
              turn.orgId,
              attachmentIds(last).filter((a) => a.status === "parsed").map((a) => a.itemId),
            )
            const text = [textOf(last), ...files.map((f) => `### Вложение: ${f.name}\n${f.content.slice(0, 6000)}`)].join("\n\n").trim()
            if (!text) return { error: "В сообщении нет текста." }
            const co = await resolveCompany((input.companyRef ?? "").trim(), await index(), false)
            const me = (await members()).find((m) => m.id === turn.userId)
            const r = await readTurnSignals({
              orgId: turn.orgId,
              userId: turn.userId,
              userName: me?.name ?? "сотрудник",
              text,
              clientId: co.kind === "existing" ? co.id : null,
              now: turn.rctx.now,
            })
            if ("error" in r) return r
            turnSignals = r
            return {
              signals: r.codes.filter((c) => c.counted || c.confidence !== "low").slice(0, 8).map((c) => ({ label: c.label, quote: c.evidence })),
              amounts: r.amounts,
              deadlines: r.deadlines,
              suggestion: r.suggestion
                ? { action: r.suggestion.action, dealType: r.suggestion.dealTypeName || null, stage: r.suggestion.stageName || null, dealRef: r.suggestion.dealId, rule: r.suggestion.ruleNote }
                : null,
              note: r.note,
            }
          } catch (e) {
            console.error("[chat/actions] readSignals failed", e)
            return { error: "Не удалось прочитать сигналы — продолжай без них." }
          }
        }),
    }),

    draftDeal: tool({
      description:
        "Prepare a NEW deal card for the user to confirm (nothing is created until the user clicks «Создать»). " +
        "companyRef: a draftId of a company card of this answer, a ref of an existing company, or its name. " +
        "The amount must be the user's own words (valueText). Stage / type: leave empty to use the org funnel rules (readSignals) or the first stage. " +
        "Then add the next step as draftTask with dealRef = the returned draftId. Returns draftId and status: ready | needs_input | duplicate.",
      inputSchema: z.object({
        name: z.string().describe("«<Компания> — <предмет>», e.g. «Вектор — поставка 200 позиций»"),
        description: z.string().max(1500).optional().describe("What was agreed — a short list from the input"),
        companyRef: z.string().optional(),
        contactRefs: z.array(z.string()).max(10).optional().describe("draftIds / refs / names of the people of the deal"),
        valueText: z.string().optional().describe("The user's OWN words for the amount, copied exactly («бюджет ~2 млн», «150 тыс. ₽»). Omit when no amount is named."),
        dealType: z.string().optional().describe("A deal type of the org (name or id) only when the user names it"),
        stage: z.string().optional().describe("A stage (name or id) only when the user names it"),
      }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftDeal", input)
          try {
            const g = groundDeal(input, await sources())
            const v = g.values
            const idx = await index()
            const opts = await dealOptions()
            const notes: string[] = []
            let into: ChatDraftPart | undefined

            const co = await resolveCompany((input.companyRef ?? "").trim(), idx, true)
            if (co.kind === "card") {
              into = co.part
              v.companyKey = co.key
              v.companyName = co.name
              g.meta.companyName = { source: "input" }
            } else if (co.kind === "existing") {
              v.companyId = co.id
              v.companyName = co.name
              g.meta.companyName = { source: "input" }
            } else if (co.kind === "many") notes.push(`Компаний «${input.companyRef}» несколько — уточни у пользователя.`)
            else if (co.kind === "none") notes.push(`Компания «${input.companyRef}» не найдена в CRM. Если она новая — сначала draftCompany, затем draftDeal с companyRef = draftId.`)
            else {
              const page = await pageClient()
              if (page) {
                v.companyId = page.id
                v.companyName = page.name
                g.meta.companyName = { source: "page" }
              }
            }

            // No subject named → a neutral name the user can edit (do not ask for it).
            if (!v.name && v.companyName) {
              v.name = `${v.companyName} — новая сделка`
              g.meta.name = { source: "default" }
            }

            // Contacts: cards of this answer (same card only) or existing ones.
            for (const ref of input.contactRefs ?? []) {
              const ct = resolveContact(ref.trim(), idx)
              if (ct.kind === "card" && (!into || into === ct.part)) {
                into = ct.part
                v.contactKeys.push(ct.key)
                v.contactNames.push(ct.name)
              } else if (ct.kind === "existing") {
                v.contactIds.push(ct.id)
                v.contactNames.push(ct.name)
              } else if (ct.kind !== "card") notes.push(`Контакт «${ref}» не найден — сделка без него.`)
            }
            if (into && !v.contactKeys.length && !v.contactIds.length) {
              for (const p of into.draft.items.filter((i) => i.type === "contact")) {
                v.contactKeys.push(p.key)
                v.contactNames.push(itemLabel(p))
              }
            }
            if (v.contactNames.length) g.meta.contactNames = { source: "input" }

            // Type and stage: the user's words → the funnel rules (readSignals) → defaults.
            const byName = <T extends { id: string; name: string }>(list: T[], q: string) =>
              list.find((x) => x.id === q) ?? list.find((x) => x.name.toLowerCase() === q.toLowerCase()) ?? list.find((x) => x.name.toLowerCase().includes(q.toLowerCase()))
            const sug = turnSignals?.suggestion?.action === "create" ? turnSignals.suggestion : null
            const t = input.dealType?.trim() ? byName(opts.dealTypes, input.dealType.trim()) : undefined
            if (t) {
              v.dealTypeId = t.id
              v.dealTypeName = t.name
              g.meta.dealTypeName = { source: "input" }
            } else if (sug?.dealTypeId) {
              v.dealTypeId = sug.dealTypeId
              v.dealTypeName = sug.dealTypeName
              g.meta.dealTypeName = { source: "rule" }
            } else if (opts.dealTypes.length === 1) {
              v.dealTypeId = opts.dealTypes[0].id
              v.dealTypeName = opts.dealTypes[0].name
              g.meta.dealTypeName = { source: "default" }
            }
            const st = input.stage?.trim() ? byName(opts.stages, input.stage.trim()) : undefined
            if (st) {
              v.stageId = st.id
              v.stageName = st.name
              g.meta.stageName = { source: "input" }
            } else if (sug?.stageId && opts.stages.some((x) => x.id === sug.stageId)) {
              v.stageId = sug.stageId
              v.stageName = sug.stageName
              v.ruleNote = sug.ruleNote
              g.meta.stageName = { source: "rule" }
            } else if (opts.stages[0]) {
              v.stageId = opts.stages[0].id
              v.stageName = opts.stages[0].name
              g.meta.stageName = { source: "default" }
            }

            // «An open deal of the same company and type exists» (§9).
            const matches: DraftMatch[] = []
            if (v.companyId) {
              for (const d of await openDealsOfClient(turn.orgId, v.companyId)) {
                const same = (d.dealTypeId ?? null) === (v.dealTypeId ?? null)
                matches.push({
                  kind: same ? "exact" : "similar",
                  type: "deal",
                  id: d.id,
                  title: d.name,
                  subtitle: d.stageName,
                  reason: same ? "открытая сделка той же компании и того же типа" : "другая открытая сделка компании",
                })
              }
              matches.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "exact" ? -1 : 1))
            }
            const item: DraftItem = {
              key: nextKey(into, [], "d"),
              type: "deal",
              values: v,
              meta: g.meta,
              removed: g.removed,
              matches: matches.slice(0, 5),
              missing: missingFields({ type: "deal", values: v }),
              refused: null,
            }
            return modelView(await saveDraft([item], into), notes.join(" ") || undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftTask: tool({
      description:
        "Prepare ONE new task card for the user to confirm (nothing is created until the user clicks «Создать»). " +
        "The deadline must come from the user's own words (dueText); without them the card asks for it. " +
        "A task about a company / person of a card of this answer: pass its draftId as companyRef / contactRef (the task joins that card). " +
        "Returns draftId and status: ready | needs_input.",
      inputSchema: taskInput,
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftTask", input)
          try {
            const notes: string[] = []
            const first = await taskItem(input, "t0", notes)
            const item = { ...first.item, key: nextKey(first.into, [], "t") }
            return modelView(await saveDraft([item], first.into), notes.join(" ") || undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),

    draftTasks: tool({
      description:
        "Prepare SEVERAL tasks as ONE checklist card (e.g. the action items of meeting notes) for the user to confirm. " +
        "Each task: title, the user's own words for its deadline (dueText), assignee, links. Max 12. " +
        "Returns draftId and status: ready | needs_input.",
      inputSchema: z.object({ tasks: z.array(taskInput).min(1).max(ACTION_LIMITS.itemsPerAction) }),
      execute: (input) =>
        serial(async () => {
          if (!asked) return NOT_ASKED
          if (tooMany()) return LIMIT
          count++
          status("draftTasks", input)
          try {
            const notes: string[] = []
            const made: DraftItem[] = []
            let into: ChatDraftPart | undefined
            const joined: { item: DraftItem; into?: ChatDraftPart }[] = []
            for (const t of input.tasks) {
              const r = await taskItem(t, "t0", notes)
              into ??= r.into
              joined.push(r)
            }
            if (into && into.draft.items.length + joined.length > ACTION_LIMITS.itemsPerAction) into = undefined
            for (const r of joined) {
              // A link to a card the checklist does not join is dropped (keys are per card).
              if (r.into !== into) unlinkKeys(r.item)
              made.push({ ...r.item, key: nextKey(into, made, "t") })
            }
            return modelView(await saveDraft(made, into), notes.join(" ") || undefined)
          } catch (e) {
            return failed(e)
          }
        }),
    }),
  }
}

export const ACTION_TOOLS = new Set([
  "draftCompany",
  "draftContact",
  "draftTask",
  "draftTasks",
  "draftDeal",
  "readSignals",
  "askUser",
  "draftUpdate",
  "draftLink",
  "draftOrderRequest",
  "draftDealMove",
  "draftTaskUpdate",
])

function unlinkKeys(item: DraftItem) {
  const v = item.values as TaskValues
  if (v.companyKey) {
    v.companyKey = null
    v.companyName = ""
  }
  if (v.contactKey) {
    v.contactKey = null
    v.contactName = ""
  }
  item.missing = missingFields({ type: "task", values: v })
}

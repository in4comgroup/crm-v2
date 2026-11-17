// `pnpm chat:eval` — the AI chat over Telegram (docs/specs/ai-chat-telegram
// §12, §17; plan TC6): the REAL router → inbox → worker → `runChatTurn`
// (channel telegram, real model) → renderer → sender, on the test DB org,
// with ONLY the Telegram Bot API mocked (no public webhook here). Checks the
// binding flow, answers (allowed tags, ≤ 4,096 chars, no ids), the merge of a
// split message, voice as the question, the CSV button, a draft card
// confirmed by its button (as the member, without a browser session), group
// messages (never the AI chat), `/stop`, the Telegram copy of an important
// notification and topic pushes with «Готово» / «Отложить до завтра».
//
// Env: CHAT_EVAL_ONLY=tg (run only this file's cases: any id prefix «tg»).
// Writes on the test DB, all removed at the end: a binding, its chats, chat
// files, the task the card creates, notifications, log rows. The org bot's
// «ИИ-чат в Telegram» switch is set for the run and restored.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm"
import type { Update } from "grammy/types"
import { db } from "@/db/drizzle"
import {
  topic,
  topicDelivery,
  aiChatAction,
  aiChatMessage,
  aiChatThread,
  notification,
  source,
  sourceItem,
  task,
  telegramBindCode,
  telegramBinding,
  telegramButton,
  telegramChatInbox,
  telegramOutMessage,
  telegramUpdateSeen,
} from "@/db/schema"
import { answerAllowedTagsOnly } from "@/lib/telegram/render"
import { visibleLength } from "@/lib/telegram/html"
import { deleteObjects } from "@/server/storage"
import { EVAL_ORG_ID, EVAL_USER_ID } from "./questions"
import { FIXTURES_DIR } from "./action-cases"

// The record functions read the session: in Telegram that is the scoped
// member session of `runAsMember` (no browser here).
vi.mock("@/lib/get-session", async () => {
  const { actingMemberSession } = await import("@/server/acting-member")
  return { getServerSession: async () => actingMemberSession() }
})

type Call = { method: string; args: unknown[] }
const tg = vi.hoisted(() => {
  const calls: Call[] = []
  let mid = 1000
  const rec =
    (method: string, ret: (...a: unknown[]) => unknown = () => true) =>
    async (...args: unknown[]) => {
      calls.push({ method, args })
      return ret(...args)
    }
  const api = {
    sendMessage: rec("sendMessage", () => ({ message_id: ++mid })),
    sendDocument: rec("sendDocument", () => ({ message_id: ++mid })),
    editMessageText: rec("editMessageText"),
    editMessageReplyMarkup: rec("editMessageReplyMarkup"),
    sendChatAction: rec("sendChatAction"),
    sendMessageDraft: rec("sendMessageDraft"),
    answerCallbackQuery: rec("answerCallbackQuery"),
    setMyCommands: rec("setMyCommands"),
    getMe: rec("getMe", () => ({ id: 1, is_bot: true, username: "eval_bot", can_read_all_group_messages: true, can_join_groups: true })),
  }
  return { calls, api, files: new Map<string, Uint8Array>() }
})
vi.mock("grammy", () => {
  class GrammyError extends Error {
    error_code = 400
    description = "mock"
    parameters = {}
  }
  class InputFile {
    constructor(
      public data: unknown,
      public filename?: string,
    ) {}
  }
  class Bot {
    api = tg.api
    constructor(public token: string) {}
  }
  return { Bot, GrammyError, InputFile }
})
vi.mock("@/lib/telegram", async (orig) => ({
  ...((await orig()) as object),
  downloadTelegramFile: async (_token: string, fileId: string) => {
    const bytes = tg.files.get(fileId)
    if (!bytes) throw new Error(`no fixture for ${fileId}`)
    return { bytes: Buffer.from(bytes), filePath: fileId }
  },
}))

// Pushes and notification copies go out only inside working hours: the eval forces «working».
vi.mock("@/server/telegram/delivery", async (orig) => {
  const m = (await orig()) as typeof import("@/server/telegram/delivery")
  return { ...m, orgWorkingNow: async (orgId: string, now: Date) => ({ ...(await m.orgWorkingNow(orgId, now)), working: true }) }
})

const { handleTelegramUpdate } = await import("@/server/telegram/router")
const { resolveTelegramWebhookContext } = await import("@/server/ingest/telegram")
const { createTelegramBindLink } = await import("@/server/telegram/bindings")

const ONLY = (process.env.CHAT_EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const run = !ONLY.length || ONLY.some((o) => o.startsWith("tg"))
const TG_USER = 7_000_000_000 + Math.floor(Math.random() * 1_000_000)
let updateId = Math.floor(Date.now() / 1000)
let msgId = 1
let sourceId = ""
let oldConfig: unknown = null
let ctx: NonNullable<Awaited<ReturnType<typeof resolveTelegramWebhookContext>>>
const threads = new Set<string>()
const TEST_TOPIC = `tg-eval-topic-${TG_USER}`
const testNotificationKeys: string[] = []
const groupChat = -100_000_000 - Math.floor(Math.random() * 1_000_000)

const from = { id: TG_USER, is_bot: false, first_name: "Eval", username: `eval_tg_${TG_USER % 100000}` }
const privateChat = { id: TG_USER, type: "private" as const, first_name: "Eval" }

function msgUpdate(extra: Record<string, unknown>, chat: Record<string, unknown> = privateChat): Update {
  return { update_id: ++updateId, message: { message_id: ++msgId, date: Math.floor(Date.now() / 1000), chat, from, ...extra } } as unknown as Update
}

/** Handle updates like the webhook, then run their deferred work (in parallel, as `after()` would). */
async function deliver(...updates: Update[]) {
  const results = []
  for (const u of updates) results.push(await handleTelegramUpdate(ctx, u, { ack: true }))
  await Promise.all(results.flatMap((r) => r.deferred.map((d) => d())))
  return results
}

const sentSince = (n: number) => tg.calls.slice(n).filter((c) => c.method === "sendMessage")
const textOf = (c: Call) => String(c.args[1] ?? "")
const keyboardOf = (c: Call) => ((c.args[2] as { reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] } })?.reply_markup?.inline_keyboard ?? []).flat()

function checkMessages(calls: Call[]): string[] {
  const problems: string[] = []
  for (const c of calls) {
    const html = textOf(c)
    if (!answerAllowedTagsOnly(html)) problems.push(`not allowed / unbalanced tags: ${html.slice(0, 120)}`)
    if (visibleLength(html) > 4096) problems.push("message > 4096 chars")
    if (/\bref\b|[0-9a-f]{8}-[0-9a-f]{4}-|searchRecords|listRecords|queryStats/i.test(html.replace(/href="[^"]*"/g, ""))) problems.push(`technical text: ${html.slice(0, 160)}`)
  }
  return problems
}

async function binding() {
  const [b] = await db.select().from(telegramBinding).where(and(eq(telegramBinding.sourceId, sourceId), eq(telegramBinding.tgUserId, String(TG_USER)))).orderBy(desc(telegramBinding.createdAt)).limit(1)
  return b ?? null
}

async function lastUserText(threadId: string): Promise<string> {
  const [m] = await db.select({ parts: aiChatMessage.parts }).from(aiChatMessage).where(and(eq(aiChatMessage.threadId, threadId), eq(aiChatMessage.role, "user"))).orderBy(desc(aiChatMessage.seq)).limit(1)
  return ((m?.parts ?? []) as { type: string; text?: string }[]).filter((p) => p.type === "text").map((p) => p.text).join("\n")
}

/** Press the newest button of a kind (as Telegram would deliver the callback). */
async function press(kind: string) {
  const b = await binding()
  const [btn] = await db.select().from(telegramButton).where(and(eq(telegramButton.bindingId, b!.id), eq(telegramButton.kind, kind))).orderBy(desc(telegramButton.createdAt)).limit(1)
  expect(btn, `a ${kind} button`).toBeTruthy()
  const update = {
    update_id: ++updateId,
    callback_query: { id: `cq${updateId}`, from, chat_instance: "x", data: `b:${btn!.id}`, message: { message_id: btn!.tgMessageId ?? 0, date: 0, chat: privateChat, text: "?" } },
  } as unknown as Update
  return deliver(update)
}

describe.skipIf(!run)("AI chat over Telegram (mocked Bot API, real router / worker / model)", () => {
  beforeAll(async () => {
    const [s] = await db.select().from(source).where(and(eq(source.ownerOrganizationId, EVAL_ORG_ID), eq(source.provider, "telegram"), eq(source.status, "active"))).limit(1)
    if (!s) throw new Error("the eval org has no active Telegram source")
    sourceId = s.id
    oldConfig = s.providerConfig
    await db.update(source).set({ providerConfig: { ...((s.providerConfig ?? {}) as object), aiChatEnabled: true } }).where(eq(source.id, sourceId))
    ctx = (await resolveTelegramWebhookContext(sourceId))!
    expect(ctx.aiChatEnabled).toBe(true)
    tg.files.set("voice1", new Uint8Array(readFileSync(join(FIXTURES_DIR, "voice/reminder-vector.wav"))))
  })

  afterAll(async () => {
    await db.update(source).set({ providerConfig: oldConfig as Record<string, unknown> }).where(eq(source.id, sourceId))
    const b = await binding()
    const threadIds = [...threads]
    if (b) {
      const own = await db.select({ id: aiChatThread.id }).from(aiChatThread).where(and(eq(aiChatThread.organizationId, EVAL_ORG_ID), eq(aiChatThread.userId, EVAL_USER_ID), eq(aiChatThread.channel, "telegram")))
      for (const t of own) if (!threadIds.includes(t.id) && t.id === b.aiChatThreadId) threadIds.push(t.id)
    }
    if (threadIds.length) {
      // What a confirmed card created + the action rows.
      const acts = await db.select({ results: aiChatAction.results }).from(aiChatAction).where(inArray(aiChatAction.threadId, threadIds))
      const taskIds = acts.flatMap((a) => ((a.results ?? []) as { type?: string; id?: string; existing?: boolean }[]).filter((r) => r.type === "task" && r.id && !r.existing).map((r) => r.id!))
      if (taskIds.length) await db.delete(task).where(inArray(task.id, taskIds))
      await db.delete(aiChatAction).where(inArray(aiChatAction.threadId, threadIds))
      const files = await db
        .select({ id: sourceItem.id, fileKey: sourceItem.fileKey, r2: sourceItem.markdownR2Key })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, EVAL_ORG_ID), inArray(sql<string>`${sourceItem.metadataJson}->'chat'->>'threadId'`, threadIds)))
      const keys = files.flatMap((f) => [f.fileKey, f.r2]).filter((k): k is string => !!k)
      if (keys.length) await deleteObjects(keys).catch((e) => console.error("tg eval cleanup: storage", e))
      if (files.length) await db.delete(sourceItem).where(inArray(sourceItem.id, files.map((f) => f.id)))
      await db.delete(telegramOutMessage).where(inArray(telegramOutMessage.aiChatThreadId, threadIds))
      await db.delete(aiChatThread).where(inArray(aiChatThread.id, threadIds))
    }
    // Messages stored as source items (ingest path): the group message and the private one after `/stop`.
    const items = await db
      .select({ id: sourceItem.id, r2: sourceItem.markdownR2Key, fileKey: sourceItem.fileKey })
      .from(sourceItem)
      .where(and(eq(sourceItem.sourceId, sourceId), or(like(sourceItem.externalId, `${groupChat}:%`), like(sourceItem.externalId, `${TG_USER}:%`))))
    const itemKeys = items.flatMap((i) => [i.r2, i.fileKey]).filter((k): k is string => !!k)
    if (itemKeys.length) await deleteObjects(itemKeys).catch((e) => console.error("tg eval cleanup: storage", e))
    if (items.length) await db.delete(sourceItem).where(inArray(sourceItem.id, items.map((i) => i.id)))
    if (b) {
      await db.delete(telegramOutMessage).where(eq(telegramOutMessage.bindingId, b.id))
      await db.delete(telegramChatInbox).where(eq(telegramChatInbox.bindingId, b.id))
    }
    await db.delete(telegramOutMessage).where(and(eq(telegramOutMessage.sourceId, sourceId), eq(telegramOutMessage.chatId, String(TG_USER))))
    await db.delete(telegramBinding).where(and(eq(telegramBinding.sourceId, sourceId), eq(telegramBinding.tgUserId, String(TG_USER))))
    await db.delete(telegramBindCode).where(and(eq(telegramBindCode.sourceId, sourceId), eq(telegramBindCode.userId, EVAL_USER_ID)))
    await db.delete(telegramUpdateSeen).where(and(eq(telegramUpdateSeen.sourceId, sourceId), sql`${telegramUpdateSeen.updateId} > ${Math.floor(Date.now() / 1000) - 7200}`))
    if (b) await db.delete(notification).where(or(like(notification.dedupeKey, `%telegram.bound:${b.id}`), like(notification.dedupeKey, `%telegram.bound_owner:${b.id}`)))
    for (const k of testNotificationKeys) await db.delete(notification).where(like(notification.dedupeKey, `%${k}`))
    await db.delete(topicDelivery).where(and(eq(topicDelivery.organizationId, EVAL_ORG_ID), sql`${TEST_TOPIC} = any(${topicDelivery.topicIds})`))
    await db.delete(notification).where(eq(notification.entityId, TEST_TOPIC))
    await db.delete(topic).where(eq(topic.id, TEST_TOPIC))
  })

  it("tg01 binding: /start <code> binds once; the same code again fails", async () => {
    const { deepLink } = await createTelegramBindLink(EVAL_ORG_ID, EVAL_USER_ID)
    const code = deepLink.split("?start=")[1]
    const n = tg.calls.length
    const [r] = await deliver(msgUpdate({ text: `/start ${code}` }))
    expect(r.outcome).toBe("command")
    expect((await binding())?.status).toBe("active")
    expect(textOf(sentSince(n)[0])).toContain("Готово")
    const m = tg.calls.length
    await deliver(msgUpdate({ text: `/start ${code}` }))
    expect(textOf(sentSince(m)[0])).toContain("устарела")
  })

  it("tg02 a question: one answer, Telegram HTML, no ids, 👍 / 👎 on it, thread channel telegram", async () => {
    const n = tg.calls.length
    const [r] = await deliver(msgUpdate({ text: "Сколько у нас открытых сделок?" }))
    expect(r.outcome).toBe("chat")
    const sent = sentSince(n)
    expect(sent.length).toBeGreaterThan(0)
    expect(checkMessages(sent)).toEqual([])
    expect(sent.some((c) => keyboardOf(c).some((k) => k.text === "👍"))).toBe(true)
    const b = await binding()
    expect(b?.aiChatThreadId).toBeTruthy()
    threads.add(b!.aiChatThreadId!)
    const [t] = await db.select({ channel: aiChatThread.channel }).from(aiChatThread).where(eq(aiChatThread.id, b!.aiChatThreadId!))
    expect(t.channel).toBe("telegram")
    console.log("tg02 answer:", sent.map(textOf).join("\n---\n").slice(0, 600))
  })

  it("tg03 a message split by Telegram → ONE turn", async () => {
    const before = (await binding())!.aiChatThreadId!
    await deliver(msgUpdate({ text: "Покажи наши открытые задачи." }), msgUpdate({ text: "Только самые срочные, пожалуйста." }))
    const b = await binding()
    threads.add(b!.aiChatThreadId!)
    expect(b!.aiChatThreadId).toBe(before)
    const text = await lastUserText(b!.aiChatThreadId!)
    expect(text).toContain("открытые задачи")
    expect(text).toContain("самые срочные")
  })

  it("tg04 statistics: a CSV button; pressing it sends the CSV file", async () => {
    const n = tg.calls.length
    await deliver(msgUpdate({ text: "Выручка по месяцам за этот год" }))
    const sent = sentSince(n)
    expect(checkMessages(sent)).toEqual([])
    const hasCsv = sent.some((c) => keyboardOf(c).some((k) => k.text.includes("CSV")))
    expect(hasCsv, "a CSV button").toBe(true)
    const m = tg.calls.length
    await press("stats_csv")
    const doc = tg.calls.slice(m).find((c) => c.method === "sendDocument")
    expect(doc, "sendDocument").toBeTruthy()
    console.log("tg04 answer:", sent.map(textOf).join("\n---\n").slice(0, 600))
  })

  it("tg05 voice: the transcript is shown and is the question", async () => {
    const n = tg.calls.length
    await deliver(msgUpdate({ voice: { file_id: "voice1", file_unique_id: "v1", duration: 6, mime_type: "audio/wav", file_size: 200_000 } }))
    const sent = sentSince(n)
    expect(sent.some((c) => textOf(c).startsWith("🎤")), "transcript echo").toBe(true)
    const b = await binding()
    threads.add(b!.aiChatThreadId!)
    expect((await lastUserText(b!.aiChatThreadId!)).toLowerCase()).toContain("вектор")
    expect(checkMessages(sent)).toEqual([])
    console.log("tg05:", sent.map(textOf).join("\n---\n").slice(0, 600))
  })

  it("tg06 a task card: «Создать» creates the task as the member (no browser session)", async () => {
    await deliver(msgUpdate({ text: "/new" }))
    const n = tg.calls.length
    await deliver(msgUpdate({ text: "Поставь мне задачу: позвонить в Вектор послезавтра в 11:00 насчёт договора поставки." }))
    const b = await binding()
    threads.add(b!.aiChatThreadId!)
    const sent = sentSince(n)
    expect(checkMessages(sent)).toEqual([])
    const card = sent.find((c) => keyboardOf(c).some((k) => k.text.includes("Создать")))
    expect(card, `a card with «Создать»: ${sent.map(textOf).join(" | ").slice(0, 400)}`).toBeTruthy()
    const m = tg.calls.length
    await press("card_confirm")
    const edit = tg.calls.slice(m).find((c) => c.method === "editMessageText")
    expect(String(edit?.args[2] ?? ""), "card edited to «Создано»").toContain("Создано")
    const [act] = await db.select({ status: aiChatAction.status, results: aiChatAction.results }).from(aiChatAction).where(eq(aiChatAction.threadId, b!.aiChatThreadId!)).orderBy(desc(aiChatAction.createdAt)).limit(1)
    expect(act.status).toBe("created")
    const taskId = ((act.results ?? []) as { type?: string; id?: string }[]).find((r) => r.type === "task")?.id
    const [t] = await db.select({ userId: task.userId, org: task.organizationId }).from(task).where(eq(task.id, taskId!))
    expect(t.org).toBe(EVAL_ORG_ID)
    expect(t.userId).toBe(EVAL_USER_ID)
  })

  it("tg07 a group message of the member never reaches the AI chat", async () => {
    const n = tg.calls.length
    const [r] = await deliver(msgUpdate({ text: "Коллеги, сколько у нас открытых сделок?" }, { id: groupChat, type: "supergroup", title: "Eval group" }))
    expect(r.outcome).not.toBe("chat")
    expect(sentSince(n)).toHaveLength(0)
  })

  it("tg09 an important notification → a Telegram copy at once; info → none", async () => {
    const { notify } = await import("@/server/notifications/engine")
    const key = `tg-eval:${TG_USER}`
    testNotificationKeys.push(key, `${key}:info`)
    const n = tg.calls.length
    await notify(EVAL_ORG_ID, { kind: "task.overdue", userIds: [EVAL_USER_ID], title: "Задача просрочена: Позвонить в Вектор", body: "Срок был вчера", href: "/tasks", dedupeKey: key })
    const copy = sentSince(n).find((c) => textOf(c).startsWith("❗"))
    expect(copy, "a Telegram copy").toBeTruthy()
    expect(checkMessages([copy!])).toEqual([])
    const [row] = await db.select({ s: notification.telegramStatus }).from(notification).where(like(notification.dedupeKey, `%${key}`))
    expect(row.s).toBe("sent")
    const m = tg.calls.length
    await notify(EVAL_ORG_ID, { kind: "task.assigned", userIds: [EVAL_USER_ID], title: "Вам назначена задача", dedupeKey: `${key}:info` })
    expect(sentSince(m)).toHaveLength(0)
  })

  it("tg10 a topic entering «Сейчас» → one push with Готово / Отложить; «Отложить» snoozes it as the member", async () => {
    const now = new Date()
    await db.insert(topic).values({ id: TEST_TOPIC, organizationId: EVAL_ORG_ID, title: "Eval — КП для Вектора", matter: "КП", status: "open", subState: "waiting_on_us", firstSeenAt: now, lastActivityAt: now, ownerUserId: EVAL_USER_ID })
    const { loadDeliveryContext } = await import("@/server/topics/delivery/run")
    const { runTelegramTopicPushes } = await import("@/server/topics/delivery/telegram-push")
    const fake = (cycle: Date) => ({
      topicId: TEST_TOPIC, title: "Eval — КП для Вектора", matter: "КП", status: "open", subState: "waiting_on_us",
      clientId: null, clientName: "Вектор", contactId: null, contactName: null, dealId: null, dealName: null, dealOwnerUserId: null,
      ownerUserId: EVAL_USER_ID, ownerName: null, leadCode: null, leadLabelRu: null, lastActivityAt: now.toISOString(), snoozedUntil: null,
      attention: { list: "now", profile: "P8", band: "high", class: null, score: 8, deadline: null, overdue: false, escalations: [], section: null, hiddenReason: null, explanation: ["клиент ждёт ответа"], cycleStartedAt: cycle.toISOString(), cycleReason: "created", cardExpiresAt: null },
      card: null, dealCards: [], marker: null, reminder: null,
    })
    const withFake = async (cycle: Date) => {
      const ctx = await loadDeliveryContext(EVAL_ORG_ID, new Date())
      ctx.lists.now = [fake(cycle) as never, ...ctx.lists.now.filter((e) => e.topicId !== TEST_TOPIC)]
      return runTelegramTopicPushes(ctx)
    }
    const n = tg.calls.length
    await withFake(now)
    const push = sentSince(n).find((c) => textOf(c).includes("Eval — КП для Вектора"))
    expect(push, "a push").toBeTruthy()
    expect(keyboardOf(push!).map((k) => k.text)).toEqual(expect.arrayContaining(["✅ Готово", "⏰ Отложить до завтра"]))
    // The same cycle again → no second push.
    const m = tg.calls.length
    await withFake(now)
    expect(sentSince(m).filter((c) => textOf(c).includes("Eval — КП"))).toHaveLength(0)
    // «Отложить до завтра» → snoozed, the push edited.
    const e0 = tg.calls.length
    await press("topic_snooze")
    const [t] = await db.select({ snoozedUntil: topic.snoozedUntil }).from(topic).where(eq(topic.id, TEST_TOPIC))
    expect(t.snoozedUntil && t.snoozedUntil.getTime() > Date.now()).toBe(true)
    expect(String(tg.calls.slice(e0).find((c) => c.method === "editMessageText")?.args[2] ?? "")).toContain("Отложено до")
  })

  it("tg11 a new cycle → a second push; «Готово» closes the topic; a third push in 7 days is limited", async () => {
    const { loadDeliveryContext } = await import("@/server/topics/delivery/run")
    const { runTelegramTopicPushes } = await import("@/server/topics/delivery/telegram-push")
    const push = async (cycle: Date) => {
      const ctx = await loadDeliveryContext(EVAL_ORG_ID, new Date())
      const base = { topicId: TEST_TOPIC, title: "Eval — КП для Вектора", matter: "", status: "open", subState: "waiting_on_us", clientId: null, clientName: null, contactId: null, contactName: null, dealId: null, dealName: null, dealOwnerUserId: null, ownerUserId: EVAL_USER_ID, ownerName: null, leadCode: null, leadLabelRu: null, lastActivityAt: cycle.toISOString(), snoozedUntil: null, card: null, dealCards: [], marker: null, reminder: null }
      ctx.lists.now = [{ ...base, attention: { list: "now", profile: "P6", band: "high", class: null, score: 7, deadline: null, overdue: false, escalations: [], section: null, hiddenReason: null, explanation: [], cycleStartedAt: cycle.toISOString(), cycleReason: "reopen", cardExpiresAt: null } } as never]
      return runTelegramTopicPushes(ctx)
    }
    await new Promise((r) => setTimeout(r, 1100))
    const r2 = await push(new Date())
    expect(r2).toMatchObject({ sent: 1 })
    await press("topic_done")
    const [t] = await db.select({ status: topic.status }).from(topic).where(eq(topic.id, TEST_TOPIC))
    expect(t.status).toBe("done")
    await new Promise((r) => setTimeout(r, 1100))
    const r3 = await push(new Date())
    expect(r3).toMatchObject({ sent: 0, limited: 1 })
  })

  it("tg08 /stop unbinds; the next message is not answered by the AI chat", async () => {
    await deliver(msgUpdate({ text: "/stop" }))
    expect((await binding())?.status).toBe("unbound")
    const [r] = await deliver(msgUpdate({ text: "Сколько сделок?" }))
    expect(r.outcome).not.toBe("chat")
  })
})

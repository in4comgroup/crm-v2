import { describe, expect, it } from "vitest"
import type { TopicEntry } from "@/lib/topics/topic-ui"
import { answerAllowedTagsOnly } from "./render"
import { pushAfterAction, renderNotificationMessage, renderTopicPush } from "./push"

function entry(over: Partial<TopicEntry> = {}): TopicEntry {
  return {
    topicId: "t1",
    title: "Альфа — КП на 200 шт",
    matter: "КП",
    status: "open",
    subState: "waiting_on_us",
    clientId: "c1",
    clientName: "Альфа <ООО>",
    contactId: null,
    contactName: null,
    dealId: null,
    dealName: null,
    dealOwnerUserId: null,
    ownerUserId: null,
    ownerName: null,
    leadCode: null,
    leadLabelRu: null,
    lastActivityAt: "2026-11-17T08:00:00Z",
    snoozedUntil: null,
    attention: {
      list: "now",
      profile: "P8",
      band: "high",
      class: null,
      score: 8,
      deadline: "2026-11-20",
      overdue: false,
      escalations: [],
      section: null,
      hiddenReason: null,
      explanation: ["клиент ждёт ответа 2 дня"],
      cycleStartedAt: "2026-11-17T08:00:00Z",
      cycleReason: "created",
      cardExpiresAt: null,
    },
    card: {
      id: "k1",
      kind: "topic",
      status: "open",
      headline: "Альфа ждёт КП до пятницы",
      whyNow: "Клиент напомнил второй раз",
      whatChanged: "",
      steps: ["Подготовить КП", "Отправить Петрову"],
      taskTitle: null,
      category: "",
      priority: "high",
      orderRequest: null,
      leadCode: null,
      events: [],
      proposal: null,
      dealId: null,
      rejectReasonCode: null,
      rejectionReason: null,
    },
    dealCards: [],
    marker: null,
    reminder: null,
    ...over,
  } as unknown as TopicEntry
}

describe("renderTopicPush", () => {
  it("headline, company (escaped), why now, deadline, steps; Открыть + Готово + Отложить", () => {
    const m = renderTopicPush(entry(), { appUrl: "https://app.example", timeZone: "Europe/Vienna" })
    expect(m.html).toContain("🔴 <b>Альфа ждёт КП до пятницы</b>")
    expect(m.html).toContain("Альфа &lt;ООО&gt;")
    expect(m.html).toContain("Клиент напомнил второй раз")
    expect(m.html).toMatch(/Срок: /)
    expect(m.html).toContain("• Подготовить КП")
    expect(answerAllowedTagsOnly(m.html)).toBe(true)
    expect(m.buttons[0][0]).toEqual({ text: "Открыть", url: "https://app.example/dashboard?topic=t1" })
    expect(m.buttons[1].map((b) => ("action" in b ? b.action.kind : ""))).toEqual(["topic_done", "topic_snooze"])
  })

  it("no card → the title and the first explanation; http app URL → a text link, no URL button", () => {
    const m = renderTopicPush(entry({ card: null, attention: { ...entry().attention!, profile: "P6" } }), { appUrl: "http://localhost:3000", timeZone: "Europe/Vienna" })
    expect(m.html).toContain("🔔 <b>Альфа — КП на 200 шт</b>")
    expect(m.html).toContain("клиент ждёт ответа 2 дня")
    expect(m.html).toContain('<a href="http://localhost:3000/dashboard?topic=t1">Открыть в CRM</a>')
    expect(m.buttons).toHaveLength(1)
  })

  it("after a button: result line, only «Открыть» stays", () => {
    const m = pushAfterAction("<b>x</b>", "✅ Готово", "https://app.example/dashboard?topic=t1")
    expect(m.html).toBe("<b>x</b>\n\n✅ Готово")
    expect(m.buttons).toEqual([[{ text: "Открыть", url: "https://app.example/dashboard?topic=t1" }]])
  })
})

describe("renderNotificationMessage", () => {
  it("title, body, relative href made absolute", () => {
    const m = renderNotificationMessage({ title: "Задача просрочена: <Позвонить>", body: "Срок был вчера", href: "/tasks?openTask=1" }, "https://app.example/")
    expect(m.html).toBe("❗ <b>Задача просрочена: &lt;Позвонить&gt;</b>\nСрок был вчера")
    expect(m.buttons).toEqual([[{ text: "Открыть в CRM", url: "https://app.example/tasks?openTask=1" }]])
    expect(answerAllowedTagsOnly(m.html)).toBe(true)
  })
})

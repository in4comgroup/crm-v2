import { describe, expect, it } from "vitest"
import type { ChatDraftPart, CompanyValues, ContactValues, DraftItem, TaskValues } from "@/lib/chat/actions"
import { confirmActionSchema, emptyCompanyValues, emptyContactValues } from "@/lib/chat/actions"
import type { RecordHit } from "@/lib/chat/records"
import type { StatsResult } from "@/lib/chat/stats"
import type { ChatRecordsPart } from "@/lib/chat/turn"
import { htmlToVisibleText, visibleLength } from "./html"
import {
  answerAllowedTagsOnly,
  renderTelegramAnswer,
  shortMoney,
  telegramCardConfirmInput,
  telegramCardState,
  type TgOutMessage,
} from "./render"

const ctx = { appUrl: "https://app.example.ru/", threadId: "thr_123", timeZone: "Europe/Vienna" }

function checkAll(messages: TgOutMessage[]) {
  for (const m of messages) {
    expect(answerAllowedTagsOnly(m.html), m.html).toBe(true)
    expect(visibleLength(m.html)).toBeLessThanOrEqual(4096)
    expect(htmlToVisibleText(m.html).trim().length).toBeGreaterThan(0)
  }
}

const hit = (type: RecordHit["type"], i: number, over: Partial<RecordHit> = {}): RecordHit => ({
  type,
  id: `${type}-id-${i}`,
  title: `${type === "deal" ? "Сделка" : "Компания"} ${i}`,
  subtitle: i % 2 ? "Москва" : null,
  facts: i === 1 ? [{ label: "Сумма", value: "2,4 млн ₽" }] : [],
  badge: i === 1 ? { label: "КП отправлено", tone: "neutral" } : null,
  date: i === 1 ? "2026-11-03T10:00:00Z" : null,
  href: type === "deal" ? `/deals?openDeal=${type}-id-${i}` : `/clients/${type}-id-${i}`,
  ...over,
})

const stats = (over: Partial<StatsResult> = {}, meta: Partial<StatsResult["meta"]> = {}): StatsResult => ({
  query: { subject: "orders", dimension: "time.month" },
  subject: "orders",
  subjectLabel: "Заказы и продажи",
  rows: [
    { key: "2026-01", label: "Январь 2026", value: 1_234_567 },
    { key: "2026-02", label: "Февраль 2026", value: 350_000 },
  ],
  scalar: null,
  ...over,
  meta: {
    measureLabel: "Выручка",
    measureKind: "money",
    dimensionLabel: "По месяцам",
    splitLabel: null,
    total: 1_584_567,
    rowCount: 2,
    truncated: false,
    periodLabel: "01.01.2026 — 16.11.2026",
    chart: "bar",
    warnings: [],
    applied: [{ label: "Статус", value: "подтверждён" }],
    ...meta,
  },
})

// ── Draft fixtures ──────────────────────────────────────────────────────

const company = (over: Partial<CompanyValues> = {}): DraftItem => ({
  key: "c1",
  type: "company",
  values: { ...emptyCompanyValues(), name: " Альфа ООО ", website: "alfa.ru", aliases: ["Альфа", " "], ...over },
  meta: {},
  removed: [],
  matches: [],
  missing: [],
  refused: null,
})

const contact = (over: Partial<ContactValues> = {}): DraftItem => ({
  key: "p1",
  type: "contact",
  values: {
    ...emptyContactValues(),
    name: "Пётр Иванов",
    position: "закупщик",
    phones: ["+7 916 123-45-67"],
    emails: ["petr@alfa.ru"],
    telegram: "@petr_iv",
    companyKey: "c1",
    companyName: "Альфа ООО",
    ...over,
  },
  meta: {},
  removed: [],
  matches: [],
  missing: [],
  refused: null,
})

const task = (over: Partial<TaskValues> = {}): DraftItem => ({
  key: "t1",
  type: "task",
  values: {
    title: " Позвонить Петрову ",
    description: "Обсудить КП ",
    type: "call",
    priority: "medium",
    dueDate: "2026-11-19T18:00",
    dueText: "в четверг",
    assigneeId: "u1",
    assigneeName: "Анна Смирнова",
    companyId: "cl1",
    companyKey: null,
    companyName: "Альфа ООО",
    contactId: null,
    contactKey: null,
    contactName: "",
    dealId: null,
    dealKey: null,
    dealName: "",
    done: false,
    ...over,
  },
  meta: {},
  removed: [],
  matches: [],
  missing: [],
  refused: null,
})

const draftPart = (items: DraftItem[], over: Partial<ChatDraftPart> = {}): ChatDraftPart => ({
  actionId: "act_1",
  kind: items.length > 1 ? "company_contact" : items[0].type === "task" ? "task" : "company",
  status: "draft",
  draft: { items, files: [{ itemId: "file_1", name: "визитка.jpg" }] },
  ...over,
})

describe("shortMoney", () => {
  it("short forms with one decimal under 10 units", () => {
    expect(shortMoney(1_234_567)).toBe("1,2 млн ₽")
    expect(shortMoney(350_000)).toBe("350 тыс ₽")
    expect(shortMoney(8_500)).toBe("8,5 тыс ₽")
    expect(shortMoney(2_000_000)).toBe("2 млн ₽")
    expect(shortMoney(3_100_000_000)).toBe("3,1 млрд ₽")
    expect(shortMoney(950)).toBe("950 ₽")
    expect(shortMoney(-45_000_000)).toBe("-45 млн ₽")
  })
})

describe("renderTelegramAnswer — answer", () => {
  it("prose + records (≤ 5 per type, more → CRM link) + web line, no ids", () => {
    const records: ChatRecordsPart = {
      counts: { client: { total: 1, capped: false }, deal: { total: 8, capped: false } },
      hits: { client: [hit("client", 1)], deal: Array.from({ length: 7 }, (_, i) => hit("deal", i + 1)) },
      applied: [{ label: "Статус", value: "открыта" }],
    }
    const out = renderTelegramAnswer(
      [
        { type: "text", text: "**Альфа ООО** — клиент, 2 открытые сделки." },
        { type: "data-records", id: "r1", data: records },
        { type: "data-turn", data: { used: ["crm", "web"], ms: 7000 } },
        { type: "data-debug", data: { model: "x", steps: [] } },
        { type: "reasoning", text: "secret" },
      ],
      ctx,
    )
    expect(out.map((m) => m.role)).toEqual(["answer"])
    const html = out[0].html
    expect(html).toContain("<b>Альфа ООО</b> — клиент")
    expect(html).toContain("Нашёл: компании 1 · сделки 8")
    expect(html).toContain("Фильтр: Статус: открыта")
    expect(html).toContain("<b>Сделки</b>")
    expect(html).toContain('<a href="https://app.example.ru/deals?openDeal=deal-id-1">открыть</a>')
    expect(html).toContain("• <b>Сделка 1</b> — Москва · КП отправлено · Сумма: 2,4 млн ₽ · 03.11.2026")
    expect(html).not.toContain("Сделка 6")
    expect(html).toContain('…ещё 3 — <a href="https://app.example.ru/dashboard?chat=thr_123">открыть в CRM</a>')
    expect(html.endsWith("🌐 с данными из интернета")).toBe(true)
    expect(html).not.toContain("secret")
    // Ids appear only inside links (never in the visible text).
    expect(htmlToVisibleText(html)).not.toContain("deal-id")
    checkAll(out)
  })

  it("strips record ids and internal note lines the model copied", () => {
    const out = renderTelegramAnswer(
      [{ type: "text", text: "[Черновик: компания «X» — ожидает подтверждения]\nСм. [Маргарита](121146a8-1234-4abc-8def-0123456789ab) (ref: 121146a8-1234-4abc-8def-0123456789ab)." }],
      ctx,
    )
    expect(out[0].html).toBe("См. Маргарита.")
  })

  it("stats: pre table with short money, total, CSV button on the last answer message", () => {
    const out = renderTelegramAnswer([{ type: "text", text: "Выручка растёт." }, { type: "data-stats", data: stats() }], ctx)
    expect(out).toHaveLength(1)
    const html = out[0].html
    expect(html).toContain("📊 <b>Выручка</b> · по месяцам")
    expect(html).toContain("<i>Заказы и продажи · 01.01.2026 — 16.11.2026 · Статус: подтверждён</i>")
    expect(html).toContain("<pre>")
    const pre = htmlToVisibleText(/<pre>([\s\S]*?)<\/pre>/.exec(html)![1])
    expect(pre.split("\n")).toEqual(["Январь 2026   1,2 млн ₽", "Февраль 2026  350 тыс ₽"])
    expect(html).toContain("Всего: <b>1\u00a0584\u00a0567 ₽</b>")
    expect(out[0].buttons).toEqual([[{ text: "📎 CSV", action: { kind: "stats_csv", statsIndex: 0 } }]])
    checkAll(out)
  })

  it("stats: long labels → bullet lines; > 12 rows → «ещё N строк — в CSV»; warnings; scalar; empty", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ key: `k${i}`, label: `Очень длинное название клиента ${i}`, value: 10 + i }))
    const out = renderTelegramAnswer(
      [
        { type: "data-stats", data: stats({ rows }, { measureKind: "count", measureLabel: "Заказы", warnings: ["Значение «Х» не найдено."] }) },
        { type: "data-stats", data: stats({ rows: [], scalar: 42 }, { measureKind: "count", measureLabel: "Сделки", dimensionLabel: null }) },
        { type: "data-stats", data: stats({ rows: [], scalar: null }, { measureLabel: "Пусто" }) },
      ],
      ctx,
    )
    const html = out.map((m) => m.html).join("\n")
    expect(html).toContain("• Очень длинное название клиента 0 — 10")
    expect(html).not.toContain("клиента 12 —")
    expect(html).toContain("…ещё 3 строки — в CSV")
    expect(html).toContain("⚠️ Значение «Х» не найдено.")
    expect(html).toContain("Итог: <b>42</b>")
    expect(html).toContain("Нет данных для этого запроса.")
    // CSV only for results with data; index = position among the message's stats parts.
    expect(out.at(-1)!.buttons).toEqual([
      [{ text: "📎 CSV · Заказы", action: { kind: "stats_csv", statsIndex: 0 } }],
      [{ text: "📎 CSV · Сделки", action: { kind: "stats_csv", statsIndex: 1 } }],
    ])
    checkAll(out)
  })

  it("composed view: KeyValue, DataTable, Markdown, Badge, Stack flattened; $state resolved", () => {
    const spec = {
      root: "s",
      state: { rows: [{ name: "Альфа", sum: 1_500_000 }] },
      elements: {
        s: { type: "Stack", props: {}, children: ["kv", "t", "m", "b", "x"] },
        kv: { type: "KeyValue", props: { items: [{ label: "ИНН", value: "7700000000" }] } },
        t: {
          type: "DataTable",
          props: { title: "Топ", columns: [{ key: "name", label: "Клиент" }, { key: "sum", label: "Сумма", type: "currency" }], rows: { $state: "/rows" } },
        },
        m: { type: "Markdown", props: { content: "## Вывод\n- пункт" } },
        b: { type: "Badge", props: { label: "важно" } },
        x: { type: "Unknown", props: { title: "Заголовок" } },
      },
    }
    const out = renderTelegramAnswer([{ type: "data-spec", data: { type: "flat", spec } }], ctx)
    const html = out[0].html
    expect(html).toContain("ИНН: 7700000000")
    expect(html).toContain("<b>Топ</b>")
    expect(htmlToVisibleText(html)).toContain("Альфа   1,5 млн ₽")
    expect(html).toContain("<b>Вывод</b>\n• пункт")
    expect(html).toContain("[важно]")
    expect(html).toContain("Заголовок")
    checkAll(out)
  })

  it("composed view from json-render patches", () => {
    const out = renderTelegramAnswer(
      [
        { type: "data-spec", data: { type: "patch", patch: { op: "add", path: "/root", value: "kv" } } },
        { type: "data-spec", data: { type: "patch", patch: { op: "add", path: "/elements/kv", value: { type: "KeyValue", props: { items: [{ label: "Город", value: "Вена" }] } } } } },
      ],
      ctx,
    )
    expect(out[0].html).toBe("Город: Вена")
  })

  it("splits a very long answer, every part valid", () => {
    const text = Array.from({ length: 30 }, (_, i) => `### Раздел ${i}\n\n${"Текст с **жирным** и [ссылкой](https://x.ru). ".repeat(12)}`).join("\n\n")
    const out = renderTelegramAnswer([{ type: "text", text }], ctx)
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((m) => m.role === "answer")).toBe(true)
    checkAll(out)
  })

  it("an empty answer gets the fallback text", () => {
    const out = renderTelegramAnswer([{ type: "data-turn", data: { used: [], ms: 100 } }], ctx)
    expect(out).toHaveLength(1)
    expect(out[0].html).toContain("Не получилось сформулировать ответ")
  })
})

describe("renderTelegramAnswer — notices, questions, sources", () => {
  it("unread attachment → a notice first; read files → nothing", () => {
    const out = renderTelegramAnswer(
      [
        { type: "data-attachment", data: { itemId: "i1", name: "скан.pdf", mediaType: "application/pdf", kind: "pdf", status: "failed", reason: "файл повреждён" } },
        { type: "data-attachment", data: { itemId: "i2", name: "ok.pdf", mediaType: "application/pdf", kind: "pdf", status: "parsed" } },
        { type: "text", text: "Ответ" },
      ],
      ctx,
    )
    expect(out.map((m) => m.role)).toEqual(["notice", "answer"])
    expect(out[0].html).toBe("⚠️ Не удалось прочитать «скан.pdf»: файл повреждён")
  })

  it("question → one message with an option button per row (≤ 5)", () => {
    const out = renderTelegramAnswer(
      [
        { type: "text", text: "Уточните, пожалуйста." },
        { type: "data-question", id: "q1", data: { id: "q1", question: "Какой «Вектор»?", options: ["Вектор (Екатеринбург)", "Вектор-Плюс", "", "a", "b", "c", "d"], allowFreeText: true } },
      ],
      ctx,
    )
    const q = out.find((m) => m.role === "question")!
    expect(q.questionId).toBe("q1")
    expect(q.html).toBe("❓ Какой «Вектор»?")
    expect(q.buttons).toHaveLength(5)
    expect(q.buttons![0]).toEqual([{ text: "Вектор (Екатеринбург)", action: { kind: "question_option", questionId: "q1", option: "Вектор (Екатеринбург)" } }])
    checkAll(out)
  })

  it("sources → expandable quote with CRM items and web sites, merged", () => {
    const mail: RecordHit = { ...hit("source_item", 1), title: "Письмо от Петрова", href: "/sources?item=si1", subtitle: null, facts: [], badge: null }
    const out = renderTelegramAnswer(
      [
        { type: "text", text: "Ответ" },
        { type: "data-evidence", data: { sourceItems: [mail], web: [{ url: "https://www.alfa.ru/about", title: "https://www.alfa.ru/about" }] } },
        { type: "data-evidence", data: { sourceItems: [mail], web: [{ url: "https://vertexaisearch.cloud.google.com/r/1", title: "rbc.ru" }] } },
      ],
      ctx,
    )
    const s = out.find((m) => m.role === "sources")!
    expect(s.html).toBe(
      '<blockquote expandable><b>Источники (3)</b>\n• Письмо от Петрова · 03.11.2026 — <a href="https://app.example.ru/sources?item=si1">открыть</a>\n• alfa.ru — <a href="https://www.alfa.ru/about">ссылка</a>\n• rbc.ru — <a href="https://vertexaisearch.cloud.google.com/r/1">ссылка</a></blockquote>',
    )
    expect(out.map((m) => m.role)).toEqual(["answer", "sources"])
    checkAll(out)
  })

  it("order: notice → answer → card → question → sources", () => {
    const out = renderTelegramAnswer(
      [
        { type: "data-evidence", data: { sourceItems: [], web: [{ url: "https://a.ru", title: "a.ru" }] } },
        { type: "data-question", data: { id: "q1", question: "?", options: [], allowFreeText: true } },
        { type: "data-draft", id: "act_1", data: draftPart([company()]) },
        { type: "text", text: "Ответ" },
        { type: "data-attachment", data: { itemId: "i", name: "x.heic", mediaType: "image/heic", kind: "image", status: "skipped", reason: "формат не поддерживается" } },
      ],
      ctx,
    )
    expect(out.map((m) => m.role)).toEqual(["notice", "answer", "card", "question", "sources"])
    checkAll(out)
  })
})

// ── Cards ──────────────────────────────────────────────────────────────

const card = (d: ChatDraftPart) => renderTelegramAnswer([{ type: "data-draft", id: d.actionId, data: d }], ctx).find((m) => m.role === "card")!

describe("draft cards", () => {
  it("company + contact, confirmable: text, buttons, confirm input = the web card defaults", () => {
    const d = draftPart([contact(), company()])
    expect(telegramCardState(d)).toBe("confirm")
    const m = card(d)
    expect(m.actionId).toBe("act_1")
    expect(m.html).toBe(
      [
        "📝 <b>Черновик: компания и контакт</b>",
        "Компания: <b>Альфа ООО</b> · alfa.ru",
        "Контакт: <b>Пётр Иванов</b> · закупщик · +7 916 123-45-67 · petr@alfa.ru · @petr_iv",
        "📎 Файл будет прикреплён к записи",
      ].join("\n"),
    )
    expect(m.buttons).toEqual([
      [
        { text: "✅ Создать", action: { kind: "card_confirm", actionId: "act_1" } },
        { text: "✖️ Отменить", action: { kind: "card_cancel", actionId: "act_1" } },
      ],
      [{ text: "✏️ Изменить в CRM", url: "https://app.example.ru/dashboard?chat=thr_123" }],
    ])
    // What draft-card.tsx `submit()` sends without edits (toValues(toForm(item)), companies first).
    const expected = {
      actionId: "act_1",
      attachFile: true,
      items: [
        {
          key: "c1",
          include: true,
          decision: "create",
          values: { name: "Альфа ООО", aliases: ["Альфа"], website: "alfa.ru", email: "", phone: "", address: "", comment: "" },
        },
        {
          key: "p1",
          include: true,
          decision: "create",
          values: {
            name: "Пётр Иванов",
            nameNative: "",
            position: "закупщик",
            emails: ["petr@alfa.ru"],
            phones: ["+7 916 123-45-67"],
            telegram: "petr_iv",
            companyId: null,
            companyKey: "c1",
            companyName: "Альфа ООО",
          },
        },
      ],
    }
    const input = telegramCardConfirmInput(d)
    expect(input).toEqual(expected)
    expect(confirmActionSchema.safeParse(input).success).toBe(true)
    checkAll([m])
  })

  it("task draft: confirm input = the web card defaults; no file → attachFile false", () => {
    const d = draftPart([task()], { draft: { items: [task()], files: [] } })
    expect(telegramCardState(d)).toBe("confirm")
    const m = card(d)
    expect(m.html).toBe(
      "📝 <b>Черновик: новая задача</b>\nЗадача: <b>Позвонить Петрову</b> · срок 19.11.2026 18:00 · исполнитель Анна Смирнова · Альфа ООО",
    )
    expect(telegramCardConfirmInput(d)).toEqual({
      actionId: "act_1",
      attachFile: false,
      items: [
        {
          key: "t1",
          include: true,
          decision: "create",
          values: {
            title: "Позвонить Петрову",
            description: "Обсудить КП",
            type: "call",
            priority: "medium",
            dueDate: "2026-11-19T18:00",
            dueText: "в четверг",
            assigneeId: "u1",
            assigneeName: "Анна Смирнова",
            companyId: "cl1",
            companyKey: null,
            companyName: "Альфа ООО",
            contactId: null,
            contactKey: null,
            contactName: "",
            dealId: null,
            dealKey: null,
            dealName: "",
            done: false,
          },
        },
      ],
    })
  })

  it("one item with an exact duplicate → decision buttons; the choice goes into the confirm input", () => {
    const dupContact = contact()
    dupContact.matches = [
      { kind: "exact", type: "contact", id: "ct_9", title: "Пётр Иванов", subtitle: "Альфа ООО", reason: "тот же телефон", fill: [{ field: "telegram", label: "Telegram", value: "@petr_iv" }] },
    ]
    const d = draftPart([company(), dupContact])
    expect(telegramCardState(d)).toBe("decide")
    const m = card(d)
    expect(m.html).toContain("⚠️ Уже есть в CRM: «Пётр Иванов» (Альфа ООО) — <a href=\"https://app.example.ru/contacts?openContact=ct_9\">открыть</a>")
    expect(m.buttons!.map((r) => r.map((b) => b.text))).toEqual([
      ["Использовать существующий"],
      ["Дополнить существующий"],
      ["Создать новый"],
      ["✖️ Отменить"],
    ])
    expect(m.buttons![0][0]).toEqual({
      text: "Использовать существующий",
      action: { kind: "card_decision", actionId: "act_1", itemKey: "p1", decision: "use_existing", existingId: "ct_9" },
    })
    expect(m.buttons![2][0]).toMatchObject({ action: { decision: "create_anyway" } })
    expect(telegramCardConfirmInput(d)).toBeNull()
    expect(telegramCardConfirmInput(d, { itemKey: "p1", decision: "bogus" })).toBeNull()
    expect(telegramCardConfirmInput(d, { itemKey: "c1", decision: "create" })).toBeNull()
    const input = telegramCardConfirmInput(d, { itemKey: "p1", decision: "use_existing", existingId: "ct_9" })!
    expect(input.items.map((i) => [i.key, i.decision, i.existingId])).toEqual([
      ["c1", "create", undefined],
      ["p1", "use_existing", "ct_9"],
    ])
    expect(telegramCardConfirmInput(d, { itemKey: "p1", decision: "create_anyway" })!.items[1]).not.toHaveProperty("existingId")
    expect(confirmActionSchema.safeParse(input).success).toBe(true)
    checkAll([m])
  })

  it("no fill → no «Дополнить»; a deal match uses feminine labels", () => {
    const c = company()
    c.matches = [{ kind: "exact", type: "client", id: "cl_1", title: "Альфа", reason: "домен" }]
    expect(card(draftPart([c])).buttons!.map((r) => r[0].text)).toEqual(["Использовать существующий", "Создать новый", "✖️ Отменить"])
  })

  it("needs_input → «Не хватает …», [Изменить в CRM][Отменить]", () => {
    const d = draftPart([task({ dueDate: "", assigneeId: null, assigneeName: "" })], { status: "needs_input" })
    expect(telegramCardState(d)).toBe("needs_input")
    const m = card(d)
    expect(m.html).toContain("❓ Не хватает: срок, исполнитель. Ответьте сообщением")
    expect(m.buttons).toEqual([
      [
        { text: "✏️ Изменить в CRM", url: "https://app.example.ru/dashboard?chat=thr_123" },
        { text: "✖️ Отменить", action: { kind: "card_cancel", actionId: "act_1" } },
      ],
    ])
    expect(telegramCardConfirmInput(d)).toBeNull()
  })

  it("several items with choices → only [Изменить в CRM]", () => {
    const c = company()
    c.matches = [{ kind: "exact", type: "client", id: "cl_1", title: "Альфа", reason: "домен" }]
    const p = contact()
    p.matches = [{ kind: "deleted", type: "contact", id: "ct_1", title: "Пётр", reason: "удалён" }]
    const d = draftPart([c, p])
    expect(telegramCardState(d)).toBe("open_crm")
    expect(card(d).buttons).toEqual([[{ text: "✏️ Изменить в CRM", url: "https://app.example.ru/dashboard?chat=thr_123" }]])
    expect(telegramCardConfirmInput(d)).toBeNull()
  })

  it("a refused item is shown and sent with include: false", () => {
    const c = company({ name: "Наша компания" })
    c.refused = "Это ваша организация"
    const d = draftPart([c, contact({ companyKey: null, companyName: "" })])
    expect(telegramCardState(d)).toBe("confirm")
    expect(card(d).html).toContain("⛔ Компания: Наша компания — Это ваша организация")
    expect(telegramCardConfirmInput(d)!.items.map((i) => [i.key, i.include])).toEqual([
      ["c1", false],
      ["p1", true],
    ])
  })

  it("created → «✅ Создано» with links (from the action result too); cancelled / expired / failed", () => {
    const results = [
      { type: "client" as const, id: "cl_1", title: "Альфа ООО", href: "/clients/cl_1" },
      { type: "contact" as const, id: "ct_1", title: "Пётр Иванов", href: "/contacts?openContact=ct_1", existing: true },
    ]
    const created = card(draftPart([company(), contact()], { status: "created", results }))
    expect(created.buttons).toBeUndefined()
    expect(created.html).toContain("✅ <b>Создано:</b>")
    expect(created.html).toContain('• Компания «Альфа ООО» — <a href="https://app.example.ru/clients/cl_1">открыть</a>')
    expect(created.html).toContain("• Контакт «Пётр Иванов» — существующая запись — <a")
    expect(created.html).not.toContain("Файл будет прикреплён")

    const viaResult = renderTelegramAnswer(
      [
        { type: "data-draft", data: draftPart([company()]) },
        { type: "data-action-result", data: { actionId: "act_1", status: "created", results: results.slice(0, 1) } },
      ],
      ctx,
    ).find((m) => m.role === "card")!
    expect(viaResult.html).toContain("Компания «Альфа ООО»")
    expect(viaResult.buttons).toBeUndefined()

    expect(card(draftPart([company()], { status: "cancelled" })).html).toContain("✖️ Отменено")
    expect(card(draftPart([company()], { status: "expired" })).html).toContain("⌛ Черновик устарел")
    expect(card(draftPart([company()], { status: "failed", error: "Ошибка <БД>" })).html).toContain("⚠️ Ошибка &lt;БД&gt;")
    for (const s of ["cancelled", "expired", "failed", "created", "confirming"] as const) {
      const d = draftPart([company()], { status: s })
      expect(telegramCardState(d)).toBe("closed")
      expect(telegramCardConfirmInput(d)).toBeNull()
      expect(card(d).buttons).toBeUndefined()
    }
  })
})

describe("answerAllowedTagsOnly", () => {
  it("accepts Telegram HTML, rejects the rest", () => {
    expect(answerAllowedTagsOnly('<b>a</b> <a href="https://x.ru">b</a> <pre><code class="language-ts">c</code></pre> <blockquote expandable>d</blockquote>')).toBe(true)
    expect(answerAllowedTagsOnly("<b>a")).toBe(false)
    expect(answerAllowedTagsOnly("<b>a</i>")).toBe(false)
    expect(answerAllowedTagsOnly("<h1>a</h1>")).toBe(false)
    expect(answerAllowedTagsOnly("<table></table>")).toBe(false)
    expect(answerAllowedTagsOnly('<a href="javascript:x">a</a>')).toBe(false)
    expect(answerAllowedTagsOnly("<b><code>x</code></b>")).toBe(false)
    expect(answerAllowedTagsOnly("<blockquote><blockquote>x</blockquote></blockquote>")).toBe(false)
    expect(answerAllowedTagsOnly("a < b")).toBe(false)
    expect(answerAllowedTagsOnly("a & b")).toBe(false)
    expect(answerAllowedTagsOnly('<b class="x">a</b>')).toBe(false)
  })
})

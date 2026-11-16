import { describe, expect, it } from "vitest"
import { buildCardWriterPrompt, type CardWriterInput } from "./prompt"

const input: CardWriterInput = {
  topicId: "t1",
  sourceItemId: "i2",
  today: "2026-11-14",
  topic: {
    title: "Норлекс — КП на корпоратив",
    matter: "КП на корпоратив",
    counterparty: "Норлекс",
    contact: "Анна",
    status: "open",
    waiting: "waiting_on_us",
    family: "offer",
    leadCode: "SALES_OFFER_REQUESTED",
    leadLabelRu: "Запрошено коммерческое предложение",
    leadNoteRu: null,
    class: "chance",
    references: [],
    products: [],
  },
  signals: [{ code: "SALES_OFFER_REQUESTED", labelRu: "Запрошено КП", date: "2026-11-10", evidence: "Пришлите КП", isNew: false }],
  items: [{ date: "2026-11-13", direction: "inbound", from: "Анна", subject: null, text: "Ну что, когда будет КП?", isNew: true }],
  deadlines: [],
  overdue: false,
  current: {
    id: "card-1",
    status: "open",
    headline: "Норлекс — отправить КП",
    whyNow: "Клиент запросил КП",
    whatChanged: "",
    steps: ["Подготовить КП"],
  },
  force: null,
}

describe("card writer prompt", () => {
  it("shows the open card id to copy and marks new items", () => {
    const p = buildCardWriterPrompt(input)
    expect(p).toContain("ТЕКУЩАЯ ОТКРЫТАЯ КАРТОЧКА\nid: card-1")
    expect(p).toContain("[НОВОЕ]")
    expect(p).toContain("Компания: Норлекс")
  })

  it("never carries the score, band or profile", () => {
    const p = buildCardWriterPrompt(input).toLowerCase()
    for (const w of ["балл", "score", "band", "p8", "d4", "w1", "профиль"]) expect(p).not.toContain(w)
  })

  it("a decided card is context only; a force adds the mandatory update line", () => {
    const p = buildCardWriterPrompt({
      ...input,
      current: { ...input.current!, status: "accepted" },
      force: "Риск: затягивание решения",
    })
    expect(p).toContain("ПРОШЛАЯ КАРТОЧКА (статус: accepted")
    expect(p).not.toContain("id: card-1")
    expect(p).toContain("ОБЯЗАТЕЛЬНОЕ ОБНОВЛЕНИЕ: Риск: затягивание решения")
  })

  it("identity I4: org lines + client profile only when given; off = unchanged", () => {
    const off = buildCardWriterPrompt(input)
    expect(off).not.toContain("НАША КОМПАНИЯ")
    expect(buildCardWriterPrompt({ ...input, org: null, clientProfile: null })).toBe(off)
    const on = buildCardWriterPrompt({
      ...input,
      org: { roleLine: "Наша компания: Альфа — производитель.", productsLine: "Наши продукты и услуги: Продукт 1." },
      clientProfile: "Профиль клиента «Норлекс»: отрасль: розница",
    })
    expect(on).toContain("НАША КОМПАНИЯ\nНаша компания: Альфа — производитель.\nНаши продукты и услуги: Продукт 1.")
    expect(on).toContain("Компания: Норлекс\nПрофиль клиента «Норлекс»: отрасль: розница")
    // Still no engine fields.
    for (const w of ["балл", "score", "band", "p8", "d4", "w1"]) expect(on.toLowerCase()).not.toContain(w)
  })

  it("custom fields: «Поля компании» block after the client profile; empty / off = no block", () => {
    const off = buildCardWriterPrompt(input)
    expect(buildCardWriterPrompt({ ...input, clientFields: null })).toBe(off)
    expect(buildCardWriterPrompt({ ...input, clientFields: "  " })).toBe(off)
    expect(off).not.toContain("Поля компании:")
    const on = buildCardWriterPrompt({
      ...input,
      org: { roleLine: "Наша компания: Альфа — производитель.", productsLine: "" },
      clientProfile: "Профиль клиента «Норлекс»: отрасль: розница",
      clientFields: "Сегмент: A\nИНН: 7700000000",
    })
    expect(on).toContain("Профиль клиента «Норлекс»: отрасль: розница\nПоля компании:\nСегмент: A\nИНН: 7700000000\nСтатус:")
  })
})

describe("existing chat tasks (ai-chat-tools Q18)", () => {
  it("are listed only when present; the prompt is unchanged without them", () => {
    const base = buildCardWriterPrompt(input)
    expect(base).not.toMatch(/Задачи уже созданы/)
    expect(buildCardWriterPrompt({ ...input, existingTasks: [] })).toBe(base)
    const p = buildCardWriterPrompt({ ...input, existingTasks: ["Отправить КП Норлексу (до 20.11.2026)"] })
    expect(p).toMatch(/Задачи уже созданы \(не предлагай их снова/)
    expect(p).toContain("- Отправить КП Норлексу (до 20.11.2026)")
  })
})

import { describe, expect, it } from "vitest"
import { DEAL_STATE_NO_DATA_TEXT } from "@/lib/topics/deal-state"
import {
  buildDealStatePrompt,
  checkClearProposals,
  checkRiskExplanations,
  checkStateText,
  countSentences,
  countWords,
  decideStateOutput,
  fixedStateText,
  type DealStateInput,
} from "./state-text"

// Pure tests of the «Текущее состояние» checks (spec topics/01 §9.3).

const ITEMS = new Set(["a1", "a2"])
const GOOD =
  "Клиент перенёс решение по поставщику на после праздников и новой даты не назвал. Ждём ответа клиента; следующий шаг не определён."

describe("counting", () => {
  it("words and sentences (dates and abbreviations are not sentence ends)", () => {
    expect(countWords("Встреча 20.11 с финдиректором — после неё решат.")).toBe(7)
    expect(countSentences("Встреча 20.11 с финдиректором. После неё клиент решит.")).toBe(2)
    expect(countSentences("Клиент ждёт КП, т.е. цену и сроки.")).toBe(1)
    expect(countSentences("")).toBe(0)
  })
})

describe("checkStateText", () => {
  it("accepts a short factual text", () => {
    expect(checkStateText(GOOD)).toEqual({ ok: true })
  })
  it("rejects > 3 sentences and > 50 words", () => {
    const four = "Один факт. Второй факт. Третий факт. Четвёртый факт."
    expect(checkStateText(four)).toMatchObject({ ok: false })
    const long = Array.from({ length: 55 }, (_, i) => `слово${i}`).join(" ")
    expect(checkStateText(long)).toMatchObject({ ok: false, reasons: [expect.stringContaining("слов 55")] })
  })
  it("rejects generic stop phrases", () => {
    expect(checkStateText("Клиент заинтересован, ведутся переговоры.")).toMatchObject({ ok: false })
    expect(checkStateText("Работа со сделкой продолжается.")).toMatchObject({ ok: false })
  })
  it("rejects a text that only repeats the stage", () => {
    expect(checkStateText("Сделка находится на стадии Квалификация.", { stageName: "Квалификация" })).toMatchObject({ ok: false })
    expect(checkStateText("Квалификация: клиент прислал запрос КП на 40 человек, ждёт цену от нас до пятницы.", { stageName: "Квалификация" })).toEqual({
      ok: true,
    })
  })
})

describe("decideStateOutput", () => {
  const ctx = { previousText: null as string | null, stageName: "Квалификация", itemIds: ITEMS }
  it("UPDATE with cited input items", () => {
    expect(decideStateOutput({ decision: "UPDATE", text: GOOD, sourceItemIds: ["a1"] }, ctx)).toEqual({
      decision: "UPDATE",
      text: GOOD,
      sourceItemIds: ["a1"],
    })
  })
  it("unknown or missing sources → REJECTED (old text kept by the caller)", () => {
    expect(decideStateOutput({ decision: "UPDATE", text: GOOD, sourceItemIds: ["zz"] }, ctx)).toMatchObject({
      decision: "REJECTED",
      reasons: [expect.stringContaining("неизвестные источники")],
    })
    expect(decideStateOutput({ decision: "UPDATE", text: GOOD, sourceItemIds: [] }, ctx)).toMatchObject({ decision: "REJECTED" })
  })
  it("NOOP keeps the old text; NOOP without an old text is checked as UPDATE; the same text = NOOP", () => {
    expect(decideStateOutput({ decision: "NOOP", text: "", sourceItemIds: [] }, { ...ctx, previousText: GOOD })).toEqual({ decision: "NOOP" })
    expect(decideStateOutput({ decision: "NOOP", text: GOOD, sourceItemIds: ["a2"] }, ctx)).toMatchObject({ decision: "UPDATE" })
    expect(decideStateOutput({ decision: "UPDATE", text: ` ${GOOD} `, sourceItemIds: ["a1"] }, { ...ctx, previousText: GOOD })).toEqual({
      decision: "NOOP",
    })
  })
})

describe("risk explanations and clear proposals", () => {
  const ctx = { riskIds: new Set(["r1", "r2"]), itemIds: ITEMS }
  it("keeps valid explanations, drops unknown risks / sources / long texts", () => {
    const res = checkRiskExplanations(
      [
        { riskId: "r1", text: "Клиент дважды отложил решение и не назвал дату.", sourceItemIds: ["a1", "a2"] },
        { riskId: "r2", text: "Есть риск.", sourceItemIds: ["zz"] },
        { riskId: "r9", text: "Чужой риск.", sourceItemIds: ["a1"] },
      ],
      ctx,
    )
    expect(res.accepted.map((x) => x.riskId)).toEqual(["r1"])
    expect(res.rejected.map((x) => x.riskId)).toEqual(["r2"])
  })
  it("a clear proposal needs a cited input item", () => {
    expect(
      checkClearProposals(
        [
          { riskId: "r1", sourceItemId: "a2", reason: "Согласована встреча 20.11 с финдиректором" },
          { riskId: "r2", sourceItemId: "zz", reason: "…" },
          { riskId: "r2", sourceItemId: "a1", reason: "  " },
        ],
        ctx,
      ),
    ).toEqual([{ riskId: "r1", sourceItemId: "a2", reason: "Согласована встреча 20.11 с финдиректором" }])
  })
})

describe("fixed texts", () => {
  it("no topic → «Недостаточно информации…»; won / lost / withdrawn texts", () => {
    expect(fixedStateText({ outcome: null, outcomeReason: null, hasTopics: false })).toBe(DEAL_STATE_NO_DATA_TEXT)
    expect(fixedStateText({ outcome: null, outcomeReason: null, hasTopics: true })).toBeNull()
    expect(fixedStateText({ outcome: "won", outcomeReason: "Подписан договор поставки на 2027 год.", hasTopics: true })).toBe(
      "Сделка выиграна: Подписан договор поставки на 2027 год.",
    )
    expect(fixedStateText({ outcome: "lost", outcomeReason: null, hasTopics: true })).toBe("Сделка проиграна, причина не установлена.")
    expect(fixedStateText({ outcome: "withdrawn", outcomeReason: null, hasTopics: true })).toBe("Сделка закрыта по нашему решению.")
    expect(checkStateText(fixedStateText({ outcome: "won", outcomeReason: "x ".repeat(80), hasTopics: true })!).ok).toBe(true)
  })
})

describe("prompt", () => {
  it("lists items with ids, risks with ids and the previous text", () => {
    const input: DealStateInput = {
      dealId: "d1",
      dealName: "Норлекс — новая точка",
      clientName: "Норлекс",
      stageName: "Квалификация",
      statusRu: "активна",
      dealTypeLabel: "Новая точка",
      amount: null,
      pausedUntil: null,
      topics: [
        {
          id: "t1",
          title: "Норлекс — ассортимент",
          statusRu: "Открыта",
          waitingRu: "ждут нас",
          leadCodeLabel: "Запрошено КП",
          references: [],
          products: [],
          amounts: [],
          deadlines: ["2026-11-20 — встреча (кто — неясно)"],
          lastEvents: [],
        },
      ],
      items: [{ id: "a1", date: "2026-11-10 10:00", directionRu: "от клиента", topicTitle: "Норлекс — ассортимент", from: null, subject: "КП", excerpt: "Пришлите КП" }],
      risks: [{ id: "r1", labelRu: "Решение откладывается", descriptionRu: "…", severity: 6, evidence: ["Пока не готовы"], sourceItemIds: ["a1"] }],
      previousText: null,
      today: "2026-11-14",
    }
    const p = buildDealStatePrompt(input)
    expect(p).toContain("### id: a1")
    expect(p).toContain("### riskId: r1")
    expect(p).toContain("— (ещё нет)")
  })

  it("identity I4: org line + client profile only when given; off = unchanged", () => {
    const input: DealStateInput = {
      dealId: "d1",
      dealName: "Норлекс — поставка",
      clientName: "Норлекс",
      stageName: "Квалификация",
      statusRu: "активна",
      dealTypeLabel: null,
      amount: null,
      pausedUntil: null,
      topics: [],
      items: [],
      risks: [],
      previousText: null,
      today: "2026-11-14",
    }
    const off = buildDealStatePrompt(input)
    expect(off).not.toContain("## Наша компания")
    expect(buildDealStatePrompt({ ...input, orgRoleLine: "", clientProfile: null })).toBe(off)
    const on = buildDealStatePrompt({
      ...input,
      orgRoleLine: "Наша компания: Альфа — производитель.",
      clientProfile: "Профиль клиента «Норлекс»: отрасль: розница",
    })
    expect(on).toContain("## Наша компания\nНаша компания: Альфа — производитель.")
    expect(on).toContain("Клиент: Норлекс\nПрофиль клиента «Норлекс»: отрасль: розница")
  })

  it("custom fields: «Поля компании» block after the client profile; empty / off = no block", () => {
    const input: DealStateInput = {
      dealId: "d1",
      dealName: "Норлекс — поставка",
      clientName: "Норлекс",
      stageName: "Квалификация",
      statusRu: "активна",
      dealTypeLabel: null,
      amount: null,
      pausedUntil: null,
      topics: [],
      items: [],
      risks: [],
      previousText: null,
      today: "2026-11-14",
    }
    const off = buildDealStatePrompt(input)
    expect(buildDealStatePrompt({ ...input, clientFields: null })).toBe(off)
    expect(buildDealStatePrompt({ ...input, clientFields: "" })).toBe(off)
    expect(off).not.toContain("Поля компании:")
    const on = buildDealStatePrompt({
      ...input,
      orgRoleLine: "Наша компания: Альфа — производитель.",
      clientProfile: "Профиль клиента «Норлекс»: отрасль: розница",
      clientFields: "Сегмент: A",
    })
    expect(on).toContain("Профиль клиента «Норлекс»: отрасль: розница\nПоля компании:\nСегмент: A\nСтадия:")
  })
})


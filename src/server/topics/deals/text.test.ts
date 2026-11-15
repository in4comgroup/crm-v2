import { describe, expect, it } from "vitest"
import type { DealCardProposal } from "@/lib/topics/cards"
import { dealCardText } from "./text"

const base: DealCardProposal = {
  v: 1,
  action: "create",
  ruleId: "r1",
  code: "SALES_OFFER_REQUESTED",
  codeLabelRu: "Запрошено коммерческое предложение",
  instanceId: "i1",
  sourceItemId: "s1",
  evidence: "Пришлите, пожалуйста, КП",
  confidence: "medium",
  topicScore: 7,
  reasonRu: "уверенность ниже порога автосоздания",
  reasonCode: "medium_confidence",
  clientId: "c1",
  clientName: "Норлекс",
  contactId: null,
  contactName: null,
  dealName: "Норлекс — запрос КП",
  dealTypeId: "t1",
  dealTypeCode: "new_location",
  dealTypeLabelRu: "Новый клиент / новая точка",
  stageId: "s1",
  stageLabelRu: "Квалификация",
  fromStageId: null,
  fromStageLabelRu: null,
  dealId: null,
}

describe("dealCardText", () => {
  it("proposal headline names the company and the type", () => {
    const t = dealCardText("deal_proposal", base)
    expect(t.headline).toBe("Норлекс — новая возможность: Новый клиент / новая точка")
    expect(t.analysis).toContain("«Пришлите, пожалуйста, КП»")
    expect(t.recommendation).toContain("«Квалификация»")
  })

  it("confirmation headline names the target stage", () => {
    const t = dealCardText("stage_confirmation", {
      ...base,
      action: "move",
      stageLabelRu: "Предложение",
      fromStageLabelRu: "Квалификация",
    })
    expect(t.headline).toBe("Норлекс — перевести сделку в «Предложение»?")
    expect(t.recommendation).toContain("«Квалификация» → «Предложение»")
  })

  it("outcome and contact fallback", () => {
    expect(dealCardText("stage_confirmation", { ...base, action: "outcome_lost", clientName: null, contactName: "Иван" }).headline).toBe(
      "Иван — сделка проиграна?",
    )
  })
})

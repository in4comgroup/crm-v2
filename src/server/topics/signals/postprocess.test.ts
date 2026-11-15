import { describe, expect, it } from "vitest"
import type {
  EffectiveSignal,
  SignalAttributeRecord,
  SignalCategoryRecord,
  SignalRelationRecord,
} from "@/lib/signals/types"
import { scoreToBand } from "@/lib/signals/extraction-types"
import type { NormalizedExtraction } from "@/server/topics/prompt/extraction"
import { evidenceInText, messageContent } from "./evidence"
import { runGates } from "./gates"
import {
  buildScoringContext,
  passesDateGate,
  postprocessExtraction,
  resolveDirection,
  type ScoringContext,
} from "./postprocess"

// ── fixtures ───────────────────────────────────────────────────────────────

function cat(code: string, p: Partial<SignalCategoryRecord> = {}): SignalCategoryRecord {
  return {
    code,
    packCode: "base",
    blockCode: "A",
    family: "offer",
    labelRu: code,
    definitionRu: "",
    boundaryRu: "",
    cuesPromptRu: [],
    synonymsRu: {},
    antiCuesRu: [],
    exampleRu: "",
    counterExampleRu: "",
    cardNoteRu: "",
    weight: 5,
    scoreRule: "fixed",
    class: "chance",
    classByRelation: false,
    kind: "event",
    effort: "medium",
    carriesAmount: false,
    asksUs: false,
    inboundOnly: false,
    emittedBy: "parser",
    stage: "active",
    displayProfile: null,
    recipientRole: null,
    closesCodes: [],
    dateGate: null,
    relevanceDays: null,
    triggerRule: null,
    noteRu: null,
    retiredAt: null,
    successorCode: null,
    updatedAt: "2026-11-13T00:00:00Z",
    ...p,
  }
}

function eff(c: SignalCategoryRecord, p: Partial<EffectiveSignal> = {}): EffectiveSignal {
  return {
    code: c.code,
    packCode: c.packCode,
    blockCode: c.blockCode,
    active: true,
    reviewOnly: false,
    stage: "active",
    weight: c.weight,
    displayProfile: null,
    recipientRole: null,
    closesCodes: c.closesCodes,
    inPrompt: c.emittedBy !== "process",
    source: {},
    ...p,
  }
}

const CATS = [
  cat("ORDER_REQUESTED", { blockCode: "O", weight: 5, class: "chance", asksUs: true }),
  cat("SALES_OFFER_REQUESTED", { weight: 7, class: "chance", inboundOnly: true }),
  cat("COMPLAINT_QUALITY", { weight: 7, class: "risk" }),
  cat("INVOICE_PAID", { weight: 0, scoreRule: "state", class: null, kind: "state" }),
  cat("PRAISE", { weight: 3, class: "fyi" }),
  cat("SIGNAL_MERGER", { blockCode: "H", weight: 6, class: "chance" }),
  cat("SIGNAL_INSOLVENCY", { blockCode: "H", weight: 9, class: "risk" }),
  cat("ACCOUNT_REVENUE_DECLINE_YOY", { weight: 5, class: "risk", kind: "trend" }),
  cat("TEAM_INTERNAL", { blockCode: "J", weight: 4, class: "fyi" }),
  cat("CONTRACT_FRAME_EXPIRY", {
    weight: 8,
    class: "risk",
    dateGate: { fact: "contractEndDate", test: "within", days: 56 },
  }),
  cat("OFF_CODE", { weight: 6 }),
  cat("PROCESS_CODE", { weight: 6, emittedBy: "process", kind: "watchdog" }),
  cat("OLD_CODE", { retiredAt: "2026-01-01T00:00:00Z", successorCode: "ORDER_REQUESTED" }),
  cat("MAILERDEMON_RECEIVED", { blockCode: "I", weight: 0, scoreRule: "inherited", class: "risk" }),
  cat("CONTACT_OOO", { blockCode: "G", weight: 4, class: "fyi" }),
]

const RELATIONS: SignalRelationRecord[] = [
  { id: "r1", packCode: "base", kind: "outranks", codeA: "SIGNAL_MERGER", codeB: "SIGNAL_INSOLVENCY", settingKey: null, fact: null, noteRu: null },
]

const ATTRS: SignalAttributeRecord[] = [
  { code: "ATTR_EMOTION_ANGRY", packCode: "base", groupCode: "emotion", scope: "message", labelRu: "", definitionRu: "", weight: 2, stage: "active", defaultOff: false, profiles: [], cuesRu: [], antiCuesRu: [], noteRu: null, sort: 0 },
  { code: "ATTR_TONE_NEGATIVE", packCode: "base", groupCode: "tone", scope: "message", labelRu: "", definitionRu: "", weight: 1, stage: "active", defaultOff: false, profiles: [], cuesRu: [], antiCuesRu: [], noteRu: null, sort: 1 },
  { code: "ATTR_BREVITY", packCode: "base", groupCode: "brevity", scope: "message", labelRu: "", definitionRu: "", weight: -1, stage: "active", defaultOff: false, profiles: [], cuesRu: [], antiCuesRu: [], noteRu: null, sort: 2 },
]

function ctx(): ScoringContext {
  return buildScoringContext({
    taxonomyVersion: 3,
    categories: CATS,
    effective: CATS.map((c) => eff(c, c.code === "OFF_CODE" ? { active: false, inPrompt: false } : {})),
    blocks: [
      { code: "A", packCode: "base", labelRu: "", audience: null, internalOnly: false, firstPartyOnly: false, sort: 0 },
      { code: "J", packCode: "base", labelRu: "", audience: null, internalOnly: true, firstPartyOnly: false, sort: 1 },
    ],
    relations: RELATIONS,
    attributes: ATTRS,
  })
}

type Sig = { code: string; evidence: string; confidence?: "high" | "medium" | "low"; subjectIndex?: number; evidenceFound?: boolean }

function out(signals: Sig[], extra: Partial<NormalizedExtraction> = {}): NormalizedExtraction {
  return {
    signals: signals.map((s) => ({
      code: s.code,
      evidence: s.evidence,
      confidence: s.confidence ?? "high",
      subjectIndex: s.subjectIndex ?? 0,
      evidenceFound: s.evidenceFound ?? true,
    })),
    attributes: [],
    subjects: [{ counterparty: "Норлекс", onBehalfOf: "", matter: "заказ товара А", references: [{ kind: "order", value: " 124 " }], products: ["Товар А 2021"] }],
    facts: {
      amounts: [],
      deadlines: [],
      contractEndDate: "",
      proposedMeetingDate: "",
      paymentTermsDays: -1,
      creditLimitRequested: -1,
    },
    direction: "inbound",
    unknownCodes: [],
    unknownAttributes: [],
    ...extra,
  }
}

const TEXT = "Прошу отгрузить 12 кор. Товар А 2021 к пятнице. Пришлите КП. Брак в поставке."
const ITEM = { text: TEXT, ownText: null, date: new Date("2026-11-10T09:00:00Z"), orgAttribution: "external" }

// ── tests ─────────────────────────────────────────────────────────────────

describe("scoreToBand", () => {
  it("maps scores to bands (spec §5.5)", () => {
    expect([0, 1, 3, 4, 5, 6, 7, 8, 9, 10].map(scoreToBand)).toEqual([
      "none", "low", "low", "normal", "normal", "high", "high", "very_high", "very_high", "critical",
    ])
  })
})

describe("resolveDirection", () => {
  it("trusts parse-time attribution", () => {
    expect(resolveDirection("inbound", "own_org")).toBe("outbound")
    expect(resolveDirection("internal", "own_org")).toBe("internal")
    expect(resolveDirection("outbound", "external")).toBe("inbound")
    expect(resolveDirection("outbound", "unknown")).toBe("outbound")
    expect(resolveDirection(null, null)).toBe("inbound")
  })

  it("allInternal (identity Q9) makes `internal` deterministic, overriding the model", () => {
    expect(resolveDirection("outbound", "own_org", true)).toBe("internal")
    expect(resolveDirection("inbound", "own_org", true)).toBe("internal")
    expect(resolveDirection(null, "unknown", true)).toBe("internal")
    // Never against a deterministic external author.
    expect(resolveDirection("inbound", "external", true)).toBe("inbound")
    expect(resolveDirection("outbound", "own_org", false)).toBe("outbound")
  })
})

describe("postprocessExtraction", () => {
  it("scores the strongest counted code (max, not sum)", () => {
    const r = postprocessExtraction(
      out([
        { code: "ORDER_REQUESTED", evidence: "Прошу отгрузить 12 кор. Товар А 2021" },
        { code: "COMPLAINT_QUALITY", evidence: "Брак в поставке" },
      ]),
      ctx(),
      ITEM,
    )
    expect(r.score).toBe(7)
    expect(r.band).toBe("high")
    expect(r.dominantCode).toBe("COMPLAINT_QUALITY")
    expect(r.instances.every((i) => i.counted)).toBe(true)
    expect(r.subjects[0].references[0].value).toBe("124")
  })

  it("tie-break: risk beats chance at equal weight", () => {
    const r = postprocessExtraction(
      out([
        { code: "SALES_OFFER_REQUESTED", evidence: "Пришлите КП" },
        { code: "COMPLAINT_QUALITY", evidence: "Брак в поставке" },
      ]),
      ctx(),
      ITEM,
    )
    expect(r.dominantCode).toBe("COMPLAINT_QUALITY")
  })

  it("adds clamped attributes to the dominant instance only (06 A2)", () => {
    const r = postprocessExtraction(
      out(
        [
          { code: "ORDER_REQUESTED", evidence: "Прошу отгрузить" },
          { code: "COMPLAINT_QUALITY", evidence: "Брак в поставке" },
        ],
        {
          attributes: [
            { code: "ATTR_EMOTION_ANGRY", evidence: "x" },
            { code: "ATTR_TONE_NEGATIVE", evidence: "y" },
          ],
        },
      ),
      ctx(),
      ITEM,
    )
    expect(r.attrAdj).toBe(2)
    expect(r.score).toBe(9)
    expect(r.instances.find((i) => i.code === "ORDER_REQUESTED")!.scoreContrib).toBe(5)
    expect(r.instances.find((i) => i.code === "COMPLAINT_QUALITY")!.scoreContrib).toBe(9)
  })

  it("attributes alone never create a score", () => {
    const r = postprocessExtraction(out([], { attributes: [{ code: "ATTR_EMOTION_ANGRY", evidence: "x" }] }), ctx(), ITEM)
    expect(r.score).toBe(0)
    expect(r.band).toBe("none")
  })

  it("negative attributes floor at 0", () => {
    const r = postprocessExtraction(
      out([{ code: "PRAISE", evidence: "Прошу отгрузить" }], { attributes: [{ code: "ATTR_BREVITY", evidence: "z" }] }),
      ctx(),
      ITEM,
    )
    expect(r.score).toBe(2)
  })

  it("trend codes have the D4 ceiling (Q24-6)", () => {
    const r = postprocessExtraction(
      out([{ code: "ACCOUNT_REVENUE_DECLINE_YOY", evidence: "Брак в поставке" }], {
        attributes: [{ code: "ATTR_EMOTION_ANGRY", evidence: "x" }],
      }),
      ctx(),
      ITEM,
    )
    expect(r.score).toBe(5)
    expect(r.band).toBe("normal")
  })

  it("low confidence is stored but counts 0", () => {
    const r = postprocessExtraction(out([{ code: "COMPLAINT_QUALITY", evidence: "Брак", confidence: "low" }]), ctx(), ITEM)
    expect(r.instances).toHaveLength(1)
    expect(r.instances[0]).toMatchObject({ counted: false, notCountedReason: "low_confidence", scoreContrib: 0 })
    expect(r.score).toBe(0)
  })

  it("state codes are stored, never scored", () => {
    const r = postprocessExtraction(out([{ code: "INVOICE_PAID", evidence: "Брак" }]), ctx(), ITEM)
    expect(r.instances[0]).toMatchObject({ counted: false, notCountedReason: "state" })
    expect(r.score).toBe(0)
  })

  it("applies outranks on the same item", () => {
    const r = postprocessExtraction(
      out([
        { code: "SIGNAL_INSOLVENCY", evidence: "Брак" },
        { code: "SIGNAL_MERGER", evidence: "Пришлите КП" },
      ]),
      ctx(),
      ITEM,
    )
    expect(r.instances.find((i) => i.code === "SIGNAL_INSOLVENCY")).toMatchObject({ counted: false, notCountedReason: "outranked" })
    expect(r.score).toBe(6)
  })

  it("drops unknown, inactive, process codes and bad evidence", () => {
    const r = postprocessExtraction(
      out(
        [
          { code: "OFF_CODE", evidence: "Брак" },
          { code: "PROCESS_CODE", evidence: "Брак" },
          { code: "ORDER_REQUESTED", evidence: "этого нет в тексте", evidenceFound: false },
          { code: "COMPLAINT_QUALITY", evidence: "   " },
        ],
        { unknownCodes: ["MADE_UP"] },
      ),
      ctx(),
      ITEM,
    )
    expect(r.instances).toHaveLength(0)
    expect(r.dropped.map((d) => `${d.code}:${d.reason}`).sort()).toEqual([
      "COMPLAINT_QUALITY:empty_evidence",
      "MADE_UP:unknown_code",
      "OFF_CODE:not_active",
      "ORDER_REQUESTED:evidence_not_found",
      "PROCESS_CODE:process_code",
    ])
  })

  it("drops evidence that is only in the quoted history", () => {
    const text = "Спасибо, получили.\n\nОт: Иван\nОтправлено: 1 ноября\nПришлите КП на корпоратив"
    const r = postprocessExtraction(out([{ code: "SALES_OFFER_REQUESTED", evidence: "Пришлите КП на корпоратив" }]), ctx(), {
      ...ITEM,
      text,
      ownText: "Спасибо, получили.",
    })
    expect(r.dropped[0].reason).toBe("evidence_in_quote")
  })

  it("drops inbound-only codes on our own items", () => {
    const r = postprocessExtraction(out([{ code: "SALES_OFFER_REQUESTED", evidence: "Пришлите КП" }]), ctx(), {
      ...ITEM,
      orgAttribution: "own_org",
    })
    expect(r.direction).toBe("outbound")
    expect(r.dropped[0].reason).toBe("inbound_only")
  })

  it("drops internal-only blocks on external items", () => {
    const r = postprocessExtraction(out([{ code: "TEAM_INTERNAL", evidence: "Брак" }]), ctx(), ITEM)
    expect(r.dropped[0].reason).toBe("internal_only_block")
    const r2 = postprocessExtraction(out([{ code: "TEAM_INTERNAL", evidence: "Брак" }], { direction: "internal" }), ctx(), {
      ...ITEM,
      orgAttribution: "own_org",
    })
    expect(r2.instances).toHaveLength(1)
    // allInternal: the model said outbound, the fact keeps the internal-only code.
    const r3 = postprocessExtraction(out([{ code: "TEAM_INTERNAL", evidence: "Брак" }], { direction: "outbound" }), ctx(), {
      ...ITEM,
      orgAttribution: "own_org",
      allInternal: true,
    })
    expect(r3.direction).toBe("internal")
    expect(r3.instances).toHaveLength(1)
  })

  it("applies date gates against the item date", () => {
    const withEnd = (d: string) =>
      out([{ code: "CONTRACT_FRAME_EXPIRY", evidence: "Брак" }], {
        facts: { ...out([]).facts, contractEndDate: d },
      })
    expect(postprocessExtraction(withEnd("2026-12-20"), ctx(), ITEM).instances).toHaveLength(1)
    expect(postprocessExtraction(withEnd("2027-06-01"), ctx(), ITEM).dropped[0].reason).toBe("date_gate")
    expect(postprocessExtraction(withEnd(""), ctx(), ITEM).dropped[0].reason).toBe("date_gate")
  })

  it("normalises facts and sentinels", () => {
    const r = postprocessExtraction(
      out([], {
        facts: {
          amounts: [
            { value: 125000, currency: "rub", scope: "total", vat: "incl", evidence: "125 000 ₽", subjectIndex: 0 },
            { value: -1, currency: "", scope: "total", vat: "unknown", evidence: "", subjectIndex: 0 },
          ],
          deadlines: [
            { date: "2026-11-14", precision: "resolved", what: "отгрузка", owner: "us", evidence: "к пятнице", subjectIndex: 7 },
            { date: "2026-02-30", precision: "exact", what: "x", owner: "us", evidence: "", subjectIndex: 0 },
          ],
          contractEndDate: "",
          proposedMeetingDate: "2026-11-20",
          paymentTermsDays: 30,
          creditLimitRequested: -1,
        },
      }),
      ctx(),
      ITEM,
    )
    expect(r.facts.amounts).toEqual([{ value: 125000, currency: "RUB", scope: "total", vat: "incl", evidence: "125 000 ₽", subjectIndex: 0 }])
    expect(r.facts.deadlines).toHaveLength(1)
    expect(r.facts.deadlines[0].subjectIndex).toBe(-1)
    expect(r.facts.proposedMeetingDate).toBe("2026-11-20")
    expect(r.facts.contractEndDate).toBeNull()
    expect(r.facts.paymentTermsDays).toBe(30)
    expect(r.facts.creditLimitRequested).toBeNull()
  })
})

describe("passesDateGate", () => {
  it("beyond test", () => {
    const facts = { proposedMeetingDate: "2026-12-30" } as never
    expect(passesDateGate({ fact: "proposedMeetingDate", test: "beyond", days: 28 }, facts, new Date("2026-11-10T10:00:00Z"))).toBe(true)
    expect(passesDateGate({ fact: "proposedMeetingDate", test: "beyond", days: 28 }, facts, new Date("2026-12-10T10:00:00Z"))).toBe(false)
  })
})

describe("evidence", () => {
  it("is whitespace-, case-, quote- and ё-insensitive", () => {
    expect(evidenceInText("«Пришлите  КП»", "пришлите кп, пожалуйста")).toBe(true)
    expect(evidenceInText("ещё", "Еще раз")).toBe(true)
    expect(evidenceInText("Прошу … к пятнице", "Прошу отгрузить 12 кор. к пятнице")).toBe(true)
    expect(evidenceInText("нет такого", "совсем другое")).toBe(false)
  })

  it("takes the Content section of parsed markdown", () => {
    const md = "---\nsource_id: x\n---\n\n## Summary\n\nКлиент просит КП.\n\n## Content\n\nПришлите КП.\n"
    expect(messageContent(md)).toBe("Пришлите КП.")
    expect(messageContent("---\na: 1\n---\nПросто текст")).toBe("Просто текст")
    expect(messageContent("Синтетика")).toBe("Синтетика")
  })
})

describe("runGates", () => {
  const base = {
    provider: "imap",
    metadataJson: { from: [{ name: "Иван", email: "ivan@norlex.example" }] },
    threadExternalId: null,
    orgAttribution: "external",
    subject: "Заказ",
    from: "Иван <ivan@norlex.example>",
    fromEmail: "ivan@norlex.example",
    fromName: "Иван",
    headers: null,
    text: "Прошу отгрузить 12 кор. Товар А 2021 к пятнице.",
    date: new Date("2026-11-10T09:00:00Z"),
  }
  const deps = () => ({ ctx: ctx(), exclusions: [], blocklist: null })

  it("sends a normal business mail to the LLM", () => {
    expect(runGates(base, deps()).kind).toBe("llm")
  })

  it("skips an excluded address (R18)", () => {
    const r = runGates(base, {
      ...deps(),
      exclusions: [{ id: "e1", kind: "email", value: "ivan@norlex.example", normalizedValue: "ivan@norlex.example" }],
    })
    expect(r).toMatchObject({ kind: "skip", reason: "excluded" })
  })

  it("skips a blocklisted external sender", () => {
    const r = runGates(base, {
      ...deps(),
      blocklist: { isBlockedEmail: () => false, isBlockedDomain: (d: string) => d === "norlex.example" },
    })
    expect(r).toMatchObject({ kind: "skip", reason: "blocklist" })
  })

  it("turns a bounce into MAILERDEMON_RECEIVED without the LLM", () => {
    const r = runGates(
      {
        ...base,
        subject: "Недоставленное сообщение",
        from: "mailer-daemon@yandex.ru",
        fromEmail: "mailer-daemon@yandex.ru",
        text: "Сообщение не доставлено. 550 5.1.1 user unknown\nMessage-ID: <abc@norlex.example>",
      },
      deps(),
    )
    expect(r.kind).toBe("deterministic")
    if (r.kind !== "deterministic") return
    expect(r.gate).toBe("bounce")
    expect(r.instances[0].code).toBe("MAILERDEMON_RECEIVED")
    expect(r.score).toBe(5)
  })

  it("turns an out-of-office reply into CONTACT_OOO", () => {
    const r = runGates(
      {
        ...base,
        subject: "Автоответ: Заказ",
        text: "Я в отпуске до 20 ноября. По срочным вопросам обращайтесь к Петру Сидорову, petr@norlex.example",
      },
      deps(),
    )
    expect(r.kind).toBe("deterministic")
    if (r.kind !== "deterministic") return
    expect(r.gate).toBe("out_of_office")
    expect(r.facts.oooReturnDate).toBe("2026-11-20")
    expect(r.score).toBe(4)
  })

  it("stores a calendar reply as a fact only", () => {
    const r = runGates({ ...base, subject: "Принято: Дегустация 20.11", text: "" }, deps())
    expect(r).toMatchObject({ kind: "deterministic", gate: "calendar_reply", score: 0, instances: [] })
  })

  it("skips automated senders, but not our own items", () => {
    const auto = { ...base, from: "noreply@shop.example", fromEmail: "noreply@shop.example", fromName: null }
    expect(runGates(auto, deps())).toMatchObject({ kind: "skip", reason: "automated" })
    expect(runGates({ ...auto, orgAttribution: "own_org" }, deps()).kind).toBe("llm")
  })

  it("applies only exclusions and blocklist to chats", () => {
    const tg = { ...base, provider: "telegram", subject: "Автоответ", from: "noreply", fromEmail: null }
    expect(runGates(tg, deps()).kind).toBe("llm")
  })
})

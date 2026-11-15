import { describe, expect, it } from "vitest"
import {
  contentDisposition,
  documentTypeBucket,
  formatFileSize,
  isInlineSafeMime,
  opensInBrowser,
  planAutoLinks,
  safeFileSegment,
  type AutoLinkInput,
} from "./documents"

const base: AutoLinkInput = {
  participants: [],
  topics: [],
  contentClients: [],
  contentContacts: [],
  openDealsByClient: {},
  existing: [],
}

describe("planAutoLinks", () => {
  it("A1: sender → contact + company (high)", () => {
    const r = planAutoLinks({ ...base, participants: [{ contactId: "p1", clientId: "c1", role: "sender" }] })
    expect(r.map((x) => [x.entityType, x.entityId, x.origin, x.confidence])).toEqual([
      ["contact", "p1", "auto_participant", "high"],
      ["client", "c1", "auto_participant", "high"],
    ])
  })
  it("A2: topic → deal, company, contact; first rule wins per entity", () => {
    const r = planAutoLinks({
      ...base,
      participants: [{ contactId: "p1", clientId: "c1", role: "recipient" }],
      topics: [{ topicTitle: "T", clientId: "c1", contactId: "p2", dealId: "d1" }],
    })
    expect(r.filter((x) => x.entityId === "c1")).toHaveLength(1)
    expect(r.find((x) => x.entityId === "c1")!.origin).toBe("auto_participant")
    expect(r.find((x) => x.entityId === "d1")!.origin).toBe("auto_topic")
    expect(r.find((x) => x.entityId === "p2")!.reason).toBe("тема «T»")
  })
  it("A3: content names are medium", () => {
    const r = planAutoLinks({ ...base, contentClients: ["c9"], contentContacts: ["p9"] })
    expect(r.every((x) => x.confidence === "medium" && x.origin === "auto_content")).toBe(true)
  })
  it("A5: the company's ONLY open deal; not with 2 deals; not when a deal link exists", () => {
    const one = planAutoLinks({ ...base, contentClients: ["c1"], openDealsByClient: { c1: ["d1"] } })
    expect(one.find((x) => x.entityType === "deal")).toMatchObject({ entityId: "d1", origin: "auto_deal", confidence: "medium" })
    const two = planAutoLinks({ ...base, contentClients: ["c1"], openDealsByClient: { c1: ["d1", "d2"] } })
    expect(two.some((x) => x.entityType === "deal")).toBe(false)
    const topicDeal = planAutoLinks({
      ...base,
      topics: [{ topicTitle: "T", clientId: "c1", contactId: null, dealId: "d7" }],
      openDealsByClient: { c1: ["d1"] },
    })
    expect(topicDeal.filter((x) => x.entityType === "deal").map((x) => x.entityId)).toEqual(["d7"])
    const existingCompany = planAutoLinks({
      ...base,
      openDealsByClient: { c1: ["d1"] },
      existing: [{ entityType: "client", entityId: "c1", removed: false }],
    })
    expect(existingCompany).toEqual([expect.objectContaining({ entityType: "deal", entityId: "d1" })])
  })
  it("never re-adds existing or REMOVED links (Q3)", () => {
    const r = planAutoLinks({
      ...base,
      participants: [{ contactId: "p1", clientId: "c1", role: "sender" }],
      openDealsByClient: { c1: ["d1"] },
      existing: [
        { entityType: "contact", entityId: "p1", removed: true },
        { entityType: "deal", entityId: "d1", removed: true },
      ],
    })
    expect(r.map((x) => `${x.entityType}:${x.entityId}`)).toEqual(["client:c1"])
  })
})

describe("file helpers", () => {
  it("type buckets", () => {
    expect(documentTypeBucket("application/pdf", "a")).toBe("pdf")
    expect(documentTypeBucket("application/octet-stream", "Отчёт.DOCX")).toBe("office")
    expect(documentTypeBucket("audio/mp4", "v.m4a")).toBe("audio")
    expect(documentTypeBucket(null, "x.zip")).toBe("other")
  })
  it("inline only for safe types", () => {
    expect(isInlineSafeMime("application/pdf")).toBe(true)
    expect(isInlineSafeMime("image/svg+xml")).toBe(false)
    expect(isInlineSafeMime("text/html; charset=utf-8")).toBe(false)
    expect(opensInBrowser("image", "image/svg+xml")).toBe(false)
    expect(opensInBrowser("video", "video/mp4")).toBe(true)
    expect(opensInBrowser("office", "application/msword")).toBe(false)
  })
  it("content disposition keeps a Cyrillic name (RFC 5987)", () => {
    const h = contentDisposition('Договор "1".pdf', "attachment")
    expect(h).toContain('attachment; filename="')
    expect(h).toContain("filename*=UTF-8''%D0%94%D0%BE%D0%B3")
    expect(h).not.toMatch(/"1"/)
  })
  it("safe key segment and sizes", () => {
    expect(safeFileSegment("../../etc/passwd")).not.toContain("/")
    expect(safeFileSegment("")).toBe("file")
    expect(formatFileSize(1536)).toBe("2 КБ")
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5 МБ")
  })
})

describe("skip reason + download name", async () => {
  const { documentSkipReason, downloadFileName } = await import("./documents")
  it("skip reasons", () => {
    expect(documentSkipReason("complete", null)).toBeNull()
    expect(documentSkipReason("failed", "x")).toBe("error")
    expect(documentSkipReason("skipped", "too large (30 MB > 20 MB)")).toBe("too_large")
    expect(documentSkipReason("skipped", "unsupported type (application/zip)")).toBe("unsupported")
    expect(documentSkipReason("skipped", "something")).toBe("other")
  })
  it("adds an extension only when missing", () => {
    expect(downloadFileName("Отчёт", "text/markdown")).toBe("Отчёт.md")
    expect(downloadFileName("Таблица", "text/csv; charset=utf-8")).toBe("Таблица.csv")
    expect(downloadFileName("a.pdf", "application/pdf")).toBe("a.pdf")
    expect(downloadFileName("noext", "application/x-unknown")).toBe("noext")
  })
})

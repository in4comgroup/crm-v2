import { describe, expect, it } from "vitest"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import {
  detectFarewell,
  effectiveLinks,
  emailsInText,
  evaluateItemRules,
  normalizeAddress,
  pairKeyFor,
  planDecision,
  type LinkRow,
  type RuleEnv,
  type RuleIndex,
  type RuleItem,
} from "./contact-links"

const row = (o: Partial<LinkRow> & { clientId: string }): LinkRow => ({
  id: o.id ?? `l-${o.clientId}`,
  relation: "employee",
  status: "current",
  isPrimary: false,
  position: null,
  startedAt: null,
  endedAt: null,
  source: "manual",
  endReason: null,
  evidenceSourceItemId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
})

describe("effectiveLinks", () => {
  it("adds an implicit primary link for client_id without a row (no backfill)", () => {
    const l = effectiveLinks({ clientId: "X", position: "Директор", createdAt: "2025-05-01T00:00:00.000Z" }, [])
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ id: null, implicit: true, clientId: "X", isPrimary: true, status: "current", position: "Директор" })
  })
  it("primary = the current row of client_id; current before former", () => {
    const l = effectiveLinks({ clientId: "Y", position: null, createdAt: "2025-01-01" }, [
      row({ clientId: "X", status: "former", endedAt: "2026-03-01T00:00:00.000Z" }),
      row({ clientId: "Z", relation: "consultant" }),
      row({ clientId: "Y" }),
    ])
    expect(l.map((x) => x.clientId)).toEqual(["Y", "Z", "X"])
    expect(l[0].isPrimary).toBe(true)
    expect(l.some((x) => x.implicit)).toBe(false)
  })
  it("no client → no implicit link", () => {
    expect(effectiveLinks({ clientId: null, position: null, createdAt: "2025-01-01" }, [])).toEqual([])
  })
})

describe("planDecision", () => {
  const implicitX = effectiveLinks({ clientId: "X", position: null, createdAt: "2025-01-01T00:00:00.000Z" }, [])
  it("moved: materialise X, end it, add Y, Y primary", () => {
    const ops = planDecision({ links: implicitX, decision: "moved", fromClientId: "X", toClientId: "Y", at: "2026-11-01T00:00:00.000Z", toName: "Бета" })
    expect(ops.map((o) => o.op)).toEqual(["materialize", "end", "add", "primary"])
    expect(ops[1]).toMatchObject({ op: "end", clientId: "X", endReason: "Перешёл в Бета" })
    expect(ops[2]).toMatchObject({ op: "add", clientId: "Y", relation: "employee" })
    expect(ops[3]).toEqual({ op: "primary", clientId: "Y" })
  })
  it("both: X stays primary, Y added as consultant", () => {
    const ops = planDecision({ links: implicitX, decision: "both", fromClientId: "X", toClientId: "Y", at: "2026-11-01T00:00:00.000Z", toName: "Бета" })
    expect(ops.map((o) => o.op)).toEqual(["add"])
    expect(ops[0]).toMatchObject({ relation: "consultant" })
  })
  it("both with Y as primary materialises X and switches primary", () => {
    const ops = planDecision({
      links: implicitX,
      decision: "both",
      fromClientId: "X",
      toClientId: "Y",
      primaryClientId: "Y",
      at: "2026-11-01T00:00:00.000Z",
      toName: "Бета",
    })
    expect(ops.map((o) => o.op)).toEqual(["add", "primary"])
  })
  it("left (no Y): X ends «Больше не работает», no primary", () => {
    const ops = planDecision({ links: implicitX, decision: "moved", fromClientId: "X", toClientId: null, at: "2026-11-01T00:00:00.000Z", toName: null })
    expect(ops.map((o) => o.op)).toEqual(["materialize", "end", "primary"])
    expect(ops[1]).toMatchObject({ endReason: "Больше не работает" })
    expect(ops[2]).toEqual({ op: "primary", clientId: null })
  })
  it("a former Y link is reopened, not duplicated", () => {
    const links = effectiveLinks({ clientId: "X", position: null, createdAt: "2025-01-01" }, [
      row({ id: "lx", clientId: "X" }),
      row({ id: "ly", clientId: "Y", status: "former", endedAt: "2025-06-01T00:00:00.000Z" }),
    ])
    const ops = planDecision({ links, decision: "moved", fromClientId: "X", toClientId: "Y", at: "2026-11-01T00:00:00.000Z", toName: "Бета" })
    expect(ops.map((o) => o.op)).toEqual(["end", "reopen", "primary"])
  })
})

describe("text helpers", () => {
  it("detects RU / EN farewells", () => {
    expect(detectFarewell("Коллеги, сегодня мой последний рабочий день в компании.").found).toBe(true)
    expect(detectFarewell("Я больше не работаю в компании, пишите Анне").found).toBe(true)
    expect(detectFarewell("Please note I am no longer with the company").found).toBe(true)
    expect(detectFarewell("Today is my last day").found).toBe(true)
    expect(detectFarewell("Пришлите счёт до пятницы").found).toBe(false)
  })
  it("finds emails and normalises addresses", () => {
    expect(emailsInText("пишите на Ivan@Beta.example, копия a@b.io.")).toEqual(["ivan@beta.example", "a@b.io"])
    expect(normalizeAddress("email", " A@B.IO ")).toBe("a@b.io")
    expect(normalizeAddress("email", "nope")).toBe("")
    expect(normalizeAddress("phone", "+43 (1) 234-56-78")).toBe("431234567" + "8")
    expect(normalizeAddress("telegram", "@Ivan_P")).toBe("ivan_p")
  })
  it("pair keys are symmetric for two records", () => {
    const a = pairKeyFor({ contactId: "a", candidateContactId: "b", newAddress: null, newAddressKind: null, toClientId: "Y", fromClientId: "X", kind: "same_person" })
    const b = pairKeyFor({ contactId: "b", candidateContactId: "a", newAddress: null, newAddressKind: null, toClientId: "X", fromClientId: "Y", kind: "same_person" })
    expect(a).toBe(b)
  })
})

// ── Rules ──────────────────────────────────────────────────────────────────

function index(): RuleIndex {
  const idx: RuleIndex = {
    contacts: new Map(),
    contactsByEmail: new Map(),
    addressClient: new Map(),
    contactsByPersonKey: new Map(),
    clientsByDomain: new Map([
      ["alpha.example", new Set(["X"])],
      ["beta.example", new Set(["Y"])],
    ]),
    clientsByKey: new Map([
      [companyMatchKey("Альфа"), new Set(["X"])],
      [companyMatchKey("Бета"), new Set(["Y"])],
    ]),
    clientNames: new Map([
      ["X", "Альфа"],
      ["Y", "Бета"],
    ]),
  }
  const add = (id: string, name: string, email: string | null, clientIds: string[], phone: string | null = null) => {
    idx.contacts.set(id, { id, name, nameNative: null, aliases: null, email, phone, clientIds })
    if (email) idx.contactsByEmail.set(email, new Set([id]))
    idx.contactsByPersonKey.set(personMatchKey(name), new Set([...(idx.contactsByPersonKey.get(personMatchKey(name)) ?? []), id]))
  }
  add("c1", "Иван Петров", "ivan@alpha.example", ["X"], "+43 1 111 22 33")
  add("c2", "Мария Соколова", "maria@gmail.com", ["X"])
  return idx
}

const env = (recent = false): RuleEnv => ({ isOwnEmail: (e) => e.endsWith("@us.example"), recentFromClient: () => recent })

function item(o: Partial<RuleItem>): RuleItem {
  return {
    id: "i1",
    date: "2026-11-10T10:00:00.000Z",
    fromEmail: null,
    fromName: null,
    participants: [],
    text: "",
    signalCodes: [],
    isBounce: false,
    isAutoReply: false,
    details: new Map(),
    organizations: [],
    ...o,
  }
}

describe("evaluateItemRules", () => {
  it("P1: farewell with a new address at client Y → moved X → Y (high)", () => {
    const out = evaluateItemRules(
      item({
        fromEmail: "ivan@alpha.example",
        participants: [{ email: "ivan@alpha.example", name: "Иван Петров", role: "from" }],
        text: "Коллеги, сегодня мой последний рабочий день. Новый адрес: ivan.petrov@beta.example",
      }),
      index(),
      env(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ contactId: "c1", fromClientId: "X", toClientId: "Y", kind: "moved", rule: "P1", confidence: "high", newAddress: "ivan.petrov@beta.example" })
  })
  it("P1: farewell without a known company → left (company unknown)", () => {
    const out = evaluateItemRules(
      item({ fromEmail: "ivan@alpha.example", text: "Я больше не работаю в компании, пишите на ivan@newco.example" }),
      index(),
      env(),
    )
    expect(out[0]).toMatchObject({ kind: "left", toClientId: null, toCompanyName: "newco.example", newAddress: "ivan@newco.example" })
  })
  it("P1: CONTACT_LEAVING signal alone also proposes", () => {
    const out = evaluateItemRules(item({ fromEmail: "ivan@alpha.example", text: "Передаю дела коллеге.", signalCodes: ["CONTACT_LEAVING"] }), index(), env())
    expect(out[0]).toMatchObject({ kind: "left", rule: "P1" })
  })
  it("P1: a bounce of the primary address → left (medium)", () => {
    const out = evaluateItemRules(
      item({ fromEmail: "mailer-daemon@mx.example", isBounce: true, text: "Delivery failed to ivan@alpha.example: user unknown" }),
      index(),
      env(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ contactId: "c1", kind: "left", confidence: "medium" })
  })
  it("P2: the same name writes from client Y's domain → moved (medium)", () => {
    const out = evaluateItemRules(
      item({ fromEmail: "i.petrov@beta.example", participants: [{ email: "i.petrov@beta.example", name: "Петров Иван", role: "from" }] }),
      index(),
      env(false),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ contactId: "c1", toClientId: "Y", kind: "moved", rule: "P2", confidence: "medium" })
  })
  it("P2: same phone in the signature → high", () => {
    const out = evaluateItemRules(
      item({
        participants: [{ email: "i.petrov@beta.example", name: "Иван Петров", role: "from" }],
        details: new Map([["i.petrov@beta.example", { phone: "+43 (1) 111-22-33", nativeName: null }]]),
      }),
      index(),
      env(),
    )
    expect(out[0].confidence).toBe("high")
  })
  it("P4: X activity within 60 days → second_company", () => {
    const out = evaluateItemRules(item({ participants: [{ email: "i.petrov@beta.example", name: "Иван Петров", role: "to" }] }), index(), env(true))
    expect(out[0]).toMatchObject({ kind: "second_company", rule: "P4" })
  })
  it("P2: an existing second record at Y → same_person with the candidate", () => {
    const idx = index()
    idx.contacts.set("c9", { id: "c9", name: "Иван Петров", nameNative: null, aliases: null, email: "i.petrov@beta.example", phone: null, clientIds: ["Y"] })
    idx.contactsByEmail.set("i.petrov@beta.example", new Set(["c9"]))
    idx.contactsByPersonKey.get(personMatchKey("Иван Петров"))!.add("c9")
    const out = evaluateItemRules(item({ participants: [{ email: "i.petrov@beta.example", name: "Иван Петров", role: "from" }] }), idx, env())
    expect(out[0]).toMatchObject({ contactId: "c1", candidateContactId: "c9", kind: "same_person" })
  })
  it("name alone never proposes (unknown domain / free mail)", () => {
    expect(evaluateItemRules(item({ participants: [{ email: "ivan@unknown.example", name: "Иван Петров", role: "from" }] }), index(), env())).toEqual([])
    expect(evaluateItemRules(item({ participants: [{ email: "ivan.p@gmail.com", name: "Иван Петров", role: "from" }] }), index(), env())).toEqual([])
  })
  it("our own addresses never propose", () => {
    expect(evaluateItemRules(item({ fromEmail: "ivan@us.example", participants: [{ email: "ivan@us.example", name: "Иван Петров", role: "from" }], text: "последний рабочий день" }), index(), env())).toEqual([])
  })
  it("P3: free-mail author, the item names exactly one other client → second_company", () => {
    const out = evaluateItemRules(
      item({ fromEmail: "maria@gmail.com", organizations: [{ key: companyMatchKey("Бета"), domain: null }] }),
      index(),
      env(),
    )
    expect(out[0]).toMatchObject({ contactId: "c2", toClientId: "Y", kind: "second_company", rule: "P3" })
  })
})

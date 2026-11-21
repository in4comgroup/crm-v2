import { describe, expect, it } from "vitest"
import type { TopicList } from "./attention-types"
import { deliveryLinks, morningModel, userLists, weeklyModel } from "./delivery-content"
import { freezeLists, listAtMoment, viewerLists, type SnapshotContext, type SnapshotFacts } from "./list-snapshot"
import type { TopicEntry } from "./topic-ui"

const msk = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`)
const DIGEST_AT = msk("2026-11-16 07:30")
const WEEK_AT = msk("2026-11-13 12:00")

describe("list at a snapshot moment (rebuilt from stored data)", () => {
  const events = [
    { at: msk("2026-11-16 09:00"), from: "digest", to: "week" },
    { at: msk("2026-11-16 12:00"), from: "week", to: "none" },
    { at: msk("2026-11-15 10:00"), from: "none", to: "digest" },
  ]
  it("attention computed before the snapshot → its read-time placement at that moment", () => {
    expect(listAtMoment({ storedList: "none", computedAt: msk("2026-11-16 06:00"), placedAt: "week", events: [] }, DIGEST_AT)).toBe("week")
  })
  it("else the `from` of the first list change after the snapshot", () => {
    expect(listAtMoment({ storedList: "none", computedAt: msk("2026-11-16 12:00"), placedAt: "none", events }, DIGEST_AT)).toBe("digest")
    expect(listAtMoment({ storedList: "none", computedAt: msk("2026-11-16 12:00"), placedAt: "none", events }, msk("2026-11-16 10:00"))).toBe("week")
  })
  it("no change after the snapshot → the stored list; a topic created after it → none", () => {
    expect(listAtMoment({ storedList: "digest", computedAt: msk("2026-11-16 10:00"), placedAt: null, events: [] }, DIGEST_AT)).toBe("digest")
    expect(
      listAtMoment({ storedList: "digest", computedAt: msk("2026-11-16 10:00"), placedAt: null, events: [{ at: msk("2026-11-16 10:00"), from: "none", to: "digest" }] }, DIGEST_AT),
    ).toBe("none")
  })
})

// ── Freeze ────────────────────────────────────────────────────────────────

type Row = {
  topicId: string
  ownerUserId: string | null
  dealOwnerUserId: string | null
  lastActivityAt: string
  attention: {
    list: TopicList
    profile: string | null
    escalations: string[]
    cycleStartedAt: string | null
    section?: "expired" | "dormant" | null
    score: number
    explanation?: string[]
    limited?: boolean
  } | null
}

function row(id: string, list: TopicList, p: Partial<NonNullable<Row["attention"]>> & { owner?: string } = {}): Row {
  return {
    topicId: id,
    ownerUserId: p.owner ?? null,
    dealOwnerUserId: null,
    lastActivityAt: "2026-11-15T10:00:00Z",
    attention: {
      list,
      profile: list === "now" ? "P8" : list === "digest" ? "D4" : list === "week" ? "W1" : null,
      escalations: [],
      cycleStartedAt: "2026-11-15T10:00:00Z",
      section: null,
      score: 5,
      explanation: ["лид: X", "итог: «…»"],
      ...p,
    },
  }
}

function facts(p: Partial<SnapshotFacts> = {}): SnapshotFacts {
  return { snoozed: false, digestList: "none", weekList: "none", weekSection: null, dormantWindowEnd: null, ...p }
}

function ctx(f: Record<string, Partial<SnapshotFacts>>): SnapshotContext {
  return {
    digestAt: DIGEST_AT.toISOString(),
    weekAt: WEEK_AT.toISOString(),
    facts: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, facts(v)])),
  }
}

const ids = (rows: { topicId: string; snapshot: string }[]) => rows.map((r) => `${r.topicId}:${r.snapshot}`)

describe("frozen «Сводка» (06 §7.2: 07:30 snapshot + «Новое с утра»)", () => {
  it("keeps the snapshot between points; later topics are «since»; a topic that dropped stays held", () => {
    const lists = {
      now: [row("D", "now")],
      digest: [row("A", "digest"), row("B", "digest")],
      week: [row("C", "week", { score: 3 })],
      others: [row("E", "none", { score: 4 }), row("F", "none")],
    }
    const c = ctx({
      A: { digestList: "digest" },
      B: { digestList: "week" }, // rose from «Неделя» after 07:30
      C: { digestList: "digest" }, // we replied (H3) → dropped to «Неделя»: held
      D: { digestList: "digest" }, // rose to «Сейчас»: shown there only
      E: { digestList: "digest" }, // card expired → no list: held
      F: { digestList: "digest", snoozed: true }, // the user snoozed it: leaves
    })
    const r = freezeLists(lists, c)
    expect(ids(r.digest)).toEqual(["A:snapshot", "E:held", "C:held", "B:since"])
    // A held topic is not repeated in «Неделя».
    expect(r.week.map((e) => e.topicId)).toEqual([])
    const heldC = r.digest.find((e) => e.topicId === "C")!
    expect(heldC.attention!.explanation).toEqual([
      "лид: X",
      "в утреннем снимке «Сводки»; сейчас тема в «Неделе» — до следующего снимка",
      "итог: «Сводка» (снимок)",
    ])
  })

  it("P6 overflow of the daily limit: in the snapshot when its cycle started before 07:30", () => {
    const lists = {
      now: [],
      digest: [
        row("L1", "digest", { limited: true, profile: "P6", cycleStartedAt: msk("2026-11-15 10:00").toISOString() }),
        row("L2", "digest", { limited: true, profile: "P6", cycleStartedAt: msk("2026-11-16 09:00").toISOString() }),
      ],
      week: [],
      others: [],
    }
    const r = freezeLists(lists, ctx({ L1: { digestList: "now" }, L2: { digestList: "now" } }))
    expect(ids(r.digest)).toEqual(["L1:snapshot", "L2:since"])
  })
})

describe("frozen «Неделя» (06 §7.2: weekly review snapshot, «Истекло», «Тема затихла»)", () => {
  it("snapshot, held, «since»; a dormant topic waits for its own snapshot and shows once", () => {
    const lists = {
      now: [],
      digest: [],
      week: [
        row("W1", "week"),
        row("W2", "week"),
        row("W4", "week", { section: "dormant" }),
        row("W5", "week", { section: "dormant" }),
      ],
      others: [row("W3", "none"), row("W6", "none")],
    }
    const c = ctx({
      W1: { weekList: "week" },
      W2: { weekList: "none" }, // joined after Friday 12:00
      W3: { weekList: "week", weekSection: "expired" }, // «Истекло», grace over since: held
      W4: { weekList: "none", dormantWindowEnd: msk("2026-11-27 12:00").toISOString() }, // dormant after the review: waits
      W5: { weekList: "week", dormantWindowEnd: msk("2026-11-20 12:00").toISOString() }, // its first snapshot
      W6: { weekList: "week", dormantWindowEnd: WEEK_AT.toISOString() }, // window ended AT this review: shown once already
    })
    const r = freezeLists(lists, c)
    expect(ids(r.week)).toEqual(["W1:snapshot", "W5:snapshot", "W3:held", "W2:since"])
    expect(r.week.find((e) => e.topicId === "W3")!.attention!.section).toBe("expired")
  })
})

// ── Same content for the dashboard and the emails ─────────────────────────

function entry(id: string, list: TopicList, p: Partial<TopicEntry["attention"] & object> = {}): TopicEntry {
  return {
    topicId: id,
    title: `Тема ${id}`,
    matter: "",
    status: "open",
    subState: "none",
    clientId: null,
    clientName: "ООО Норлекс",
    contactId: null,
    contactName: null,
    taskContactId: null,
    family: null,
    sources: [],
    sourceCount: 0,
    dealId: null,
    dealName: null,
    dealOwnerUserId: null,
    ownerUserId: null,
    ownerName: null,
    leadCode: null,
    leadLabelRu: null,
    lastActivityAt: "2026-11-15T10:00:00Z",
    snoozedUntil: null,
    attention: {
      list,
      profile: list === "digest" ? "D4" : "W1",
      band: "normal",
      class: null,
      score: 5,
      deadline: null,
      overdue: false,
      escalations: [],
      section: null,
      hiddenReason: null,
      explanation: [],
      cycleStartedAt: "2026-11-15T10:00:00Z",
      cycleReason: "created",
      cardExpiresAt: null,
      ...p,
    },
    card: null,
    dealCards: [],
    marker: null,
    reminder: null,
  }
}

describe("emails use the frozen lists (userLists = viewerLists + routing)", () => {
  const org = {
    now: [],
    digest: [entry("A", "digest"), entry("B", "digest")],
    week: [entry("C", "week"), entry("X", "week")],
    others: [],
    snapshot: ctx({ A: { digestList: "digest" }, B: { digestList: "none" }, C: { digestList: "digest" }, X: { weekList: "week" } }),
  }
  const members = new Set(["anna"])
  const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "")

  it("dashboard and email see the same «Сводка» / «Неделя»", () => {
    const dash = viewerLists(org, org.snapshot, "anna", members, 3, dayOf)
    const mail = userLists(org, "anna", members, 3, dayOf)
    expect(mail.digest.map((e) => [e.topicId, e.snapshot])).toEqual(dash.digest.map((e) => [e.topicId, e.snapshot]))
    expect(mail.week.map((e) => e.topicId)).toEqual(dash.week.map((e) => e.topicId))
    expect(mail.digest.map((e) => e.topicId)).toEqual(["A", "C", "B"])
    expect(mail.week.map((e) => e.topicId)).toEqual(["X"])
  })

  it("morning email: «Сводка» = the snapshot (N visible), «Новое с утра» apart; weekly email has «Новое после обзора»", () => {
    const lists = userLists(org, "anna", members, 3, dayOf)
    const mc = {
      orgName: "Org",
      userName: null,
      localDay: "2026-11-16",
      timeZone: "Etc/GMT-3",
      links: deliveryLinks("https://app.example"),
      digestVisibleItems: 1,
    }
    const m = morningModel(lists, mc)
    expect(m.sections.map((s) => [s.title, s.entries.map((e) => e.topicId)])).toEqual([
      ["Сейчас", []],
      ["Сводка", ["A", "C"]],
      ["Новое с утра", ["B"]],
    ])
    expect(m.sections[1].visible).toBe(1)
    const w = weeklyModel({ ...lists, week: [...lists.week, { ...entry("N", "week"), snapshot: "since" }] }, mc)
    expect(w.sections.map((s) => [s.title, s.entries.map((e) => e.topicId)])).toEqual([
      ["Неделя", ["X"]],
      ["Истекло", []],
      ["Тема затихла", []],
      ["Новое после обзора", ["N"]],
    ])
  })
})

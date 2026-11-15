import { describe, expect, it } from "vitest"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import {
  aiMonthlyLimitText,
  clientProposalsKey,
  dueTaskReminders,
  failedRunParts,
  fmtUsd,
  isCredentialsError,
  isoWeekKey,
  monthlyLimitStep,
  orgProfilePeriodKey,
  previousUtcMonthKey,
  sourceIsFailing,
  taskReminderKeys,
  taskReminderText,
} from "./rules"

// Europe/Vienna, Mon–Fri; 2026-11-16 is a Monday (CET = UTC+1).
const cal = new WorkCalendar(
  [
    { day: "2026-12-31", isWorking: false, isShort: false },
    { day: "2027-01-01", isWorking: false, isShort: false },
  ],
  { timeZone: "Europe/Vienna", workStart: "08:00", workEnd: "18:00" },
)
const at = (day: string, hhmm: string) => cal.at(day, hhmm)

function kinds(input: Parameters<typeof dueTaskReminders>[0], now: Date) {
  return dueTaskReminders(input, cal, now).map((r) => r.kind)
}

describe("task reminders (Q7)", () => {
  const monday = { taskId: "t1", dueAt: at("2026-11-16", "00:00"), status: "todo", createdAt: at("2026-11-10", "10:00") }

  it("Monday task: «tomorrow» on Friday 09:00, not before, not on the weekend after the day starts", () => {
    expect(kinds(monday, at("2026-11-13", "08:59"))).toEqual([])
    expect(kinds(monday, at("2026-11-13", "09:00"))).toEqual(["task.due_tomorrow"])
    expect(kinds(monday, at("2026-11-15", "20:00"))).toEqual(["task.due_tomorrow"])
    expect(kinds(monday, at("2026-11-16", "00:30"))).toEqual([])
  })

  it("due day: «today» at 09:00 until the day ends", () => {
    expect(kinds(monday, at("2026-11-16", "09:00"))).toEqual(["task.due_today"])
    expect(kinds(monday, at("2026-11-16", "23:30"))).toEqual(["task.due_today"])
  })

  it("overdue once at 09:00 of the next working day, within 3 days", () => {
    expect(kinds(monday, at("2026-11-17", "08:00"))).toEqual([])
    expect(kinds(monday, at("2026-11-17", "09:15"))).toEqual(["task.overdue"])
    expect(kinds(monday, at("2026-11-21", "09:15"))).toEqual([])
  })

  it("Friday task: overdue on Monday", () => {
    const fri = { ...monday, dueAt: at("2026-11-20", "00:00") }
    expect(kinds(fri, at("2026-11-21", "10:00"))).toEqual([])
    expect(kinds(fri, at("2026-11-23", "09:15"))).toEqual(["task.overdue"])
  })

  it("holidays: the working day before Jan 4 is Dec 30", () => {
    const t = { ...monday, dueAt: at("2027-01-04", "00:00"), createdAt: at("2026-12-01", "10:00") }
    expect(kinds(t, at("2026-12-30", "09:10"))).toEqual(["task.due_tomorrow"])
    expect(kinds(t, at("2026-12-29", "12:00"))).toEqual([])
  })

  it("created after the «tomorrow» moment → no «tomorrow» notice", () => {
    const t = { ...monday, createdAt: at("2026-11-14", "12:00") }
    expect(kinds(t, at("2026-11-15", "12:00"))).toEqual([])
  })

  it("task with a time: «today» at min(09:00, due − 2 h)", () => {
    const early = { ...monday, dueAt: at("2026-11-16", "10:00") }
    expect(kinds(early, at("2026-11-16", "07:59"))).toEqual([])
    expect(kinds(early, at("2026-11-16", "08:00"))).toEqual(["task.due_today"])
    const late = { ...monday, dueAt: at("2026-11-16", "16:00") }
    expect(kinds(late, at("2026-11-16", "08:30"))).toEqual([])
    expect(kinds(late, at("2026-11-16", "09:00"))).toEqual(["task.due_today"])
  })

  it("created on its due day after 09:00 → «today» at once", () => {
    const t = { ...monday, dueAt: at("2026-11-16", "17:00"), createdAt: at("2026-11-16", "13:05") }
    expect(kinds(t, at("2026-11-16", "13:05"))).toEqual(["task.due_today"])
  })

  it("closed tasks never notify; keys carry the due day", () => {
    expect(kinds({ ...monday, status: "done" }, at("2026-11-16", "10:00"))).toEqual([])
    expect(dueTaskReminders(monday, cal, at("2026-11-16", "10:00"))[0].dedupeKey).toBe("task.due_today:t1:2026-11-16")
    expect(taskReminderKeys("t1", "2026-11-16")).toEqual([
      "task.due_tomorrow:t1:2026-11-16",
      "task.due_today:t1:2026-11-16",
      "task.overdue:t1:2026-11-16",
    ])
  })

  it("texts", () => {
    expect(taskReminderText("task.due_today", { name: "Позвонить", dueAt: at("2026-11-16", "15:00") }, cal)).toEqual({
      title: "Срок задачи сегодня: Позвонить",
      body: "Срок: сегодня в 15:00.",
    })
    expect(taskReminderText("task.due_tomorrow", { name: "X", dueAt: at("2026-11-16", "00:00") }, cal).body).toContain("16 ноября")
  })
})

describe("AI limit steps", () => {
  it("thresholds", () => {
    expect(monthlyLimitStep(0.69)).toBe(0)
    expect(monthlyLimitStep(0.7)).toBe(70)
    expect(monthlyLimitStep(0.95)).toBe(90)
    expect(monthlyLimitStep(1)).toBe(100)
    expect(monthlyLimitStep(Number.NaN)).toBe(0)
  })
  it("text with Russian numbers", () => {
    const now = new Date("2026-11-15T10:00:00Z")
    expect(aiMonthlyLimitText(70, 14.4, 20, now).title).toBe("Использовано 72 % месячного лимита ИИ (14,40 из 20 $)")
    expect(aiMonthlyLimitText(100, 20.1, 20, now).body).toContain("1 декабря")
    expect(fmtUsd(1234.5)).toBe("1 234,50")
    expect(previousUtcMonthKey(new Date("2026-01-03T00:00:00Z"))).toBe("2025-12")
  })
})

describe("org profile period", () => {
  it("ISO weeks", () => {
    expect(isoWeekKey("2026-11-16")).toBe("2026-W47")
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53")
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01")
  })
  it("a new period every Monday 09:00 org time", () => {
    expect(orgProfilePeriodKey(cal, at("2026-11-16", "08:59"))).toBe("profile.org.incomplete:2026-W46")
    expect(orgProfilePeriodKey(cal, at("2026-11-16", "09:00"))).toBe("profile.org.incomplete:2026-W47")
    expect(orgProfilePeriodKey(cal, at("2026-11-22", "23:00"))).toBe("profile.org.incomplete:2026-W47")
  })
  it("client proposals digest after 09:00 only", () => {
    expect(clientProposalsKey(cal, at("2026-11-16", "08:30"))).toBeNull()
    expect(clientProposalsKey(cal, at("2026-11-16", "09:10"))).toBe("profile.client.proposals:2026-11-16")
  })
})

describe("source health", () => {
  const run = { id: "r1", startedAt: new Date("2026-11-15T03:00:00Z") }
  it("failing after the grace when no success since the failed run", () => {
    const base = { lastSyncedAt: new Date("2026-11-14T03:05:00Z"), latestRun: run, latestError: "boom", failedRunsInRow: 1 }
    expect(sourceIsFailing(base, new Date("2026-11-15T05:00:00Z"))).toBe(false)
    expect(sourceIsFailing(base, new Date("2026-11-15T06:00:00Z"))).toBe(true)
    expect(sourceIsFailing({ ...base, failedRunsInRow: 3 }, new Date("2026-11-15T03:30:00Z"))).toBe(true)
    expect(sourceIsFailing({ ...base, lastSyncedAt: new Date("2026-11-15T04:00:00Z") }, new Date("2026-11-15T08:00:00Z"))).toBe(false)
    expect(sourceIsFailing({ ...base, latestError: null }, new Date("2026-11-15T08:00:00Z"))).toBe(false)
  })
  it("credentials errors", () => {
    expect(isCredentialsError("Source s1 (gchat) has no credentials configured. Open …")).toBe(true)
    expect(isCredentialsError("socket hang up")).toBe(false)
  })
})

describe("runs", () => {
  it("failed parts of one org", () => {
    expect(failedRunParts({ phases: { intake: { inserted: 2 }, signals: { error: "x" }, cards: { skipped: "y" } } })).toEqual(["signals"])
    expect(failedRunParts({ error: "actor" })).toEqual(["org"])
  })
})

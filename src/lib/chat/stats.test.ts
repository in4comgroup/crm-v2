import { describe, expect, it } from "vitest"
import { STATS_SUBJECTS, STATS_VOCAB, statsCsv, statsValueText, type StatsResult } from "./stats"

const base = (over: Partial<StatsResult> = {}): StatsResult => ({
  query: { subject: "deals" },
  subject: "deals",
  subjectLabel: "Сделки",
  rows: [],
  scalar: null,
  meta: {
    measureLabel: "Сумма сделок",
    measureKind: "money",
    dimensionLabel: "Стадия",
    splitLabel: null,
    total: 0,
    rowCount: 0,
    truncated: false,
    periodLabel: "за всё время",
    chart: "bar",
    warnings: [],
    applied: [],
  },
  ...over,
})

describe("chat stats contract", () => {
  it("every subject has its default measure and Russian labels", () => {
    for (const s of STATS_SUBJECTS) {
      const v = STATS_VOCAB[s]
      expect(v.measures[v.defaultMeasure], s).toBeDefined()
      for (const m of Object.values(v.measures)) expect(m.label).toMatch(/[А-Яа-я]/)
      for (const d of Object.values(v.dimensions)) expect(d.label).toMatch(/[А-Яа-я]/)
    }
  })

  it("formats values by kind", () => {
    expect(statsValueText(1234567, "money").replace(/\s/g, " ")).toBe("1 234 567")
    expect(statsValueText(33.333, "percent")).toBe("33,3 %")
    expect(statsValueText(4.25, "days")).toBe("4,3 дн.")
  })

  it("writes Excel-friendly CSV", () => {
    const csv = statsCsv(
      base({
        rows: [
          { key: "a", label: "Квалификация; первая", value: 1500.5 },
          { key: "b", label: 'КП "отправлено"', value: 20 },
        ],
      }),
    )
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv).toBe('﻿Стадия;Сумма сделок\r\n"Квалификация; первая";1500,5\r\n"КП ""отправлено""";20\r\n')
  })

  it("writes a split column and a scalar", () => {
    const split = statsCsv(
      base({
        meta: { ...base().meta, splitLabel: "Ответственный" },
        rows: [{ key: "a", label: "2026-01", value: 2, splitKey: "u1", splitLabel: "Иван" }],
      }),
    )
    expect(split).toContain("Стадия;Ответственный;Сумма сделок\r\n2026-01;Иван;2")
    const scalar = statsCsv(base({ scalar: 42, meta: { ...base().meta, dimensionLabel: null } }))
    expect(scalar).toContain("Сумма сделок;42")
  })
})

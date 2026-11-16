// Render tests of the chat <StatsBlock> (spec ai-chat §8) and a guard that
// the shared chart refactor left the /analytics <AnalyticsAnswerCard> as it was.
// Server render only (no DOM): recharts draws nothing without a size, so the
// assertions read the header, chips, table and tile text.

import { createElement, type ReactElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AnalyticsAnswerCard } from "@/components/blocks/analytics/analytics-answer-card"
import { StatsBlock, statsCsvFileName } from "@/components/blocks/chat/stats-block"
import type { AnalyticsQueryResult } from "@/lib/analytics-semantic"
import type { StatsResult } from "@/lib/chat/stats"

async function html(el: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(el)
  await stream.allReady
  return (await new Response(stream).text()).replace(/<!-- -->/g, "")
}

/** Visible text, one "|" between text nodes (styles dropped, plain spaces). */
async function text(el: ReactElement): Promise<string> {
  return (await html(el))
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/&quot;/g, '"')
    .replace(/[\u00a0\u202f]/g, " ") // Intl uses no-break spaces in numbers
}

function stats(over: Omit<Partial<StatsResult>, "meta"> & { meta?: Partial<StatsResult["meta"]> }): StatsResult {
  const base: StatsResult = {
    query: { subject: "deals", measure: "amount", dimension: "owner" },
    subject: "deals",
    subjectLabel: "Сделки",
    rows: [],
    scalar: null,
    meta: {
      measureLabel: "Сумма сделок",
      measureKind: "money",
      dimensionLabel: "Ответственный",
      splitLabel: null,
      total: 0,
      rowCount: 0,
      truncated: false,
      periodLabel: "01.01.2026 — 16.11.2026",
      chart: "bar",
      warnings: [],
      applied: [],
    },
  }
  return { ...base, ...over, meta: { ...base.meta, ...over.meta } }
}

describe("StatsBlock", () => {
  it("money bar: header, chips, toggle, CSV, ₽ total", async () => {
    const t = await text(
      createElement(StatsBlock, {
        result: stats({
          rows: [
            { key: "u1", label: "Иванов", value: 1250000 },
            { key: "u2", label: "Петров", value: 830000 },
          ],
          meta: { total: 2080000, rowCount: 2, applied: [{ label: "Стадия", value: "Переговоры" }] },
        }),
      }),
    )
    expect(t).toContain("|Сумма сделок| · ответственный|")
    expect(t).toContain("Всего: 2 080 000 ₽")
    expect(t).toContain("|Сделки|")
    expect(t).toContain("|01.01.2026 — 16.11.2026|")
    expect(t).toContain("|Стадия:|Переговоры|")
    expect(t).toContain("|График|Таблица|Скачать CSV|")
    // Chart view by default: no table rows.
    expect(t).not.toContain("Иванов")
  })

  it("table view: sortable headers, values via statsValueText, share", async () => {
    const t = await text(
      createElement(StatsBlock, {
        result: stats({
          rows: [
            { key: "u1", label: "Иванов", value: 1250000 },
            { key: "u2", label: "Петров", value: 830000 },
          ],
          meta: { total: 2080000, rowCount: 2, chart: "table" },
        }),
      }),
    )
    expect(t).toContain("|Ответственный|Сумма сделок|Доля|")
    expect(t).toContain("|Иванов|1 250 000 ₽|60,1%|Петров|830 000 ₽|39,9%|")
    const h = await html(createElement(StatsBlock, { result: stats({ rows: [{ key: "a", label: "A", value: 1 }], meta: { chart: "table", total: 1 } }) }))
    expect(h).toContain('aria-sort="none"')
  })

  it("percent: no total, no share, % values", async () => {
    const result = stats({
      query: { subject: "deals", measure: "winRate", dimension: "owner", chart: "table" },
      rows: [
        { key: "u1", label: "Иванов", value: 42.5 },
        { key: "u2", label: "Петров", value: 60 },
      ],
      meta: { measureLabel: "Доля выигранных", measureKind: "percent", total: 102.5, rowCount: 2, chart: "table" },
    })
    const t = await text(createElement(StatsBlock, { result }))
    expect(t).not.toContain("Всего")
    expect(t).not.toContain("Доля|")
    expect(t).toContain("|Иванов|42,5 %|Петров|60 %|")
    expect(statsCsvFileName(result, new Date(2026, 10, 16))).toBe("deals-winrate-2026-11-16.csv")
  })

  it("split: label × split rows", async () => {
    const t = await text(
      createElement(StatsBlock, {
        result: stats({
          query: { subject: "tasks", measure: "count", dimension: "time.month", splitBy: "status" },
          subject: "tasks",
          subjectLabel: "Задачи",
          rows: [
            { key: "2026-10", label: "Окт 2026", value: 3, splitKey: "open", splitLabel: "Открыта" },
            { key: "2026-10", label: "Окт 2026", value: 5, splitKey: "done", splitLabel: "Выполнена" },
          ],
          meta: {
            measureLabel: "Задачи",
            measureKind: "count",
            dimensionLabel: "По месяцам",
            splitLabel: "Статус",
            total: 8,
            rowCount: 2,
            chart: "table",
          },
        }),
      }),
    )
    expect(t).toContain("|Задачи| · по месяцам × статус|")
    expect(t).toContain("|По месяцам|Статус|Задачи|Доля|")
    expect(t).toContain("|Окт 2026|Открыта|3|37,5%|Окт 2026|Выполнена|5|62,5%|")
  })

  it("scalar: compact tile with value and period", async () => {
    const t = await text(
      createElement(StatsBlock, {
        result: stats({
          query: { subject: "deals", measure: "avgDaysToClose" },
          scalar: 12.25,
          meta: { measureLabel: "Среднее время до закрытия", measureKind: "days", dimensionLabel: null, total: 12.25 },
        }),
      }),
    )
    expect(t).toContain("|Сделки|Среднее время до закрытия|")
    expect(t).toContain("|12,3 дн.|")
    expect(t).toContain("|01.01.2026 — 16.11.2026|")
    expect(t).not.toContain("График")
  })

  it("empty with a warning: message + warning, no CSV", async () => {
    const t = await text(
      createElement(StatsBlock, {
        result: stats({ meta: { warnings: ["Фильтр «Стадия = Х» ничего не нашёл."], applied: [{ label: "Стадия", value: "Х" }] } }),
      }),
    )
    expect(t).toContain("Нет данных для этого запроса.")
    expect(t).toContain("Фильтр «Стадия = Х» ничего не нашёл.")
    expect(t).not.toContain("Скачать CSV")
    expect(t).not.toContain("Всего")
  })
})

describe("AnalyticsAnswerCard (unchanged by the shared chart refactor)", () => {
  it("renders the same text for a money result as before", async () => {
    const r: AnalyticsQueryResult = {
      spec: { measure: "revenue" } as AnalyticsQueryResult["spec"],
      rows: [
        { key: "a", label: "Иванов", value: 1250000 },
        { key: "b", label: "Петров", value: 830000.4 },
      ],
      scalar: null,
      meta: {
        measureLabel: "Выручка",
        measureKind: "money",
        dimensionLabel: "Продавец",
        splitLabel: null,
        total: 2080000.4,
        rowCount: 2,
        truncated: false,
        from: "2026-01-01",
        to: "2026-11-16",
        grain: "order",
        chart: "bar",
        warnings: ["Фильтр «X» ничего не нашёл."],
      },
    }
    // Captured from the card BEFORE the refactor (2026-11-16).
    expect(await text(createElement(AnalyticsAnswerCard, { result: r }))).toBe(
      "|Выручка| · продавец|Всего: 2 080 000 ₽|Продавец|Выручка|Доля|Иванов|1 250 000 ₽|60,1%|Петров|830 000 ₽|39,9%|Фильтр «X» ничего не нашёл.|",
    )
    // Scalar → nothing but warnings, as before.
    expect(await html(createElement(AnalyticsAnswerCard, { result: { ...r, rows: [], scalar: 5, meta: { ...r.meta, warnings: [] } } }))).toBe("")
  })
})

// Statistics of the AI chat (docs/specs/ai-chat/01-specification.md §8).
// Client-safe vocabulary + contract: the model picks keys from these
// whitelists, code builds the SQL (src/server/chat/stats/), the app draws the
// chart + table (StatsBlock). The model never writes SQL and never re-types
// numbers.
//
// `orders` IS the analytics semantic layer of /analytics («ИИ ассистент»):
// same measures, dimensions and engine (`runAnalyticsQuery`), so a number in
// the chat equals the same number on the «Аналитика» page.

import {
  DIMENSIONS as ORDER_DIMENSIONS,
  MEASURES as ORDER_MEASURES,
  type AnalyticsResultRow,
  type AnswerChart,
} from "@/lib/analytics-semantic"
import type { AppliedFilter } from "@/lib/chat/records"

export type { AnswerChart as StatsChart } from "@/lib/analytics-semantic"
export type StatsRow = AnalyticsResultRow

export const STATS_SUBJECTS = ["orders", "deals", "tasks", "clients", "sources", "topics", "products"] as const
export type StatsSubject = (typeof STATS_SUBJECTS)[number]

/** `days` = an average duration in days; `percent` = 0–100. */
export type StatsMeasureKind = "money" | "count" | "percent" | "days"

export type StatsMeasureDef = { label: string; kind: StatsMeasureKind; hint: string }
export type StatsDimensionDef = { label: string; hint: string; isTime?: boolean }

export type StatsSubjectDef = {
  label: string
  /** What the period (from / to) applies to; null = the subject has no date (period ignored). */
  dateLabel: string | null
  defaultMeasure: string
  measures: Record<string, StatsMeasureDef>
  dimensions: Record<string, StatsDimensionDef>
  /** Only for users in topics mode `on`. */
  topicsOnly?: boolean
}

const TIME_DIMS = (what: string): Record<string, StatsDimensionDef> => ({
  "time.week": { label: "По неделям", hint: `Weekly, by ${what}.`, isTime: true },
  "time.month": { label: "По месяцам", hint: `Monthly, by ${what} — the default time breakdown.`, isTime: true },
  "time.quarter": { label: "По кварталам", hint: `Quarterly, by ${what}.`, isTime: true },
  "time.year": { label: "По годам", hint: `Yearly, by ${what}.`, isTime: true },
})

export const STATS_VOCAB: Record<StatsSubject, StatsSubjectDef> = {
  orders: {
    label: "Заказы и продажи",
    dateLabel: "дата заказа",
    defaultMeasure: "revenue",
    measures: ORDER_MEASURES,
    dimensions: ORDER_DIMENSIONS,
  },
  deals: {
    label: "Сделки",
    dateLabel: "дата создания сделки",
    defaultMeasure: "count",
    measures: {
      count: { label: "Сделки", kind: "count", hint: "Number of deals (not deleted)." },
      amount: { label: "Сумма сделок", kind: "money", hint: "Sum of the deal amounts." },
      avgAmount: { label: "Средняя сумма сделки", kind: "money", hint: "Average deal amount (deals with an amount)." },
      winRate: { label: "Доля выигранных", kind: "percent", hint: "Won / (won + lost) among closed deals, %." },
      avgDaysToClose: { label: "Среднее время до закрытия", kind: "days", hint: "Average days from creation to the move into a won / lost stage." },
    },
    dimensions: {
      stage: { label: "Стадия", hint: "Funnel stage." },
      outcome: { label: "Состояние", hint: "Open / won / lost / paused / cancelled." },
      owner: { label: "Ответственный", hint: "Deal owner." },
      type: { label: "Тип сделки", hint: "Deal type." },
      client: { label: "Компания", hint: "The deal's company. Use with a small topN." },
      outcomeReason: { label: "Причина исхода", hint: "Outcome reason of won / lost / cancelled deals." },
      ...TIME_DIMS("creation date"),
    },
  },
  tasks: {
    label: "Задачи",
    dateLabel: "срок задачи",
    defaultMeasure: "count",
    measures: {
      count: { label: "Задачи", kind: "count", hint: "Number of tasks." },
      open: { label: "Открытые задачи", kind: "count", hint: "Tasks not done / cancelled." },
      overdue: { label: "Просроченные задачи", kind: "count", hint: "Open tasks with the due date in the past." },
      done: { label: "Выполненные задачи", kind: "count", hint: "Tasks with status done." },
      // No «выполнено в срок»: a task has no completion time (only updated_at).
    },
    dimensions: {
      status: { label: "Статус", hint: "Task status." },
      assignee: { label: "Исполнитель", hint: "Assignee." },
      type: { label: "Тип задачи", hint: "Task type." },
      priority: { label: "Приоритет", hint: "Priority." },
      client: { label: "Компания", hint: "The task's company. Use with a small topN." },
      ...TIME_DIMS("due date"),
    },
  },
  clients: {
    label: "Компании",
    dateLabel: "дата добавления в CRM",
    defaultMeasure: "count",
    measures: {
      count: { label: "Компании", kind: "count", hint: "Number of companies (not deleted / blocked)." },
    },
    dimensions: {
      relation: { label: "Отношения", hint: "Клиент / Потенциальный / Поставщик / Партнёр / Не определено (same as the «Компании» tabs)." },
      industry: { label: "Отрасль", hint: "Industry from the company profile." },
      responsible: { label: "Ответственный", hint: "«Ответственный» of the company." },
      size: { label: "Размер", hint: "Size band from the company profile." },
      segment: { label: "Сегмент", hint: "A / B / C by net revenue of the last 12 full months." },
      ...TIME_DIMS("date added"),
    },
  },
  sources: {
    label: "Источники (письма, сообщения, файлы)",
    dateLabel: "дата сообщения / файла",
    defaultMeasure: "count",
    measures: {
      count: { label: "Сообщения и файлы", kind: "count", hint: "Number of stored source items (messages, mails, files)." },
    },
    dimensions: {
      provider: { label: "Канал", hint: "Mail / Telegram / WhatsApp / Google Chat / Drive / files / AI chat." },
      source: { label: "Источник", hint: "The connected source by name." },
      direction: { label: "Направление", hint: "Incoming / outgoing / internal (own-org attribution)." },
      kind: { label: "Вид", hint: "Message or document (attachment / file)." },
      ...TIME_DIMS("message date"),
    },
  },
  topics: {
    label: "Темы",
    dateLabel: "дата появления темы",
    defaultMeasure: "count",
    topicsOnly: true,
    measures: {
      count: { label: "Темы", kind: "count", hint: "Number of topics (not merged)." },
      open: { label: "Темы в работе", kind: "count", hint: "Open or dormant topics." },
      resolved: { label: "Решённые темы", kind: "count", hint: "Resolved or done topics." },
      avgDaysToClose: { label: "Среднее время до решения", kind: "days", hint: "Average days from first seen to closed." },
    },
    dimensions: {
      status: { label: "Статус", hint: "Topic status." },
      list: { label: "Список", hint: "«Сейчас» / «Сводка» / «Неделя» / none (stored placement)." },
      band: { label: "Важность", hint: "Signal band." },
      family: { label: "Вид темы", hint: "Topic family (offer, order, complaint, …)." },
      client: { label: "Компания", hint: "The topic's company. Use with a small topN." },
      owner: { label: "Ответственный", hint: "Topic assignee." },
      ...TIME_DIMS("first-seen date"),
    },
  },
  products: {
    label: "Каталог товаров",
    dateLabel: null,
    defaultMeasure: "count",
    measures: {
      count: { label: "Товары", kind: "count", hint: "Number of active catalog products." },
      inStock: { label: "Товары в наличии", kind: "count", hint: "Active products with stock > 0." },
      totalStock: { label: "Остаток, шт.", kind: "count", hint: "Sum of stock units." },
      avgPrice: { label: "Средняя цена", kind: "money", hint: "Average price of products with a price." },
    },
    dimensions: {
      category: { label: "Категория", hint: "Catalog category." },
      country: { label: "Страна", hint: "Country of origin." },
      region: { label: "Регион", hint: "Region." },
      color: { label: "Цвет", hint: "Colour." },
      type: { label: "Тип товара", hint: "Product type." },
    },
  },
}

export type StatsFilter = { dimension: string; value: string }

export type StatsQuery = {
  subject: StatsSubject
  /** Omit → the subject's default measure. */
  measure?: string
  /** Omit for a single number (answered in prose, no chart). */
  dimension?: string
  splitBy?: string
  filters?: StatsFilter[]
  /** YYYY-MM-DD, inclusive, org time zone. */
  from?: string
  to?: string
  topN?: number
  chart?: AnswerChart
}

/**
 * Result of one statistics query = the analytics result shape
 * (`AnalyticsQueryResult`) plus the chat's subject, chips and period text,
 * so StatsBlock draws every subject the way /analytics draws orders.
 */
export type StatsResult = {
  query: StatsQuery
  subject: StatsSubject
  subjectLabel: string
  rows: StatsRow[]
  scalar: number | null
  meta: {
    measureLabel: string
    measureKind: StatsMeasureKind
    dimensionLabel: string | null
    splitLabel: string | null
    total: number
    rowCount: number
    truncated: boolean
    /** Period in the org time zone, e.g. «01.01.2026 — 16.11.2026» / «за всё время». */
    periodLabel: string
    chart: AnswerChart
    /** Filter values that matched nothing etc. — the model must say so. */
    warnings: string[]
    /** Filters as chips (Russian). */
    applied: AppliedFilter[]
  }
}

export const STATS_MAX_ROWS = 400
export const STATS_DEFAULT_TOP_N = 12

/** Number for a table cell / CSV, by measure kind (no currency sign in CSV). */
export function statsValueText(value: number, kind: StatsMeasureKind): string {
  if (!Number.isFinite(value)) return ""
  const one = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 })
  if (kind === "percent") return `${one.format(value)} %`
  if (kind === "days") return `${one.format(value)} дн.`
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: kind === "money" ? 0 : 2 }).format(value)
}

/**
 * CSV of a result (spec §8, Q4): «;» separator (Russian Excel), BOM for
 * UTF-8, decimal comma, one row per row × split. Pure.
 */
export function statsCsv(result: StatsResult): string {
  const esc = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace(".", ",") : "")
  const split = Boolean(result.meta.splitLabel)
  const head = [result.meta.dimensionLabel ?? "Показатель", ...(split ? [result.meta.splitLabel ?? ""] : []), result.meta.measureLabel]
  const lines = [head.map(esc).join(";")]
  if (!result.rows.length && result.scalar != null) {
    lines.push([esc(result.meta.measureLabel), num(result.scalar)].join(";"))
  }
  for (const r of result.rows) {
    lines.push([esc(r.label), ...(split ? [esc(r.splitLabel ?? "")] : []), num(r.value)].join(";"))
  }
  return `﻿${lines.join("\r\n")}\r\n`
}

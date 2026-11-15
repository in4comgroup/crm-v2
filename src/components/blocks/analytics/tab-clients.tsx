"use client"

import { useMemo, useState } from "react"
import { ChartCard, NoData, SliceTable } from "./analytics-primitives"
import {
  ChartFootnote,
  ClientScatter,
  RankedBars,
  ShareDonut,
  StackedPeriodBars,
  buildSafeConfig,
  buildSeries,
  remapStack,
  type MetricKey,
} from "./analytics-charts"
import { MetricToggle } from "./metric-toggle"
import {
  clientTypeLabel,
  foldTail,
  formatMoney,
  formatMoneyFull,
} from "@/lib/analytics-format"
import type { SalesAnalytics, StackPoint } from "@/server/analytics"

/**
 * Clients cut by the org's «Тип клиента» custom field (option labels come
 * from `data.clientTypeLabels`), plus the portfolio scatter that shows how
 * order count and basket size trade off.
 */
export function TabClients({ data }: { data: SalesAnalytics }) {
  const [metric, setMetric] = useState<MetricKey>("revenue")
  const typeLabels = data.clientTypeLabels

  const typeRows = useMemo(
    () =>
      foldTail(
        data.clientTypes.map((r) => ({ ...r, label: clientTypeLabel(r.key, typeLabels) })),
        6,
      ),
    [data.clientTypes, typeLabels],
  )
  const typeSeries = useMemo(
    () => buildSeries(typeRows.map((r) => r.label)),
    [typeRows],
  )

  const typeStack = useMemo(() => {
    // The pivot is keyed by the option id; relabel before remapping so the
    // stack, the donut and the table all speak the same language.
    const labelled: StackPoint[] = data.clientTypeMonthly.map((p) => {
      const out: StackPoint = { period: String(p.period) }
      for (const k of data.clientTypeKeys) {
        out[clientTypeLabel(k, typeLabels)] = Number(p[k] ?? 0)
      }
      return out
    })
    return remapStack(labelled, typeSeries)
  }, [data.clientTypeMonthly, data.clientTypeKeys, typeSeries, typeLabels])

  // Scatter compares every pair of hues at once, so it's capped at the three
  // slots that clear the all-pairs separation gates. Rarer types fold in as a
  // neutral rather than getting a fourth hue.
  const scatterTypes = useMemo(() => {
    const ordered = data.clientTypes.map((r) => r.key)
    return ordered.length <= 3 ? ordered : [...ordered.slice(0, 2), "unknown"]
  }, [data.clientTypes])

  const scatterPoints = useMemo(
    () =>
      data.clientScatter.map((p) =>
        scatterTypes.includes(p.type) ? p : { ...p, type: "unknown" },
      ),
    [data.clientScatter, scatterTypes],
  )

  const scatterConfig = useMemo(
    () => buildSafeConfig(scatterTypes, (k: string) => clientTypeLabel(k, typeLabels)),
    [scatterTypes, typeLabels],
  )

  const typeTableRows = useMemo(
    () =>
      data.clientTypes.map((r) => ({ ...r, label: clientTypeLabel(r.key, typeLabels) })),
    [data.clientTypes, typeLabels],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <MetricToggle value={metric} onChange={setMetric} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Категории клиентов"
          description="Доля типов клиентов в выручке"
        >
          {typeRows.length ? (
            <ShareDonut
              rows={typeRows}
              series={typeSeries}
              metric={metric}
              height={280}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Категории клиентов по месяцам"
          description="Как менялось соотношение типов клиентов"
          className="lg:col-span-2"
        >
          {typeStack.length ? (
            <StackedPeriodBars
              data={typeStack}
              keys={typeSeries.keys}
              config={typeSeries.config}
              metricFormat={formatMoney}
              metricFormatFull={formatMoneyFull}
              height={280}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Портфель клиентов"
        description="Число заказов против выручки; размер точки — средний чек"
      >
        {scatterPoints.length ? (
          <>
            <ClientScatter
              points={scatterPoints}
              typeKeys={scatterTypes}
              config={scatterConfig}
              height={340}
            />
            <ChartFootnote>
              Точки справа сверху — ключевые аккаунты: много заказов и высокая
              выручка. Крупные точки слева — редкие, но дорогие закупки.
            </ChartFootnote>
          </>
        ) : (
          <NoData />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Топ клиентов"
          description="12 крупнейших покупателей за период"
        >
          {data.topClients.length ? (
            <RankedBars rows={data.topClients} metric={metric} limit={12} />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Сводка по категориям"
          description="Выручка, заказы и объём в разрезе типа клиента"
        >
          <SliceTable
            rows={typeTableRows}
            labelHeader="Категория"
            series={typeSeries}
          />
        </ChartCard>
      </div>
    </div>
  )
}

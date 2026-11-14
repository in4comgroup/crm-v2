"use client"

// Хук доски сделок: параллельно тянет ленту решений и задачи сделок
// и отдаёт refetch. Все ответы деградируют мягко — при ошибке фетча сохраняем
// предыдущие данные и никогда не бросаем.

import { useCallback, useEffect, useRef, useState } from "react"

import type { FeedEvent } from "@/server/deals"
import type { TaskRow } from "@/app/api/tasks/route"

// Задача сделки для карточки (имя + тип/приоритет/статус + исполнитель).
export type DealTaskInfo = {
  name: string
  type: TaskRow["type"]
  priority: TaskRow["priority"]
  status: TaskRow["status"]
  assigneeName: string | null
}

export type BoardIntelData = {
  feed: FeedEvent[]
  // Все задачи сделки (по createdAt desc) — карточка листает их шевронами.
  tasksByDeal: Record<string, DealTaskInfo[]>
}

// Стабильная по ссылке заглушка данных — безопасна для первого рендера.
const EMPTY: BoardIntelData = {
  feed: [],
  tasksByDeal: {},
}

export function useBoardIntel(): {
  data: BoardIntelData
  loading: boolean
  refetch: () => void
} {
  const [data, setData] = useState<BoardIntelData>(EMPTY)
  const [loading, setLoading] = useState(true)
  // Guard от гонки: у каждого вызова load() свой номер; применяем результат
  // только если это последний запрос — поздний ответ не затирает свежий.
  const latestRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++latestRef.current
    setLoading(true)
    try {
      const [feedRes, tasksRes] = await Promise.all([
        fetch("/api/deals/feed"),
        fetch("/api/tasks"),
      ])
      if (!feedRes.ok || !tasksRes.ok) {
        throw new Error("Не удалось загрузить данные доски")
      }

      const [feedJson, tasksJson] = await Promise.all([
        feedRes.json() as Promise<{ events?: FeedEvent[] }>,
        tasksRes.json() as Promise<{ tasks?: TaskRow[] }>,
      ])

      // Все задачи по сделке, отсортированные по createdAt desc (самая свежая
      // первой) — карточка листает их шевронами. Любой статус, не только open.
      const tasksByDeal: Record<string, DealTaskInfo[]> = {}
      const sorted = [...(tasksJson.tasks ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )
      for (const t of sorted) {
        if (!t.dealId) continue
        ;(tasksByDeal[t.dealId] ??= []).push({
          name: t.name,
          type: t.type,
          priority: t.priority,
          status: t.status,
          assigneeName: t.assigneeName,
        })
      }

      // Устаревший ответ (пока летел, стартовал новый load) — не применяем.
      if (latestRef.current !== seq) return

      setData({
        feed: feedJson.events ?? [],
        tasksByDeal,
      })
    } catch {
      // Мягкая деградация: сохраняем предыдущие данные, ничего не бросаем.
    } finally {
      // loading гасит только последний запрос (более новый сам собой управит).
      if (latestRef.current === seq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refetch: load }
}

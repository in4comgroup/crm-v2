"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import type { listUrgentTasks } from "@/server/tasks"
import { useOrgTime } from "@/lib/org-time-context"
import { formatOrgDueShort } from "@/lib/org-time"

type UrgentTasks = Awaited<ReturnType<typeof listUrgentTasks>>

export function UrgentTasksSection() {
  // Deadlines in the ORG time zone, not the browser's (2026-11-26).
  const { timeZone } = useOrgTime()
  const [items, setItems] = useState<UrgentTasks | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/tasks?urgent=1", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load urgent tasks")
        const { tasks }: { tasks: UrgentTasks } = await response.json()
        if (!controller.signal.aborted) setItems(tasks)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [attempt])

  return (
    <section aria-labelledby="urgent-tasks-heading" className="mb-4 flex max-h-[30dvh] shrink-0 flex-col rounded-xl border bg-card p-3">
      <h2 id="urgent-tasks-heading" className="flex shrink-0 items-center gap-2 text-sm font-semibold">
        Мои срочные задачи
        {!!items?.length && <Badge variant="secondary">{items.length}</Badge>}
      </h2>

      {failed ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Не удалось загрузить задачи.{" "}
          <button type="button" className="underline" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>Повторить</button>
        </p>
      ) : !items?.length ? (
        <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">{items ? "Срочных задач нет." : "Загружаем задачи…"}</p>
      ) : (
        <ul className="mt-2 min-h-0 divide-y overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/tasks?openTask=${encodeURIComponent(item.id)}`} className="group flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
                <span className="min-w-0 flex-1 wrap-anywhere group-hover:underline group-focus-visible:underline">{item.name}</span>
                <time dateTime={item.dueDate} className="text-xs text-muted-foreground">{formatOrgDueShort(item.dueDate, timeZone)}</time>
                {item.overdue ? <Badge variant="destructive">Просрочена</Badge> : item.priority === "high" && <Badge variant="outline">Высокий приоритет</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useGlobalChat } from "@/lib/global-chat-context"
import type { listUrgentTasks } from "@/server/tasks"

type UrgentTasks = Awaited<ReturnType<typeof listUrgentTasks>>
const dueFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" })

export function UrgentTasksSection() {
  const { openChat } = useGlobalChat()
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
    <section aria-labelledby="urgent-tasks-heading" className="mb-4 shrink-0 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="urgent-tasks-heading" className="flex items-center gap-2 text-sm font-semibold">
          Мои срочные задачи
          {!!items?.length && <Badge variant="secondary">{items.length}</Badge>}
        </h2>
        <Link href="/tasks" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline">Все задачи</Link>
      </div>
      {failed ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Не удалось загрузить задачи.{" "}
          <button type="button" className="underline" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>Повторить</button>
        </p>
      ) : !items?.length ? (
        <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">{items ? "Срочных задач нет." : "Загружаем задачи…"}</p>
      ) : (
        <ul className="mt-2 max-h-40 divide-y overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/tasks?openTask=${encodeURIComponent(item.id)}`} className="group flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
                <span className="min-w-0 flex-1 wrap-anywhere group-hover:underline group-focus-visible:underline">{item.name}</span>
                <time dateTime={item.dueDate} className="text-xs text-muted-foreground">{dueFormat.format(new Date(item.dueDate))}</time>
                {item.overdue ? <Badge variant="destructive">Просрочена</Badge> : item.priority === "high" && <Badge variant="outline">Высокий приоритет</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!!items?.length && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <p className="text-sm text-muted-foreground">Привет! Разберём срочные задачи?</p>
          <Button type="button" variant="secondary" size="sm" onClick={openChat}>
            Открыть ИИ-чат
          </Button>
        </div>
      )}
    </section>
  )
}

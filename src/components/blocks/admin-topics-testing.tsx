"use client"

// Tab «Тесты и отладка» on /settings (platform admin): quality checks and
// debugging of the topics engine, kept apart from the operations tab «Темы»
// (modes, runs, CRM checks, delivery) and the registry tab «Сигналы».
// Blocks: signal review of scanned items, topic debug, golden set, eval.
// Each block loads its own data.

import { AdminTopicsGolden } from "@/components/blocks/admin-topics-golden"
import { AdminTopicsSignals } from "@/components/blocks/admin-topics-signals"
import { AdminTopicsSpike } from "@/components/blocks/admin-topics-spike"
import { AdminTopicsTopics } from "@/components/blocks/admin-topics-topics"

export function AdminTopicsTesting() {
  return (
    <div className="flex flex-col gap-6">
      {/* Shadow review of the signal extraction (plan phase 2). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Сигналы сообщений</h2>
          <p className="text-sm text-muted-foreground">
            Результат извлечения сигналов по сообщениям организации: статус, балл, коды, факты и
            предметы. Пользователи этого не видят.
          </p>
        </div>
        <AdminTopicsSignals />
      </section>

      {/* Topic engine debug (plan phase 3 task 8). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Темы (отладка)</h2>
          <p className="text-sm text-muted-foreground">
            Темы организации: контрагент, ведущий код, балл, статус, сообщения, сигналы и журнал.
            Действия: «Готово», «Не относится», объединение, отвязка и повторный разбор сообщения.
            Пользователи этого не видят.
          </p>
        </div>
        <AdminTopicsTopics />
      </section>

      {/* Golden set and model spike (plan phase 0 tasks 7–8). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Эталонный набор</h2>
        <AdminTopicsGolden />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Оценка извлечения (eval)</h2>
        <AdminTopicsSpike />
      </section>
    </div>
  )
}

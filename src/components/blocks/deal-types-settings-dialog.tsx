"use client"

import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { DealTypeOption } from "@/app/api/deals/route"

// One editable row. `id` null = a new type (code editable until saved).
type Row = {
  key: string
  id: string | null
  code: string
  label: string
  visible: boolean
}

const CODE_RE = /^[a-z][a-z0-9_]{1,47}$/

// «Типы сделок» (/deals, кнопка рядом с «Настройками стадий»; topics spec
// 01 §9.2 / §14): список типов сделок организации — название, видимость,
// порядок; новый тип = код + название. Типы не удаляются (на них ссылаются
// сделки и правила стадий) — только скрываются. Менять может только
// владелец организации (canManage с сервера; сервер проверяет сам).
// Сохранение — PUT /api/deals { dealTypes }.
export function DealTypesSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRows(null)
    fetch("/api/deals?dealTypes=1")
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed")
        const data = (await res.json()) as {
          types: DealTypeOption[]
          canManage: boolean
        }
        if (cancelled) return
        setCanManage(data.canManage)
        setRows(
          data.types.map((t) => ({
            key: t.id,
            id: t.id,
            code: t.code,
            label: t.labelRu,
            visible: !t.isHidden,
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        toast.error("Не удалось загрузить типы сделок")
        onOpenChange(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, onOpenChange])

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) =>
      prev ? prev.map((r) => (r.key === key ? { ...r, ...patch } : r)) : prev,
    )

  const moveRow = (index: number, delta: -1 | 1) =>
    setRows((prev) => {
      if (!prev) return prev
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const addRow = () =>
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: `new-${Date.now()}`,
        id: null,
        code: "",
        label: "",
        visible: true,
      },
    ])

  const save = async () => {
    if (!rows) return
    for (const r of rows) {
      if (!r.label.trim()) {
        toast.error("У каждого типа должно быть название")
        return
      }
      if (!r.id && !CODE_RE.test(r.code.trim())) {
        toast.error(
          "Код нового типа: латиница в нижнем регистре, цифры и «_», 2–48 символов",
        )
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch("/api/deals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealTypes: rows.map((r, i) => ({
            ...(r.id ? { id: r.id } : { code: r.code.trim() }),
            labelRu: r.label.trim(),
            sort: i,
            isHidden: !r.visible,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Не удалось сохранить")
      }
      toast.success("Типы сделок сохранены")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Типы сделок</DialogTitle>
          <DialogDescription>
            {canManage
              ? "Название, порядок и видимость типов в выборе. Типы не удаляются — скрытый тип остаётся у старых сделок и в правилах."
              : "Список типов сделок организации. Менять его может только владелец организации."}
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {rows.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Типов пока нет.
              </div>
            )}
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-2">
                {canManage && (
                  <div className="flex shrink-0 flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-6"
                      aria-label="Выше"
                      disabled={i === 0}
                      onClick={() => moveRow(i, -1)}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-6"
                      aria-label="Ниже"
                      disabled={i === rows.length - 1}
                      onClick={() => moveRow(i, 1)}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {r.id ? (
                  <Badge
                    variant="secondary"
                    className="w-36 shrink-0 justify-start truncate font-mono text-[10px]"
                  >
                    {r.code}
                  </Badge>
                ) : (
                  <Input
                    value={r.code}
                    onChange={(e) =>
                      update(r.key, { code: e.target.value.toLowerCase() })
                    }
                    placeholder="kod_tipa"
                    aria-label="Код нового типа"
                    className="w-36 shrink-0 font-mono text-xs"
                  />
                )}
                <Input
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  placeholder="Название типа"
                  aria-label={`Название типа ${r.code || "(новый)"}`}
                  disabled={!canManage}
                  className="min-w-0 flex-1"
                />
                <Switch
                  checked={r.visible}
                  onCheckedChange={(v) => update(r.key, { visible: v })}
                  disabled={!canManage}
                  aria-label={`Показывать тип «${r.label || r.code}» в выборе`}
                />
              </div>
            ))}
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus className="mr-1 h-4 w-4" />
                Добавить тип
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {canManage ? "Отмена" : "Закрыть"}
          </Button>
          {canManage && (
            <Button onClick={save} disabled={saving || rows === null}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

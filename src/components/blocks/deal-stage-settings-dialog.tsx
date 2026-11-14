"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
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
import type { FunnelStageSetting } from "@/app/api/deals/route"
import {
  DEFAULT_STALE_NORM_DAYS,
  parseStaleNormInput,
  STALE_NORM_MAX_DAYS,
  STALE_NORM_MIN_DAYS,
} from "@/lib/deal-activity"

type Row = FunnelStageSetting & { value: string; visible: boolean; norm: string }

// «Настройки стадий» (/deals, кнопка со слайдерами справа от «Свернуть все»):
// название каждой стадии воронки (в поле — текущее название) + тоггл
// видимости колонки на доске + «Норма, дн» для бейджа «N дн без активности»
// (пусто = 14). Терминальные Закрыта/Проиграна сюда не входят —
// на доске это одна колонка «Закрытие». Сохранение — PUT /api/deals
// { stageSettings }; орга на системной воронке при этом получает свою копию
// стадий + 0-ю «Контакт до запроса» (saveFunnelStageSettings).
export function DealStageSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState(false)
  // Only the org owner may save; others see the settings read-only.
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRows(null)
    fetch("/api/deals?stageSettings=1")
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed")
        const data = (await res.json()) as { stages: FunnelStageSetting[]; canManage?: boolean }
        if (cancelled) return
        setCanManage(data.canManage === true)
        setRows(
          data.stages.map((s) => ({
            ...s,
            value: s.displayName ?? s.defaultLabel,
            visible: !s.isHidden,
            norm: s.staleNormDays != null ? String(s.staleNormDays) : "",
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        toast.error("Не удалось загрузить стадии")
        onOpenChange(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, onOpenChange])

  const update = (
    id: string,
    patch: Partial<Pick<Row, "value" | "visible" | "norm">>,
  ) =>
    setRows((prev) =>
      prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev,
    )

  const normInvalid = (r: Row) => parseStaleNormInput(r.norm) === undefined
  const hasInvalidNorm = rows?.some(normInvalid) ?? false

  const save = async () => {
    if (!rows) return
    if (hasInvalidNorm) {
      toast.error(
        `Норма — целое число дней от ${STALE_NORM_MIN_DAYS} до ${STALE_NORM_MAX_DAYS}`,
      )
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/deals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageSettings: rows.map((r) => {
            const value = r.value.trim()
            return {
              id: r.id,
              // Пусто или совпадает с подписью по умолчанию — своё название
              // не храним (останется русская подпись системной стадии).
              displayName: value && value !== r.defaultLabel ? value : null,
              isHidden: !r.visible,
              staleNormDays: parseStaleNormInput(r.norm) ?? null,
            }
          }),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Не удалось сохранить")
      }
      toast.success("Стадии сохранены")
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки стадий</DialogTitle>
          <DialogDescription>
            Названия колонок воронки и их видимость на доске. Сделки в
            скрытой стадии на доске не показываются. «Норма, дн» — сколько
            дней без активности нормально для стадии; дольше — на карточке
            красный бейдж (пусто = {DEFAULT_STALE_NORM_DAYS}).
            {rows !== null && !canManage && (
              <span className="mt-1 block text-amber-600 dark:text-amber-500">
                Менять настройки стадий может только владелец организации.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex-1">Название</div>
              <div className="w-20 text-center">Норма, дн</div>
              <div className="w-8 text-center">Вид</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <div className="relative min-w-0 flex-1">
                  <Input
                    value={r.value}
                    onChange={(e) => update(r.id, { value: e.target.value })}
                    placeholder={r.defaultLabel}
                    aria-label={`Название стадии «${r.defaultLabel}»`}
                    disabled={!canManage}
                    className={r.isPrePipeline ? "pr-28" : undefined}
                  />
                  {r.isPrePipeline && (
                    <Badge
                      variant="secondary"
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      до воронки
                    </Badge>
                  )}
                </div>
                <Input
                  value={r.norm}
                  onChange={(e) => update(r.id, { norm: e.target.value })}
                  inputMode="numeric"
                  placeholder={String(DEFAULT_STALE_NORM_DAYS)}
                  aria-label={`Норма, дн для стадии «${r.value || r.defaultLabel}»`}
                  aria-invalid={normInvalid(r) || undefined}
                  disabled={!canManage}
                  className="w-20 text-center"
                />
                <Switch
                  checked={r.visible}
                  onCheckedChange={(v) => update(r.id, { visible: v })}
                  aria-label={`Показывать стадию «${r.value || r.defaultLabel}»`}
                  disabled={!canManage}
                />
              </div>
            ))}
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
          <Button
            onClick={save}
            disabled={saving || rows === null || hasInvalidNorm}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Сохранить
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

// «Организация» sub-tab of «Сигналы»: settings of the selected org —
// packs on/off (org_pack), activation presets, stage rules (stage_rule with
// organizationId) and per-org stage guards of deal-risk types (risk_guard).
// Spec: 05 §5, 01-specification §9.2 / §9.4.

import { useState } from "react"
import { Loader, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MultiCheckSelect } from "@/components/blocks/admin-ai-models"
import type {
  DealRiskStageGuardRecord,
  DealRiskTypeRecord,
  SignalsApplyPresetRequest,
} from "@/lib/signals/types"
import { StageRulesPanel } from "@/components/blocks/admin-signals-stage-rules"
import { CodeChips } from "@/components/blocks/admin-signals-platform"
import {
  ConfirmDialog,
  ErrorList,
  FormSection,
  SIGNALS_API,
  postSignals,
  stageOptions,
  useSignals,
} from "@/components/blocks/admin-signals-shared"

export function OrgPanel() {
  const { org } = useSignals()
  if (!org) {
    return (
      <Card className="py-10 text-center text-sm text-muted-foreground">
        Выберите организацию в тулбаре, чтобы настроить её пакеты, правила стадий и риски.
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrgPacks />
        <OrgPresets />
      </div>
      <FormSection
        title="Правила стадий"
        description="Код сигнала → действие над стадиями воронки этой организации (01 §9.2)."
      >
        <StageRulesPanel mode="org" />
      </FormSection>
      <OrgRiskGuards />
    </div>
  )
}

function OrgPacks() {
  const { registry, org, orgId, save } = useSignals()
  const [busy, setBusy] = useState<string | null>(null)
  const counts = new Map<string, number>()
  for (const e of org?.effective ?? []) if (e.active) counts.set(e.packCode, (counts.get(e.packCode) ?? 0) + 1)

  const toggle = async (packCode: string, enabled: boolean) => {
    const existing = org?.packs.find((p) => p.packCode === packCode)
    setBusy(packCode)
    await save({
      entity: "org_pack",
      action: existing ? "update" : "create",
      key: packCode,
      organizationId: orgId,
      data: { organizationId: orgId, packCode, enabled },
      summary: `Пакет ${packCode} ${enabled ? "включён" : "выключен"} для «${org?.organizationName ?? ""}»`,
    })
    setBusy(null)
  }

  return (
    <FormSection title="Пакеты организации" description="Код действует, только если его пакет включён (05 §5).">
      <div className="divide-y rounded-lg border">
        {registry.packs.map((p) => {
          const enabled = !!org?.packs.find((x) => x.packCode === p.code)?.enabled
          return (
            <div key={p.code} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {p.labelRu} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                </div>
                {p.descriptionRu && <div className="truncate text-xs text-muted-foreground">{p.descriptionRu}</div>}
              </div>
              {enabled && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  активно кодов: {counts.get(p.code) ?? 0}
                </span>
              )}
              {busy === p.code && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={enabled}
                disabled={busy !== null}
                onCheckedChange={(v) => toggle(p.code, v)}
                aria-label={`Пакет ${p.code}`}
              />
            </div>
          )
        })}
      </div>
    </FormSection>
  )
}

function OrgPresets() {
  const { org, orgId, reload } = useSignals()
  const [confirm, setConfirm] = useState<{ key: string; labelRu: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = async (preset: string) => {
    if (!orgId) return
    setBusy(true)
    try {
      const res = await postSignals<{ version: number; changed: number; skipped?: string[] }>(`${SIGNALS_API}/presets`, {
        organizationId: orgId,
        preset,
      } satisfies SignalsApplyPresetRequest)
      if (!res.ok) {
        toast.error(`Шаблон не применён: ${res.errors.map((e) => e.message).join("; ")}`)
        return
      }
      toast.success(`Сохранено (версия ${res.data.version}) · изменено настроек: ${res.data.changed}`)
      if (res.data.skipped?.length) toast.warning(`Пропущено: ${res.data.skipped.join("; ")}`)
      await reload()
    } catch (e) {
      toast.error(`Шаблон не применён: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const presets = org?.presets ?? []
  return (
    <FormSection
      title="Шаблоны активации"
      description="Шаблон включает пакеты и задаёт стадии кодов для организации (05 §5.1). Без шаблона организация получает все коды включённых пакетов."
    >
      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Шаблонов нет.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {presets.map((p) => (
            <div key={p.key} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.labelRu}</div>
                <div className="text-xs text-muted-foreground">{p.descriptionRu}</div>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(p)}>
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Применить шаблон
              </Button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Применить шаблон «${confirm?.labelRu ?? ""}»?`}
        description={`Настройки организации «${org?.organizationName ?? ""}» будут перезаписаны значениями шаблона. Изменение сохранится как новая версия реестра.`}
        confirmLabel="Применить"
        onConfirm={() => confirm && apply(confirm.key)}
      />
    </FormSection>
  )
}

function OrgRiskGuards() {
  const { registry, org } = useSignals()
  const rows = registry.riskTypes
    .slice()
    .sort((a, b) => a.packCode.localeCompare(b.packCode) || b.severity - a.severity)
  const enabledPacks = new Set((org?.packs ?? []).filter((p) => p.enabled).map((p) => p.packCode))
  return (
    <FormSection
      title="Риски сделок"
      description="Типы риска — данные платформы. Для организации задаётся, действует ли риск и на каких стадиях (пусто = на всех стадиях, 01 §9.4)."
    >
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Риск</TableHead>
              <TableHead className="text-right">Серьёзность</TableHead>
              <TableHead>Триггеры</TableHead>
              <TableHead>Снимают</TableHead>
              <TableHead>Действует</TableHead>
              <TableHead>Стадии организации</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Типов риска нет
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <RiskGuardRow
                  key={`${r.code}:${JSON.stringify(org?.riskGuards.find((g) => g.riskCode === r.code) ?? null)}`}
                  risk={r}
                  guard={org?.riskGuards.find((g) => g.riskCode === r.code) ?? null}
                  packOff={!enabledPacks.has(r.packCode)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </FormSection>
  )
}

function RiskGuardRow({
  risk,
  guard,
  packOff,
}: {
  risk: DealRiskTypeRecord
  guard: DealRiskStageGuardRecord | null
  packOff: boolean
}) {
  const { org, orgId, save } = useSignals()
  const initialStages = guard?.stageIds ?? []
  const [stages, setStages] = useState<string[]>(initialStages)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([])
  const enabled = guard?.enabled ?? true
  const dirty = JSON.stringify([...stages].sort()) !== JSON.stringify([...initialStages].sort())

  const persist = async (next: { enabled: boolean; stageIds: string[] }) => {
    setBusy(true)
    const res = await save({
      entity: "risk_guard",
      action: guard ? "update" : "create",
      key: risk.code,
      organizationId: orgId,
      data: {
        organizationId: orgId,
        riskCode: risk.code,
        enabled: next.enabled,
        stageIds: next.stageIds.length ? next.stageIds : null,
      },
      summary: `Риск ${risk.code} для «${org?.organizationName ?? ""}»: ${next.enabled ? "действует" : "выключен"}, стадий: ${next.stageIds.length || "все"}`,
    })
    setBusy(false)
    setErrors(res.ok ? [] : res.errors)
  }

  const reset = async () => {
    setBusy(true)
    const res = await save({
      entity: "risk_guard",
      action: "delete",
      key: risk.code,
      organizationId: orgId,
      summary: `Сброшены стадии риска ${risk.code} для «${org?.organizationName ?? ""}»`,
    })
    setBusy(false)
    setErrors(res.ok ? [] : res.errors)
  }

  return (
    <TableRow className={`even:bg-muted/40 ${risk.enabled && enabled ? "" : "text-muted-foreground"}`}>
      <TableCell>
        <div className="font-mono text-xs">{risk.code}</div>
        <div className="max-w-64 truncate">{risk.labelRu}</div>
        <div className="flex gap-1">
          {!risk.enabled && <Badge variant="outline" className="font-normal">выключен на платформе</Badge>}
          {packOff && <Badge variant="outline" className="font-normal">пакет {risk.packCode} выключен</Badge>}
        </div>
        {errors.length > 0 && <ErrorList errors={errors} />}
      </TableCell>
      <TableCell className="text-right tabular-nums">{risk.severity}</TableCell>
      <TableCell><CodeChips codes={risk.triggerCodes} max={3} /></TableCell>
      <TableCell><CodeChips codes={risk.clearCodes} max={3} /></TableCell>
      <TableCell>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(v) => persist({ enabled: v, stageIds: initialStages })}
          aria-label="Риск действует"
        />
      </TableCell>
      <TableCell>
        <MultiCheckSelect
          label="Стадий"
          emptyLabel="Все стадии"
          options={stageOptions(org)}
          values={stages}
          onChange={setStages}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {dirty && (
            <Button size="sm" disabled={busy} onClick={() => persist({ enabled, stageIds: stages })}>
              {busy && <Loader className="h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          )}
          {guard && !dirty && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              Сбросить
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

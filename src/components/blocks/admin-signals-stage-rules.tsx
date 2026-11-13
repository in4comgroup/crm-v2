"use client"

// Stage rules of the «Сигналы» tab: per-org rules (targets = the org's own
// funnel stages) and pack templates (organizationId null, targets = stage
// meanings S1…S5 / won / lost). Spec: 01-specification §9.2.

import { useMemo, useState } from "react"
import { Copy, Loader, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { MultiCheckSelect } from "@/components/blocks/admin-ai-models"
import {
  CONFIDENCES,
  STAGE_MEANINGS,
  STAGE_RULE_EFFECTS,
  type SignalStageRuleRecord,
  type SignalsCopyStageRulesRequest,
  type SignalsValidationError,
  type StageRuleGuards,
} from "@/lib/signals/types"
import {
  BoolField,
  CONFIDENCE_LABELS_RU,
  ConfirmDialog,
  EFFECT_LABELS_RU,
  ErrorList,
  FormField,
  FormSection,
  ListEditor,
  MEANING_LABELS_RU,
  NumberInput,
  SIGNALS_API,
  SearchPicker,
  ValueSelect,
  codeOptions,
  diffRecord,
  fieldErrors,
  options,
  postSignals,
  stageOptions,
  useSignals,
} from "@/components/blocks/admin-signals-shared"

type Mode = "org" | "template"

function guardChips(
  g: StageRuleGuards,
  stageName: (id: string) => string,
): string[] {
  const out: string[] = []
  if (g.minConfidence) out.push(`уверенность ≥ ${CONFIDENCE_LABELS_RU[g.minConfidence]}`)
  if (g.minScore !== undefined && g.minScore !== null) out.push(`оценка ≥ ${g.minScore}`)
  if (g.fromStageIds?.length) out.push(`из стадий: ${g.fromStageIds.map(stageName).join(", ")}`)
  if (g.fromStageMeanings?.length) out.push(`из стадий: ${g.fromStageMeanings.join(", ")}`)
  if (g.forwardOnly === false) out.push("назад разрешено")
  if (g.forwardOnly === true) out.push("только вперёд")
  if (g.requiresConfirmation) out.push("с подтверждением")
  if (g.requiresFact) out.push(`факт: ${g.requiresFact}`)
  if (g.clientGuard) out.push(`клиент: ${g.clientGuard}`)
  return out
}

// ── table ────────────────────────────────────────────────────────────────

export function StageRulesPanel({ mode }: { mode: Mode }) {
  const { registry, org, orgId, save } = useSignals()
  const [editing, setEditing] = useState<{ rule: SignalStageRuleRecord | null } | null>(null)
  const [deleting, setDeleting] = useState<SignalStageRuleRecord | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [packFilter, setPackFilter] = useState<string | null>(null)

  const rules = useMemo(() => {
    const src = mode === "org" ? org?.stageRules ?? [] : registry.stageRuleTemplates
    return src
      .filter((r) => !packFilter || r.packCode === packFilter)
      .slice()
      .sort((a, b) => (a.packCode ?? "").localeCompare(b.packCode ?? "") || a.sort - b.sort || a.code.localeCompare(b.code))
  }, [mode, org, registry, packFilter])

  const stageName = (id: string) => {
    const s = org?.funnelStages.find((x) => x.id === id)
    return s ? s.displayName || s.name : id
  }
  const labelOf = (code: string) => registry.categories.find((c) => c.code === code)?.labelRu

  const toggle = (r: SignalStageRuleRecord, enabled: boolean) =>
    save({
      entity: "stage_rule",
      action: "update",
      key: r.id,
      organizationId: mode === "org" ? orgId : null,
      data: { enabled },
      summary: `${enabled ? "Включено" : "Выключено"} правило ${r.code}`,
    })

  const remove = async (r: SignalStageRuleRecord) => {
    await save({
      entity: "stage_rule",
      action: "delete",
      key: r.id,
      organizationId: mode === "org" ? orgId : null,
      summary: `Удалено правило ${r.code} (${EFFECT_LABELS_RU[r.effect]})`,
    })
  }

  const packOpts = registry.packs.map((p) => ({ value: p.code, label: p.labelRu }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setEditing({ rule: null })}>
          <Plus className="h-4 w-4" />
          Новое правило
        </Button>
        {mode === "org" && (
          <Button size="sm" variant="outline" onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" />
            Скопировать шаблон правил
          </Button>
        )}
        <div className="w-56">
          <ValueSelect
            size="sm"
            value={packFilter}
            onChange={setPackFilter}
            options={packOpts}
            nullable
            noneLabel="Все пакеты"
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">Правил: {rules.length}</span>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Цель</TableHead>
              <TableHead>Типы сделок</TableHead>
              <TableHead>Условия</TableHead>
              <TableHead>Пакет</TableHead>
              <TableHead className="w-16">Вкл.</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {mode === "org"
                    ? "У организации нет правил стадий. Скопируйте шаблон пакета или создайте правило."
                    : "Шаблонов правил нет"}
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => (
                <TableRow key={r.id} className={`even:bg-muted/40 ${r.enabled ? "" : "text-muted-foreground"}`}>
                  <TableCell>
                    <div className="font-mono text-xs">{r.code}</div>
                    <div className="max-w-56 truncate text-xs text-muted-foreground">{labelOf(r.code) ?? "нет такого кода"}</div>
                  </TableCell>
                  <TableCell>{EFFECT_LABELS_RU[r.effect] ?? r.effect}</TableCell>
                  <TableCell>
                    {r.targetStageId
                      ? stageName(r.targetStageId)
                      : r.targetStageMeaning
                        ? MEANING_LABELS_RU[r.targetStageMeaning as keyof typeof MEANING_LABELS_RU] ?? r.targetStageMeaning
                        : "—"}
                  </TableCell>
                  <TableCell className="text-xs">{r.dealTypes.length ? r.dealTypes.join(", ") : "все"}</TableCell>
                  <TableCell>
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {guardChips(r.guards ?? {}, stageName).map((c) => (
                        <Badge key={c} variant="outline" className="font-normal">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.packCode ?? "—"}</TableCell>
                  <TableCell>
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggle(r, v)} aria-label="Включено" />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Изменить" onClick={() => setEditing({ rule: r })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Удалить" onClick={() => setDeleting(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <StageRuleDialog
        mode={mode}
        open={!!editing}
        rule={editing?.rule ?? null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Удалить правило?"
        description={deleting ? `${deleting.code} · ${EFFECT_LABELS_RU[deleting.effect]}` : undefined}
        confirmLabel="Удалить"
        destructive
        onConfirm={() => deleting && remove(deleting)}
      />
      {mode === "org" && <CopyRulesDialog open={copyOpen} onClose={() => setCopyOpen(false)} />}
    </div>
  )
}

// ── editor ───────────────────────────────────────────────────────────────

function blankRule(mode: Mode, orgId: string | null): SignalStageRuleRecord {
  return {
    id: "",
    organizationId: mode === "org" ? orgId : null,
    packCode: null,
    code: "",
    effect: "move_stage",
    targetStageId: null,
    targetStageMeaning: null,
    dealTypes: [],
    guards: { forwardOnly: true },
    enabled: true,
    sort: 0,
    noteRu: null,
  }
}

function StageRuleDialog({
  mode,
  open,
  rule,
  onClose,
}: {
  mode: Mode
  open: boolean
  rule: SignalStageRuleRecord | null
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? `Правило ${rule.code}` : mode === "org" ? "Новое правило организации" : "Новый шаблон правила"}
          </DialogTitle>
          <DialogDescription>
            {mode === "org"
              ? "Код → действие над стадиями сделки этой организации."
              : "Шаблон пакета: цель задаётся смыслом стадии (S1…S5, выиграна, проиграна)."}
          </DialogDescription>
        </DialogHeader>
        {open && <StageRuleForm key={rule?.id ?? "new"} mode={mode} rule={rule} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function StageRuleForm({
  mode,
  rule,
  onDone,
}: {
  mode: Mode
  rule: SignalStageRuleRecord | null
  onDone: () => void
}) {
  const { registry, org, orgId, save } = useSignals()
  const original = rule ?? blankRule(mode, orgId)
  const [d, setD] = useState<SignalStageRuleRecord>(original)
  const [summary, setSummary] = useState("")
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof SignalStageRuleRecord>(k: K, v: SignalStageRuleRecord[K]) =>
    setD((x) => ({ ...x, [k]: v }))
  const setGuard = <K extends keyof StageRuleGuards>(k: K, v: StageRuleGuards[K] | undefined) =>
    setD((x) => {
      const g = { ...x.guards }
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete g[k]
      else g[k] = v
      return { ...x, guards: g }
    })

  const stages = stageOptions(org)
  const meaningOpts = options(STAGE_MEANINGS, MEANING_LABELS_RU)
  const errs = (n: string) => fieldErrors(errors, n)

  const onSave = async () => {
    const { id: _id, ...rest } = d
    void _id
    const data: Record<string, unknown> = {
      ...rest,
      organizationId: mode === "org" ? orgId : null,
      dealTypes: d.dealTypes.map((s) => s.trim()).filter(Boolean),
      noteRu: d.noteRu?.trim() ? d.noteRu : null,
    }
    const isNew = !rule
    const payload = isNew ? data : diffRecord(original as unknown as Record<string, unknown>, data)
    if (!isNew && Object.keys(payload).length === 0) {
      toast.info("Нет изменений")
      return
    }
    setSaving(true)
    const res = await save({
      entity: "stage_rule",
      action: isNew ? "create" : "update",
      key: isNew ? undefined : rule.id,
      organizationId: mode === "org" ? orgId : null,
      data: payload,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (res.ok) onDone()
    else setErrors(res.errors)
  }

  return (
    <>
      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Код сигнала" errors={errs("code")}>
            <SearchPicker
              value={d.code || null}
              onChange={(v) => set("code", v ?? "")}
              options={codeOptions(registry, { excludeRetired: true })}
              placeholder="Выберите код…"
            />
          </FormField>
          <FormField label="Действие" errors={errs("effect")}>
            <ValueSelect
              value={d.effect}
              onChange={(v) => v && set("effect", v as SignalStageRuleRecord["effect"])}
              options={options(STAGE_RULE_EFFECTS, EFFECT_LABELS_RU)}
            />
          </FormField>
          {mode === "org" ? (
            <FormField label="Целевая стадия" errors={errs("targetStageId")}>
              <ValueSelect
                value={d.targetStageId}
                onChange={(v) => set("targetStageId", v)}
                options={stages}
                nullable
                noneLabel="Нет (не нужна)"
              />
            </FormField>
          ) : (
            <FormField label="Целевая стадия (смысл)" errors={errs("targetStageMeaning")}>
              <ValueSelect
                value={d.targetStageMeaning}
                onChange={(v) => set("targetStageMeaning", v)}
                options={meaningOpts}
                nullable
                noneLabel="Нет (не нужна)"
              />
            </FormField>
          )}
          <FormField label="Пакет" errors={errs("packCode")}>
            <ValueSelect
              value={d.packCode}
              onChange={(v) => set("packCode", v)}
              options={registry.packs.map((p) => ({ value: p.code, label: p.labelRu }))}
              nullable
              noneLabel="Без пакета"
            />
          </FormField>
          <FormField label="Порядок" errors={errs("sort")}>
            <NumberInput value={d.sort} onChange={(v) => set("sort", v ?? 0)} />
          </FormField>
          <FormField label="Состояние" errors={errs("enabled")}>
            <BoolField checked={d.enabled} onChange={(v) => set("enabled", v)} label="Правило включено" />
          </FormField>
          <FormField
            label="Типы сделок"
            hint="Коды типов сделок организации (например, new_venue). Пусто = любой тип."
            errors={errs("dealTypes")}
            className="sm:col-span-2"
          >
            <ListEditor values={d.dealTypes} onChange={(v) => set("dealTypes", v)} placeholder="new_venue" />
          </FormField>
        </div>

        <FormSection title="Условия (guards)">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Мин. уверенность" errors={errs("guards.minConfidence")}>
              <ValueSelect
                value={d.guards.minConfidence ?? null}
                onChange={(v) => setGuard("minConfidence", (v ?? undefined) as StageRuleGuards["minConfidence"])}
                options={options(CONFIDENCES, CONFIDENCE_LABELS_RU)}
                nullable
                noneLabel="Не задано"
              />
            </FormField>
            <FormField label="Мин. оценка" errors={errs("guards.minScore")}>
              <NumberInput
                value={d.guards.minScore ?? null}
                onChange={(v) => setGuard("minScore", v ?? undefined)}
                nullable
                placeholder="Не задано"
              />
            </FormField>
            <FormField label="Из стадий" hint="Пусто = из любой стадии" errors={errs(mode === "org" ? "guards.fromStageIds" : "guards.fromStageMeanings")}>
              {mode === "org" ? (
                <MultiCheckSelect
                  label="Стадий"
                  emptyLabel="Любая стадия"
                  options={stages}
                  values={d.guards.fromStageIds ?? []}
                  onChange={(v) => setGuard("fromStageIds", v)}
                />
              ) : (
                <MultiCheckSelect
                  label="Стадий"
                  emptyLabel="Любая стадия"
                  options={meaningOpts}
                  values={d.guards.fromStageMeanings ?? []}
                  onChange={(v) => setGuard("fromStageMeanings", v)}
                />
              )}
            </FormField>
            <div className="flex flex-col justify-center gap-2">
              <BoolField
                checked={d.guards.forwardOnly !== false}
                onChange={(v) => setGuard("forwardOnly", v)}
                label="Только вперёд"
              />
              <BoolField
                checked={!!d.guards.requiresConfirmation}
                onChange={(v) => setGuard("requiresConfirmation", v || undefined)}
                label="Требует подтверждения (карточка)"
              />
            </div>
            <FormField label="Нужен факт" hint="Например, concrete_task" errors={errs("guards.requiresFact")}>
              <Input
                value={d.guards.requiresFact ?? ""}
                onChange={(e) => setGuard("requiresFact", e.target.value || undefined)}
                className="font-mono"
              />
            </FormField>
            <FormField label="Проверка клиента" errors={errs("guards.clientGuard")}>
              <Input
                value={d.guards.clientGuard ?? ""}
                onChange={(e) => setGuard("clientGuard", e.target.value || undefined)}
                className="font-mono"
              />
            </FormField>
          </div>
        </FormSection>

        <FormField label="Примечание" errors={errs("noteRu")}>
          <Textarea value={d.noteRu ?? ""} onChange={(e) => set("noteRu", e.target.value)} rows={2} />
        </FormField>

        <ErrorList errors={errors} />
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Причина изменения</span>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="h-8" />
        </div>
        <Button size="sm" onClick={onSave} disabled={saving || !d.code}>
          {saving && <Loader className="h-4 w-4 animate-spin" />}
          {rule ? "Сохранить" : "Создать"}
        </Button>
      </DialogFooter>
    </>
  )
}

// ── copy pack template → org ─────────────────────────────────────────────

function CopyRulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Скопировать шаблон правил</DialogTitle>
          <DialogDescription>
            Правила шаблона пакета копируются в организацию. Сопоставьте смыслы стадий с
            воронкой организации; правила с несопоставленной стадией сервер не создаст.
          </DialogDescription>
        </DialogHeader>
        {open && <CopyRulesForm onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function CopyRulesForm({ onDone }: { onDone: () => void }) {
  const { registry, org, orgId, reload } = useSignals()
  const templatePacks = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of registry.stageRuleTemplates) {
      if (r.packCode) counts.set(r.packCode, (counts.get(r.packCode) ?? 0) + 1)
    }
    return registry.packs
      .filter((p) => counts.has(p.code))
      .map((p) => ({ value: p.code, label: `${p.labelRu} (${counts.get(p.code)} правил)` }))
  }, [registry])
  const [packCode, setPackCode] = useState<string | null>(templatePacks[0]?.value ?? null)
  const [map, setMap] = useState<SignalsCopyStageRulesRequest["stageMap"]>({})
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)

  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of registry.stageRuleTemplates) {
      if (r.packCode !== packCode) continue
      const keys = [r.targetStageMeaning, ...(r.guards?.fromStageMeanings ?? [])].filter(Boolean) as string[]
      for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [registry, packCode])

  const stages = stageOptions(org)

  const onCopy = async () => {
    if (!orgId || !packCode) return
    setSaving(true)
    try {
      const res = await postSignals<{ version: number; created: number; skipped?: string[] }>(`${SIGNALS_API}/stage-rules/copy`, {
        organizationId: orgId,
        packCode,
        stageMap: map,
      } satisfies SignalsCopyStageRulesRequest)
      if (!res.ok) {
        setErrors(res.errors)
        toast.error(`Не скопировано: ошибок ${res.errors.length}`)
        return
      }
      toast.success(`Сохранено (версия ${res.data.version}) · скопировано правил: ${res.data.created}`)
      if (res.data.skipped?.length) toast.warning(`Пропущено: ${res.data.skipped.join("; ")}`)
      await reload()
      onDone()
    } catch (e) {
      toast.error(`Не удалось скопировать: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  if (templatePacks.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">В реестре нет шаблонов правил.</p>
  }

  return (
    <>
      <div className="space-y-4">
        <FormField label="Пакет-шаблон" errors={fieldErrors(errors, "packCode")}>
          <ValueSelect value={packCode} onChange={setPackCode} options={templatePacks} />
        </FormField>
        <div className="space-y-2">
          <div className="text-sm font-medium">Сопоставление стадий</div>
          {STAGE_MEANINGS.map((m) => (
            <div key={m} className="grid grid-cols-[8rem_1fr] items-center gap-3">
              <span className="text-sm">
                {MEANING_LABELS_RU[m]}
                {used.get(m) ? (
                  <span className="ml-1 text-xs text-muted-foreground">({used.get(m)})</span>
                ) : null}
              </span>
              <ValueSelect
                size="sm"
                value={map[m] ?? null}
                onChange={(v) =>
                  setMap((x) => {
                    const next = { ...x }
                    if (v) next[m] = v
                    else delete next[m]
                    return next
                  })
                }
                options={stages}
                nullable
                noneLabel="Не сопоставлено"
              />
            </div>
          ))}
          {fieldErrors(errors, "stageMap").map((e, i) => (
            <p key={i} className="text-xs text-red-500">{e}</p>
          ))}
        </div>
        <ErrorList errors={errors} />
      </div>
      <DialogFooter>
        <Button size="sm" onClick={onCopy} disabled={saving || !packCode}>
          {saving && <Loader className="h-4 w-4 animate-spin" />}
          Скопировать
        </Button>
      </DialogFooter>
    </>
  )
}

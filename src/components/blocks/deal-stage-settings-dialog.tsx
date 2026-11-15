"use client"

// «Настройки воронки» (/deals, кнопка со слайдерами; docs/specs/funnel §3.7,
// §7): owner edits, other members read. One draft `FunnelConfig` (stages,
// deal types, outcome reasons, entry gate, stage rules) — validated on the
// client with `validateFunnelConfig` (inline issues + a summary), saved with
// PUT /api/deals/funnel { config } (server issues shown the same way).
// «Начать с шаблона» = POST { action: "template", code } → the draft (kept
// stage ids of the same code, so their deals stay); «Проверить на данных» =
// POST { action: "preview", config } → what the edited rules would have done
// over the last 30 days (nothing written). Unsaved changes ask on close.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  EyeOff,
  FlaskConical,
  LayoutTemplate,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import {
  RuleRow,
  needsStage,
  type DraftRule,
} from "@/components/blocks/deal-funnel-rule-editor"
import type {
  FunnelGetResponse,
  FunnelPreviewResult,
} from "@/components/blocks/deal-funnel-ui"
import {
  ENTRY_GATES,
  ENTRY_GATE_LABELS_RU,
  FUNNEL_LIMITS,
  PROBABILITY_MODES,
  PROBABILITY_MODE_LABELS_RU,
  REASON_KINDS,
  REASON_KIND_LABELS_RU,
  RULE_EFFECT_LABELS_RU,
  STAGE_ROLES,
  STAGE_ROLE_LABELS_RU,
  newStageCode,
  validateFunnelConfig,
  type EntryGate,
  type FunnelConfig,
  type FunnelIssue,
  type FunnelRule,
  type FunnelStageConfig,
  type ProbabilityMode,
  type ReasonKind,
  type RuleEffect,
  type StageRole,
} from "@/lib/funnel/config"
import { DEFAULT_STALE_NORM_DAYS } from "@/lib/deal-activity"
import { cn } from "@/lib/utils"

export type FunnelSettingsTab = "stages" | "types" | "reasons" | "gate"

type Draft = Omit<FunnelConfig, "rules"> & { rules: DraftRule[] }

type PreviewData = FunnelPreviewResult

type ConfirmState = {
  title: string
  description: string
  action: string
  destructive?: boolean
  onConfirm: () => void
}

/** Pseudo stage «События и пауза» — rules without a target stage. */
const GENERAL = "__general__"

let ruleKeySeq = 0
const newRuleKey = () => `rule-${++ruleKeySeq}`

function toDraft(c: FunnelConfig): Draft {
  return { ...c, rules: c.rules.map((r) => ({ ...r, _k: newRuleKey() })) }
}

function toConfig(d: Draft): FunnelConfig {
  return {
    ...d,
    rules: d.rules.map((r) => {
      const { _k, ...rule } = r
      void _k
      return rule
    }),
  }
}

/** Where a rule is shown: its target stage, the won / lost stage, or GENERAL. */
function ruleHome(rule: FunnelRule, stages: readonly FunnelStageConfig[]): string {
  if (needsStage(rule.effect)) {
    return rule.stage && stages.some((s) => s.code === rule.stage)
      ? rule.stage
      : GENERAL
  }
  if (rule.effect === "outcome_won") {
    return stages.find((s) => s.role === "won")?.code ?? GENERAL
  }
  if (rule.effect === "outcome_lost") {
    return stages.find((s) => s.role === "lost")?.code ?? GENERAL
  }
  return GENERAL
}

const CYRILLIC = /[а-яё]/i

/**
 * Structural (zod) issues come with English default messages — give the
 * common ones a Russian text; the funnel rules are Russian already.
 */
function humanizeIssue(issue: FunnelIssue): FunnelIssue {
  if (CYRILLIC.test(issue.message)) return issue
  const p = issue.path
  let message = "Неверное значение"
  if (/^rules\.\d+\.signal$/.test(p)) message = "Выберите сигнал"
  else if (/^rules\.\d+\.stage$/.test(p)) message = "Укажите стадию"
  else if (/\.(name|label)$/.test(p)) message = "Укажите название (не слишком длинное)"
  else if (/\.probability$/.test(p)) message = "Вероятность — от 0 до 100 %"
  else if (/\.staleNormDays$/.test(p)) message = "Норма — целое число дней от 1 до 365"
  else if (/\.code$/.test(p)) message = "Код: латиница, цифры, «_»"
  else if (/^stages$/.test(p)) message = "Слишком много или слишком мало стадий"
  else if (/^rules$/.test(p)) message = "Слишком много правил"
  return { ...issue, message }
}

function issuesAt(issues: readonly FunnelIssue[], prefix: string): FunnelIssue[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
}

function tabOfIssue(path: string): FunnelSettingsTab | null {
  if (path.startsWith("stages") || path.startsWith("rules")) return "stages"
  if (path.startsWith("dealTypes")) return "types"
  if (path.startsWith("reasons")) return "reasons"
  if (path.startsWith("entryGate")) return "gate"
  return null
}

function uniqueCode(prefix: string, taken: readonly string[]): string {
  const set = new Set(taken)
  for (let n = 1; n < 1000; n++) {
    const c = `${prefix}_${n}`
    if (!set.has(c)) return c
  }
  return `${prefix}_${Date.now()}`
}

function uniqueName(base: string, taken: readonly string[]): string {
  const set = new Set(taken.map((t) => t.toLowerCase()))
  if (!set.has(base.toLowerCase())) return base
  for (let n = 2; n < 1000; n++) {
    const c = `${base} ${n}`
    if (!set.has(c.toLowerCase())) return c
  }
  return base
}

const ROLE_SHORT_RU: Record<StageRole, string> = {
  area0: "до воронки",
  active: "воронка",
  won: "выиграли",
  lost: "не состоялась",
}

const GATE_EXPLANATION_RU: Record<EntryGate, string> = {
  none: "Правило «Создать сделку» создаёт сделку само, когда сигнал клиента достаточно уверенный; иначе появляется карточка-предложение.",
  go_no_go:
    "Сделка сама не создаётся. По сигналу клиента появляется карточка «Новая возможность: go / no-go?»: «Go» создаёт сделку на стадии правила, «No-go» требует причину из списка «No-go» и остаётся в истории темы и компании. Решает любой участник.",
}

export function DealStageSettingsDialog({
  open,
  onOpenChange,
  onSaved,
  initialTab = "stages",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialTab?: FunnelSettingsTab
}) {
  const [loaded, setLoaded] = useState<FunnelGetResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalJson, setOriginalJson] = useState("")
  const [tab, setTab] = useState<FunnelSettingsTab>(initialTab)
  const [selected, setSelected] = useState<string>(GENERAL)
  const [serverIssues, setServerIssues] = useState<FunnelIssue[]>([])
  const [issuesShown, setIssuesShown] = useState(false)
  const [preview, setPreview] = useState<{ data: PreviewData; json: string } | null>(null)
  const [busy, setBusy] = useState<null | "save" | "preview" | "template">(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  // Reset on open («adjust state during render»); the fetch is an effect.
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setTab(initialTab)
      setLoaded(null)
      setDraft(null)
      setServerIssues([])
      setIssuesShown(false)
      setPreview(null)
      setConfirm(null)
    }
  }
  // The caller passes an inline onOpenChange — keep the load effect keyed
  // on `open` only, or every parent render would reload (and drop) the draft.
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/deals/funnel")
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed")
        const data = (await res.json()) as FunnelGetResponse
        if (cancelled) return
        const d = toDraft(data.config)
        setLoaded(data)
        setDraft(d)
        setOriginalJson(JSON.stringify(toConfig(d)))
        setSelected(d.stages[0]?.code ?? GENERAL)
      })
      .catch(() => {
        if (cancelled) return
        toast.error("Не удалось загрузить настройки воронки")
        onOpenChangeRef.current(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const canManage = loaded?.canManage === true
  const ro = !canManage
  const catalog = useMemo(() => loaded?.catalog ?? [], [loaded])
  const usage = useMemo(() => loaded?.stagesUsage ?? {}, [loaded])
  const usageOf = (s: FunnelStageConfig) =>
    s.id ? (usage[s.id] ?? usage[s.code] ?? 0) : 0

  const ctx = useMemo(
    () => ({
      knownSignals: new Set(catalog.map((c) => c.code)),
      dealsByStageId: usage,
      existingStageIds: (loaded?.config.stages ?? [])
        .map((s) => s.id)
        .filter((x): x is string => !!x),
    }),
    [catalog, usage, loaded],
  )

  const config = useMemo(() => (draft ? toConfig(draft) : null), [draft])
  const draftJson = useMemo(() => (config ? JSON.stringify(config) : ""), [config])
  const dirty = !!draft && draftJson !== originalJson
  const liveIssues = useMemo(
    () =>
      config ? validateFunnelConfig(config, ctx).issues.map(humanizeIssue) : [],
    [config, ctx],
  )
  const issues = useMemo(
    () => [...liveIssues, ...serverIssues],
    [liveIssues, serverIssues],
  )
  const previewFresh = !!preview && preview.json === draftJson
  const previewByIndex = useMemo(() => {
    const m = new Map<number, number>()
    if (preview && previewFresh) {
      for (const r of preview.data.rules) m.set(r.index, r.wouldAct)
    }
    return m
  }, [preview, previewFresh])

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d))
    setServerIssues([])
  }

  const close = () => onOpenChange(false)
  const requestClose = () => {
    if (busy === "save") return
    if (dirty && canManage) {
      setConfirm({
        title: "Закрыть без сохранения?",
        description: "Изменения воронки не сохранены и пропадут.",
        action: "Не сохранять",
        destructive: true,
        onConfirm: close,
      })
      return
    }
    close()
  }

  // ── Stages ──────────────────────────────────────────────────────────────
  const patchStage = (code: string, patch: Partial<FunnelStageConfig>) =>
    update((d) => ({
      ...d,
      stages: d.stages.map((s) => (s.code === code ? { ...s, ...patch } : s)),
    }))

  const moveStage = (index: number, dir: -1 | 1) =>
    update((d) => {
      const j = index + dir
      if (j < 0 || j >= d.stages.length) return d
      const stages = [...d.stages]
      ;[stages[index], stages[j]] = [stages[j], stages[index]]
      return { ...d, stages }
    })

  const addStage = () => {
    if (!draft) return
    const code = newStageCode(draft.stages.map((s) => s.code))
    const stage: FunnelStageConfig = {
      code,
      name: uniqueName(
        "Новая стадия",
        draft.stages.map((s) => s.name),
      ),
      role: "active",
      description: null,
      entryCondition: null,
      signalsHint: null,
      inForecast: false,
      probabilityMode: "stage",
      probability: 0,
      staleNormDays: null,
      isHidden: false,
    }
    update((d) => {
      const lastActive = d.stages.map((s) => s.role).lastIndexOf("active")
      const at = lastActive >= 0 ? lastActive + 1 : d.stages.length
      const stages = [...d.stages]
      stages.splice(at, 0, stage)
      return { ...d, stages }
    })
    setSelected(code)
  }

  const removeStage = (stage: FunnelStageConfig) => {
    if (!draft) return
    const targeting = draft.rules.filter(
      (r) => needsStage(r.effect) && r.stage === stage.code,
    )
    const doRemove = () => {
      update((d) => ({
        ...d,
        stages: d.stages.filter((s) => s.code !== stage.code),
        rules: d.rules.filter(
          (r) => !(needsStage(r.effect) && r.stage === stage.code),
        ),
      }))
      const rest = draft.stages.filter((s) => s.code !== stage.code)
      setSelected(rest[0]?.code ?? GENERAL)
    }
    setConfirm({
      title: `Удалить стадию «${stage.name}»?`,
      description: targeting.length
        ? `Вместе со стадией удалятся правила, которые переводят на неё: ${targeting.length}. Изменение применится после «Сохранить».`
        : "Изменение применится после «Сохранить».",
      action: "Удалить",
      destructive: true,
      onConfirm: doRemove,
    })
  }

  // ── Rules ───────────────────────────────────────────────────────────────
  const patchRule = (key: string, patch: Partial<FunnelRule>) =>
    update((d) => ({
      ...d,
      rules: d.rules.map((r) => (r._k === key ? { ...r, ...patch } : r)),
    }))
  const removeRule = (key: string) =>
    update((d) => ({ ...d, rules: d.rules.filter((r) => r._k !== key) }))
  const addRule = (effect: RuleEffect, stage: string | null) => {
    if (!draft) return
    if (draft.rules.length >= FUNNEL_LIMITS.rules) {
      toast.error(`Не больше ${FUNNEL_LIMITS.rules} правил`)
      return
    }
    const rule: DraftRule = {
      _k: newRuleKey(),
      signal: "",
      effect,
      stage,
      dealTypes: [],
      requiresConfirmation: false,
      minConfidence: "medium",
      enabled: true,
    }
    update((d) => ({ ...d, rules: [...d.rules, rule] }))
  }

  // ── Header actions ──────────────────────────────────────────────────────
  const applyTemplate = (code: string, label: string) =>
    setConfirm({
      title: `Начать с шаблона «${label}»?`,
      description:
        "Черновик заменится шаблоном: стадии, правила, типы и причины. Стадии с тем же кодом сохранят свои сделки. Ничего не запишется до «Сохранить».",
      action: "Заменить черновик",
      onConfirm: async () => {
        setBusy("template")
        try {
          const res = await fetch("/api/deals/funnel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "template", code }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || !body.config) {
            throw new Error(body.error || "Не удалось загрузить шаблон")
          }
          const tpl = body.config as FunnelConfig
          // Keep the ids of existing stages / types with the SAME code —
          // their deals (and rules) stay attached.
          const orig = loaded?.config
          const stageIdByCode = new Map(
            (orig?.stages ?? []).filter((s) => s.id).map((s) => [s.code, s.id]),
          )
          const typeIdByCode = new Map(
            (orig?.dealTypes ?? []).filter((t) => t.id).map((t) => [t.code, t.id]),
          )
          const merged: FunnelConfig = {
            ...tpl,
            stages: tpl.stages.map((s) => ({
              ...s,
              id: s.id ?? stageIdByCode.get(s.code),
            })),
            dealTypes: tpl.dealTypes.map((t) => ({
              ...t,
              id: t.id ?? typeIdByCode.get(t.code),
            })),
          }
          const d = toDraft(merged)
          setDraft(d)
          setServerIssues([])
          setPreview(null)
          setSelected(d.stages[0]?.code ?? GENERAL)
          toast.success("Шаблон загружен в черновик — проверьте и сохраните")
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Не удалось загрузить шаблон")
        } finally {
          setBusy(null)
        }
      },
    })

  const runPreview = async () => {
    if (!config) return
    setBusy("preview")
    try {
      const res = await fetch("/api/deals/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", config }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.preview) {
        if (Array.isArray(body.issues)) {
          setServerIssues(body.issues as FunnelIssue[])
          setIssuesShown(true)
        }
        throw new Error(body.error || "Не удалось проверить правила")
      }
      setPreview({ data: body.preview as PreviewData, json: draftJson })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось проверить правила")
    } finally {
      setBusy(null)
    }
  }

  const jumpTo = (issue: FunnelIssue | undefined) => {
    if (!issue || !draft) return
    const t = tabOfIssue(issue.path)
    if (t) setTab(t)
    const m = /^(stages|rules)\.(\d+)/.exec(issue.path)
    if (!m) return
    const i = Number(m[2])
    if (m[1] === "stages") {
      const s = draft.stages[i]
      if (s) setSelected(s.code)
    } else {
      const r = draft.rules[i]
      if (r) setSelected(ruleHome(r, draft.stages))
    }
  }

  const save = async () => {
    if (!config) return
    const v = validateFunnelConfig(config, ctx)
    if (v.issues.length > 0) {
      setIssuesShown(true)
      jumpTo(v.issues.map(humanizeIssue)[0])
      toast.error("Воронку нельзя сохранить — исправьте ошибки")
      return
    }
    setBusy("save")
    try {
      const res = await fetch("/api/deals/funnel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(body.issues) && body.issues.length > 0) {
          const list = body.issues as FunnelIssue[]
          setServerIssues(list)
          setIssuesShown(true)
          jumpTo(list[0])
        }
        throw new Error(body.error || "Не удалось сохранить воронку")
      }
      toast.success("Воронка сохранена")
      onSaved()
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить воронку")
    } finally {
      setBusy(null)
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────
  const issueCountByTab = (t: FunnelSettingsTab) =>
    issues.filter((i) => tabOfIssue(i.path) === t).length

  const issueLocation = (path: string): string => {
    if (!draft) return ""
    const m = /^(stages|rules|dealTypes)\.(\d+)/.exec(path)
    if (m) {
      const i = Number(m[2])
      if (m[1] === "stages") return `Стадия «${draft.stages[i]?.name ?? i + 1}»`
      if (m[1] === "rules") {
        const r = draft.rules[i]
        const label = catalog.find((c) => c.code === r?.signal)?.labelRu
        return `Правило «${label ?? r?.signal ?? i + 1}»`
      }
      return `Тип «${draft.dealTypes[i]?.label ?? i + 1}»`
    }
    const rk = /^reasons\.(lost|noGo|withdrawn)/.exec(path)
    if (rk) return `Причины: ${REASON_KIND_LABELS_RU[rk[1] as ReasonKind]}`
    if (path === "stages") return "Стадии"
    return ""
  }

  const ruleIndexByKey = new Map(draft?.rules.map((r, i) => [r._k, i]) ?? [])
  const rulesAt = (home: string) =>
    draft ? draft.rules.filter((r) => ruleHome(r, draft.stages) === home) : []

  const renderRules = (home: string, add: { effect: RuleEffect; stage: string | null; label: string }) => {
    if (!draft) return null
    const rules = rulesAt(home)
    return (
      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="text-sm text-muted-foreground">Правил пока нет.</p>
        )}
        {rules.map((r) => {
          const idx = ruleIndexByKey.get(r._k) ?? -1
          return (
            <RuleRow
              key={r._k}
              rule={r}
              catalog={catalog}
              stages={draft.stages}
              dealTypes={draft.dealTypes}
              issues={issuesAt(issues, `rules.${idx}`)}
              previewCount={previewFresh ? (previewByIndex.get(idx) ?? 0) : null}
              readOnly={ro}
              onChange={(patch) => patchRule(r._k, patch)}
              onRemove={() => removeRule(r._k)}
            />
          )
        })}
        {!ro && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addRule(add.effect, add.stage)}
          >
            <Plus className="h-4 w-4 mr-1" />
            {add.label}
          </Button>
        )}
      </div>
    )
  }

  const selectedIndex = draft ? draft.stages.findIndex((s) => s.code === selected) : -1
  const selectedStage = selectedIndex >= 0 && draft ? draft.stages[selectedIndex] : null
  const activeCount = draft?.stages.filter((s) => s.role === "active").length ?? 0
  const firstActiveCode = draft?.stages.find((s) => s.role === "active")?.code ?? null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) requestClose()
        }}
      >
        <DialogContent className="flex h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-[min(1240px,calc(100vw-2rem))]">
          <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-3 pr-12">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>Настройки воронки</DialogTitle>
                <DialogDescription className="mt-1">
                  Стадии, правила перевода по сигналам клиента, типы сделок,
                  причины исходов и правило входа в воронку.
                </DialogDescription>
              </div>
              {draft && canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || !loaded?.templates.length}
                      >
                        {busy === "template" ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <LayoutTemplate className="h-4 w-4 mr-1" />
                        )}
                        Начать с шаблона
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                      <DropdownMenuLabel>Шаблоны воронки</DropdownMenuLabel>
                      {(loaded?.templates ?? []).map((t) => (
                        <DropdownMenuItem
                          key={t.code}
                          onSelect={() => applyTemplate(t.code, t.labelRu)}
                          className="flex-col items-start gap-0.5"
                        >
                          <span>{t.labelRu}</span>
                          {t.description && (
                            <span className="text-xs text-muted-foreground">
                              {t.description}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={runPreview}
                    disabled={busy !== null}
                  >
                    {busy === "preview" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <FlaskConical className="h-4 w-4 mr-1" />
                    )}
                    Проверить на данных
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={save}
                    disabled={busy !== null || !dirty}
                  >
                    {busy === "save" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Сохранить
                  </Button>
                </div>
              )}
            </div>
            {draft && !canManage && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
                Менять воронку может только владелец организации — здесь только
                просмотр.
              </p>
            )}
          </DialogHeader>

          {!draft ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as FunnelSettingsTab)}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="shrink-0 space-y-3 border-b px-5 py-3">
                <TabsList>
                  {(
                    [
                      ["stages", "Стадии"],
                      ["types", "Типы сделок"],
                      ["reasons", "Причины"],
                      ["gate", "Правила входа"],
                    ] as const
                  ).map(([v, label]) => {
                    const n = issueCountByTab(v)
                    return (
                      <TabsTrigger key={v} value={v}>
                        {label}
                        {n > 0 && (
                          <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] leading-4 font-semibold text-white">
                            {n}
                          </span>
                        )}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>

                {issuesShown && issues.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Воронку нельзя сохранить: {issues.length}{" "}
                      {issues.length === 1 ? "ошибка" : "ошибок"}
                    </div>
                    <ul className="space-y-0.5">
                      {issues.map((i, n) => {
                        const where = issueLocation(i.path)
                        return (
                          <li key={n}>
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => jumpTo(i)}
                            >
                              {where && (
                                <span className="text-muted-foreground">{where}: </span>
                              )}
                              {i.message}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {preview && (
                  <PreviewPanel
                    preview={preview.data}
                    stale={!previewFresh}
                    stages={draft.stages}
                    catalog={catalog}
                    onClose={() => setPreview(null)}
                  />
                )}
              </div>

              {/* ── Стадии ── */}
              <TabsContent value="stages" className="min-h-0 flex-1">
                <div className="flex h-full min-h-0 flex-col md:flex-row">
                  <div className="shrink-0 space-y-1 overflow-y-auto border-b p-3 md:w-72 md:border-r md:border-b-0">
                    {issuesAt(issues, "stages")
                      .filter((i) => i.path === "stages")
                      .map((i, n) => (
                        <p key={n} className="px-1 text-xs text-destructive">
                          {i.message}
                        </p>
                      ))}
                    {draft.stages.map((s, i) => (
                      <StageListItem
                        key={s.code}
                        stage={s}
                        selected={s.code === selected}
                        usage={usageOf(s)}
                        hasIssues={issuesAt(issues, `stages.${i}`).length > 0}
                        ruleCount={rulesAt(s.code).length}
                        canUp={!ro && i > 0}
                        canDown={!ro && i < draft.stages.length - 1}
                        readOnly={ro}
                        onSelect={() => setSelected(s.code)}
                        onUp={() => moveStage(i, -1)}
                        onDown={() => moveStage(i, 1)}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setSelected(GENERAL)}
                      className={cn(
                        "mt-2 w-full rounded-md border border-dashed px-2.5 py-2 text-left text-sm hover:bg-accent",
                        selected === GENERAL && "border-primary bg-accent",
                      )}
                    >
                      События и пауза (без стадии)
                      <span className="ml-1 text-xs text-muted-foreground">
                        {rulesAt(GENERAL).length}
                      </span>
                    </button>
                    {!ro && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={addStage}
                        disabled={activeCount >= FUNNEL_LIMITS.activeStages}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Добавить стадию
                      </Button>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <fieldset disabled={ro} className="min-w-0 space-y-5">
                      {selectedStage ? (
                        <StageEditor
                          stage={selectedStage}
                          issues={issuesAt(issues, `stages.${selectedIndex}`)}
                          usage={usageOf(selectedStage)}
                          readOnly={ro}
                          onPatch={(p) => patchStage(selectedStage.code, p)}
                          onRemove={() => removeStage(selectedStage)}
                        >
                          {selectedStage.role === "area0" ? (
                            <p className="text-sm text-muted-foreground">
                              Стадия вне воронки: правила сюда сделки не
                              переводят.
                            </p>
                          ) : selectedStage.role === "active" ? (
                            renderRules(selectedStage.code, {
                              effect:
                                selectedStage.code === firstActiveCode
                                  ? "create_deal"
                                  : "move_stage",
                              stage: selectedStage.code,
                              label: "Добавить сигнал",
                            })
                          ) : (
                            renderRules(selectedStage.code, {
                              effect:
                                selectedStage.role === "won"
                                  ? "outcome_won"
                                  : "outcome_lost",
                              stage: null,
                              label: "Добавить сигнал итога",
                            })
                          )}
                        </StageEditor>
                      ) : (
                        <section className="space-y-3">
                          <div>
                            <h3 className="font-medium">События и пауза</h3>
                            <p className="text-sm text-muted-foreground">
                              Сигналы, которые не меняют стадию: события
                              внутри стадии (встреча, комментарии, новые
                              сроки), пауза и снятие с паузы. Молчание
                              клиента сделку не закрывает.
                            </p>
                          </div>
                          {renderRules(GENERAL, {
                            effect: "in_stage",
                            stage: null,
                            label: "Добавить сигнал",
                          })}
                        </section>
                      )}
                    </fieldset>
                  </div>
                </div>
              </TabsContent>

              {/* ── Типы сделок ── */}
              <TabsContent value="types" className="min-h-0 flex-1 overflow-y-auto p-5">
                <fieldset disabled={ro} className="max-w-2xl space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Типы не удаляются (на них ссылаются сделки и правила) —
                    только скрываются. Правило с типами действует только на
                    сделки этих типов.
                  </p>
                  {draft.dealTypes.map((t, i) => {
                    const its = issuesAt(issues, `dealTypes.${i}`)
                    return (
                      <div key={t.id ?? t.code} className="space-y-1">
                        <div className="flex items-center gap-3">
                          <Input
                            value={t.label}
                            maxLength={FUNNEL_LIMITS.dealTypeLabel}
                            aria-label="Название типа"
                            aria-invalid={its.length > 0 || undefined}
                            onChange={(e) =>
                              update((d) => ({
                                ...d,
                                dealTypes: d.dealTypes.map((x, j) =>
                                  j === i ? { ...x, label: e.target.value } : x,
                                ),
                              }))
                            }
                          />
                          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                            <Switch
                              checked={!t.hidden}
                              onCheckedChange={(v) =>
                                update((d) => ({
                                  ...d,
                                  dealTypes: d.dealTypes.map((x, j) =>
                                    j === i ? { ...x, hidden: !v } : x,
                                  ),
                                }))
                              }
                              aria-label={`Показывать тип «${t.label}»`}
                            />
                            Показывать
                          </label>
                          {!ro && !t.id ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Удалить тип"
                              onClick={() =>
                                update((d) => ({
                                  ...d,
                                  dealTypes: d.dealTypes.filter((_, j) => j !== i),
                                  rules: d.rules.map((r) => ({
                                    ...r,
                                    dealTypes: r.dealTypes.filter((c) => c !== t.code),
                                  })),
                                }))
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="w-8 shrink-0" />
                          )}
                        </div>
                        {its.map((x, n) => (
                          <p key={n} className="text-xs text-destructive">
                            {x.message}
                          </p>
                        ))}
                      </div>
                    )
                  })}
                  {!ro && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={draft.dealTypes.length >= FUNNEL_LIMITS.dealTypes}
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          dealTypes: [
                            ...d.dealTypes,
                            {
                              code: uniqueCode(
                                "type",
                                d.dealTypes.map((t) => t.code),
                              ),
                              label: uniqueName(
                                "Новый тип",
                                d.dealTypes.map((t) => t.label),
                              ),
                              hidden: false,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Добавить тип
                    </Button>
                  )}
                </fieldset>
              </TabsContent>

              {/* ── Причины ── */}
              <TabsContent value="reasons" className="min-h-0 flex-1 overflow-y-auto p-5">
                <fieldset disabled={ro} className="grid gap-4 lg:grid-cols-3">
                  {REASON_KINDS.map((kind) => (
                    <ReasonList
                      key={kind}
                      kind={kind}
                      reasons={draft.reasons[kind]}
                      issues={issuesAt(issues, `reasons.${kind}`)}
                      readOnly={ro}
                      onChange={(list) =>
                        update((d) => ({
                          ...d,
                          reasons: { ...d.reasons, [kind]: list },
                        }))
                      }
                    />
                  ))}
                </fieldset>
              </TabsContent>

              {/* ── Правила входа ── */}
              <TabsContent value="gate" className="min-h-0 flex-1 overflow-y-auto p-5">
                <fieldset disabled={ro} className="max-w-2xl space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Как новая возможность попадает в воронку. Сигнал клиента
                    сохраняется в теме сразу в обоих случаях.
                  </p>
                  <RadioGroup
                    value={draft.entryGate}
                    onValueChange={(v) =>
                      update((d) => ({ ...d, entryGate: v as EntryGate }))
                    }
                    className="gap-3"
                  >
                    {ENTRY_GATES.map((g) => (
                      <label
                        key={g}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-md border p-3",
                          draft.entryGate === g && "border-primary bg-accent/50",
                        )}
                      >
                        <RadioGroupItem value={g} className="mt-0.5" />
                        <div className="space-y-1">
                          <div className="text-sm font-medium">
                            {ENTRY_GATE_LABELS_RU[g]}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {GATE_EXPLANATION_RU[g]}
                          </p>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </fieldset>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                confirm?.destructive &&
                  "bg-destructive text-white hover:bg-destructive/90",
              )}
              onClick={() => {
                const c = confirm
                setConfirm(null)
                c?.onConfirm()
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── Stage list item (left pane) ───────────────────────────────────────────

function StageListItem({
  stage,
  selected,
  usage,
  hasIssues,
  ruleCount,
  canUp,
  canDown,
  readOnly,
  onSelect,
  onUp,
  onDown,
}: {
  stage: FunnelStageConfig
  selected: boolean
  usage: number
  hasIssues: boolean
  ruleCount: number
  canUp: boolean
  canDown: boolean
  readOnly: boolean
  onSelect: () => void
  onUp: () => void
  onDown: () => void
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md border px-1 py-1",
        selected ? "border-primary bg-accent" : "border-transparent hover:bg-accent/60",
        stage.role === "area0" && "border-dashed",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-1.5 py-0.5 text-left"
      >
        <div className="flex items-center gap-1.5 text-sm">
          {hasIssues && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
          )}
          <span className="truncate">{stage.name || "Без названия"}</span>
          {stage.isHidden && (
            <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {ROLE_SHORT_RU[stage.role]}
          {stage.role === "active" && stage.inForecast ? " · в прогнозе" : ""}
          {` · сделок: ${usage}`}
          {ruleCount > 0 ? ` · правил: ${ruleCount}` : ""}
        </div>
      </button>
      {!readOnly && (
        <div className="flex shrink-0 flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Выше: «${stage.name}»`}
            disabled={!canUp}
            onClick={onUp}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Ниже: «${stage.name}»`}
            disabled={!canDown}
            onClick={onDown}
          >
            <ArrowDown />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Stage editor (right pane) ─────────────────────────────────────────────

function StageEditor({
  stage,
  issues,
  usage,
  readOnly,
  onPatch,
  onRemove,
  children,
}: {
  stage: FunnelStageConfig
  issues: readonly FunnelIssue[]
  usage: number
  readOnly: boolean
  onPatch: (patch: Partial<FunnelStageConfig>) => void
  onRemove: () => void
  children: ReactNode
}) {
  const removeTip = useAnchorTooltip()
  const fieldIssues = (field: string) =>
    issues.filter((i) => i.path.endsWith(`.${field}`))
  const otherIssues = issues.filter(
    (i) => !/\.(name|inForecast|code|probability|staleNormDays)$/.test(i.path),
  )
  const active = stage.role === "active"
  const pct = Math.round(stage.probability * 100)
  const err = (field: string) =>
    fieldIssues(field).map((i, n) => (
      <p key={n} className="text-xs text-destructive">
        {i.message}
      </p>
    ))
  return (
    <>
      <section className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="funnel-stage-name">Название</Label>
            <Input
              id="funnel-stage-name"
              value={stage.name}
              maxLength={FUNNEL_LIMITS.stageName}
              aria-invalid={fieldIssues("name").length > 0 || undefined}
              onChange={(e) => onPatch({ name: e.target.value })}
            />
            {err("name")}
          </div>
          <div className="w-64 space-y-1.5">
            <Label>Роль</Label>
            <Select
              value={stage.role}
              onValueChange={(v) => {
                const role = v as StageRole
                onPatch(role === "active" ? { role } : { role, inForecast: false })
              }}
            >
              <SelectTrigger className="w-full" aria-label="Роль стадии">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {STAGE_ROLE_LABELS_RU[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!readOnly && (
            <div className="self-end">
              <span {...removeTip.bind} className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  aria-label={`Удалить стадию «${stage.name}»`}
                  disabled={usage > 0}
                  onClick={onRemove}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
              <AnchorTooltip
                text={
                  usage > 0
                    ? `На стадии сделок: ${usage} — сначала перенесите их`
                    : "Удалить стадию"
                }
                open={removeTip.open}
                virtualRef={removeTip.virtualRef}
              />
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="funnel-stage-desc">Что объединяет</Label>
            <Textarea
              id="funnel-stage-desc"
              rows={3}
              maxLength={FUNNEL_LIMITS.description}
              value={stage.description ?? ""}
              placeholder="Коротко: какой этап работы с возможностью"
              onChange={(e) => onPatch({ description: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="funnel-stage-entry">Условие входа</Label>
            <Textarea
              id="funnel-stage-entry"
              rows={3}
              maxLength={FUNNEL_LIMITS.entryCondition}
              value={stage.entryCondition ?? ""}
              placeholder="Что должно произойти со стороны клиента, чтобы сделка попала сюда"
              onChange={(e) => onPatch({ entryCondition: e.target.value || null })}
            />
            <p className="text-xs text-muted-foreground">
              Видна подсказкой у колонки на доске.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="funnel-stage-signals">Сигналы (для людей)</Label>
            <Textarea
              id="funnel-stage-signals"
              rows={3}
              maxLength={FUNNEL_LIMITS.signalsHint}
              value={stage.signalsHint ?? ""}
              placeholder="Простыми словами: какие письма и события говорят о входе"
              onChange={(e) => onPatch({ signalsHint: e.target.value || null })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {active && (
            <>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch
                  checked={stage.inForecast}
                  onCheckedChange={(v) => onPatch({ inForecast: v })}
                  aria-label="В прогнозе"
                />
                В прогнозе
              </label>
              <div className="w-56 space-y-1.5">
                <Label>Вероятность</Label>
                <Select
                  value={stage.probabilityMode}
                  onValueChange={(v) => onPatch({ probabilityMode: v as ProbabilityMode })}
                >
                  <SelectTrigger className="w-full" aria-label="Вероятность">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROBABILITY_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PROBABILITY_MODE_LABELS_RU[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {stage.probabilityMode === "stage" && (
                <div className="w-28 space-y-1.5">
                  <Label htmlFor="funnel-stage-prob">Вероятность, %</Label>
                  <Input
                    id="funnel-stage-prob"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    inputMode="numeric"
                    value={Number.isFinite(pct) ? pct : 0}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      onPatch({ probability: Math.min(100, Math.max(0, n)) / 100 })
                    }}
                  />
                </div>
              )}
            </>
          )}
          <div className="w-28 space-y-1.5">
            <Label htmlFor="funnel-stage-norm">Норма, дн</Label>
            <Input
              id="funnel-stage-norm"
              type="number"
              min={1}
              max={365}
              step={1}
              inputMode="numeric"
              placeholder={String(DEFAULT_STALE_NORM_DAYS)}
              value={stage.staleNormDays ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === "") return onPatch({ staleNormDays: null })
                const n = Math.trunc(Number(raw))
                if (Number.isFinite(n)) onPatch({ staleNormDays: n })
              }}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch
              checked={!stage.isHidden}
              onCheckedChange={(v) => onPatch({ isHidden: !v })}
              aria-label="Показывать на доске"
            />
            Показывать на доске
          </label>
        </div>
        {err("inForecast")}
        {err("probability")}
        {err("staleNormDays")}
        {otherIssues.map((i, n) => (
          <p key={n} className="text-xs text-destructive">
            {i.message}
          </p>
        ))}
        {active && stage.probabilityMode === "expert" && stage.inForecast && (
          <p className="text-xs text-muted-foreground">
            Прогноз = сумма сделки × экспертная вероятность, которую
            ответственный ставит в карточке сделки. Без неё сделка — «без
            оценки».
          </p>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <h3 className="font-medium">
            {stage.role === "won" || stage.role === "lost"
              ? "Что закрывает сделку с этим итогом"
              : "Что переводит сюда"}
          </h3>
          <p className="text-sm text-muted-foreground">
            Сигналы клиента из общего каталога. Наши собственные действия и
            молчание клиента стадию не двигают.
          </p>
        </div>
        {children}
      </section>
    </>
  )
}

// ── Reason list (one kind) ────────────────────────────────────────────────

function ReasonList({
  kind,
  reasons,
  issues,
  readOnly,
  onChange,
}: {
  kind: ReasonKind
  reasons: FunnelConfig["reasons"][ReasonKind]
  issues: readonly FunnelIssue[]
  readOnly: boolean
  onChange: (list: FunnelConfig["reasons"][ReasonKind]) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{REASON_KIND_LABELS_RU[kind]}</h3>
      {reasons.length === 0 && (
        <p className="text-sm text-muted-foreground">Причин нет.</p>
      )}
      {reasons.map((r, i) => {
        const its = issuesAt(issues, `reasons.${kind}.${i}`)
        return (
          <div key={r.code} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={r.label}
                maxLength={FUNNEL_LIMITS.reasonLabel}
                aria-label="Причина"
                aria-invalid={its.length > 0 || undefined}
                onChange={(e) =>
                  onChange(
                    reasons.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
              />
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Удалить причину «${r.label}»`}
                  onClick={() => onChange(reasons.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {its.map((x, n) => (
              <p key={n} className="text-xs text-destructive">
                {x.message}
              </p>
            ))}
          </div>
        )
      })}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reasons.length >= FUNNEL_LIMITS.reasonsPerKind}
          onClick={() =>
            onChange([
              ...reasons,
              {
                code: uniqueCode(
                  "r",
                  reasons.map((x) => x.code),
                ),
                label: "",
              },
            ])
          }
        >
          <Plus className="h-4 w-4 mr-1" />
          Добавить причину
        </Button>
      )}
    </div>
  )
}

// ── Preview panel («Проверить на данных») ─────────────────────────────────

function PreviewPanel({
  preview,
  stale,
  stages,
  catalog,
  onClose,
}: {
  preview: PreviewData
  stale: boolean
  stages: readonly FunnelStageConfig[]
  catalog: FunnelGetResponse["catalog"]
  onClose: () => void
}) {
  const since = new Date(preview.since)
  const sinceText = Number.isNaN(since.getTime())
    ? ""
    : ` (с ${since.toLocaleDateString("ru-RU")})`
  const stageName = (code: string | null) =>
    code ? (stages.find((s) => s.code === code)?.name ?? code) : null
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
  }
  const rules = preview.rules.filter((r) => r.instances > 0)
  const t = preview.totals
  return (
    <div className="max-h-[38vh] overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            Что бы сдвинулось за {preview.days} дн.{sinceText}
          </div>
          <div className="text-xs text-muted-foreground">
            Проверка по сигналам клиентов; ничего не записано. Пауза:{" "}
            {t.pause}, снятие паузы: {t.resume}, события внутри стадии:{" "}
            {t.inStage}.
            {stale && (
              <span className="ml-1 text-amber-700 dark:text-amber-400">
                Черновик изменился — проверьте снова.
              </span>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Закрыть проверку"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {preview.issues.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs text-destructive">
          {preview.issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      )}
      <table className="mb-3 w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pr-2 font-normal">Стадия</th>
            <th className="px-2 py-1 text-right font-normal">Создано</th>
            <th className="px-2 py-1 text-right font-normal">Переведено</th>
            <th className="px-2 py-1 text-right font-normal">Выиграно</th>
            <th className="px-2 py-1 text-right font-normal">Не состоялось</th>
          </tr>
        </thead>
        <tbody>
          {preview.stages.map((s) => (
            <tr key={s.code} className="border-t">
              <td className="py-1 pr-2">{stageName(s.code) ?? s.name}</td>
              {[s.create, s.move, s.won, s.lost].map((n, i) => (
                <td key={i} className="px-2 py-1 text-right tabular-nums">
                  {n || "—"}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="py-1 pr-2">Всего</td>
            {[t.create, t.move, t.won, t.lost].map((n, i) => (
              <td key={i} className="px-2 py-1 text-right tabular-nums">
                {n || "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          За этот период ни один сигнал из правил не найден.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map((r) => {
            const label = catalog.find((c) => c.code === r.signal)?.labelRu ?? r.signal
            const target = stageName(r.stage)
            return (
              <li key={r.index}>
                <div>
                  <span className="font-medium">{label}</span>{" "}
                  <span className="text-muted-foreground">
                    → {RULE_EFFECT_LABELS_RU[r.effect] ?? r.effect}
                    {target ? ` «${target}»` : ""}:
                  </span>{" "}
                  <Badge variant="secondary" className="tabular-nums">
                    сработало бы: {r.wouldAct}
                  </Badge>{" "}
                  <span className="text-xs text-muted-foreground">
                    (сигналов {r.instances}, тем {r.topics})
                  </span>
                </div>
                {r.examples.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {r.examples
                      .slice(0, 3)
                      .map((e) =>
                        [e.company, e.topicTitle, fmt(e.date)]
                          .filter(Boolean)
                          .join(" · "),
                      )
                      .join("; ")}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

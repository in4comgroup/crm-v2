"use client"

// «Коды» sub-tab of «Сигналы»: the registry table of all signal codes and
// the full code editor (05 §3), plus the per-org settings and the pack
// overrides of one code (05 §5).

import { useMemo, useState } from "react"
import { Check, Loader, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_PAGE_SIZE, TablePager, pageCount } from "@/components/blocks/table-pager"
import { MultiCheckSelect } from "@/components/blocks/admin-ai-models"
import {
  CLASS_LABELS_RU,
  DISPLAY_PROFILES,
  KIND_LABELS_RU,
  PROFILE_LABELS_RU,
  RECIPIENT_ROLES,
  SIGNAL_CLASSES,
  SIGNAL_EFFORTS,
  SIGNAL_EMITTED_BY,
  SIGNAL_FAMILIES,
  SIGNAL_KINDS,
  SIGNAL_SCORE_RULES,
  SIGNAL_STAGES,
  STAGE_LABELS_RU,
  type AntiCue,
  type DisplayProfile,
  type EffectiveSignal,
  type OrganizationSignalOverrideRecord,
  type RecipientRole,
  type SignalCategoryRecord,
  type SignalPackOverrideRecord,
  type SignalStage,
  type SignalsValidationError,
} from "@/lib/signals/types"
import {
  BoolField,
  CharCount,
  ConfirmDialog,
  EFFORT_LABELS_RU,
  EMITTED_BY_LABELS_RU,
  ErrorList,
  FAMILY_LABELS_RU,
  FormField,
  FormSection,
  JsonEditor,
  ListEditor,
  NumberInput,
  RECIPIENT_LABELS_RU,
  SCORE_RULE_LABELS_RU,
  SOURCE_LABELS_RU,
  SYNONYM_GROUPS,
  SearchPicker,
  ValueSelect,
  codeOptions,
  diffRecord,
  fieldErrors,
  jsonText,
  options,
  packOverrideKey,
  parseJsonObject,
  useSignals,
} from "@/components/blocks/admin-signals-shared"

export const CUES_MAX = 8
export const CUE_LEN_MAX = 60
const LABEL_MAX = 60
const CODE_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/

export type CodeFilters = {
  pack: string | null
  block: string | null
  stage: string | null
  profile: string | null
  klass: string | null
  family: string | null
  activeOnly: boolean
  q: string
}

export const EMPTY_FILTERS: CodeFilters = {
  pack: null,
  block: null,
  stage: null,
  profile: null,
  klass: null,
  family: null,
  activeOnly: false,
  q: "",
}

const PROCESS_KINDS = new Set(["watchdog", "derived", "trend"])

function searchText(c: SignalCategoryRecord): string {
  return [
    c.code,
    c.labelRu,
    ...c.cuesPromptRu,
    ...Object.values(c.synonymsRu ?? {}).flat(),
    ...(c.antiCuesRu ?? []).map((a) => a.text),
  ]
    .join("\n")
    .toLowerCase()
}

// ── table ────────────────────────────────────────────────────────────────

export function useFilteredCodes(filters: CodeFilters) {
  const { registry, org } = useSignals()
  const effMap = useMemo(
    () => new Map<string, EffectiveSignal>((org?.effective ?? []).map((e) => [e.code, e])),
    [org],
  )
  const packSort = useMemo(() => new Map(registry.packs.map((p) => [p.code, p.sort])), [registry])
  const blockSort = useMemo(() => new Map(registry.blocks.map((b) => [b.code, b.sort])), [registry])
  const index = useMemo(
    () => new Map(registry.categories.map((c) => [c.code, searchText(c)])),
    [registry],
  )

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return registry.categories
      .filter((c) => {
        const eff = effMap.get(c.code)
        const stage = eff?.stage ?? c.stage
        const profile = eff ? eff.displayProfile : c.displayProfile
        if (filters.pack && c.packCode !== filters.pack) return false
        if (filters.block && c.blockCode !== filters.block) return false
        if (filters.stage && stage !== filters.stage) return false
        if (filters.profile && (profile ?? "auto") !== filters.profile) return false
        if (filters.klass && (c.class ?? "none") !== filters.klass) return false
        if (filters.family && c.family !== filters.family) return false
        if (filters.activeOnly && org && !eff?.active) return false
        if (q && !index.get(c.code)?.includes(q)) return false
        return true
      })
      .sort(
        (a, b) =>
          (packSort.get(a.packCode) ?? 0) - (packSort.get(b.packCode) ?? 0) ||
          a.packCode.localeCompare(b.packCode) ||
          (blockSort.get(a.blockCode) ?? 0) - (blockSort.get(b.blockCode) ?? 0) ||
          a.blockCode.localeCompare(b.blockCode) ||
          a.code.localeCompare(b.code),
      )
  }, [registry, effMap, org, filters, index, packSort, blockSort])

  return { rows, effMap }
}

function SourceChips({ eff }: { eff: EffectiveSignal }) {
  const FIELD: Record<string, string> = {
    stage: "стадия",
    weight: "вес",
    displayProfile: "профиль",
    recipientRole: "получатель",
    closesCodes: "закрывает",
  }
  const nonBase = Object.entries(eff.source).filter(([, s]) => s && s !== "base")
  if (nonBase.length === 0) return <span className="text-xs text-muted-foreground">база</span>
  return (
    <div className="flex flex-wrap gap-1">
      {nonBase.map(([f, s]) => (
        <Badge
          key={f}
          variant="outline"
          className={`font-normal ${s === "org" ? "border-sky-500/50 text-sky-700 dark:text-sky-300" : "border-amber-500/50 text-amber-700 dark:text-amber-300"}`}
        >
          {FIELD[f] ?? f}: {SOURCE_LABELS_RU[s as "org" | "pack"]}
        </Badge>
      ))}
    </div>
  )
}

function stageBadge(stage: SignalStage) {
  const cls =
    stage === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : stage === "gated"
        ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
        : "bg-muted text-muted-foreground"
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{STAGE_LABELS_RU[stage] ?? stage}</span>
}

export function CodesTable({
  filters,
  onOpen,
}: {
  filters: CodeFilters
  onOpen: (code: string) => void
}) {
  const { registry, org } = useSignals()
  const { rows, effMap } = useFilteredCodes(filters)
  const blockLabel = useMemo(
    () => new Map(registry.blocks.map((b) => [`${b.packCode}:${b.code}`, b.labelRu])),
    [registry],
  )
  const withOrg = !!org
  const cols = withOrg ? 13 : 8
  const [pageRaw, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  // Clamp: a filter change can shrink the list below the current page.
  const page = Math.min(pageRaw, pageCount(rows.length, pageSize) - 1)
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        Кодов: {rows.length} из {registry.categories.length}
        {withOrg && <> · активно для организации: {org.effective.filter((e) => e.active).length}</>}
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Пакет / блок</TableHead>
              <TableHead className="text-right">Вес</TableHead>
              <TableHead>Класс</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Профиль</TableHead>
              <TableHead>Стадия</TableHead>
              {withOrg && (
                <>
                  <TableHead>Стадия орг.</TableHead>
                  <TableHead className="text-right">Вес орг.</TableHead>
                  <TableHead>Профиль орг.</TableHead>
                  <TableHead>В промпте</TableHead>
                  <TableHead>Источник</TableHead>
                </>
              )}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
                  {registry.categories.length === 0 ? "Реестр пуст" : "Коды не найдены"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((c) => {
                const eff = effMap.get(c.code)
                return (
                  <TableRow
                    key={c.code}
                    onClick={() => onOpen(c.code)}
                    className={`cursor-pointer even:bg-muted/40 ${c.retiredAt ? "text-muted-foreground" : ""}`}
                  >
                    <TableCell>
                      <div className="font-mono text-xs">{c.code}</div>
                      <div className="max-w-72 truncate">{c.labelRu}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{c.packCode}</div>
                      <div className="text-muted-foreground" title={blockLabel.get(`${c.packCode}:${c.blockCode}`)}>
                        {c.blockCode}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.weight}</TableCell>
                    <TableCell className="text-xs">
                      {c.class ? CLASS_LABELS_RU[c.class] : "—"}
                      {c.classByRelation && <span className="text-muted-foreground"> · по связи</span>}
                    </TableCell>
                    <TableCell className="text-xs">{KIND_LABELS_RU[c.kind] ?? c.kind}</TableCell>
                    <TableCell className="text-xs">{c.displayProfile ?? "авто"}</TableCell>
                    <TableCell>{stageBadge(c.stage)}</TableCell>
                    {withOrg && (
                      <>
                        <TableCell>{eff ? stageBadge(eff.stage) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{eff?.weight ?? "—"}</TableCell>
                        <TableCell className="text-xs">{eff ? eff.displayProfile ?? "авто" : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {eff?.inPrompt ? (
                              <Check className="h-4 w-4 text-emerald-600" aria-label="в промпте" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {eff?.reviewOnly && (
                              <Badge variant="outline" className="border-amber-500/50 font-normal text-amber-700 dark:text-amber-300">
                                проверка
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{eff ? <SourceChips eff={eff} /> : "—"}</TableCell>
                      </>
                    )}
                    <TableCell>
                      {c.retiredAt && (
                        <Badge variant="outline" className="font-normal">
                          выведен{c.successorCode ? ` → ${c.successorCode}` : ""}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
      <TablePager
        page={page}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(0)
        }}
      />
    </div>
  )
}

// ── editor ───────────────────────────────────────────────────────────────

function blankCode(packCode: string): SignalCategoryRecord {
  return {
    code: "",
    packCode,
    blockCode: "",
    family: "",
    labelRu: "",
    definitionRu: "",
    boundaryRu: "",
    cuesPromptRu: [],
    synonymsRu: {},
    antiCuesRu: [],
    exampleRu: "",
    counterExampleRu: "",
    cardNoteRu: "",
    weight: 5,
    scoreRule: "fixed",
    class: "chance",
    classByRelation: false,
    kind: "event",
    effort: null,
    carriesAmount: false,
    asksUs: false,
    inboundOnly: false,
    emittedBy: "parser",
    // 05 §9: a new code starts as onHold and runs only in the offline eval.
    stage: "onHold",
    displayProfile: null,
    recipientRole: null,
    closesCodes: [],
    dateGate: null,
    relevanceDays: null,
    triggerRule: null,
    noteRu: null,
    retiredAt: null,
    successorCode: null,
    updatedAt: "",
  }
}

export function CodeEditorSheet({
  code,
  isNew,
  onClose,
  onCreated,
}: {
  /** Code to edit; ignored when isNew. */
  code: string | null
  isNew: boolean
  onClose: () => void
  onCreated: (code: string) => void
}) {
  const { registry } = useSignals()
  const open = isNew || !!code
  const record = isNew ? null : registry.categories.find((c) => c.code === code) ?? null
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-4xl">
        <SheetHeader className="pr-12">
          <SheetTitle>{isNew ? "Новый код" : record ? record.labelRu : code}</SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {isNew ? "Новый код начинается со стадии «Ожидает» (05 §9)" : code}
          </SheetDescription>
        </SheetHeader>
        {open && (isNew || record) && (
          <CodeEditorBody
            key={isNew ? "__new__" : `${record!.code}:${record!.updatedAt}`}
            record={record}
            onCreated={onCreated}
          />
        )}
        {open && !isNew && !record && (
          <p className="px-4 text-sm text-muted-foreground">Код не найден в реестре.</p>
        )}
      </SheetContent>
    </Sheet>
  )
}

function CodeEditorBody({
  record,
  onCreated,
}: {
  record: SignalCategoryRecord | null
  onCreated: (code: string) => void
}) {
  const { registry, org, save } = useSignals()
  const isNew = !record
  const original = useMemo(
    () => record ?? blankCode(registry.packs[0]?.code ?? "base"),
    [record, registry.packs],
  )
  const [d, setD] = useState<SignalCategoryRecord>(original)
  const [dateGateText, setDateGateText] = useState(jsonText(original.dateGate))
  const [triggerText, setTriggerText] = useState(jsonText(original.triggerRule))
  const [summary, setSummary] = useState("")
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof SignalCategoryRecord>(k: K, v: SignalCategoryRecord[K]) =>
    setD((x) => ({ ...x, [k]: v }))
  const errs = (...n: string[]) => fieldErrors(errors, ...n)

  const blocks = registry.blocks
    .filter((b) => b.packCode === d.packCode)
    .sort((a, b) => a.sort - b.sort)
    .map((b) => ({ value: b.code, label: `${b.code} · ${b.labelRu}` }))
  const families = [
    ...options(SIGNAL_FAMILIES, FAMILY_LABELS_RU),
    ...(d.family && !(SIGNAL_FAMILIES as readonly string[]).includes(d.family)
      ? [{ value: d.family, label: d.family }]
      : []),
  ]
  const codes = codeOptions(registry, { exclude: d.code })
  const synonymKeys = [
    ...SYNONYM_GROUPS,
    ...Object.keys(d.synonymsRu ?? {})
      .filter((k) => !SYNONYM_GROUPS.some((g) => g.key === k))
      .map((k) => ({ key: k, label: k })),
  ]
  const isProcess = PROCESS_KINDS.has(d.kind)

  const onSave = async () => {
    const gate = parseJsonObject(dateGateText)
    const trig = parseJsonObject(triggerText)
    const local: SignalsValidationError[] = []
    if (!gate.ok) local.push({ field: "dateGate", message: gate.message })
    if (!trig.ok) local.push({ field: "triggerRule", message: trig.message })
    if (isNew && !CODE_RE.test(d.code)) {
      local.push({ field: "code", message: "Код: UPPER_SNAKE (A–Z, 0–9, _), не длиннее 48 символов" })
    }
    if (local.length) {
      setErrors(local)
      return
    }
    const clean: SignalCategoryRecord = {
      ...d,
      cuesPromptRu: d.cuesPromptRu.map((s) => s.trim()).filter(Boolean),
      synonymsRu: Object.fromEntries(
        Object.entries(d.synonymsRu ?? {})
          .map(([k, v]) => [k, v.map((s) => s.trim()).filter(Boolean)] as const)
          .filter(([, v]) => v.length > 0),
      ),
      antiCuesRu: d.antiCuesRu
        .map((a) => ({ text: a.text.trim(), code: a.code }))
        .filter((a) => a.text),
      noteRu: d.noteRu?.trim() ? d.noteRu : null,
      dateGate: gate.ok ? gate.value : null,
      triggerRule: trig.ok ? trig.value : null,
    }
    const { updatedAt: _u, ...data } = clean
    void _u
    const { updatedAt: _o, ...orig } = original
    void _o
    const payload = isNew ? data : diffRecord(orig, data)
    if (!isNew && Object.keys(payload).length === 0) {
      toast.info("Нет изменений")
      return
    }
    setSaving(true)
    const res = await save({
      entity: "category",
      action: isNew ? "create" : "update",
      key: isNew ? undefined : original.code,
      data: payload,
      // Empty → the server writes a default summary (action, entity, fields).
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (!res.ok) {
      setErrors(res.errors)
      return
    }
    setErrors([])
    setSummary("")
    if (isNew) onCreated(d.code)
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <FormSection title="Идентификация">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Код" hint="UPPER_SNAKE, ≤ 48 символов. Не меняется после создания." errors={errs("code")}>
            <Input
              value={d.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              disabled={!isNew}
              className="font-mono"
            />
          </FormField>
          <FormField label="Пакет" errors={errs("packCode")}>
            <ValueSelect
              value={d.packCode}
              onChange={(v) => v && setD((x) => ({ ...x, packCode: v, blockCode: "" }))}
              options={registry.packs.map((p) => ({ value: p.code, label: `${p.code} · ${p.labelRu}` }))}
            />
          </FormField>
          <FormField label="Блок" errors={errs("blockCode")}>
            <ValueSelect
              value={d.blockCode || null}
              onChange={(v) => set("blockCode", v ?? "")}
              options={blocks}
              placeholder="Выберите блок…"
            />
          </FormField>
          <FormField label="Семейство" errors={errs("family")}>
            <ValueSelect
              value={d.family || null}
              onChange={(v) => set("family", v ?? "")}
              options={families}
              placeholder="Выберите семейство…"
            />
          </FormField>
          <FormField
            label={
              <span className="flex items-center justify-between">
                Подпись (что сделал контрагент) <CharCount value={d.labelRu} max={LABEL_MAX} />
              </span>
            }
            errors={errs("labelRu")}
            className="sm:col-span-2"
          >
            <Input value={d.labelRu} onChange={(e) => set("labelRu", e.target.value)} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Оценка" description="Шкала веса — 05 §3.3. Для score_rule = state вес 0 и класс пустой.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Вес (0–9)" errors={errs("weight")}>
            <ValueSelect
              value={String(d.weight)}
              onChange={(v) => set("weight", Number(v ?? 0))}
              options={Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: String(i) }))}
            />
          </FormField>
          <FormField label="Правило оценки" errors={errs("scoreRule")}>
            <ValueSelect
              value={d.scoreRule}
              onChange={(v) => v && set("scoreRule", v as SignalCategoryRecord["scoreRule"])}
              options={options(SIGNAL_SCORE_RULES, SCORE_RULE_LABELS_RU)}
            />
          </FormField>
          <FormField label="Класс" errors={errs("class")}>
            <ValueSelect
              value={d.class}
              onChange={(v) => set("class", v as SignalCategoryRecord["class"])}
              options={options(SIGNAL_CLASSES, CLASS_LABELS_RU)}
              nullable
              noneLabel="Нет (только для state)"
            />
          </FormField>
          <FormField label="Тип" errors={errs("kind")}>
            <ValueSelect
              value={d.kind}
              onChange={(v) => v && set("kind", v as SignalCategoryRecord["kind"])}
              options={options(SIGNAL_KINDS, KIND_LABELS_RU)}
            />
          </FormField>
          <FormField label="Усилие" errors={errs("effort")}>
            <ValueSelect
              value={d.effort}
              onChange={(v) => set("effort", v as SignalCategoryRecord["effort"])}
              options={options(SIGNAL_EFFORTS, EFFORT_LABELS_RU)}
              nullable
              noneLabel="Не задано (= средне)"
            />
          </FormField>
          <div className="flex flex-col justify-end gap-2">
            <BoolField checked={d.classByRelation} onChange={(v) => set("classByRelation", v)} label="Класс по связи с клиентом" />
            <BoolField checked={d.carriesAmount} onChange={(v) => set("carriesAmount", v)} label="Несёт сумму" />
          </div>
        </div>
      </FormSection>

      <FormSection title="Поведение">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Стадия" errors={errs("stage")}>
            <ValueSelect
              value={d.stage}
              onChange={(v) => v && set("stage", v as SignalStage)}
              options={options(SIGNAL_STAGES, STAGE_LABELS_RU)}
            />
          </FormField>
          <FormField label="Кто выдаёт" errors={errs("emittedBy")}>
            <ValueSelect
              value={d.emittedBy}
              onChange={(v) => v && set("emittedBy", v as SignalCategoryRecord["emittedBy"])}
              options={options(SIGNAL_EMITTED_BY, EMITTED_BY_LABELS_RU)}
            />
          </FormField>
          <FormField label="Профиль показа" errors={errs("displayProfile")}>
            <ValueSelect
              value={d.displayProfile}
              onChange={(v) => set("displayProfile", v as DisplayProfile | null)}
              options={options(DISPLAY_PROFILES, PROFILE_LABELS_RU)}
              nullable
              noneLabel="Авто (по оценке)"
            />
          </FormField>
          <FormField label="Получатель" errors={errs("recipientRole")}>
            <ValueSelect
              value={d.recipientRole}
              onChange={(v) => set("recipientRole", v as RecipientRole | null)}
              options={options(RECIPIENT_ROLES, RECIPIENT_LABELS_RU)}
              nullable
              noneLabel="Не задан"
            />
          </FormField>
          <FormField label="Окно актуальности, дней" hint="Пусто = по умолчанию (14 / 30 / 45 / тренд 90)" errors={errs("relevanceDays")}>
            <NumberInput value={d.relevanceDays} onChange={(v) => set("relevanceDays", v)} nullable min={1} />
          </FormField>
          <div className="flex flex-col justify-end gap-2">
            <BoolField checked={d.asksUs} onChange={(v) => set("asksUs", v)} label="Просит нас (REQ)" />
            <BoolField checked={d.inboundOnly} onChange={(v) => set("inboundOnly", v)} label="Только входящие" />
          </div>
          <FormField
            label="Закрывает коды (на той же теме)"
            hint="Для state- и event-кодов; не для watchdog / derived / trend"
            errors={errs("closesCodes")}
            className="sm:col-span-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <MultiCheckSelect
                label="Кодов"
                emptyLabel="Не закрывает"
                options={codes}
                values={d.closesCodes}
                onChange={(v) => set("closesCodes", v)}
                searchable
              />
              {d.closesCodes.map((c) => (
                <Badge key={c} variant="secondary" className="font-mono font-normal">
                  {c}
                </Badge>
              ))}
            </div>
          </FormField>
          <FormField
            label="Условие по дате (date_gate)"
            hint='{ "fact": "…", "test": "within" | "beyond", "settingKey": "…", "days": 30 }'
            errors={errs("dateGate")}
            className="sm:col-span-3"
          >
            <JsonEditor text={dateGateText} onText={setDateGateText} rows={4} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Тексты и признаки" description="Правила написания — 05 §4. Признаки — подсказки, не регулярные выражения.">
        <div className="grid grid-cols-1 gap-4">
          <FormField label="Определение" errors={errs("definitionRu")}>
            <Textarea value={d.definitionRu} onChange={(e) => set("definitionRu", e.target.value)} rows={3} />
          </FormField>
          <FormField label="Граница («не считается»)" hint="Обязательна для активного кода" errors={errs("boundaryRu")}>
            <Textarea value={d.boundaryRu} onChange={(e) => set("boundaryRu", e.target.value)} rows={3} />
          </FormField>
          <FormField
            label={`Признаки для промпта (≤ ${CUES_MAX}, до ${CUE_LEN_MAX} символов)`}
            errors={errs("cuesPromptRu")}
          >
            <ListEditor
              values={d.cuesPromptRu}
              onChange={(v) => set("cuesPromptRu", v)}
              maxItems={CUES_MAX}
              maxLen={CUE_LEN_MAX}
              placeholder="скиньте КП"
            />
          </FormField>
          <FormField label="Синонимы (для людей, тестов и генератора)" errors={errs("synonymsRu")}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {synonymKeys.map((g) => (
                <div key={g.key} className="space-y-1.5 rounded-lg border p-2">
                  <div className="text-xs font-medium">
                    {g.label} <span className="font-mono text-muted-foreground">({g.key})</span>
                  </div>
                  <ListEditor
                    values={d.synonymsRu?.[g.key] ?? []}
                    onChange={(v) => set("synonymsRu", { ...d.synonymsRu, [g.key]: v })}
                  />
                </div>
              ))}
            </div>
          </FormField>
          <FormField label="Анти-признаки (похожие фразы → правильный код)" errors={errs("antiCuesRu")}>
            <AntiCuesEditor
              values={d.antiCuesRu}
              onChange={(v) => set("antiCuesRu", v)}
              codes={codes}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Пример (должен дать код)" errors={errs("exampleRu")}>
              <Textarea value={d.exampleRu} onChange={(e) => set("exampleRu", e.target.value)} rows={2} />
            </FormField>
            <FormField label="Контрпример (не должен)" errors={errs("counterExampleRu")}>
              <Textarea value={d.counterExampleRu} onChange={(e) => set("counterExampleRu", e.target.value)} rows={2} />
            </FormField>
          </div>
          <FormField label="Заметка для карточки" hint="Роли, не имена" errors={errs("cardNoteRu")}>
            <Textarea value={d.cardNoteRu} onChange={(e) => set("cardNoteRu", e.target.value)} rows={2} />
          </FormField>
          <FormField label="Примечание администратора" errors={errs("noteRu")}>
            <Textarea value={d.noteRu ?? ""} onChange={(e) => set("noteRu", e.target.value)} rows={2} />
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title="Процесс"
        description={
          isProcess
            ? "Код процесса: правило обязательно, «Кто выдаёт» = процесс (05 §3.6, §7 п. 5)."
            : "Только для watchdog / derived / trend."
        }
      >
        <FormField
          label="Правило запуска (trigger_rule)"
          hint='{ "source": "orders", "window": "P90D", "baseline": "…", "threshold": { … }, "cooldownDays": 90 }'
          errors={errs("triggerRule")}
        >
          <JsonEditor text={triggerText} onText={setTriggerText} rows={7} />
        </FormField>
      </FormSection>

      <FormSection title="Вывод из оборота" description="Код не удаляется: строка остаётся, указывается преемник.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-end">
            <BoolField
              checked={!!d.retiredAt}
              onChange={(v) =>
                setD((x) => ({
                  ...x,
                  retiredAt: v ? x.retiredAt ?? new Date().toISOString() : null,
                  successorCode: v ? x.successorCode : null,
                }))
              }
              label="Выведен из оборота"
            />
          </div>
          <FormField label="Преемник" errors={errs("successorCode", "retiredAt")}>
            <SearchPicker
              value={d.successorCode}
              onChange={(v) => set("successorCode", v)}
              options={codes}
              nullable
              noneLabel="Нет преемника"
            />
          </FormField>
        </div>
      </FormSection>

      {!isNew && org && <OrgOverrideSection record={original} summary={summary} />}
      {!isNew && <PackOverridesSection record={original} summary={summary} />}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background px-4 py-3">
        <ErrorList errors={errors} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Причина изменения</span>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Например: «Уточнена граница с ORDER_REQUESTED»"
              className="h-8"
            />
          </div>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving && <Loader className="h-4 w-4 animate-spin" />}
            {isNew ? "Создать код" : "Сохранить код"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AntiCuesEditor({
  values,
  onChange,
  codes,
}: {
  values: AntiCue[]
  onChange: (v: AntiCue[]) => void
  codes: { value: string; label: string; hint?: string }[]
}) {
  const update = (i: number, patch: Partial<AntiCue>) =>
    onChange(values.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="space-y-1.5">
      {values.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_16rem_auto] items-center gap-1.5">
          <Input
            value={a.text}
            onChange={(e) => update(i, { text: e.target.value })}
            placeholder="есть ли в наличии?"
            className="h-8"
          />
          <SearchPicker
            value={a.code}
            onChange={(v) => update(i, { code: v })}
            options={codes}
            nullable
            noneLabel="Нет сигнала"
            className="h-8"
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Удалить"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...values, { text: "", code: null }])}>
        <Plus className="h-4 w-4" />
        Добавить анти-признак
      </Button>
    </div>
  )
}

// ── org settings of one code (entity org_override) ─────────────────────

type OverrideDraft = Pick<
  OrganizationSignalOverrideRecord,
  "stage" | "weight" | "displayProfile" | "recipientRole" | "reviewOnly" | "noteRu"
>

function OrgOverrideSection({ record, summary }: { record: SignalCategoryRecord; summary: string }) {
  const { org, orgId, save } = useSignals()
  const existing = org?.overrides.find((o) => o.code === record.code) ?? null
  const eff = org?.effective.find((e) => e.code === record.code) ?? null
  return (
    <OrgOverrideForm
      key={existing ? JSON.stringify(existing) : "none"}
      record={record}
      existing={existing}
      eff={eff}
      orgId={orgId!}
      orgName={org?.organizationName ?? ""}
      packEnabled={!!org?.packs.find((p) => p.packCode === record.packCode)?.enabled}
      summary={summary}
      save={save}
    />
  )
}

function OrgOverrideForm({
  record,
  existing,
  eff,
  orgId,
  orgName,
  packEnabled,
  summary,
  save,
}: {
  record: SignalCategoryRecord
  existing: OrganizationSignalOverrideRecord | null
  eff: EffectiveSignal | null
  orgId: string
  orgName: string
  packEnabled: boolean
  summary: string
  save: ReturnType<typeof useSignals>["save"]
}) {
  const initial: OverrideDraft = {
    stage: existing?.stage ?? null,
    weight: existing?.weight ?? null,
    displayProfile: existing?.displayProfile ?? null,
    recipientRole: existing?.recipientRole ?? null,
    reviewOnly: existing?.reviewOnly ?? false,
    noteRu: existing?.noteRu ?? null,
  }
  const [d, setD] = useState<OverrideDraft>(initial)
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const set = <K extends keyof OverrideDraft>(k: K, v: OverrideDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const errs = (n: string) => fieldErrors(errors, n)

  const onSave = async () => {
    const data = { organizationId: orgId, code: record.code, ...d, noteRu: d.noteRu?.trim() ? d.noteRu : null }
    if (existing && Object.keys(diffRecord(initial, d)).length === 0) {
      toast.info("Нет изменений")
      return
    }
    setSaving(true)
    const res = await save({
      entity: "org_override",
      action: existing ? "update" : "create",
      key: record.code,
      organizationId: orgId,
      data,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (!res.ok) setErrors(res.errors)
    else setErrors([])
  }

  const onReset = async () => {
    setSaving(true)
    const res = await save({
      entity: "org_override",
      action: "delete",
      key: record.code,
      organizationId: orgId,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (!res.ok) setErrors(res.errors)
  }

  const inherited = (v: unknown) => (v === null || v === undefined ? "—" : String(v))

  return (
    <FormSection
      title={`Настройки организации «${orgName}»`}
      description={
        <>
          Порядок: организация → пакет → база. Пусто = как в пакете.{" "}
          {!packEnabled && <span className="text-amber-600">Пакет {record.packCode} выключен для организации.</span>}
          {eff && (
            <>
              {" "}Сейчас: стадия {STAGE_LABELS_RU[eff.stage]}, вес {eff.weight}, профиль {eff.displayProfile ?? "авто"}
              {eff.inPrompt ? ", в промпте" : ", не в промпте"}.
            </>
          )}
        </>
      }
      actions={
        existing ? (
          <Badge variant="outline" className="border-sky-500/50 font-normal text-sky-700 dark:text-sky-300">
            есть настройка
          </Badge>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Стадия" hint={`Без настройки: ${record.stage}`} errors={errs("stage")}>
          <ValueSelect
            value={d.stage}
            onChange={(v) => set("stage", v as SignalStage | null)}
            options={options(SIGNAL_STAGES, STAGE_LABELS_RU)}
            nullable
            noneLabel="Как в пакете"
          />
        </FormField>
        <FormField label="Вес" hint={`Без настройки: ${inherited(record.weight)}`} errors={errs("weight")}>
          <ValueSelect
            value={d.weight === null ? null : String(d.weight)}
            onChange={(v) => set("weight", v === null ? null : Number(v))}
            options={Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: String(i) }))}
            nullable
            noneLabel="Как в пакете"
          />
        </FormField>
        <FormField label="Профиль показа" errors={errs("displayProfile")}>
          <ValueSelect
            value={d.displayProfile}
            onChange={(v) => set("displayProfile", v as DisplayProfile | null)}
            options={options(DISPLAY_PROFILES, PROFILE_LABELS_RU)}
            nullable
            noneLabel="Как в пакете"
          />
        </FormField>
        <FormField label="Получатель" errors={errs("recipientRole")}>
          <ValueSelect
            value={d.recipientRole}
            onChange={(v) => set("recipientRole", v as RecipientRole | null)}
            options={options(RECIPIENT_ROLES, RECIPIENT_LABELS_RU)}
            nullable
            noneLabel="Как в пакете"
          />
        </FormField>
        <div className="sm:col-span-2">
          <BoolField
            checked={d.reviewOnly}
            onChange={(v) => set("reviewOnly", v)}
            label="Только проверка (review): код работает только в офлайн-оценке"
          />
          {errs("reviewOnly").map((m, i) => (
            <p key={i} className="text-xs text-red-500">{m}</p>
          ))}
        </div>
        <FormField label="Примечание" errors={errs("noteRu")} className="sm:col-span-2">
          <Textarea value={d.noteRu ?? ""} onChange={(e) => set("noteRu", e.target.value)} rows={2} />
        </FormField>
      </div>
      <ErrorList errors={errors} />
      <div className="flex justify-end gap-2">
        {existing && (
          <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} disabled={saving}>
            Сбросить настройку
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving && <Loader className="h-4 w-4 animate-spin" />}
          Сохранить для организации
        </Button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Сбросить настройку организации?"
        description={`Код ${record.code} снова возьмёт значения пакета.`}
        confirmLabel="Сбросить"
        onConfirm={onReset}
      />
    </FormSection>
  )
}

// ── pack overrides of one code (entity pack_override) ─────────────────

function PackOverridesSection({ record, summary }: { record: SignalCategoryRecord; summary: string }) {
  const { registry } = useSignals()
  const rows = registry.packOverrides.filter((o) => o.code === record.code)
  const free = registry.packs.filter(
    (p) => p.code !== record.packCode && !rows.some((r) => r.packCode === p.code),
  )
  const [adding, setAdding] = useState<string | null>(null)
  if (rows.length === 0 && free.length === 0) return null
  return (
    <FormSection
      title="Переопределения пакетов"
      description="Вертикальный пакет меняет вес, профиль, получателя, стадию и «закрывает» базового кода (05 §5)."
      actions={
        free.length > 0 && !adding ? (
          <div className="w-56">
            <ValueSelect
              size="sm"
              value={null}
              onChange={(v) => setAdding(v)}
              options={free.map((p) => ({ value: p.code, label: p.labelRu }))}
              placeholder="Добавить для пакета…"
            />
          </div>
        ) : undefined
      }
    >
      {rows.length === 0 && !adding && <p className="text-sm text-muted-foreground">Переопределений нет.</p>}
      {rows.map((r) => (
        <PackOverrideForm key={`${r.packCode}:${JSON.stringify(r)}`} record={record} existing={r} packCode={r.packCode} summary={summary} />
      ))}
      {adding && (
        <PackOverrideForm
          key={`new:${adding}`}
          record={record}
          existing={null}
          packCode={adding}
          summary={summary}
          onDone={() => setAdding(null)}
        />
      )}
    </FormSection>
  )
}

function PackOverrideForm({
  record,
  existing,
  packCode,
  summary,
  onDone,
}: {
  record: SignalCategoryRecord
  existing: SignalPackOverrideRecord | null
  packCode: string
  summary: string
  onDone?: () => void
}) {
  const { registry, save } = useSignals()
  const initial: SignalPackOverrideRecord = existing ?? {
    packCode,
    code: record.code,
    weight: null,
    displayProfile: null,
    recipientRole: null,
    stage: null,
    closesCodes: null,
    noteRu: null,
  }
  const [d, setD] = useState<SignalPackOverrideRecord>(initial)
  const [errors, setErrors] = useState<SignalsValidationError[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof SignalPackOverrideRecord>(k: K, v: SignalPackOverrideRecord[K]) =>
    setD((x) => ({ ...x, [k]: v }))
  const errs = (n: string) => fieldErrors(errors, n)
  const packLabel = registry.packs.find((p) => p.code === packCode)?.labelRu ?? packCode
  const key = packOverrideKey(packCode, record.code)

  const onSave = async () => {
    const data = { ...d, noteRu: d.noteRu?.trim() ? d.noteRu : null }
    if (existing && Object.keys(diffRecord(initial, data)).length === 0) {
      toast.info("Нет изменений")
      return
    }
    setSaving(true)
    const res = await save({
      entity: "pack_override",
      action: existing ? "update" : "create",
      key,
      data: existing ? diffRecord(initial, data) : data,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (!res.ok) setErrors(res.errors)
    else {
      setErrors([])
      onDone?.()
    }
  }

  const onDelete = async () => {
    setSaving(true)
    const res = await save({
      entity: "pack_override",
      action: "delete",
      key,
      summary: summary.trim() || undefined,
    })
    setSaving(false)
    if (!res.ok) setErrors(res.errors)
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {packLabel} <span className="font-mono text-xs text-muted-foreground">{packCode}</span>
          {!existing && <span className="ml-2 text-xs text-muted-foreground">новое</span>}
        </div>
        <div className="flex gap-1">
          {existing ? (
            <Button size="icon-sm" variant="ghost" aria-label="Удалить" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon-sm" variant="ghost" aria-label="Отмена" onClick={onDone}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label="Вес" errors={errs("weight")}>
          <ValueSelect
            value={d.weight === null ? null : String(d.weight)}
            onChange={(v) => set("weight", v === null ? null : Number(v))}
            options={Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: String(i) }))}
            nullable
            noneLabel={`База (${record.weight})`}
          />
        </FormField>
        <FormField label="Стадия" errors={errs("stage")}>
          <ValueSelect
            value={d.stage}
            onChange={(v) => set("stage", v as SignalStage | null)}
            options={options(SIGNAL_STAGES, STAGE_LABELS_RU)}
            nullable
            noneLabel="Как в базе"
          />
        </FormField>
        <FormField label="Профиль" errors={errs("displayProfile")}>
          <ValueSelect
            value={d.displayProfile}
            onChange={(v) => set("displayProfile", v as DisplayProfile | null)}
            options={options(DISPLAY_PROFILES, PROFILE_LABELS_RU)}
            nullable
            noneLabel="Как в базе"
          />
        </FormField>
        <FormField label="Получатель" errors={errs("recipientRole")}>
          <ValueSelect
            value={d.recipientRole}
            onChange={(v) => set("recipientRole", v as RecipientRole | null)}
            options={options(RECIPIENT_ROLES, RECIPIENT_LABELS_RU)}
            nullable
            noneLabel="Как в базе"
          />
        </FormField>
        <FormField label="Закрывает коды" errors={errs("closesCodes")} className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <BoolField
              checked={d.closesCodes !== null}
              onChange={(v) => set("closesCodes", v ? [...record.closesCodes] : null)}
              label="Заменить список базы"
            />
            {d.closesCodes !== null && (
              <MultiCheckSelect
                label="Кодов"
                emptyLabel="Не закрывает"
                options={codeOptions(registry, { exclude: record.code })}
                values={d.closesCodes}
                onChange={(v) => set("closesCodes", v)}
                searchable
              />
            )}
          </div>
        </FormField>
        <FormField label="Примечание" errors={errs("noteRu")} className="sm:col-span-2">
          <Input value={d.noteRu ?? ""} onChange={(e) => set("noteRu", e.target.value)} className="h-8" />
        </FormField>
      </div>
      <ErrorList errors={errors} />
      <div className="flex justify-end">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving && <Loader className="h-4 w-4 animate-spin" />}
          {existing ? "Сохранить переопределение" : "Создать переопределение"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить переопределение пакета?"
        description={`${record.code} в пакете ${packCode} вернётся к значениям базы.`}
        confirmLabel="Удалить"
        destructive
        onConfirm={onDelete}
      />
    </div>
  )
}

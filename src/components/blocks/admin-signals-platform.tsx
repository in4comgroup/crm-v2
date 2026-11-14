"use client"

// Platform sub-tabs of «Сигналы»: packs & blocks, attributes, relations and
// deal-risk types — tables with create / edit dialogs (entities pack, block,
// attribute, relation, risk_type). Stage-rule templates live in
// admin-signals-stage-rules.tsx.

import { TablePager } from "@/components/blocks/table-pager"
import { useTablePaging } from "@/components/blocks/use-table-paging"
import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ATTRIBUTE_SCOPES,
  RELATION_KINDS,
  SIGNAL_STAGES,
  STAGE_LABELS_RU,
  type DealRiskTypeRecord,
  type SignalAttributeRecord,
  type SignalBlockRecord,
  type SignalPackRecord,
  type SignalRegistryEntity,
  type SignalRelationRecord,
} from "@/lib/signals/types"
import { RecordDialog, type FieldSpec } from "@/components/blocks/admin-signals-record-dialog"
import {
  AUDIENCE_LABELS_RU,
  RELATION_LABELS_RU,
  SCOPE_LABELS_RU,
  ValueSelect,
  codeOptions,
  useSignals,
} from "@/components/blocks/admin-signals-shared"

type Editing = {
  entity: SignalRegistryEntity
  isNew: boolean
  record: Record<string, unknown>
} | null

function packOpts(packs: SignalPackRecord[]) {
  return packs.map((p) => ({ value: p.code, label: `${p.code} · ${p.labelRu}` }))
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  )
}

function CodeChips({ codes, max = 4 }: { codes: string[]; max?: number }) {
  if (codes.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      {codes.slice(0, max).map((c) => (
        <Badge key={c} variant="secondary" className="font-mono text-[11px] font-normal">
          {c}
        </Badge>
      ))}
      {codes.length > max && <span className="text-xs text-muted-foreground">+{codes.length - max}</span>}
    </div>
  )
}

// ── packs & blocks ──────────────────────────────────────────────────────

export function PacksBlocksPanel() {
  const { registry } = useSignals()
  const [editing, setEditing] = useState<Editing>(null)
  const counts = useMemo(() => {
    const byPack = new Map<string, number>()
    const byBlock = new Map<string, number>()
    for (const c of registry.categories) {
      byPack.set(c.packCode, (byPack.get(c.packCode) ?? 0) + 1)
      byBlock.set(`${c.packCode}:${c.blockCode}`, (byBlock.get(`${c.packCode}:${c.blockCode}`) ?? 0) + 1)
    }
    return { byPack, byBlock }
  }, [registry])

  const packFields: FieldSpec[] = [
    { name: "code", label: "Код", type: "text", mono: true, lockedOnEdit: true },
    { name: "labelRu", label: "Название", type: "text" },
    { name: "sort", label: "Порядок", type: "number" },
    { name: "descriptionRu", label: "Описание", type: "textarea", nullable: true },
  ]
  const blockFields: FieldSpec[] = [
    { name: "code", label: "Код", type: "text", mono: true, lockedOnEdit: true },
    { name: "packCode", label: "Пакет", type: "select", options: packOpts(registry.packs), lockedOnEdit: true },
    { name: "labelRu", label: "Название", type: "text" },
    {
      name: "audience",
      label: "Аудитория",
      type: "select",
      nullable: true,
      noneLabel: "Не задана",
      options: Object.entries(AUDIENCE_LABELS_RU).map(([value, label]) => ({ value, label })),
    },
    { name: "sort", label: "Порядок", type: "number" },
    { name: "internalOnly", label: "Только внутреннее", type: "bool" },
    { name: "firstPartyOnly", label: "Только свои документы", type: "bool" },
  ]

  const blocks = registry.blocks
    .slice()
    .sort((a, b) => a.packCode.localeCompare(b.packCode) || a.sort - b.sort)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Пакеты</h3>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() =>
              setEditing({
                entity: "pack",
                isNew: true,
                record: { code: "", labelRu: "", descriptionRu: "", sort: registry.packs.length * 10 },
              })
            }
          >
            <Plus className="h-4 w-4" />
            Новый пакет
          </Button>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead className="text-right">Кодов</TableHead>
                <TableHead className="text-right">Порядок</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registry.packs.length === 0 ? (
                <Empty cols={5} text="Пакетов нет" />
              ) : (
                registry.packs.map((p) => (
                  <TableRow
                    key={p.code}
                    className="cursor-pointer even:bg-muted/40"
                    onClick={() => setEditing({ entity: "pack", isNew: false, record: { ...p } })}
                  >
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell>{p.labelRu}</TableCell>
                    <TableCell className="max-w-96 truncate text-sm text-muted-foreground">{p.descriptionRu ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{counts.byPack.get(p.code) ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.sort}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Блоки</h3>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() =>
              setEditing({
                entity: "block",
                isNew: true,
                record: {
                  code: "",
                  packCode: registry.packs[0]?.code ?? "",
                  labelRu: "",
                  audience: null,
                  internalOnly: false,
                  firstPartyOnly: false,
                  sort: 0,
                },
              })
            }
          >
            <Plus className="h-4 w-4" />
            Новый блок
          </Button>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пакет</TableHead>
                <TableHead>Код</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Аудитория</TableHead>
                <TableHead>Флаги</TableHead>
                <TableHead className="text-right">Кодов</TableHead>
                <TableHead className="text-right">Порядок</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.length === 0 ? (
                <Empty cols={7} text="Блоков нет" />
              ) : (
                blocks.map((b: SignalBlockRecord) => (
                  <TableRow
                    key={`${b.packCode}:${b.code}`}
                    className="cursor-pointer even:bg-muted/40"
                    onClick={() => setEditing({ entity: "block", isNew: false, record: { ...b } })}
                  >
                    <TableCell className="text-xs">{b.packCode}</TableCell>
                    <TableCell className="font-mono text-xs">{b.code}</TableCell>
                    <TableCell>{b.labelRu}</TableCell>
                    <TableCell className="text-sm">{b.audience ? AUDIENCE_LABELS_RU[b.audience] ?? b.audience : "—"}</TableCell>
                    <TableCell className="space-x-1">
                      {b.internalOnly && <Badge variant="outline" className="font-normal">внутреннее</Badge>}
                      {b.firstPartyOnly && <Badge variant="outline" className="font-normal">свои документы</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{counts.byBlock.get(`${b.packCode}:${b.code}`) ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.sort}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <RecordDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing?.entity === "pack"
            ? editing.isNew ? "Новый пакет" : `Пакет ${String(editing.record.code)}`
            : editing?.isNew ? "Новый блок" : `Блок ${String(editing?.record.code ?? "")}`
        }
        entity={editing?.entity ?? "pack"}
        isNew={!!editing?.isNew}
        record={editing?.record ?? {}}
        keyOf={(r) => String(r.code)}
        fields={editing?.entity === "block" ? blockFields : packFields}
      />
    </div>
  )
}

// ── attributes ──────────────────────────────────────────────────────────

export function AttributesPanel() {
  const { registry } = useSignals()
  const [editing, setEditing] = useState<Editing>(null)
  const [pack, setPack] = useState<string | null>(null)
  const rows = registry.attributes
    .filter((a) => !pack || a.packCode === pack)
    .slice()
    .sort((a, b) => a.packCode.localeCompare(b.packCode) || a.sort - b.sort || a.code.localeCompare(b.code))
  const paging = useTablePaging(rows)

  const fields: FieldSpec[] = [
    { name: "code", label: "Код", type: "text", mono: true, lockedOnEdit: true },
    { name: "packCode", label: "Пакет", type: "select", options: packOpts(registry.packs) },
    { name: "labelRu", label: "Название", type: "text" },
    { name: "groupCode", label: "Группа (взаимоисключающая)", type: "text", mono: true, nullable: true },
    {
      name: "scope",
      label: "Область",
      type: "select",
      options: ATTRIBUTE_SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS_RU[s] })),
    },
    { name: "weight", label: "Вес (−1…+2)", type: "number", min: -1, max: 2 },
    {
      name: "stage",
      label: "Стадия",
      type: "select",
      options: SIGNAL_STAGES.map((s) => ({ value: s, label: STAGE_LABELS_RU[s] })),
    },
    { name: "sort", label: "Порядок", type: "number" },
    { name: "defaultOff", label: "Выключен по умолчанию", type: "bool" },
    { name: "profiles", label: "Профили", type: "list", hint: "Например: P6, P8" },
    { name: "definitionRu", label: "Определение", type: "textarea" },
    { name: "cuesRu", label: "Признаки", type: "list" },
    { name: "antiCuesRu", label: "Анти-признаки", type: "list" },
    { name: "noteRu", label: "Примечание", type: "textarea", nullable: true },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              entity: "attribute",
              isNew: true,
              record: {
                code: "",
                packCode: registry.packs[0]?.code ?? "",
                groupCode: null,
                scope: "message",
                labelRu: "",
                definitionRu: "",
                weight: 0,
                stage: "onHold",
                defaultOff: false,
                profiles: [],
                cuesRu: [],
                antiCuesRu: [],
                noteRu: null,
                sort: 0,
              } satisfies SignalAttributeRecord,
            })
          }
        >
          <Plus className="h-4 w-4" />
          Новый атрибут
        </Button>
        <div className="w-56">
          <ValueSelect size="sm" value={pack} onChange={setPack} options={packOpts(registry.packs)} nullable noneLabel="Все пакеты" />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">Атрибутов: {rows.length}</span>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Пакет</TableHead>
              <TableHead>Группа</TableHead>
              <TableHead>Область</TableHead>
              <TableHead className="text-right">Вес</TableHead>
              <TableHead>Стадия</TableHead>
              <TableHead>Профили</TableHead>
              <TableHead className="text-right">Признаков</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <Empty cols={8} text="Атрибутов нет" />
            ) : (
              paging.pageRows.map((a) => (
                <TableRow
                  key={a.code}
                  className={`cursor-pointer even:bg-muted/40 ${a.defaultOff ? "text-muted-foreground" : ""}`}
                  onClick={() => setEditing({ entity: "attribute", isNew: false, record: { ...a } })}
                >
                  <TableCell>
                    <div className="font-mono text-xs">{a.code}</div>
                    <div className="max-w-72 truncate">{a.labelRu}</div>
                  </TableCell>
                  <TableCell className="text-xs">{a.packCode}</TableCell>
                  <TableCell className="font-mono text-xs">{a.groupCode ?? "—"}</TableCell>
                  <TableCell className="text-sm">{SCOPE_LABELS_RU[a.scope] ?? a.scope}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.weight > 0 ? `+${a.weight}` : a.weight}</TableCell>
                  <TableCell className="text-sm">{STAGE_LABELS_RU[a.stage] ?? a.stage}</TableCell>
                  <TableCell className="text-xs">{a.profiles.join(", ") || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.cuesRu.length}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <TablePager {...paging.pagerProps} />
      <RecordDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? "Новый атрибут" : `Атрибут ${String(editing?.record.code ?? "")}`}
        entity="attribute"
        isNew={!!editing?.isNew}
        record={editing?.record ?? {}}
        keyOf={(r) => String(r.code)}
        fields={fields}
      />
    </div>
  )
}

// ── relations ───────────────────────────────────────────────────────────

export function RelationsPanel() {
  const { registry } = useSignals()
  const [editing, setEditing] = useState<Editing>(null)
  const [kind, setKind] = useState<string | null>(null)
  const label = useMemo(() => new Map(registry.categories.map((c) => [c.code, c])), [registry])
  const rows = registry.relations
    .filter((r) => !kind || r.kind === kind)
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.codeA.localeCompare(b.codeA))
  const codes = codeOptions(registry, { excludeRetired: true })
  const paging = useTablePaging(rows)

  const fields: FieldSpec[] = [
    {
      name: "kind",
      label: "Вид связи",
      type: "select",
      options: RELATION_KINDS.map((k) => ({ value: k, label: RELATION_LABELS_RU[k] })),
    },
    { name: "packCode", label: "Пакет", type: "select", options: packOpts(registry.packs) },
    { name: "codeA", label: "Код A", type: "picker", options: codes },
    { name: "codeB", label: "Код B", type: "picker", options: codes },
    { name: "settingKey", label: "Ключ настройки (dampens)", type: "text", mono: true, nullable: true },
    { name: "fact", label: "Факт (dampens)", type: "text", mono: true, nullable: true },
    { name: "noteRu", label: "Примечание", type: "textarea", nullable: true },
  ]

  const codeCell = (code: string) => {
    const c = label.get(code)
    return (
      <div>
        <div className="font-mono text-xs">
          {code}
          {c?.retiredAt && <Badge variant="outline" className="ml-1 font-normal text-red-600">выведен</Badge>}
          {!c && <Badge variant="outline" className="ml-1 font-normal text-red-600">нет кода</Badge>}
        </div>
        <div className="max-w-60 truncate text-xs text-muted-foreground">{c?.labelRu}</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              entity: "relation",
              isNew: true,
              record: {
                kind: "outranks",
                packCode: registry.packs[0]?.code ?? "",
                codeA: null,
                codeB: null,
                settingKey: null,
                fact: null,
                noteRu: null,
              },
            })
          }
        >
          <Plus className="h-4 w-4" />
          Новая связь
        </Button>
        <div className="w-60">
          <ValueSelect
            size="sm"
            value={kind}
            onChange={setKind}
            options={RELATION_KINDS.map((k) => ({ value: k, label: RELATION_LABELS_RU[k] }))}
            nullable
            noneLabel="Все виды"
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">Связей: {rows.length}</span>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код A</TableHead>
              <TableHead>Связь</TableHead>
              <TableHead>Код B</TableHead>
              <TableHead>Пакет</TableHead>
              <TableHead>Настройка / факт</TableHead>
              <TableHead>Примечание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <Empty cols={6} text="Связей нет" />
            ) : (
              paging.pageRows.map((r: SignalRelationRecord) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer even:bg-muted/40"
                  onClick={() => setEditing({ entity: "relation", isNew: false, record: { ...r } })}
                >
                  <TableCell>{codeCell(r.codeA)}</TableCell>
                  <TableCell className="text-sm">{RELATION_LABELS_RU[r.kind] ?? r.kind}</TableCell>
                  <TableCell>{codeCell(r.codeB)}</TableCell>
                  <TableCell className="text-xs">{r.packCode}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {[r.settingKey, r.fact].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">{r.noteRu ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <TablePager {...paging.pagerProps} />
      <RecordDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? "Новая связь" : "Связь кодов"}
        description="Связь не может ссылаться на выведенный код (05 §7 п. 8)."
        entity="relation"
        isNew={!!editing?.isNew}
        record={editing?.record ?? {}}
        keyOf={(r) => String(r.id)}
        fields={fields}
        canDelete
      />
    </div>
  )
}

// ── deal-risk types ─────────────────────────────────────────────────────

export function RiskTypesPanel() {
  const { registry } = useSignals()
  const [editing, setEditing] = useState<Editing>(null)
  const codes = codeOptions(registry)
  const rows = registry.riskTypes
    .slice()
    .sort((a, b) => a.packCode.localeCompare(b.packCode) || b.severity - a.severity || a.code.localeCompare(b.code))

  const fields: FieldSpec[] = [
    { name: "code", label: "Код", type: "text", mono: true, lockedOnEdit: true },
    { name: "packCode", label: "Пакет", type: "select", options: packOpts(registry.packs) },
    { name: "labelRu", label: "Название", type: "text", wide: true },
    { name: "severity", label: "Серьёзность (1–9)", type: "number", min: 1, max: 9 },
    { name: "minOccurrences", label: "Мин. повторений", type: "number", min: 1 },
    {
      name: "scope",
      label: "Область",
      type: "select",
      options: [
        { value: "deal", label: "Сделка" },
        { value: "client", label: "Клиент" },
      ],
    },
    { name: "enabled", label: "Включён", type: "bool" },
    { name: "triggerCodes", label: "Триггеры", type: "multi", options: codes },
    { name: "clearCodes", label: "Снимают риск", type: "multi", options: codes },
    { name: "condition", label: "Условие (проверка сервера)", type: "text", mono: true, nullable: true },
    { name: "reactionRole", label: "Роль реакции", type: "text", mono: true, nullable: true },
    { name: "stageGuardTemplate", label: "Шаблон стадий", type: "text", nullable: true, hint: "Подсказка для настройки стадий организации" },
    { name: "descriptionRu", label: "Описание (фиксированный текст)", type: "textarea" },
    { name: "explanationRu", label: "Пояснение", type: "textarea" },
    { name: "noteRu", label: "Примечание", type: "textarea", nullable: true },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              entity: "risk_type",
              isNew: true,
              record: {
                code: "",
                packCode: registry.packs[0]?.code ?? "",
                labelRu: "",
                descriptionRu: "",
                explanationRu: "",
                triggerCodes: [],
                clearCodes: [],
                severity: 5,
                minOccurrences: 1,
                condition: null,
                scope: "deal",
                reactionRole: null,
                stageGuardTemplate: null,
                noteRu: null,
                enabled: true,
              } satisfies DealRiskTypeRecord,
            })
          }
        >
          <Plus className="h-4 w-4" />
          Новый тип риска
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">Типов риска: {rows.length}</span>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Риск</TableHead>
              <TableHead>Пакет</TableHead>
              <TableHead className="text-right">Серьёзность</TableHead>
              <TableHead className="text-right">Повторов</TableHead>
              <TableHead>Триггеры</TableHead>
              <TableHead>Снимают</TableHead>
              <TableHead>Состояние</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <Empty cols={7} text="Типов риска нет" />
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.code}
                  className={`cursor-pointer even:bg-muted/40 ${r.enabled ? "" : "text-muted-foreground"}`}
                  onClick={() => setEditing({ entity: "risk_type", isNew: false, record: { ...r } })}
                >
                  <TableCell>
                    <div className="font-mono text-xs">{r.code}</div>
                    <div className="max-w-64 truncate">{r.labelRu}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.packCode}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.severity}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minOccurrences}</TableCell>
                  <TableCell><CodeChips codes={r.triggerCodes} /></TableCell>
                  <TableCell><CodeChips codes={r.clearCodes} /></TableCell>
                  <TableCell>
                    {r.enabled ? (
                      <Badge variant="outline" className="font-normal">включён</Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal text-muted-foreground">выключен</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <RecordDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? "Новый тип риска" : `Риск ${String(editing?.record.code ?? "")}`}
        entity="risk_type"
        isNew={!!editing?.isNew}
        record={editing?.record ?? {}}
        keyOf={(r) => String(r.code)}
        fields={fields}
      />
    </div>
  )
}

export { CodeChips }

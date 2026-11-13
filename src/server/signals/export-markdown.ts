import "server-only"

import { eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { signalTaxonomyVersion } from "@/db/schema"
import {
  CLASS_LABELS_RU,
  KIND_LABELS_RU,
  STAGE_LABELS_RU,
  type SignalCategoryRecord,
  type SignalsOrgResponse,
  type SignalsRegistryResponse,
} from "@/lib/signals/types"
import { getOrganizationName, getOrgRegistry, loadRegistry } from "@/server/signals/registry"

// «Экспорт в Markdown» (spec 01 §4.1, 05 §9 step 4): the full current
// registry with all parameters, in the 05a entry format — per block a
// summary table, then one section per code. With an org: that org's packs,
// overrides, effective state, stage rules and risk guards.
// Reads fresh rows (not the cache): an export must match the DB exactly.

const SYNONYM_GROUP_RU: Record<string, string> = {
  business: "Деловая переписка",
  chat: "Чаты / мессенджеры (разговорный стиль)",
  terms: "Сокращения и термины",
  patterns: "Устойчивые конструкции / маркеры",
}

/** Escape a value for a Markdown table cell. */
function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "да" : "—"
  if (Array.isArray(v)) return v.length ? v.map((x) => cell(x)).join(", ") : "—"
  if (typeof v === "object") return "`" + JSON.stringify(v).replace(/\|/g, "\\|") + "`"
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

function table(head: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "_нет_\n"
  return (
    `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n` +
    rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n") +
    "\n"
  )
}

const code = (c: string | null | undefined) => (c ? `\`${c}\`` : "—")
const codes = (list: string[] | null | undefined) => (list && list.length ? list.map((c) => `\`${c}\``).join(", ") : "—")
const quoted = (list: string[]) => (list.length ? list.map((x) => `«${x}»`).join(", ") : "—")
const para = (label: string, v: string | null | undefined) => `**${label}:** ${v && v.trim() ? v.trim() : "—"}\n`

function categorySection(
  c: SignalCategoryRecord,
  reg: SignalsRegistryResponse,
  closedBy: Map<string, string[]>,
  org: SignalsOrgResponse | null,
): string {
  const rels = reg.relations
    .filter((r) => r.codeA === c.code || r.codeB === c.code)
    .map(
      (r) =>
        `\`${r.codeA}\` ${r.kind} \`${r.codeB}\`` +
        (r.settingKey || r.fact ? ` (${[r.settingKey, r.fact].filter(Boolean).join(", ")})` : "") +
        (r.noteRu ? ` — ${r.noteRu}` : ""),
    )
  const packOv = reg.packOverrides
    .filter((o) => o.code === c.code)
    .map(
      (o) =>
        `${o.packCode}: ` +
        [
          o.stage && `стадия ${o.stage}`,
          o.weight !== null && `вес ${o.weight}`,
          o.displayProfile && `профиль ${o.displayProfile}`,
          o.recipientRole && `получатель ${o.recipientRole}`,
          o.closesCodes && `закрывает ${codes(o.closesCodes)}`,
          o.noteRu,
        ]
          .filter(Boolean)
          .join(" · "),
    )

  const rows: [string, unknown][] = [
    ["Pack · block · family", `${c.packCode} · ${c.blockCode} · ${c.family}`],
    [
      "Weight · class · kind · score rule",
      `${c.weight} · ${c.class ? `${c.class} (${CLASS_LABELS_RU[c.class]})` : "—"} · ${c.kind} (${KIND_LABELS_RU[c.kind]}) · ${c.scoreRule}`,
    ],
    ["Class by relation", c.classByRelation],
    [
      "Effort · asks us · inbound only · amount",
      `${c.effort ?? "— (medium)"} · ${c.asksUs ? "yes" : "no"} · ${c.inboundOnly ? "yes" : "no"} · ${c.carriesAmount ? "yes" : "no"}`,
    ],
    ["Emitted by", c.emittedBy],
    ["Stage (pack default)", `${c.stage} (${STAGE_LABELS_RU[c.stage]})`],
    ["Display profile", c.displayProfile ?? "from score"],
    ["Recipient role", c.recipientRole],
    ["Closes / closed by", `closes: ${codes(c.closesCodes)} · closed by: ${codes(closedBy.get(c.code))}`],
    ["Relations", rels.join("; ")],
    ["Pack overrides", packOv.join("; ")],
    ["Date gate", c.dateGate],
    ["Relevance window (days)", c.relevanceDays ?? "default"],
    ["Trigger rule", c.triggerRule],
    ["Note", c.noteRu],
    ["Retired · successor", c.retiredAt ? `${c.retiredAt.slice(0, 10)} · ${code(c.successorCode)}` : null],
    ["Updated", c.updatedAt.slice(0, 10)],
  ]
  if (org) {
    const e = org.effective.find((x) => x.code === c.code)
    if (e) {
      rows.push([
        `Org «${org.organizationName}» (effective)`,
        `${e.active ? "active" : "off"}${e.reviewOnly ? " · review" : ""}${e.inPrompt ? " · in prompt" : ""} · ` +
          `стадия ${e.stage} · вес ${e.weight} · профиль ${e.displayProfile ?? "—"} · получатель ${e.recipientRole ?? "—"}`,
      ])
    }
  }

  let out = `#### \`${c.code}\` — ${c.labelRu}\n\n`
  out += table(
    ["Field", "Value"],
    rows.map(([k, v]) => [k, v]),
  )
  out += "\n"
  out += para("Определение", c.definitionRu)
  out += para("Граница (не считается)", c.boundaryRu)
  out += `**Признаки для промпта (≤ 8):** ${quoted(c.cuesPromptRu)}\n\n`
  const groups = Object.entries(c.synonymsRu ?? {}).filter(([, v]) => v && v.length)
  if (groups.length) {
    out += "**Синонимы и выражения (полный список):**\n"
    for (const [g, list] of groups) out += `- ${SYNONYM_GROUP_RU[g] ?? g}: ${quoted(list)}\n`
    out += "\n"
  } else out += "**Синонимы и выражения (полный список):** —\n\n"
  out +=
    "**Похоже, но не это (анти-признаки):** " +
    (c.antiCuesRu.length
      ? c.antiCuesRu.map((a) => `«${a.text}» → ${a.code ? `\`${a.code}\`` : "нет сигнала"}`).join("; ")
      : "—") +
    "\n\n"
  out += para("Пример (evidence)", c.exampleRu)
  out += para("Контрпример", c.counterExampleRu)
  out += "\n"
  out += para("Заметка для карточки", c.cardNoteRu)
  return out + "\n"
}

function summaryRow(c: SignalCategoryRecord, org: SignalsOrgResponse | null): unknown[] {
  const row: unknown[] = [
    `\`${c.code}\``,
    c.labelRu,
    c.weight,
    c.class,
    c.kind,
    c.scoreRule,
    c.effort,
    c.asksUs,
    c.inboundOnly,
    c.carriesAmount,
    c.emittedBy,
    c.stage,
    c.displayProfile,
    c.recipientRole,
    c.family,
  ]
  if (org) {
    const e = org.effective.find((x) => x.code === c.code)
    row.push(e ? (e.active ? (e.inPrompt ? "on" : "on (не в промпте)") : e.reviewOnly ? "review" : "off") : "—")
  }
  return row
}

export type RegistryMarkdownExport = { markdown: string; version: number; fileName: string }

/** Full registry as Markdown; with `organizationId` also that org's settings. */
export async function exportRegistryMarkdown(organizationId?: string | null): Promise<RegistryMarkdownExport> {
  const [reg, org] = await Promise.all([
    loadRegistry(),
    organizationId ? getOrgRegistry(organizationId) : Promise.resolve(null),
  ])
  const [ver] = reg.version
    ? await db
        .select({ createdAt: signalTaxonomyVersion.createdAt, summary: signalTaxonomyVersion.summary })
        .from(signalTaxonomyVersion)
        .where(eq(signalTaxonomyVersion.version, reg.version))
        .limit(1)
    : []

  const closedBy = new Map<string, string[]>()
  for (const c of reg.categories) {
    for (const t of c.closesCodes) closedBy.set(t, [...(closedBy.get(t) ?? []), c.code])
  }

  const live = reg.categories.filter((c) => !c.retiredAt)
  const retired = reg.categories.filter((c) => c.retiredAt)
  const now = new Date().toISOString().slice(0, 10)

  let md = `# Реестр сигналов — версия ${reg.version}\n\n`
  md += `Выгружено: ${now} · версия от ${ver ? ver.createdAt.toISOString().slice(0, 10) : "—"}`
  md += ver ? ` · «${ver.summary}»\n` : "\n"
  if (org) md += `\nОрганизация: **${org.organizationName}** (\`${org.organizationId}\`)\n`
  md +=
    `\nКодов: ${reg.categories.length} (действующих ${live.length}, выведено ${retired.length}) · ` +
    `атрибутов ${reg.attributes.length} · связей ${reg.relations.length} · типов рисков ${reg.riskTypes.length} · ` +
    `шаблонов правил стадий ${reg.stageRuleTemplates.length}\n\n---\n\n`

  md += "## Пакеты\n\n"
  md += table(
    ["Code", "Название", "Описание", "Sort"],
    reg.packs.map((p) => [`\`${p.code}\``, p.labelRu, p.descriptionRu, p.sort]),
  )
  md += "\n## Блоки\n\n"
  md += table(
    ["Code", "Pack", "Название", "Audience", "Internal only", "First party only", "Sort", "Кодов"],
    reg.blocks.map((b) => [
      `\`${b.code}\``,
      b.packCode,
      b.labelRu,
      b.audience,
      b.internalOnly,
      b.firstPartyOnly,
      b.sort,
      live.filter((c) => c.blockCode === b.code).length,
    ]),
  )

  md += "\n---\n\n## Коды\n\n"
  const head = [
    "Code",
    "Название (RU)",
    "W",
    "Class",
    "Kind",
    "Score rule",
    "Effort",
    "Asks us",
    "Inbound only",
    "Amount",
    "Emitted by",
    "Stage (pack)",
    "Profile",
    "Recipient",
    "Family",
    ...(org ? ["Org"] : []),
  ]
  for (const pack of reg.packs) {
    for (const b of reg.blocks.filter((x) => x.packCode === pack.code)) {
      const list = live.filter((c) => c.blockCode === b.code)
      if (list.length === 0) continue
      const byStage = Object.entries(
        list.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.stage]: (acc[c.stage] ?? 0) + 1 }), {}),
      )
        .map(([s, n]) => `${n} ${s}`)
        .join(", ")
      md += `### ${b.code} · ${b.labelRu} (пакет ${pack.code})\n\n`
      md += table(
        head,
        list.map((c) => summaryRow(c, org)),
      )
      md += `\nБлок ${b.code}: ${list.length} кодов — ${byStage}.\n\n`
      for (const c of list) md += categorySection(c, reg, closedBy, org)
    }
  }
  // Codes whose block is missing from the block list (should not happen).
  const blockCodes = new Set(reg.blocks.map((b) => b.code))
  const orphans = live.filter((c) => !blockCodes.has(c.blockCode))
  if (orphans.length) {
    md += "### Коды без блока\n\n"
    for (const c of orphans) md += categorySection(c, reg, closedBy, org)
  }

  md += "## Выведенные из обращения коды\n\n"
  md += table(
    ["Code", "Название", "Pack · block", "Выведен", "Преемник", "Примечание"],
    retired.map((c) => [
      `\`${c.code}\``,
      c.labelRu,
      `${c.packCode} · ${c.blockCode}`,
      c.retiredAt?.slice(0, 10),
      code(c.successorCode),
      c.noteRu,
    ]),
  )
  if (retired.length) {
    md += "\n"
    for (const c of retired) md += categorySection(c, reg, closedBy, org)
  }

  md += "\n## Атрибуты\n\n"
  md += table(
    [
      "Code",
      "Pack",
      "Группа",
      "Scope",
      "Название",
      "Определение",
      "Вес",
      "Stage",
      "Выкл. по умолчанию",
      "Профили",
      "Признаки",
      "Анти-признаки",
      "Примечание",
    ],
    reg.attributes.map((a) => [
      `\`${a.code}\``,
      a.packCode,
      a.groupCode,
      a.scope,
      a.labelRu,
      a.definitionRu,
      a.weight,
      a.stage,
      a.defaultOff,
      a.profiles,
      quoted(a.cuesRu),
      quoted(a.antiCuesRu),
      a.noteRu,
    ]),
  )

  md += "\n## Связи\n\n"
  md += table(
    ["Id", "Pack", "Kind", "A", "B", "Setting key", "Fact", "Примечание"],
    reg.relations.map((r) => [r.id, r.packCode, r.kind, `\`${r.codeA}\``, `\`${r.codeB}\``, r.settingKey, r.fact, r.noteRu]),
  )

  md += "\n## Переопределения пакетов\n\n"
  md += table(
    ["Pack", "Code", "Stage", "Weight", "Profile", "Recipient", "Closes codes", "Примечание"],
    reg.packOverrides.map((o) => [
      o.packCode,
      `\`${o.code}\``,
      o.stage,
      o.weight,
      o.displayProfile,
      o.recipientRole,
      o.closesCodes === null ? "—" : codes(o.closesCodes),
      o.noteRu,
    ]),
  )

  md += "\n## Типы рисков сделки\n\n"
  for (const t of reg.riskTypes) {
    md += `### \`${t.code}\` — ${t.labelRu}\n\n`
    md += table(
      ["Field", "Value"],
      [
        ["Pack · scope · enabled", `${t.packCode} · ${t.scope} · ${t.enabled ? "yes" : "no"}`],
        ["Severity · min occurrences", `${t.severity} · ${t.minOccurrences}`],
        ["Trigger codes", codes(t.triggerCodes)],
        ["Clear codes", codes(t.clearCodes)],
        ["Condition", t.condition],
        ["Reaction role", t.reactionRole],
        ["Stage guard template", t.stageGuardTemplate],
        ["Note", t.noteRu],
      ],
    )
    md += "\n" + para("Описание", t.descriptionRu) + "\n" + para("Пояснение (NOOP)", t.explanationRu) + "\n"
  }
  if (reg.riskTypes.length === 0) md += "_нет_\n"

  md += "\n## Шаблоны правил стадий\n\n"
  md += table(
    ["Id", "Pack", "Code", "Effect", "Target (meaning)", "Deal types", "Guards", "Enabled", "Sort", "Примечание"],
    reg.stageRuleTemplates.map((r) => [
      r.id,
      r.packCode,
      `\`${r.code}\``,
      r.effect,
      r.targetStageMeaning,
      r.dealTypes,
      Object.keys(r.guards ?? {}).length ? r.guards : null,
      r.enabled,
      r.sort,
      r.noteRu,
    ]),
  )

  if (org) {
    const stageName = new Map(org.funnelStages.map((s) => [s.id, s.displayName || s.name]))
    const stage = (id: string | null) => (id ? (stageName.get(id) ?? `${id} (не в воронке)`) : null)
    md += `\n---\n\n## Организация «${org.organizationName}»\n\n`
    md += "### Пакеты организации\n\n"
    md += table(
      ["Pack", "Включён"],
      org.packs.map((p) => [p.packCode, p.enabled]),
    )
    md += "\n### Переопределения кодов\n\n"
    md += table(
      ["Code", "Stage", "Weight", "Profile", "Recipient", "Review only", "Примечание"],
      org.overrides.map((o) => [`\`${o.code}\``, o.stage, o.weight, o.displayProfile, o.recipientRole, o.reviewOnly, o.noteRu]),
    )
    const eff = org.effective
    md +=
      `\n### Эффективное состояние\n\nАктивных кодов: ${eff.filter((e) => e.active).length} · ` +
      `в живом промпте: ${eff.filter((e) => e.inPrompt).length} · ` +
      `только офлайн-проверка (review): ${eff.filter((e) => e.reviewOnly).length}\n\n`
    md += table(
      ["Code", "Pack · block", "Active", "In prompt", "Review", "Stage", "Weight", "Profile", "Recipient", "Closes", "Источник"],
      eff
        .filter((e) => e.active || e.reviewOnly || e.source.stage === "org")
        .map((e) => [
          `\`${e.code}\``,
          `${e.packCode} · ${e.blockCode}`,
          e.active,
          e.inPrompt,
          e.reviewOnly,
          e.stage,
          e.weight,
          e.displayProfile,
          e.recipientRole,
          codes(e.closesCodes),
          Object.entries(e.source)
            .filter(([, v]) => v !== "base")
            .map(([k, v]) => `${k}: ${v}`)
            .join(", "),
        ]),
    )
    md += "\nКоды, которых нет в таблице: выключены (пакет выключен или стадия не «active»).\n"
    md += "\n### Воронка (стадии)\n\n"
    md += table(
      ["Id", "Name", "Display name", "Sort", "Hidden"],
      org.funnelStages.map((s) => [s.id, s.name, s.displayName, s.sortOrder, s.isHidden]),
    )
    md += "\n### Правила стадий\n\n"
    md += table(
      ["Id", "Code", "Effect", "Target stage", "Deal types", "Guards", "Enabled", "Sort", "Примечание"],
      org.stageRules.map((r) => [
        r.id,
        `\`${r.code}\``,
        r.effect,
        stage(r.targetStageId) ?? r.targetStageMeaning,
        r.dealTypes,
        Object.keys(r.guards ?? {}).length
          ? {
              ...r.guards,
              ...(r.guards.fromStageIds ? { fromStageIds: r.guards.fromStageIds.map((id) => stage(id)) } : {}),
            }
          : null,
        r.enabled,
        r.sort,
        r.noteRu,
      ]),
    )
    md += "\n### Стадии рисков\n\n"
    md += table(
      ["Risk", "Включён", "Стадии"],
      org.riskGuards.map((g) => [`\`${g.riskCode}\``, g.enabled, g.stageIds ? g.stageIds.map((id) => stage(id)) : "все стадии"]),
    )
  }

  let orgPart = ""
  if (org) {
    const meta = await getOrganizationName(org.organizationId)
    const slug = (meta?.slug ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
    orgPart = "-" + (slug || org.organizationId.replace(/[^A-Za-z0-9_-]+/g, ""))
  }
  return { markdown: md, version: reg.version, fileName: `signals-v${reg.version}${orgPart}.md` }
}

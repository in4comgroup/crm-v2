/**
 * HISTORICAL — do not re-run. It produced migrations/0012 (already applied
 * everywhere it matters) and the IN4COM preset. Migration 0014 then merged
 * the distribution pack into `base` (R21, one pack) and the preset was
 * edited to match. Registry changes now go through «Сигналы» (DB is the
 * master) or a NEW custom migration — never through this generator.
 *
 * Dev-time generator: signal catalogs (docs/specs/topics/05a, 05b, 05c) →
 *   1. migrations/0012_signals_registry_v1.sql — the v1 seed (platform
 *      reference data, fixed keys, ON CONFLICT DO NOTHING);
 *   2. src/server/signals/presets/distribution-pilot.ts — the IN4COM
 *      activation preset (tenant data is never in a migration).
 *
 * Run from the repo root:  npx tsx tools/topics/catalog-to-seed-sql.ts [--report=<file.json>]
 *
 * Prints parse issues, every value that went to note_ru (counts; full list
 * with --report) and every ACTIVE code that fails a 05 §7 validation rule.
 * Agency (05d) is not seeded (decision R5).
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseCatalogs, type SeedCategory } from "./catalog-parser"

const ROOT = process.cwd()
const DOCS = join(ROOT, "docs/specs/topics")
const SQL_OUT = join(ROOT, "migrations/0012_signals_registry_v1.sql")
const PRESET_OUT = join(ROOT, "src/server/signals/presets/distribution-pilot.ts")
const TODAY = "2026-11-13"

const parsed = parseCatalogs(DOCS)
const { packs, blocks, categories, attributes, relations, packOverrides, riskTypes, stageRules, notes, issues } =
  parsed

// ── SQL literals ──────────────────────────────────────────────────────────

type Sql = { sql: string }
const raw = (sql: string): Sql => ({ sql })
const str = (v: string | null | undefined) => (v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`)
const int = (v: number | null | undefined) => (v === null || v === undefined ? "NULL" : String(Math.trunc(v)))
const bool = (v: boolean) => (v ? "true" : "false")
const arr = (v: string[] | null | undefined) =>
  v === null || v === undefined ? "NULL" : v.length === 0 ? "'{}'::text[]" : `ARRAY[${v.map(str).join(", ")}]::text[]`
const json = (v: unknown) => (v === null || v === undefined ? "NULL" : `${str(JSON.stringify(v))}::jsonb`)

function lit(v: unknown): string {
  if (v && typeof v === "object" && "sql" in (v as object)) return (v as Sql).sql
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number") return int(v)
  if (typeof v === "boolean") return bool(v)
  if (typeof v === "string") return str(v)
  throw new Error(`unsupported literal ${JSON.stringify(v)}`)
}

function insert(table: string, cols: string[], rows: unknown[][], conflict = "ON CONFLICT DO NOTHING"): string[] {
  const out: string[] = []
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25)
    out.push(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES\n` +
        chunk.map((r) => `  (${r.map(lit).join(", ")})`).join(",\n") +
        `\n${conflict};`,
    )
  }
  return out
}

// ── statements (FK order) ─────────────────────────────────────────────────

const stmts: string[] = []

stmts.push(
  ...insert(
    "signal_pack",
    ["code", "label_ru", "description_ru", "sort"],
    packs.map((p) => [p.code, p.labelRu, p.descriptionRu, p.sort]),
  ),
)
stmts.push(
  ...insert(
    "signal_block",
    ["code", "pack_code", "label_ru", "audience", "internal_only", "first_party_only", "sort"],
    blocks.map((b) => [b.code, b.packCode, b.labelRu, b.audience, b.internalOnly, b.firstPartyOnly, b.sort]),
  ),
)
const catCols = [
  "code",
  "pack_code",
  "block_code",
  "family",
  "label_ru",
  "definition_ru",
  "boundary_ru",
  "cues_prompt_ru",
  "synonyms_ru",
  "anti_cues_ru",
  "example_ru",
  "counter_example_ru",
  "card_note_ru",
  "weight",
  "score_rule",
  "class",
  "class_by_relation",
  "kind",
  "effort",
  "carries_amount",
  "asks_us",
  "inbound_only",
  "emitted_by",
  "stage",
  "display_profile",
  "recipient_role",
  "closes_codes",
  "date_gate",
  "relevance_days",
  "trigger_rule",
  "note_ru",
  "retired_at",
  "successor_code",
]
stmts.push(
  ...insert(
    "signal_category",
    catCols,
    categories.map((c) => [
      c.code,
      c.packCode,
      c.blockCode,
      c.family,
      c.labelRu,
      c.definitionRu,
      c.boundaryRu,
      raw(arr(c.cuesPromptRu)),
      raw(json(c.synonymsRu)),
      raw(json(c.antiCuesRu)),
      c.exampleRu,
      c.counterExampleRu,
      c.cardNoteRu,
      c.weight,
      c.scoreRule,
      c.class,
      c.classByRelation,
      c.kind,
      c.effort,
      c.carriesAmount,
      c.asksUs,
      c.inboundOnly,
      c.emittedBy,
      c.stage,
      c.displayProfile,
      c.recipientRole,
      raw(arr(c.closesCodes)),
      raw(json(c.dateGate)),
      c.relevanceDays,
      raw(json(c.triggerRule)),
      c.noteRu,
      raw(c.retiredAt ? `${str(c.retiredAt)}::timestamp` : "NULL"),
      c.successorCode,
    ]),
  ),
)
stmts.push(
  ...insert(
    "signal_attribute",
    [
      "code",
      "pack_code",
      "group_code",
      "scope",
      "label_ru",
      "definition_ru",
      "weight",
      "stage",
      "default_off",
      "profiles",
      "cues_ru",
      "anti_cues_ru",
      "note_ru",
      "sort",
    ],
    attributes.map((a) => [
      a.code,
      a.packCode,
      a.groupCode,
      a.scope,
      a.labelRu,
      a.definitionRu,
      a.weight,
      a.stage,
      a.defaultOff,
      raw(arr(a.profiles)),
      raw(arr(a.cuesRu)),
      raw(arr(a.antiCuesRu)),
      a.noteRu,
      a.sort,
    ]),
  ),
)
stmts.push(
  ...insert(
    "signal_relation",
    ["id", "pack_code", "kind", "code_a", "code_b", "setting_key", "fact", "note_ru"],
    relations.map((r) => [r.id, r.packCode, r.kind, r.codeA, r.codeB, r.settingKey, r.fact, r.noteRu]),
  ),
)
stmts.push(
  ...insert(
    "signal_pack_override",
    ["pack_code", "code", "weight", "display_profile", "recipient_role", "stage", "closes_codes", "note_ru"],
    packOverrides.map((o) => [
      o.packCode,
      o.code,
      o.weight,
      o.displayProfile,
      o.recipientRole,
      o.stage,
      raw(arr(o.closesCodes)),
      o.noteRu,
    ]),
  ),
)
stmts.push(
  ...insert(
    "deal_risk_type",
    [
      "code",
      "pack_code",
      "label_ru",
      "description_ru",
      "explanation_ru",
      "trigger_codes",
      "clear_codes",
      "severity",
      "min_occurrences",
      "condition",
      "scope",
      "reaction_role",
      "stage_guard_template",
      "note_ru",
      "enabled",
    ],
    riskTypes.map((r) => [
      r.code,
      r.packCode,
      r.labelRu,
      r.descriptionRu,
      r.explanationRu,
      raw(arr(r.triggerCodes)),
      raw(arr(r.clearCodes)),
      r.severity,
      r.minOccurrences,
      r.condition,
      r.scope,
      r.reactionRole,
      r.stageGuardTemplate,
      r.noteRu,
      r.enabled,
    ]),
  ),
)
stmts.push(
  ...insert(
    "signal_stage_rule",
    [
      "id",
      "organization_id",
      "pack_code",
      "code",
      "effect",
      "target_stage_id",
      "target_stage_meaning",
      "deal_types",
      "guards",
      "enabled",
      "sort",
      "note_ru",
    ],
    stageRules.map((r) => [
      r.id,
      null,
      r.packCode,
      r.code,
      r.effect,
      null,
      r.targetStageMeaning,
      raw(arr(r.dealTypes)),
      raw(json(r.guards)),
      r.enabled,
      r.sort,
      r.noteRu,
    ]),
  ),
)
stmts.push(
  ...insert("signal_taxonomy_version", ["version", "summary"], [[1, "Seed v1 from catalogs 05a–05c"]]),
)

const header = `-- Signals registry v1 seed (platform reference data; plan phase 1 task 2, decision R11).
-- GENERATED by tools/topics/catalog-to-seed-sql.ts from docs/specs/topics/
-- 05a-signals-base-a-g.md, 05b-signals-base-h-n.md, 05c-signals-distribution.md
-- on ${TODAY}. Do not edit by hand — fix the catalogs and regenerate (before
-- this migration is applied anywhere; after that, change the registry in
-- «Сигналы» or add a NEW migration).
-- Packs: base, distribution (agency 05d is not seeded, R5). Fixed keys +
-- ON CONFLICT DO NOTHING, so a re-run is a no-op. Tenant data (per-org
-- activation, IN4COM preset, org stage rules) is NOT here.
`
writeFileSync(SQL_OUT, header + "\n" + stmts.join("\n--> statement-breakpoint\n") + "\n")

// ── activation preset (R6) ────────────────────────────────────────────────

const presetCodes = categories
  .filter((c) => !c.retiredAt)
  .map((c) => [c.code, c.in4com] as const)
  .sort((a, b) => a[0].localeCompare(b[0]))
const presetTs = `// GENERATED by tools/topics/catalog-to-seed-sql.ts from the «IN4COM» columns
// of docs/specs/topics/05a, 05b, 05c (${TODAY}). Do not edit by hand.
//
// Activation preset (05 §5.1, decision R6): on = active; review = onHold +
// reviewOnly (offline eval batch only); off = onHold. Tenant data — applied
// to an org by the signals server module, never seeded by a migration.
import "server-only"

export type PresetCodeStatus = "on" | "review" | "off"

export type SignalActivationPreset = {
  key: string
  labelRu: string
  descriptionRu: string
  packs: string[]
  codes: Record<string, PresetCodeStatus>
}

export const DISTRIBUTION_PILOT_PRESET: SignalActivationPreset = {
  key: "distribution-pilot",
  labelRu: "Пилот дистрибуции (IN4COM)",
  descriptionRu:
    "Пакеты «Базовый» и «Дистрибуция». Коды «on» активны; коды «review» ожидают и работают только в офлайн-проверке на золотом наборе; остальные ожидают.",
  packs: ["base", "distribution"],
  codes: {
${presetCodes.map(([c, s]) => `    ${c}: "${s}",`).join("\n")}
  },
}
`
writeFileSync(PRESET_OUT, presetTs)

// ── validation (05 §7) over ACTIVE codes ─────────────────────────────────

const byCode = new Map(categories.map((c) => [c.code, c]))
const retired = new Set(categories.filter((c) => c.retiredAt).map((c) => c.code))
const failures: string[] = []
const warnings: string[] = []
const fail = (c: SeedCategory, rule: string, msg: string) => failures.push(`${c.code} [§7.${rule}] ${msg}`)
for (const c of categories) {
  if (c.retiredAt) continue
  const effective = (() => {
    const o = packOverrides.find((p) => p.code === c.code)
    return o?.closesCodes ?? c.closesCodes
  })()
  if (c.stage === "active") {
    if (!c.definitionRu) fail(c, "1", "empty definition_ru")
    if (!c.boundaryRu) fail(c, "1", "empty boundary_ru")
    if (c.cuesPromptRu.length === 0 && c.emittedBy !== "process") fail(c, "1", "empty cues_prompt_ru")
    if (c.cuesPromptRu.length > 8) fail(c, "2", `${c.cuesPromptRu.length} cues`)
    for (const q of c.cuesPromptRu) if (q.length > 60) fail(c, "2", `cue longer than 60 chars: «${q}»`)
    if (c.scoreRule === "state" && (c.weight !== 0 || c.class !== null)) fail(c, "3", "state with weight/class")
    for (const x of effective) {
      if (!byCode.has(x)) fail(c, "4", `closes unknown code ${x}`)
      else if (x === c.code) fail(c, "4", "closes itself")
      else if (byCode.get(x)!.family !== c.family) warnings.push(`${c.code} closes ${x}: cross-family`)
    }
    if (effective.length && ["watchdog", "derived", "trend"].includes(c.kind)) fail(c, "4", `closes_codes on a ${c.kind} code`)
    if (["watchdog", "derived", "trend"].includes(c.kind)) {
      if (c.emittedBy !== "process") fail(c, "5", `${c.kind} with emitted_by=${c.emittedBy}`)
      if (!c.triggerRule) fail(c, "5", "empty trigger_rule")
    }
    if (c.kind === "trend" && c.displayProfile && ["P6", "P8"].includes(c.displayProfile)) fail(c, "6", "trend above D4")
    if (!c.family) fail(c, "7", "empty family")
  }
}
for (const r of relations) {
  if (retired.has(r.codeA) || retired.has(r.codeB)) failures.push(`${r.id} [§7.8] refers to a retired code`)
  if (!byCode.has(r.codeA) || !byCode.has(r.codeB)) warnings.push(`${r.id}: refers to a code that is not seeded`)
}
for (const r of stageRules) if (!byCode.has(r.code)) failures.push(`${r.id}: code ${r.code} not seeded (FK)`)
for (const r of riskTypes) {
  for (const x of [...r.triggerCodes, ...r.clearCodes]) if (!byCode.has(x)) warnings.push(`risk ${r.code}: code ${x} not seeded`)
}

// ── report ────────────────────────────────────────────────────────────────

const perPackStage: Record<string, Record<string, number>> = {}
for (const c of categories) {
  const k = c.retiredAt ? "retired" : c.stage
  perPackStage[c.packCode] ??= {}
  perPackStage[c.packCode][k] = (perPackStage[c.packCode][k] ?? 0) + 1
}
const in4: Record<string, Record<string, number>> = {}
for (const [code, s] of presetCodes) {
  const p = byCode.get(code)!.packCode
  in4[p] ??= {}
  in4[p][s] = (in4[p][s] ?? 0) + 1
}
const noteCounts: Record<string, number> = {}
for (const n of notes) noteCounts[`${n.entity}.${n.field}`] = (noteCounts[`${n.entity}.${n.field}`] ?? 0) + 1

console.log(`wrote ${SQL_OUT} (${stmts.length} statements)`)
console.log(`wrote ${PRESET_OUT} (${presetCodes.length} codes)`)
console.log("rows:", {
  packs: packs.length,
  blocks: blocks.length,
  categories: categories.length,
  attributes: attributes.length,
  relations: relations.length,
  packOverrides: packOverrides.length,
  riskTypes: riskTypes.length,
  stageRuleTemplates: stageRules.length,
})
console.log("codes per pack per stage:", JSON.stringify(perPackStage))
console.log("IN4COM preset:", JSON.stringify(in4))
console.log("relations per kind:", JSON.stringify(relations.reduce<Record<string, number>>((a, r) => ((a[`${r.packCode}.${r.kind}`] = (a[`${r.packCode}.${r.kind}`] ?? 0) + 1), a), {})))
console.log("note_ru per field:", JSON.stringify(noteCounts, null, 1))
console.log(`\nISSUES (${issues.length}):\n  ${issues.join("\n  ")}`)
console.log(`\n§7 FAILURES on active codes (${failures.length}):\n  ${failures.join("\n  ")}`)
console.log(`\nWARNINGS (${warnings.length}):\n  ${warnings.join("\n  ")}`)

const reportArg = process.argv.find((a) => a.startsWith("--report="))
if (reportArg) {
  writeFileSync(reportArg.slice("--report=".length), JSON.stringify({ notes, issues, failures, warnings }, null, 2))
}

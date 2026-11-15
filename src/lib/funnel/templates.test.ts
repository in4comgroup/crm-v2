import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { validateFunnelConfig, type FunnelConfig } from "./config"
import { FUNNEL_TEMPLATE_SOURCES } from "./templates-source"

// The two platform funnel templates live in TWO places: the TS source (used
// by code) and the migration that seeds `funnel_template`. This test reads the
// migration and compares, so they can never drift; it also validates every
// template + the IN4COM tenant config against the signal codes the registry
// has after all migrations.

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")

const MIGRATION = "migrations/0038_funnel_codes_and_templates.sql"
const NEW_CODES = [
  "SALES_RFI_REQUESTED",
  "SALES_BRIEF_RECEIVED",
  "SALES_SHORTLISTED",
  "SALES_FINAL_TERMS",
  "SALES_SELECTED",
  "CONTRACT_SIGNED",
  "SALES_LOST",
]
/** Retired codes deleted by migration 0017 (R23; deleted by `retired_at`, not by name). */
const RETIRED_R23 = [
  "COMPLAINT_ERROR",
  "CONTRACT_LICENSE",
  "CONTRACT_SLA",
  "DELIVERY_ACCEPTANCE",
  "DELIVERY_CONFIRM",
  "DELIVERY_REPORT",
  "SALES_CONCEPT",
  "SALES_MOCKUP",
  "SALES_ORDER_CONFIRM",
  "SALES_PRESENTATION",
  "SIGNAL_TENDER",
]

const unq = (s: string) => s.replace(/''/g, "'")

/** Codes of every `INSERT INTO "signal_category"` row of a migration (rows start with `  ('CODE', 'pack'`). */
function insertedCategoryCodes(sql: string): string[] {
  const codes: string[] = []
  for (const stmt of sql.split("--> statement-breakpoint")) {
    if (!stmt.includes('INSERT INTO "signal_category"')) continue
    for (const m of stmt.matchAll(/^ {2}\('([A-Z][A-Z0-9_]+)', '[a-z_]+', '/gm)) codes.push(m[1])
  }
  return codes
}

/** Codes hard-deleted by name (`DELETE FROM "signal_category" WHERE "code" IN (…)`). */
function deletedCategoryCodes(sql: string): string[] {
  const m = sql.match(/DELETE FROM "signal_category" WHERE "code" IN \(([^)]*)\)/)
  return m ? [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]) : []
}

function registryCodes(): Set<string> {
  const known = new Set(insertedCategoryCodes(read("migrations/0012_signals_registry_v1.sql")))
  for (const c of deletedCategoryCodes(read("migrations/0016_signals_generic_registry.sql"))) known.delete(c)
  for (const c of RETIRED_R23) known.delete(c)
  for (const c of insertedCategoryCodes(read(MIGRATION))) known.add(c)
  return known
}

type SeededTemplate = { code: string; labelRu: string; description: string; sort: number; config: unknown }

function seededTemplates(): SeededTemplate[] {
  const sql = read(MIGRATION)
  const re = /INSERT INTO "funnel_template" \("code", "label_ru", "description", "sort", "config", "is_active"\) VALUES\n {2}\('([a-z0-9_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), '((?:[^']|'')*)'::jsonb, true\)/g
  return [...sql.matchAll(re)].map((m) => ({
    code: m[1],
    labelRu: unq(m[2]),
    description: unq(m[3]),
    sort: Number(m[4]),
    config: JSON.parse(unq(m[5])),
  }))
}

const known = registryCodes()

describe("registry codes after the migrations", () => {
  it("has the seed minus deleted codes plus the 7 funnel codes", () => {
    expect(insertedCategoryCodes(read(MIGRATION)).sort()).toEqual([...NEW_CODES].sort())
    // 165 seed codes + 11 retired − 7 (R22) − 11 (R23) + 7 new.
    expect(known.size).toBe(165)
    for (const c of NEW_CODES) expect(known.has(c)).toBe(true)
    expect(known.has("PROSPECT_NEED_EXPRESSED")).toBe(false)
  })
})

describe("funnel templates", () => {
  it("the migration seeds exactly the TS source", () => {
    const seeded = seededTemplates()
    expect(seeded.map((t) => t.code)).toEqual(FUNNEL_TEMPLATE_SOURCES.map((t) => t.code))
    for (const src of FUNNEL_TEMPLATE_SOURCES) {
      const row = seeded.find((t) => t.code === src.code)!
      expect(row).toEqual({ code: src.code, labelRu: src.labelRu, description: src.description, sort: src.sort, config: src.config })
    }
  })

  it.each(FUNNEL_TEMPLATE_SOURCES.map((t) => [t.code, t.config] as const))("%s is a valid funnel", (_code, config) => {
    const r = validateFunnelConfig(config, { knownSignals: known })
    expect(r.issues).toEqual([])
    // Parsing keeps the JSON as is (no defaults filled in → the stored JSON is complete).
    expect(r.config).toEqual(config)
  })

  it("tenders_5: go / no-go gate, expert forecast only at s3 / s4", () => {
    const t = FUNNEL_TEMPLATE_SOURCES.find((x) => x.code === "tenders_5")!.config
    expect(t.entryGate).toBe("go_no_go")
    const fc = t.stages.filter((s) => s.inForecast).map((s) => [s.code, s.probabilityMode])
    expect(fc).toEqual([
      ["s3", "expert"],
      ["s4", "expert"],
    ])
  })

  it("no vertical or company words in the templates", () => {
    const text = JSON.stringify(FUNNEL_TEMPLATE_SOURCES) + read(MIGRATION)
    expect(text).not.toMatch(/вин[оа]|алкогол|horeca|москв|агентств|in4com/i)
  })
})

describe("IN4COM funnel config (tenant data, docs/specs/funnel/in4com-funnel.json)", () => {
  const in4com = JSON.parse(read("docs/specs/funnel/in4com-funnel.json")) as FunnelConfig
  const tenders = FUNNEL_TEMPLATE_SOURCES.find((x) => x.code === "tenders_5")!.config

  it("is valid", () => {
    expect(validateFunnelConfig(in4com, { knownSignals: known }).issues).toEqual([])
  })

  it("= tenders_5 + the old deal types hidden", () => {
    const { dealTypes, ...rest } = in4com
    const { dealTypes: tplTypes, ...tplRest } = tenders
    expect(rest).toEqual(tplRest)
    expect(dealTypes.slice(0, tplTypes.length)).toEqual(tplTypes)
    expect(dealTypes.slice(tplTypes.length).every((t) => t.hidden === true)).toBe(true)
  })
})

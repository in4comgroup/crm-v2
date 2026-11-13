/**
 * Dev-time converter: signal catalogs (docs/specs/topics/05a, 05b, 05c) →
 * src/server/topics/catalog/catalog-v0.ts.
 *
 * Run from the repo root:  npx tsx tools/topics/catalog-to-ts.ts
 *
 * Takes only the codes whose IN4COM column is "on" or "review" (decision R6:
 * "on" codes go into the live prompt, "review" codes only into the offline
 * eval batch) plus the message-scope attributes of 05b. The output is a
 * committed, typed stop-gap until the phase-1 DB registry; runtime code must
 * never read docs/ (it is not deployed). Phase 1 seeds the registry from the
 * same catalogs and the generated file is then deleted together with this
 * converter.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const DOCS = join(ROOT, "docs/specs/topics")
const OUT = join(ROOT, "src/server/topics/catalog/catalog-v0.ts")

const FILES: { file: string; pack: "base" | "distribution" }[] = [
  { file: "05a-signals-base-a-g.md", pack: "base" },
  { file: "05b-signals-base-h-n.md", pack: "base" },
  { file: "05c-signals-distribution.md", pack: "distribution" },
]

// Decision R8 (02-open-questions.md § F): ORDER_REQUESTED weight 5 / D4.
const FORCED: Record<string, { weight: number; profile: string }> = {
  ORDER_REQUESTED: { weight: 5, profile: "D4" },
}

type Row = {
  code: string
  pack: "base" | "distribution"
  block: string
  blockLabelRu: string
  labelRu: string
  weight: number
  class: string | null
  kind: string
  scoreRule: string
  effort: string | null
  asksUs: boolean
  inboundOnly: boolean
  carriesAmount: boolean
  stage: string
  in4com: string
  profile: string | null
  recipient: string | null
  family: string
}

type Entry = Row & {
  emittedBy: "parser" | "process" | "both"
  promptEligible: boolean
  definitionRu: string
  boundaryRu: string
  cuesPromptRu: string[]
  antiCuesRu: { text: string; code: string | null }[]
  exampleRu: string
  counterExampleRu: string
  cardNoteRu: string
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())

const dash = (v: string) => (v === "—" || v === "-" || v === "" ? null : v)
const yes = (v: string) => v.toLowerCase() === "yes"
const unquoteCode = (v: string) => v.replace(/`/g, "").trim()

/** Top-level «…» quotes of a text (nesting-aware: «Счёт на ООО «Ромашка».»). */
function guillemets(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ""
  for (const ch of text) {
    if (ch === "«") {
      if (depth > 0) buf += ch
      depth++
    } else if (ch === "»" && depth > 0) {
      depth--
      if (depth === 0) {
        out.push(buf.trim())
        buf = ""
      } else buf += ch
    } else if (depth > 0) buf += ch
  }
  return out.filter(Boolean)
}

/** Split on ";" outside «…» quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let buf = ""
  for (const ch of text) {
    if (ch === "«") depth++
    else if (ch === "»" && depth > 0) depth--
    if (ch === ";" && depth === 0) {
      parts.push(buf)
      buf = ""
    } else buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts.map((p) => p.trim().replace(/\.$/, "").trim()).filter(Boolean)
}

function parseAntiCues(text: string): { text: string; code: string | null }[] {
  return splitTopLevel(text).map((part) => {
    const m = part.match(/→\s*(.+)$/)
    let code: string | null = null
    let phrase = part
    if (m) {
      phrase = part.slice(0, m.index).trim()
      const codeMatch = m[1].match(/`([A-Z0-9_]+)`/)
      code = codeMatch ? codeMatch[1] : null
    }
    return { text: phrase.replace(/`/g, ""), code }
  })
}

const clean = (s: string) => s.replace(/`/g, "").replace(/\s+/g, " ").trim()

function parseFile(file: string, pack: "base" | "distribution") {
  const md = readFileSync(join(DOCS, file), "utf8")
  const lines = md.split("\n")
  const rows = new Map<string, Row>()
  const entries = new Map<string, Partial<Entry> & { section: string[] }>()
  const attributes: {
    code: string
    group: string
    labelRu: string
    weight: number
    stage: string
    defaultOff: boolean
    cuesRu: string
    antiCuesRu: string
  }[] = []

  let block = ""
  let blockLabel = ""
  let inCodeTable = false
  let inAttrTable = false
  let current: (Partial<Entry> & { section: string[] }) | null = null

  for (const line of lines) {
    const h2 = line.match(/^## ([A-Z][A-Z0-9]*) · (.+)$/)
    if (line.startsWith("## ")) {
      current = null
      inCodeTable = false
      inAttrTable = false
      if (h2) {
        block = h2[1]
        blockLabel = h2[2].trim()
      } else block = ""
      if (line.startsWith("## Attributes")) inAttrTable = true
      continue
    }
    const h3 = line.match(/^### `([A-Z0-9_]+)` — (.+)$/)
    if (h3) {
      inCodeTable = false
      current = { section: [] }
      entries.set(h3[1], current)
      continue
    }
    if (line.startsWith("| Code | Название (RU) | W |")) {
      inCodeTable = true
      continue
    }
    if (inCodeTable && line.startsWith("| `")) {
      const c = cells(line)
      if (c.length !== 15) throw new Error(`${file}: bad row ${line}`)
      const code = unquoteCode(c[0])
      rows.set(code, {
        code,
        pack,
        block,
        blockLabelRu: blockLabel,
        labelRu: c[1],
        weight: Number(c[2]),
        // «risk (rel.)» = a risk for the relationship → plain class "risk".
        class: dash(c[3])?.replace(/\s*\(.*\)\s*$/, "") ?? null,
        kind: c[4],
        scoreRule: c[5],
        effort: dash(c[6]),
        asksUs: yes(c[7]),
        inboundOnly: yes(c[8]),
        carriesAmount: yes(c[9]),
        stage: c[10],
        // "on (review: 4 → 5 risk?)" → "on"
        in4com: c[11].split(/[\s(]/)[0],
        profile: dash(c[12]),
        recipient: dash(c[13]),
        family: c[14],
      })
      continue
    }
    if (inCodeTable && !line.startsWith("|")) inCodeTable = false
    if (inAttrTable && line.startsWith("| `ATTR_")) {
      const c = cells(line)
      attributes.push({
        code: unquoteCode(c[0]),
        group: c[1],
        labelRu: c[3],
        weight: Number(c[4]),
        stage: c[5].split(";")[0].trim(),
        defaultOff: c[5].includes("выключено"),
        cuesRu: c[6],
        antiCuesRu: c[7],
        // scope is filtered below
        ...({ scope: c[2] } as object),
      })
      continue
    }
    if (current) current.section.push(line)
  }

  for (const [code, e] of entries) {
    const text = e.section.join("\n")
    const field = (name: string) => {
      const m = text.match(new RegExp(`^\\| ${name} \\| (.+) \\|$`, "m"))
      return m ? m[1].trim() : ""
    }
    const para = (label: string) => {
      const re = new RegExp(`^\\*\\*${label}[^*]*:\\*\\*(.*)$`, "m")
      const m = text.match(re)
      return m ? m[1].trim() : ""
    }
    const emitted = field("Emitted by")
    const first = emitted.split(/[\s;(—]/)[0] as Entry["emittedBy"]
    e.emittedBy = first === "parser" || first === "process" || first === "both" ? first : "both"
    // "both (v204); in this design only the process emits it" and the
    // deterministic bounce detector: never asked from the LLM.
    const notLlm =
      /only the process emits it/.test(emitted) || /without the LLM/.test(emitted)
    e.promptEligible = e.emittedBy !== "process" && !notLlm
    e.definitionRu = clean(para("Определение"))
    e.boundaryRu = clean(para("Граница"))
    e.cuesPromptRu = guillemets(para("Признаки для промпта")).slice(0, 8)
    e.antiCuesRu = parseAntiCues(para("Похоже, но не это"))
    e.exampleRu = clean(para("Пример"))
    e.counterExampleRu = clean(para("Контрпример"))
    e.cardNoteRu = clean(para("Заметка для карточки"))
    void code
  }
  return { rows, entries, attributes }
}

const all: Entry[] = []
const attrs: ReturnType<typeof parseFile>["attributes"] = []
for (const { file, pack } of FILES) {
  const { rows, entries, attributes } = parseFile(file, pack)
  attrs.push(...attributes)
  for (const [code, row] of rows) {
    if (row.in4com !== "on" && row.in4com !== "review") continue
    const e = entries.get(code)
    if (!e) throw new Error(`${file}: no entry for ${code}`)
    const forced = FORCED[code]
    const merged = {
      ...row,
      ...(forced ? { weight: forced.weight, profile: forced.profile } : {}),
      emittedBy: e.emittedBy!,
      // 05 §3.4: only `emitted_by = process` codes stay out of the prompt
      // (a `both` watchdog such as CONTRACT_FRAME_EXPIRY is read from text
      // and kept by the server date gate).
      promptEligible: e.promptEligible!,
      definitionRu: e.definitionRu!,
      boundaryRu: e.boundaryRu!,
      cuesPromptRu: e.cuesPromptRu!,
      antiCuesRu: e.antiCuesRu!,
      exampleRu: e.exampleRu!,
      counterExampleRu: e.counterExampleRu!,
      cardNoteRu: e.cardNoteRu!,
    } satisfies Entry
    if (merged.promptEligible && (!merged.definitionRu || !merged.boundaryRu || merged.cuesPromptRu.length === 0)) {
      console.warn(`warn: ${code} is prompt-eligible but misses definition / boundary / cues`)
    }
    all.push(merged)
  }
}

const messageAttrs = attrs
  .filter((a) => (a as unknown as { scope: string }).scope === "message")
  .map(({ code, group, labelRu, weight, stage, defaultOff, cuesRu, antiCuesRu }) => ({
    code,
    group: group.toLowerCase(),
    labelRu,
    weight,
    stage,
    defaultOff,
    cuesRu: guillemets(cuesRu).slice(0, 8),
    antiCuesRu: clean(antiCuesRu),
  }))

// Stats
const stat: Record<string, Record<string, number>> = {}
for (const e of all) {
  stat[e.pack] ??= { on: 0, review: 0, onPrompt: 0, reviewPrompt: 0 }
  stat[e.pack][e.in4com]++
  if (e.promptEligible) stat[e.pack][e.in4com === "on" ? "onPrompt" : "reviewPrompt"]++
}
for (const e of all) if (!e.promptEligible) console.log(`  not in prompt: ${e.code} (${e.in4com}, ${e.kind}, ${e.emittedBy})`)
console.log("codes:", JSON.stringify(stat), "attributes(message):", messageAttrs.length)

const header = `// GENERATED by tools/topics/catalog-to-ts.ts from docs/specs/topics/05a, 05b,
// 05c — do not edit by hand; edit the catalogs and re-run
//   npx tsx tools/topics/catalog-to-ts.ts
//
// STOP-GAP (catalog v0) until the phase-1 DB signals registry
// (docs/specs/topics/03-development-plan.md phase 1). Phase 1 seeds the
// registry tables from the same catalogs; this file and the converter are
// then deleted and the prompt builder reads the org's effective registry.
// Runtime must never read docs/ (not deployed), hence a committed TS file.
//
// Content (decision R6): only codes with IN4COM = "on" (live prompt) or
// "review" (offline eval batch only), plus the message-scope attributes.
// Decision R8 applied: ORDER_REQUESTED weight 5 / D4.
import "server-only"

export type SignalPack = "base" | "distribution"
export type SignalClass = "risk" | "chance" | "fyi"
export type SignalKind = "event" | "watchdog" | "derived" | "trend" | "state"
export type In4comStatus = "on" | "review"

export type SignalCatalogEntry = {
  code: string
  pack: SignalPack
  block: string
  blockLabelRu: string
  labelRu: string
  weight: number
  class: SignalClass | null
  kind: SignalKind
  scoreRule: "fixed" | "state" | "inherited"
  effort: "quick" | "medium" | "complex" | null
  asksUs: boolean
  inboundOnly: boolean
  carriesAmount: boolean
  /** Pack default stage. */
  stage: "active" | "onHold" | "parked" | "gated"
  /** IN4COM activation (05 §5.1): "on" = live prompt, "review" = offline eval only. */
  in4com: In4comStatus
  profile: string | null
  recipient: string | null
  family: string
  emittedBy: "parser" | "process" | "both"
  /** False for process / watchdog / trend codes and deterministic-only codes. */
  promptEligible: boolean
  definitionRu: string
  boundaryRu: string
  /** ≤ 8 prompt cues. */
  cuesPromptRu: string[]
  antiCuesRu: { text: string; code: string | null }[]
  exampleRu: string
  counterExampleRu: string
  cardNoteRu: string
}

export type SignalAttributeEntry = {
  code: string
  group: string
  labelRu: string
  weight: number
  stage: string
  /** Off by default for Russian (spec §10.3): salutation. */
  defaultOff: boolean
  cuesRu: string[]
  antiCuesRu: string
}

`

const body =
  `export const SIGNAL_CATALOG_V0: readonly SignalCatalogEntry[] = ${JSON.stringify(all, null, 2)}\n\n` +
  `export const SIGNAL_ATTRIBUTES_V0: readonly SignalAttributeEntry[] = ${JSON.stringify(messageAttrs, null, 2)}\n`

writeFileSync(OUT, header + body)
console.log(`wrote ${OUT} (${all.length} codes)`)

/**
 * Dev-time parser of the signal catalogs (docs/specs/topics/05a, 05b, 05c)
 * into registry records (src/lib/signals/types.ts shapes). Used by
 * tools/topics/catalog-to-seed-sql.ts (v1 seed migration + activation
 * preset). Agency (05d) is not parsed (decision R5).
 *
 * Rule: nothing is dropped silently. A value that does not fit a typed
 * field goes to `noteRu` with its field label and the original text, and the
 * parser records an issue.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DISPLAY_PROFILES,
  RECIPIENT_ROLES,
  SIGNAL_CLASSES,
  SIGNAL_EFFORTS,
  SIGNAL_EMITTED_BY,
  SIGNAL_FAMILIES,
  SIGNAL_KINDS,
  SIGNAL_SCORE_RULES,
  SIGNAL_STAGES,
  type AntiCue,
  type DealRiskTypeRecord,
  type SignalAttributeRecord,
  type SignalBlockRecord,
  type SignalPackOverrideRecord,
  type SignalPackRecord,
  type SignalRelationRecord,
  type SignalStageRuleRecord,
} from "@/lib/signals/types"

export type PackCode = "base" | "distribution"

export const CATALOG_FILES: { file: string; pack: PackCode }[] = [
  { file: "05a-signals-base-a-g.md", pack: "base" },
  { file: "05b-signals-base-h-n.md", pack: "base" },
  { file: "05c-signals-distribution.md", pack: "distribution" },
]

/** Category as seeded (DB columns) + the IN4COM activation for the preset. */
export type SeedCategory = {
  code: string
  packCode: PackCode
  blockCode: string
  family: string
  labelRu: string
  definitionRu: string
  boundaryRu: string
  cuesPromptRu: string[]
  synonymsRu: Record<string, string[]>
  antiCuesRu: AntiCue[]
  exampleRu: string
  counterExampleRu: string
  cardNoteRu: string
  weight: number
  scoreRule: string
  class: string | null
  classByRelation: boolean
  kind: string
  effort: string | null
  carriesAmount: boolean
  asksUs: boolean
  inboundOnly: boolean
  emittedBy: string
  stage: string
  displayProfile: string | null
  recipientRole: string | null
  closesCodes: string[]
  dateGate: Record<string, unknown> | null
  relevanceDays: number | null
  triggerRule: Record<string, unknown> | null
  noteRu: string | null
  retiredAt: string | null
  successorCode: string | null
  /** IN4COM column (R6): on | review | off. Not a DB column. */
  in4com: "on" | "review" | "off"
}

export type NoteRecord = {
  entity: string
  key: string
  field: string
  text: string
}

export type ParsedCatalogs = {
  packs: SignalPackRecord[]
  blocks: SignalBlockRecord[]
  categories: SeedCategory[]
  attributes: SignalAttributeRecord[]
  relations: SignalRelationRecord[]
  packOverrides: SignalPackOverrideRecord[]
  riskTypes: DealRiskTypeRecord[]
  stageRules: SignalStageRuleRecord[]
  /** Everything that went to note_ru (entity, key, field, original text). */
  notes: NoteRecord[]
  /** Parse problems (missing entries, unknown values, skipped rows). */
  issues: string[]
}

// ── text helpers ──────────────────────────────────────────────────────────

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())

const isDash = (v: string) => v === "—" || v === "-" || v === ""
const codesIn = (text: string) => [...text.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1])
const stripTicks = (s: string) => s.replace(/`/g, "")
const clean = (s: string) => s.replace(/\s+/g, " ").trim()
const stripParens = (s: string) => s.replace(/\([^()]*\)/g, "")

/** Top-level «…» quotes (nesting-aware). */
export function guillemets(text: string): string[] {
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

/** Split on the given separators outside «…» and (…) . */
function splitTopLevel(text: string, seps: string[]): string[] {
  const parts: string[] = []
  let q = 0
  let p = 0
  let buf = ""
  for (const ch of text) {
    if (ch === "«") q++
    else if (ch === "»" && q > 0) q--
    else if (ch === "(") p++
    else if (ch === ")" && p > 0) p--
    if (seps.includes(ch) && q === 0 && p === 0) {
      parts.push(buf)
      buf = ""
    } else buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts.map((s) => s.trim()).filter(Boolean)
}

function parseAntiCues(text: string): AntiCue[] {
  if (!text.trim()) return []
  return splitTopLevel(text.replace(/\.\s*$/, ""), [";"]).map((part) => {
    const m = part.match(/→\s*(.+)$/)
    let code: string | null = null
    let phrase = part
    if (m) {
      phrase = part.slice(0, m.index).trim()
      const c = codesIn(m[1])
      code = c[0] ?? null
    }
    return { text: clean(stripTicks(phrase)), code }
  })
}

const SYNONYM_GROUPS: [RegExp, string][] = [
  [/^Деловая переписка от третьих лиц/, "business_third_party"],
  [/^Деловая переписка/, "business"],
  [/^Чаты/, "chat"],
  [/^Сокращения/, "terms"],
  [/^Устойчивые конструкции/, "patterns"],
  [/^Новости/, "news"],
  [/^Отправители/, "senders"],
  [/^Системные уведомления \(рус/, "system_ru"],
  [/^Системные уведомления \(англ/, "system_en"],
]

function synonymItems(group: string, text: string): string[] {
  const parts = splitTopLevel(text.replace(/\.\s*$/, ""), group === "patterns" ? [";"] : [",", ";"])
  return parts.map((p) => {
    const g = guillemets(p)
    // A bare «…» item → its inner text; anything else keeps its wording.
    if (g.length === 1 && p.replace(/^«/, "").replace(/»$/, "").trim() === g[0]) return g[0]
    return clean(stripTicks(p))
  })
}

// ── value normalisation (with notes) ──────────────────────────────────────

const inList = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v)

export function parseCatalogs(docsDir: string): ParsedCatalogs {
  const notes: NoteRecord[] = []
  const issues: string[] = []
  const packs: SignalPackRecord[] = [
    {
      code: "base",
      labelRu: "Базовый пакет",
      descriptionRu:
        "Общие коды для любой компании: продажи, договоры, счета, обратная связь, встречи, контакты, рынок, команда, аккаунт, конкуренты, поставщики.",
      sort: 0,
    },
    {
      code: "distribution",
      labelRu: "Дистрибуция (вино и крепкий алкоголь)",
      descriptionRu:
        "Коды дистрибьютора вина и крепкого алкоголя: заказы, наличие и образцы, листинг, доставка и возвраты, ЕГАИС и документы, оплата.",
      sort: 1,
    },
  ]
  const blocks: SignalBlockRecord[] = []
  const categories = new Map<string, SeedCategory>()
  const attributes: SignalAttributeRecord[] = []
  const relations = new Map<string, SignalRelationRecord>()
  const packOverrides: SignalPackOverrideRecord[] = []
  const riskTypes: DealRiskTypeRecord[] = []
  const stageRules: SignalStageRuleRecord[] = []

  const noteLines = new Map<string, string[]>() // category code → note lines
  const rawRelations = new Map<string, string>() // category code → «Relations» field (with backticks)
  const addNote = (entity: string, key: string, field: string, text: string) => {
    const t = clean(text)
    if (!t) return
    notes.push({ entity, key, field, text: t })
    if (entity === "category") {
      const arr = noteLines.get(key) ?? []
      arr.push(`${field}: ${t}`)
      noteLines.set(key, arr)
    }
  }

  // Runs after every helper below is defined (consts are not hoisted).
  function runFiles() {
    for (const { file, pack } of CATALOG_FILES) {
      const md = readFileSync(join(docsDir, file), "utf8")
      const lines = md.split("\n")

      // Sections by "## " heading.
      type Section = { title: string; lines: string[] }
      const sections: Section[] = []
      let cur: Section = { title: "", lines: [] }
      for (const line of lines) {
        if (line.startsWith("## ")) {
          sections.push(cur)
          cur = { title: line.slice(3).trim(), lines: [] }
        } else cur.lines.push(line)
      }
      sections.push(cur)

      // 05c block table (audience) in «Pack conventions».
      const dsAudience = new Map<string, string>()
      for (const s of sections) {
        if (s.title !== "Pack conventions") continue
        for (const l of s.lines) {
          const m = l.match(/^\| (DS\d) \| ([^|]+) \| (\w+) \| /)
          if (m) dsAudience.set(m[1], m[3])
        }
      }

      for (const s of sections) {
        const blockHead = s.title.match(/^([A-Z][A-Z0-9]*) · (.+)$/)
        if (blockHead) {
          parseBlockSection(s, blockHead[1], blockHead[2], pack, file, dsAudience)
        } else if (s.title.startsWith("Attributes")) {
          parseAttributes(s.lines)
        } else if (s.title === "Relations") {
          parseRelationTable(s.lines, pack)
        } else if (s.title.startsWith("Retired codes")) {
          parseRetired(s.lines, pack)
        } else if (s.title.startsWith("Deal-risk types")) {
          parseRiskTypes(s.lines, pack)
        } else if (s.title.startsWith("Stage-rule template")) {
          parseStageRules(s.lines, pack)
        }
      }
    }
  }

  // ── block section: summary table + entries ─────────────────────────────
  function parseBlockSection(
    s: { lines: string[] },
    blockCode: string,
    labelRaw: string,
    pack: PackCode,
    file: string,
    dsAudience: Map<string, string>,
  ) {
    const intro: string[] = []
    let i = 0
    while (i < s.lines.length && !s.lines[i].startsWith("| Code |")) {
      if (s.lines[i].trim()) intro.push(s.lines[i])
      i++
    }
    const introText = intro.join(" ")
    const internalOnly = /internal-only/i.test(introText)
    blocks.push({
      code: blockCode,
      packCode: pack,
      labelRu: labelRaw.replace(/\s*\(proposed.*\)$/, "").trim(),
      audience: dsAudience.get(blockCode) ?? (internalOnly ? "colleagues_activity" : null),
      internalOnly,
      // "Block H is not first-party-only" is the only statement in 05a–05c.
      firstPartyOnly: false,
      sort: blocks.length,
    })

    // Summary rows.
    const rows: string[][] = []
    for (; i < s.lines.length; i++) {
      const l = s.lines[i]
      if (l.startsWith("| `")) rows.push(cells(l))
      else if (!l.startsWith("|") && rows.length > 0) break
    }

    // Entries: "### `CODE` — label" until the next "### ".
    const entries = new Map<string, string[]>()
    let code: string | null = null
    for (const l of s.lines) {
      const h3 = l.match(/^### `([A-Z0-9_]+)` — /)
      if (h3) {
        code = h3[1]
        entries.set(code, [])
        continue
      }
      if (l.startsWith("### ")) code = null
      if (code) entries.get(code)!.push(l)
    }

    for (const c of rows) {
      if (c.length !== 15) {
        issues.push(`${file}: summary row with ${c.length} cells: ${c[0]}`)
        continue
      }
      const code = stripTicks(c[0])
      const body = entries.get(code)
      if (!body) issues.push(`${file}: no entry section for ${code}`)
      categories.set(code, buildCategory(code, c, body ?? [], pack, blockCode, file))
      entries.delete(code)
    }
    for (const orphan of entries.keys()) issues.push(`${file}: entry ${orphan} has no summary row (skipped)`)
  }

  function buildCategory(
    code: string,
    c: string[],
    body: string[],
    pack: PackCode,
    blockCode: string,
    file: string,
  ): SeedCategory {
    const text = body.join("\n")
    const field = (name: string) => {
      const m = text.match(new RegExp(`^\\| ${name.replace(/[/·]/g, (x) => `\\${x}`)} \\| (.+) \\|$`, "m"))
      return m ? m[1].trim() : ""
    }
    const para = (label: string) => {
      const m = text.match(new RegExp(`^\\*\\*${label}[^*]*:\\*\\*(.*)$`, "m"))
      return m ? m[1].trim() : ""
    }
    const note = (f: string, t: string) => addNote("category", code, f, t)

    // Lines before the field table (05c DS7 «proposed (new)» marks).
    const pre: string[] = []
    for (const l of body) {
      if (l.startsWith("| Field")) break
      if (l.trim()) pre.push(stripTicks(l))
    }
    if (pre.length) note("Статус", pre.join(" "))

    // weight
    let weight = Number(c[2])
    if (!Number.isFinite(weight)) {
      note("Weight", c[2])
      weight = 0
    }
    // class
    let klass: string | null = null
    let classByRelation = false
    if (!isDash(c[3])) {
      const base = c[3].replace(/\s*\(.*\)\s*$/, "")
      if (/\(rel\.?\)/.test(c[3])) classByRelation = true
      if (inList(SIGNAL_CLASSES, base)) klass = base
      else note("Class", c[3])
    }
    const pick = (list: readonly string[], v: string, label: string, fallback: string | null) => {
      if (isDash(v)) return fallback
      if (list.includes(v)) return v
      note(label, v)
      return fallback
    }
    const kind = pick(SIGNAL_KINDS, c[4], "Kind", "event")!
    const scoreRule = pick(SIGNAL_SCORE_RULES, c[5], "Score rule", "fixed")!
    const effort = pick(SIGNAL_EFFORTS, c[6], "Effort", null)
    const bool = (v: string, label: string) => {
      if (v === "yes") return true
      if (v === "no" || isDash(v)) return false
      note(label, v)
      return /^yes/.test(v)
    }
    const asksUs = bool(c[7], "Asks us")
    const inboundOnly = bool(c[8], "Inbound only")
    const carriesAmount = bool(c[9], "Amount")
    const stage = pick(SIGNAL_STAGES, c[10], "Stage", "onHold")!
    const in4First = c[11].split(/[\s(]/)[0]
    const in4com = (["on", "review", "off"].includes(in4First) ? in4First : "off") as SeedCategory["in4com"]
    if (c[11] !== in4First) note("IN4COM", c[11])
    if (!["on", "review", "off"].includes(in4First)) issues.push(`${code}: IN4COM value «${c[11]}» → off`)
    const recipientRole = pick(RECIPIENT_ROLES, c[13], "Recipient", null)
    let family = c[14]
    if (!inList(SIGNAL_FAMILIES, family)) {
      note("Family", family)
      issues.push(`${code}: family «${family}» not in the list`)
      family = family || "internal"
    }

    // display profile — the entry field decides "from weight" (= null).
    const prof = field("Display profile")
    let displayProfile: string | null = null
    if (/^from weight/.test(prof)) {
      const rest = prof.replace(/^from weight \([A-Z0-9]+\)\s*/, "")
      if (rest) note("Display profile", prof)
    } else if (/^S[01]\b/.test(prof)) {
      displayProfile = prof.slice(0, 2)
      if (prof.length > 2) note("Display profile", prof)
    } else if (prof) {
      note("Display profile", prof)
    } else if (!isDash(c[12]) && inList(DISPLAY_PROFILES, c[12])) {
      displayProfile = c[12]
    }
    if (!/^(P6|P8|D4|W1|S0|S1)$/.test(c[12])) note("Profile (summary)", c[12])

    // emitted by
    const emittedRaw = field("Emitted by")
    let emittedBy = emittedRaw.split(/[\s;(—]/)[0]
    if (!inList(SIGNAL_EMITTED_BY, emittedBy)) {
      issues.push(`${code}: emitted by «${emittedRaw}» → both`)
      emittedBy = "both"
    }
    if (emittedRaw !== emittedBy) note("Emitted by", emittedRaw)

    // closes / closed by
    const closesRaw = field("Closes / closed by")
    const cm = closesRaw.match(/^closes: (.*?) · closed by: (.*)$/)
    let closesCodes: string[] = []
    if (cm) {
      const closesPart = cm[1]
      if (!isDash(closesPart)) {
        const first = closesPart.split(";")[0]
        closesCodes = codesIn(first)
        if (closesPart !== first || /\(|on the same topic/.test(first)) note("Closes", closesPart)
      }
      if (!isDash(cm[2])) note("Closed by", cm[2])
    } else if (closesRaw) {
      note("Closes / closed by", closesRaw)
    }

    // date gate
    const gateRaw = field("Date gate")
    let dateGate: Record<string, unknown> | null = null
    if (gateRaw.startsWith("{")) {
      const fact = gateRaw.match(/fact: `([^`]+)`/)?.[1]
      const settingKey = gateRaw.match(/setting: `([^`]+)`/)?.[1]
      const test = /within/.test(gateRaw) ? "within" : /more than|beyond/.test(gateRaw) ? "beyond" : null
      const days = Number(gateRaw.match(/window: (?:0–)?(\d+)/)?.[1] ?? gateRaw.match(/= (\d+)/)?.[1] ?? NaN)
      if (fact && test) {
        dateGate = {
          fact,
          test,
          settingKey: settingKey ?? null,
          ...(Number.isFinite(days) ? { days } : {}),
        }
      } else issues.push(`${code}: date gate not parsed: ${gateRaw}`)
      note("Date gate", gateRaw)
    } else if (!isDash(gateRaw)) {
      note("Date gate", gateRaw)
    }

    // relevance window
    const relRaw = field("Relevance window")
    let relevanceDays: number | null = null
    if (relRaw && relRaw !== "default" && !isDash(relRaw)) {
      const m = relRaw.match(/^(\d+) days\b/)
      if (m) relevanceDays = Number(m[1])
      note("Relevance window", relRaw)
    }

    // free-text fields kept as notes
    const rels = field("Relations")
    if (!isDash(rels)) {
      note("Relations", rels)
      rawRelations.set(code, rels)
    }
    const deal = field("Deal effect")
    if (!isDash(deal)) note("Deal effect", deal)

    // consistency: summary vs entry table
    const wck = field("Weight · class · kind · score rule")
      .split("·")
      .map((x) => x.trim())
    if (wck.length === 4 && parseInt(wck[0], 10) !== weight && code !== "ORDER_REQUESTED") {
      issues.push(`${code}: weight ${weight} (summary) vs ${wck[0]} (entry) — summary used`)
    }
    const sb = field("Stage \\(pack default\\) · IN4COM")
    void sb

    // texts
    const cuesRaw = para("Признаки для промпта")
    const cues = guillemets(cuesRaw)
    if (cues.length > 8) issues.push(`${code}: ${cues.length} prompt cues (> 8), first 8 kept, rest → note`)
    if (cues.length > 8)
      note(
        "Признаки (сверх 8)",
        cues
          .slice(8)
          .map((q) => `«${q}»`)
          .join(", "),
      )
    if (cues.length === 0 && cuesRaw && !/^—/.test(cuesRaw)) note("Признаки", cuesRaw)

    const synonymsRu: Record<string, string[]> = {}
    const synIdx = body.findIndex((l) => l.startsWith("**Синонимы"))
    if (synIdx >= 0) {
      for (let k = synIdx + 1; k < body.length && body[k].startsWith("- "); k++) {
        const m = body[k].match(/^- ([^:]+): (.*)$/)
        if (!m) continue
        const g = SYNONYM_GROUPS.find(([re]) => re.test(m[1]))?.[1]
        if (!g) {
          note("Синонимы", body[k])
          continue
        }
        synonymsRu[g] = [...(synonymsRu[g] ?? []), ...synonymItems(g, m[2])]
      }
    }

    // trigger rule (process codes): RU + EN prose
    let triggerRule: Record<string, unknown> | null = null
    const trIdx = body.findIndex((l) => l.startsWith("**Правило срабатывания"))
    if (trIdx >= 0) {
      const rule: Record<string, string> = {}
      const inline = body[trIdx].replace(/^\*\*[^*]+\*\*\s*/, "").trim()
      if (inline) rule.ru = clean(stripTicks(inline))
      for (let k = trIdx + 1; k < body.length && body[k].trim(); k++) {
        const m = body[k].match(/^- (RU|EN): (.*)$/)
        if (m) rule[m[1].toLowerCase()] = clean(m[2])
        else rule.ru = clean(`${rule.ru ?? ""} ${body[k]}`)
      }
      triggerRule = rule
    }

    const labelRu = c[1]
    const cat: SeedCategory = {
      code,
      packCode: pack,
      blockCode,
      family,
      labelRu,
      definitionRu: clean(stripTicks(para("Определение"))),
      boundaryRu: clean(stripTicks(para("Граница"))),
      cuesPromptRu: cues.slice(0, 8),
      synonymsRu,
      antiCuesRu: parseAntiCues(para("Похоже, но не это")),
      exampleRu: clean(stripTicks(para("Пример"))),
      counterExampleRu: clean(stripTicks(para("Контрпример"))),
      cardNoteRu: clean(stripTicks(para("Заметка для карточки"))),
      weight,
      scoreRule,
      class: klass,
      classByRelation,
      kind,
      effort,
      carriesAmount,
      asksUs,
      inboundOnly,
      emittedBy,
      stage,
      displayProfile,
      recipientRole,
      closesCodes,
      dateGate,
      relevanceDays,
      triggerRule,
      noteRu: null,
      retiredAt: null,
      successorCode: null,
      in4com,
    }
    void file
    return cat
  }

  // ── attributes (05b) ───────────────────────────────────────────────────
  function parseAttributes(lines: string[]) {
    for (const l of lines) {
      if (!l.startsWith("| `ATTR_")) continue
      const c = cells(l)
      const code = stripTicks(c[0])
      const scope = c[2] as SignalAttributeRecord["scope"]
      const stageRaw = c[5]
      const stage = stageRaw.split(";")[0].trim()
      const noteParts: string[] = []
      if (stageRaw !== stage) noteParts.push(`Stage: ${stageRaw}`)
      if (!inList(SIGNAL_STAGES, stage)) issues.push(`${code}: attribute stage «${stageRaw}»`)
      const isMessage = scope === "message"
      const cuesRu = isMessage ? guillemets(c[6]) : []
      const definitionRu = isMessage ? "" : clean(stripTicks(c[6]))
      if (isMessage && cuesRu.length === 0) noteParts.push(`Признаки: ${c[6]}`)
      const noteRu = noteParts.length ? noteParts.join("\n") : null
      for (const n of noteParts) {
        const [f, ...rest] = n.split(": ")
        notes.push({
          entity: "attribute",
          key: code,
          field: f,
          text: rest.join(": "),
        })
      }
      attributes.push({
        code,
        packCode: "base",
        groupCode: c[1].toLowerCase().replace(/\s+/g, "_"),
        scope,
        labelRu: c[3],
        definitionRu,
        weight: Number(c[4]),
        stage: (inList(SIGNAL_STAGES, stage) ? stage : "onHold") as SignalAttributeRecord["stage"],
        defaultOff: /выключено/.test(stageRaw),
        profiles: [],
        cuesRu,
        antiCuesRu: splitTopLevel(c[7], [";"]).map((x) => clean(stripTicks(x))),
        noteRu,
        sort: attributes.length,
      })
    }
  }

  // ── relations ─────────────────────────────────────────────────────────
  function addRelation(
    pack: PackCode,
    kind: SignalRelationRecord["kind"],
    a: string,
    b: string,
    noteRu: string | null,
    extra: Partial<SignalRelationRecord> = {},
  ) {
    if (a === b) return
    // `both` is symmetric: one row per pair.
    const [x, y] = kind === "both" && a > b ? [b, a] : [a, b]
    const id = `rel:${kind}:${x}:${y}`
    if (relations.has(id)) return
    relations.set(id, {
      id,
      packCode: pack,
      kind,
      codeA: x,
      codeB: y,
      settingKey: null,
      fact: null,
      noteRu,
      ...extra,
    })
  }

  function parseRelationTable(lines: string[], pack: PackCode) {
    for (const l of lines) {
      if (!l.startsWith("| ") || l.startsWith("| Kind") || l.startsWith("|---")) continue
      const c = cells(l)
      if (c.length < 4) continue
      const kind = c[0] as SignalRelationRecord["kind"]
      const [a] = codesIn(c[1])
      const [b] = codesIn(c[2])
      if (!a || !b || !["outranks", "leads_over", "both", "merges_into", "dampens"].includes(kind)) {
        issues.push(`relation row not parsed: ${l}`)
        continue
      }
      addRelation(pack, kind, a, b, clean(c[3]) || null)
    }
  }

  /** 05c entry «Relations» prose → outranks / leads_over / both / dampens. */
  function relationsFromProse(code: string, prose: string, pack: PackCode) {
    for (const clauseRaw of splitTopLevel(prose, [";"])) {
      const clause = clean(clauseRaw)
      const noteRu = clean(stripTicks(clause))
      const verb = clause.match(/\b(outranks|leads over)\b/)
      if (verb) {
        const kind = verb[1] === "outranks" ? "outranks" : "leads_over"
        const before = clause.slice(0, verb.index)
        const after = clause.slice(verb.index! + verb[0].length)
        if (/^\s*it\b/.test(after) && codesIn(before).length) {
          for (const a of codesIn(before)) addRelation(pack, kind, a, code, noteRu)
        } else {
          const target = stripParens(after.split(/\bwhen\b/)[0])
          for (const b of codesIn(target)) addRelation(pack, kind, code, b, noteRu)
        }
        continue
      }
      if (/`both` with/.test(clause)) {
        const target = stripParens(clause.split("`both` with")[1] ?? "")
        for (const b of codesIn(target)) addRelation(pack, "both", code, b, noteRu)
        continue
      }
      if (/relation `dampens` on/.test(clause)) {
        const [b] = codesIn(clause.split("`dampens` on")[1] ?? "")
        if (b) {
          addRelation(pack, "dampens", code, b, noteRu, {
            fact: "facts.deadlines",
            // 06 §5.2 H4: until the promised date + 1 working day.
            settingKey: null,
          })
        }
      }
    }
  }

  // ── retired codes (05a) ───────────────────────────────────────────────
  function parseRetired(lines: string[], pack: PackCode) {
    for (const l of lines) {
      if (!l.startsWith("| `")) continue
      const c = cells(l)
      const code = stripTicks(c[0])
      const successor = isDash(c[1]) ? null : stripTicks(c[1])
      const blockCode = c[2].split(/\s/)[0]
      retiredRows.push({
        code,
        successor,
        blockCode,
        note: `${c[2]} · ${c[3]}`,
        pack,
      })
    }
  }
  const retiredRows: {
    code: string
    successor: string | null
    blockCode: string
    note: string
    pack: PackCode
  }[] = []

  // ── deal-risk types (05c) ─────────────────────────────────────────────
  function parseRiskTypes(lines: string[], pack: PackCode) {
    const details = new Map<string, Map<string, string>>()
    let cur: Map<string, string> | null = null
    for (const l of lines) {
      const h = l.match(/^### `([A-Z0-9_]+)` — /)
      if (h) {
        cur = new Map()
        details.set(h[1], cur)
        continue
      }
      if (cur && /^\| [a-z_]+ \| /.test(l)) {
        const c = cells(l)
        if (!cur.has(c[0])) cur.set(c[0], c[1])
        else issues.push(`risk detail: duplicate field ${c[0]} in a section («${c[1]}» ignored)`)
      }
    }
    for (const l of lines) {
      if (!l.startsWith("| `")) continue
      const c = cells(l)
      if (c.length !== 10) continue
      const code = stripTicks(c[0])
      const d = details.get(code) ?? new Map<string, string>()
      const noteParts: string[] = []
      const nt = (f: string, t: string) => {
        noteParts.push(`${f}: ${clean(t)}`)
        notes.push({
          entity: "risk_type",
          key: code,
          field: f,
          text: clean(t),
        })
      }
      const triggerCodes = codesIn(c[2])
      if (/proposed/.test(c[2])) nt("Triggers", c[2])
      const clearCodes = codesIn(c[3].split(/check|— when/)[0])
      if (/check|when|proposed|—/.test(c[3]) && !d.get("clear_codes")) nt("Clears", c[3])
      const minOcc = Number(c[5].match(/^\d+/)?.[0] ?? 1)
      if (!/^\d+$/.test(c[5])) nt("Min occurrences", c[5])
      const condId = c[7].match(/`([a-z0-9_]+)`/)?.[1] ?? null
      if (d.get("condition")) nt("Condition", d.get("condition")!)
      else if (!isDash(c[7]) && c[7] !== `\`${condId}\``) nt("Condition", c[7])
      let scope: "deal" | "client" = "deal"
      if (c[8] === "client") scope = "client"
      else if (c[8] !== "deal") {
        nt("Trigger scope", c[8])
        issues.push(`risk ${code}: scope «${c[8]}» is not deal|client → deal, original in note`)
      }
      if (d.get("stage_guard") && d.get("stage_guard") !== c[6]) nt("Stage guard", d.get("stage_guard")!)
      if (d.get("clear_codes") && /\(/.test(d.get("clear_codes")!)) nt("Clear codes", d.get("clear_codes")!)
      riskTypes.push({
        code,
        packCode: pack,
        labelRu: c[1],
        descriptionRu: clean(d.get("description_ru") ?? ""),
        explanationRu: "",
        triggerCodes,
        clearCodes,
        severity: Number(c[4]),
        minOccurrences: minOcc,
        condition: condId,
        scope,
        reactionRole: isDash(c[9]) ? null : c[9],
        stageGuardTemplate: isDash(c[6]) ? null : c[6],
        noteRu: noteParts.length ? noteParts.join("\n") : null,
        enabled: true,
      })
    }
  }

  // ── stage-rule templates (05c) ────────────────────────────────────────
  const DEAL_TYPES = [
    "new_venue",
    "wine_card_listing",
    "chain_listing",
    "tender",
    "supply_agreement",
    "renewal",
  ]
  function stageList(v: string): string[] {
    if (isDash(v)) return []
    const range = v.match(/^S(\d)–S(\d)$/)
    if (range) {
      const out: string[] = []
      for (let k = Number(range[1]); k <= Number(range[2]); k++) out.push(`S${k}`)
      return out
    }
    return v.split(",").map((x) => x.trim())
  }
  function parseStageRules(lines: string[], pack: PackCode) {
    for (const l of lines) {
      const m = l.match(/^\| (\d+) \| /)
      if (!m) continue
      const c = cells(l)
      const n = Number(c[0])
      const codes = codesIn(c[1])
      const effectRaw = stripTicks(c[2])
      const effect =
        effectRaw === "create_deal"
          ? "create_deal"
          : effectRaw === "in_stage"
            ? "in_stage"
            : effectRaw === "enter_stage"
              ? "move_stage"
              : effectRaw === "outcome won"
                ? "outcome_won"
                : effectRaw === "outcome lost"
                  ? "outcome_lost"
                  : null
      if (!effect) {
        issues.push(
          `stage-rule template #${n} (${codes.join(", ") || c[1]}): effect «${c[2]}» — no rule row (Q26: no deal effect)`,
        )
        continue
      }
      if (codes.length !== 1) {
        issues.push(`stage-rule template #${n}: ${codes.length} codes, skipped`)
        continue
      }
      const noteParts: string[] = []
      const nt = (f: string, t: string) => {
        noteParts.push(`${f}: ${clean(t)}`)
        notes.push({
          entity: "stage_rule",
          key: `tpl:${pack}:${n}`,
          field: f,
          text: clean(t),
        })
      }
      if (/proposed/.test(c[1])) nt("Code", c[1])
      if (effectRaw === "enter_stage") nt("Effect", "enter_stage (catalog) → move_stage")
      let dealTypes: string[] = []
      if (c[4] === "all") dealTypes = []
      else if (/^all except/.test(c[4])) {
        const ex = new Set(c[4].match(/`([a-z_]+)`/g)?.map((x) => stripTicks(x)) ?? [])
        dealTypes = DEAL_TYPES.filter((t) => !ex.has(t))
        nt("Deal type", c[4])
      } else dealTypes = (c[4].match(/`([a-z_]+)`/g) ?? []).map((x) => stripTicks(x))
      const guards: Record<string, unknown> = {}
      if (!isDash(c[5])) guards.minConfidence = c[5]
      if (!isDash(c[6])) guards.minScore = Number(c[6])
      const from = stageList(c[7])
      if (from.length) guards.fromStageMeanings = from
      if (/yes/.test(c[8])) guards.forwardOnly = true
      if (/yes/.test(c[9])) guards.requiresConfirmation = true
      const guardText = c[10]
      if (/client_type|client_is_new/.test(guardText)) guards.clientGuard = clean(stripTicks(guardText))
      else if (!isDash(guardText)) nt("Note", guardText)
      stageRules.push({
        id: `tpl:${pack}:${n}`,
        organizationId: null,
        packCode: pack,
        code: codes[0],
        effect: effect as SignalStageRuleRecord["effect"],
        targetStageId: null,
        targetStageMeaning: isDash(c[3]) ? null : c[3],
        dealTypes,
        guards,
        enabled: true,
        sort: n,
        noteRu: noteParts.length ? noteParts.join("\n") : null,
      })
    }
  }

  // ── post-processing ───────────────────────────────────────────────────
  runFiles()

  // Relations from 05c entry prose.
  for (const cat of categories.values()) {
    if (cat.packCode !== "distribution") continue
    const rel = rawRelations.get(cat.code)
    if (rel) relationsFromProse(cat.code, rel, "distribution")
  }

  // Retired codes → category rows (retired, successor).
  for (const r of retiredRows) {
    const succ = r.successor ? categories.get(r.successor) : undefined
    const familyByBlock: Record<string, string> = {
      A: "offer",
      B: "contract",
      C: "delivery",
      E: "complaint",
    }
    const family = succ?.family ?? familyByBlock[r.blockCode] ?? "internal"
    if (categories.has(r.code)) {
      issues.push(`retired code ${r.code} also exists as a live code — not inserted twice`)
      continue
    }
    const noteText = `Retired 2026-09-25 (v204): ${r.note}${succ ? "" : `; family «${family}» inferred from block ${r.blockCode}`}`
    addNote("category", r.code, "Retired", noteText)
    categories.set(r.code, {
      code: r.code,
      packCode: r.pack,
      blockCode: r.blockCode,
      family,
      labelRu: `${r.code} (выведен)`,
      definitionRu: "",
      boundaryRu: "",
      cuesPromptRu: [],
      synonymsRu: {},
      antiCuesRu: [],
      exampleRu: "",
      counterExampleRu: "",
      cardNoteRu: "",
      weight: 0,
      scoreRule: "fixed",
      class: null,
      classByRelation: false,
      kind: "event",
      effort: null,
      carriesAmount: false,
      asksUs: false,
      inboundOnly: false,
      emittedBy: "parser",
      stage: "parked",
      displayProfile: null,
      recipientRole: null,
      closesCodes: [],
      dateGate: null,
      relevanceDays: null,
      triggerRule: null,
      noteRu: null,
      retiredAt: "2026-09-25",
      successorCode: r.successor,
      in4com: "off",
    })
  }

  // Decisions: R8, state codes weight 0.
  const order = categories.get("ORDER_REQUESTED")
  if (order) {
    order.weight = 5
    order.displayProfile = null // from weight 5 = D4 (R8)
  }
  for (const cat of categories.values()) {
    if (cat.kind === "state" || cat.scoreRule === "state") {
      if (cat.weight !== 0) {
        issues.push(`${cat.code}: state code weight ${cat.weight} → 0`)
        cat.weight = 0
      }
    }
  }

  // Pack override (R12): distribution adds PAYMENT_PROMISE to INVOICE_PAID.
  const paid = categories.get("INVOICE_PAID")
  if (paid) {
    const closes = [...new Set([...paid.closesCodes, "PAYMENT_PROMISE"])]
    packOverrides.push({
      packCode: "distribution",
      code: "INVOICE_PAID",
      weight: null,
      displayProfile: null,
      recipientRole: null,
      stage: null,
      closesCodes: closes,
      noteRu:
        "05c «Closing and attachment logic»: base INVOICE_PAID closes INVOICE_OVERDUE and (pack seed adds it) PAYMENT_PROMISE (R12).",
    })
  }

  // Assemble category note_ru.
  for (const cat of categories.values()) {
    const lines = noteLines.get(cat.code)
    cat.noteRu = lines?.length ? lines.join("\n") : null
  }

  return {
    packs,
    blocks,
    categories: [...categories.values()],
    attributes,
    relations: [...relations.values()],
    packOverrides,
    riskTypes,
    stageRules,
    notes,
    issues,
  }
}

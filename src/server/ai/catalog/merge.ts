import "server-only"

import {
  NORMALIZED_FIELDS,
  type NormalizedField,
  type NormalizedModel,
} from "@/server/ai/types"

// Multi-source merge (docs/specs/models/02-model-registry.md §5). Pure.
//
// - The FIRST source is authoritative: it decides which models exist, and
//   its non-null values win.
// - Later sources only FILL fields that are still empty. They never add
//   models. A later model is matched by model id, then by its canonical id.
// - `fieldSources` records which source filled each field; `raw` keeps
//   every source's original record, keyed by source.

export type SourceResult = { key: string; models: NormalizedModel[] }

export type MergedModel = {
  modelId: string
  fields: Partial<Record<NormalizedField, unknown>>
  fieldSources: Record<string, string>
  raw: Record<string, unknown>
}

// List fields that describe what a model accepts / produces. Sources report
// these incompletely (a gateway lists fewer input types than the model
// supports), so they are UNIONED across sources instead of first-wins.
const UNION_FIELDS: ReadonlySet<NormalizedField> = new Set([
  "inputModalities",
  "outputModalities",
])

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0)

function fill(target: MergedModel, m: NormalizedModel, sourceKey: string) {
  for (const f of NORMALIZED_FIELDS) {
    const v = m[f]
    if (isEmpty(v)) continue
    const current = target.fields[f]
    if (UNION_FIELDS.has(f) && Array.isArray(v) && Array.isArray(current)) {
      const merged = [...new Set([...(current as string[]), ...(v as string[])])]
      if (merged.length > current.length) {
        target.fields[f] = merged
        target.fieldSources[f] = `${target.fieldSources[f]}+${sourceKey}`
      }
      continue
    }
    if (!isEmpty(current)) continue
    target.fields[f] = v
    target.fieldSources[f] = sourceKey
  }
  target.raw[sourceKey] = m.raw
}

export function mergeCatalogs(results: SourceResult[]): MergedModel[] {
  const [authoritative, ...rest] = results
  if (!authoritative) return []

  const byId = new Map<string, MergedModel>()
  for (const m of authoritative.models) {
    if (byId.has(m.modelId)) continue
    const merged: MergedModel = {
      modelId: m.modelId,
      fields: {},
      fieldSources: {},
      raw: {},
    }
    fill(merged, m, authoritative.key)
    byId.set(m.modelId, merged)
  }

  for (const { key, models } of rest) {
    for (const m of models) {
      const target =
        byId.get(m.modelId) ??
        (m.canonicalModelId ? byId.get(m.canonicalModelId) : undefined)
      if (target && !(key in target.raw)) fill(target, m, key)
    }
  }

  return [...byId.values()]
}

import "server-only"

// Registry of signal activation presets (05 §5.1). A preset is tenant data
// applied to one org by the signals server module (`applyPreset`); it is
// never seeded by a migration. There are no presets today (R22, 2026-11-14):
// every org inherits the generic `base` codes as they are. Add a preset here
// only when an org needs its own code set (e.g. for a test).

export type PresetCodeStatus = "on" | "review" | "off"

/** on = active; review = onHold + reviewOnly (offline eval only); off = onHold. */
export type SignalActivationPreset = {
  key: string
  labelRu: string
  descriptionRu: string
  packs: string[]
  codes: Record<string, PresetCodeStatus>
}

export const SIGNAL_PRESETS: readonly SignalActivationPreset[] = []

export function getSignalPreset(key: string): SignalActivationPreset | null {
  return SIGNAL_PRESETS.find((p) => p.key === key) ?? null
}

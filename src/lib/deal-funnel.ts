// UI-only Russian labels for the seeded **system** funnel stages. The DB stage
// names stay English (Qualification … Rejected) — deals reference stage rows by
// id, and discovery/seed logic matches on the English names — so this is a pure
// presentation map. Any custom org-defined stage falls through to its own name.
export const DEAL_STAGE_LABEL: Record<string, string> = {
  Qualification: "Квалификация",
  Discovery: "Потребности",
  Pilot: "Пилот",
  Proposal: "КП",
  Negotiations: "Переговоры",
  Closed: "Закрыта",
  Rejected: "Проиграна",
}

export function dealStageLabel(name: string): string {
  return DEAL_STAGE_LABEL[name] ?? name
}

// Подпись стадии с учётом пользовательского названия из «Настроек стадий».
export function stageDisplayLabel(
  name: string,
  displayName: string | null | undefined,
): string {
  const custom = displayName?.trim()
  return custom ? custom : dealStageLabel(name)
}

// ── Stage roles (docs/specs/funnel §3.1) ──────────────────────────────────
// Every logic check of a stage's meaning goes by `deal_funnel_stage.role`
// (area0 | active | won | lost), never by its name — an org may name and
// order its stages freely. Client-safe helpers shared by server and UI.

export type DealStageRole = "area0" | "active" | "won" | "lost"

/** Normalises a stored role (unknown / missing → "active"). */
export function stageRoleOf(role: string | null | undefined): DealStageRole {
  return role === "area0" || role === "won" || role === "lost" ? role : "active"
}

/** won / lost = the outcome (terminal) stages of the funnel. */
export function isTerminalStageRole(role: string | null | undefined): boolean {
  const r = stageRoleOf(role)
  return r === "won" || r === "lost"
}

/** «Контакт до запроса» (area 0): out of the funnel, never an engine target. */
export function isArea0StageRole(role: string | null | undefined): boolean {
  return stageRoleOf(role) === "area0"
}

/** area0 / active = a deal on this stage is still open work («потенциальный»). */
export function isOpenStageRole(role: string | null | undefined): boolean {
  const r = stageRoleOf(role)
  return r === "area0" || r === "active"
}

// Id «виртуальной» 0-й стадии в «Настройках стадий», пока орга сидит на
// системной воронке: в диалоге она уже видна, а создаётся при первом
// сохранении (saveFunnelStageSettings в src/server/deals.ts).
export const PRE_PIPELINE_VIRTUAL_ID = "__pre_pipeline__"

// Lifecycle statuses of an OPEN deal (topics plan phase 5, spec 01 §9.2):
// `paused` keeps its stage and stays on the board, in pickers, search and
// the open-deal dedupe — it is treated like `active` everywhere except the
// pause / resume actions themselves. Client-safe (no DB import).
export const OPEN_DEAL_STATUSES = ["active", "paused"] as const

export function isOpenDealStatus(status: string): boolean {
  return status === "active" || status === "paused"
}

// «Пауза до 20 нояб.» — short Russian date for the pause badge.
export function formatPauseUntil(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

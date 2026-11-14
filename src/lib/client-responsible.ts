// «Ответственный» (Responsible) on a company — pure, client-safe rules.
//
// Product rules (owner of the product, 11/2026):
//   • a new company gets its creator as the responsible member;
//   • an org OWNER may set any human, not banned member of the org (incl.
//     themselves); an owner assignment ends a pending handover;
//   • the current responsible member who is NOT an owner may only «Передать
//     владельцу» — the responsible becomes an owner of the org and the
//     handover waits for that owner's decision;
//   • everybody else: read only.
// The server (src/server/client-responsible.ts) enforces these rules with
// `checkResponsibleChange`; the UI uses `responsibleMode` to pick controls.

export type ResponsibleMember = {
  userId: string
  name: string
  email: string | null
  /** Org role: owner | admin | member. */
  role: string
  banned: boolean
}

export type ResponsibleActor = {
  userId: string
  /** The actor's org role, null when not a member of the org. */
  role: string | null
}

export type ResponsibleClientState = {
  responsibleUserId: string | null
}

export type ResponsibleChange =
  | { kind: "assign"; targetUserId: string }
  | { kind: "handover"; ownerUserId?: string | null }

export type ResponsibleCheck =
  | { ok: true; targetUserId: string }
  | { ok: false; status: 400 | 403; error: string }

/** Max length of the optional handover reason. */
export const HANDOVER_REASON_MAX = 500

export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner"
}

/** Members that may become responsible: human (the caller passes humans only) and not banned. */
export function assignableMembers(members: ResponsibleMember[]): ResponsibleMember[] {
  return members.filter((m) => !m.banned)
}

/** Owners a handover may go to (not banned). */
export function handoverOwners(members: ResponsibleMember[]): ResponsibleMember[] {
  return members.filter((m) => isOwnerRole(m.role) && !m.banned)
}

/** Which control the viewer gets for a company's «Ответственный» field. */
export function responsibleMode(
  actor: ResponsibleActor,
  client: ResponsibleClientState,
): "assign" | "handover" | "read" {
  if (isOwnerRole(actor.role)) return "assign"
  if (actor.role && client.responsibleUserId === actor.userId) return "handover"
  return "read"
}

/**
 * Decides whether `actor` may make `change` on a company and returns the
 * resulting responsible user id. `members` = the org's HUMAN members (the
 * system actor «Агент» is never in it).
 */
export function checkResponsibleChange(
  actor: ResponsibleActor,
  client: ResponsibleClientState,
  change: ResponsibleChange,
  members: ResponsibleMember[],
): ResponsibleCheck {
  if (!actor.role) {
    return { ok: false, status: 403, error: "Вы не участник этой организации" }
  }
  if (change.kind === "assign") {
    if (!isOwnerRole(actor.role)) {
      return {
        ok: false,
        status: 403,
        error: "Назначить ответственного может только владелец организации",
      }
    }
    const target = assignableMembers(members).find((m) => m.userId === change.targetUserId)
    if (!target) {
      return {
        ok: false,
        status: 400,
        error: "Ответственным можно назначить только участника организации",
      }
    }
    return { ok: true, targetUserId: target.userId }
  }

  // handover
  if (isOwnerRole(actor.role)) {
    return {
      ok: false,
      status: 400,
      error: "Владелец назначает ответственного напрямую, передача не нужна",
    }
  }
  if (client.responsibleUserId !== actor.userId) {
    return {
      ok: false,
      status: 403,
      error: "Передать компанию владельцу может только её ответственный",
    }
  }
  const owners = handoverOwners(members)
  if (owners.length === 0) {
    return { ok: false, status: 400, error: "В организации нет владельца" }
  }
  if (change.ownerUserId) {
    const owner = owners.find((o) => o.userId === change.ownerUserId)
    if (!owner) {
      return {
        ok: false,
        status: 400,
        error: "Передать компанию можно только владельцу организации",
      }
    }
    return { ok: true, targetUserId: owner.userId }
  }
  if (owners.length > 1) {
    return { ok: false, status: 400, error: "Выберите владельца, которому передать компанию" }
  }
  return { ok: true, targetUserId: owners[0].userId }
}

/** Trims the optional handover reason; empty → null. */
export function normalizeHandoverReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim().replace(/\s+/g, " ")
  return t ? t.slice(0, HANDOVER_REASON_MAX) : null
}

// ── Companies feed filter «Ответственный» ──────────────────────────────

/** `all` | `mine` | `handover` (waits for the owner) | a member's user id. */
export type ResponsibleFilter = string

export const RESPONSIBLE_FILTER_ALL = "all"
export const RESPONSIBLE_FILTER_MINE = "mine"
export const RESPONSIBLE_FILTER_HANDOVER = "handover"

export function matchesResponsibleFilter(
  filter: ResponsibleFilter | null | undefined,
  row: { responsibleUserId: string | null; responsibleHandoverFromUserId: string | null },
  viewerUserId: string,
): boolean {
  if (!filter || filter === RESPONSIBLE_FILTER_ALL) return true
  if (filter === RESPONSIBLE_FILTER_MINE) return row.responsibleUserId === viewerUserId
  if (filter === RESPONSIBLE_FILTER_HANDOVER) return !!row.responsibleHandoverFromUserId
  return row.responsibleUserId === filter
}

// ── Pending handover note (kept in client.custom_fields) ───────────────

/**
 * Server-controlled key of `client.custom_fields` that holds the reason of a
 * PENDING handover (there is no client journal table). Never accepted from the
 * edit form; cleared when an owner assigns the company.
 */
export const HANDOVER_NOTE_KEY = "responsibleHandover"

export type HandoverNote = { reason: string | null; at: string }

export function readHandoverNote(customFields: unknown): HandoverNote | null {
  if (!customFields || typeof customFields !== "object") return null
  const v = (customFields as Record<string, unknown>)[HANDOVER_NOTE_KEY]
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  return {
    reason: typeof o.reason === "string" && o.reason.trim() ? o.reason : null,
    at: typeof o.at === "string" ? o.at : "",
  }
}

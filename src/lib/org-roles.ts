// Organization roles in the UI (client-safe, pure).
//
// The DB / better-auth keeps three org roles (`owner` | `admin` | `member`),
// but the product uses only two for now: «Владелец» (owner) and «Участник»
// (member). `admin` is still shown as a label for members who already have
// it, but it is never offered as a new choice.

export type OrgRole = "owner" | "admin" | "member"

// Display labels — DB enum keys stay English.
export const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
}

/** Roles an owner may assign today (role-change dialog). */
export const ASSIGNABLE_ORG_ROLES = ["owner", "member"] as const
export type AssignableOrgRole = (typeof ASSIGNABLE_ORG_ROLES)[number]

export function orgRoleLabel(role: string | null | undefined): string {
  if (!role) return ORG_ROLE_LABEL.member
  return ORG_ROLE_LABEL[role] ?? role
}

export function isAssignableOrgRole(role: string | null | undefined): role is AssignableOrgRole {
  return (ASSIGNABLE_ORG_ROLES as readonly string[]).includes(role ?? "")
}

// Organization switcher for platform admins (sidebar footer). Pure helpers,
// shared by the server (membership list, session hook) and the UI.

export type OrgOption = { id: string; name: string }

/** Memberships sorted by name (Russian collation: Cyrillic before Latin, case-insensitive), then id. */
export function sortOrgOptions(list: readonly OrgOption[]): OrgOption[] {
  return [...list].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
    return byName !== 0 ? byName : a.id.localeCompare(b.id)
  })
}

/**
 * The session fields that must follow `activeOrganizationId`. better-auth's
 * `organization.setActive` writes only the id; the session-update hook in
 * src/lib/auth.ts adds these so the sidebar name / slug never go stale.
 * `org` = the newly active organization, or null (unset / not found).
 */
export function activeOrgSessionFields(
  org: { name: string; slug: string | null } | null,
): { activeOrganizationName: string | null; activeOrganizationSlug: string | null } {
  return {
    activeOrganizationName: org?.name ?? null,
    activeOrganizationSlug: org?.slug ?? null,
  }
}

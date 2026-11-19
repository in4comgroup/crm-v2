// «Ведётся на уровне» of a contact (docs/specs/clients-contacts/07): the
// person in OUR organization at whose level the contact is managed. Either a
// member of the org (a system user) or a person who is not a user (name +
// optional position, e.g. the general manager). Static reference: no logic
// reads it. Client-safe, pure.

import { z } from "zod"

export const MANAGED_AT_LIMITS = { name: 120, position: 120 } as const

/** What the form / API sends. `null` = clear the field. */
export type ContactManagedAtInput =
  | { kind: "member"; userId: string }
  | { kind: "person"; name: string; position?: string | null }

/** What a contact row carries for display. */
export type ContactManagedAt =
  | {
      kind: "member"
      userId: string
      name: string | null
      /** false = the user is no longer a member of the org (shown, not offered). */
      isMember: boolean
    }
  | { kind: "person"; name: string; position: string | null }

export const contactManagedAtInputSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("member"), userId: z.string().trim().min(1) }),
    z.object({
      kind: z.literal("person"),
      name: z.string().trim().min(1, "Укажите имя").max(MANAGED_AT_LIMITS.name, "Имя слишком длинное"),
      position: z
        .string()
        .trim()
        .max(MANAGED_AT_LIMITS.position, "Должность слишком длинная")
        .nullish()
        .transform((v) => (v ? v : null)),
    }),
  ])
  .nullable()

/** Stored columns of one value (all null = not set). */
export type ManagedAtColumns = {
  managedAtUserId: string | null
  managedAtPersonName: string | null
  managedAtPersonPosition: string | null
}

export function managedAtColumns(input: z.infer<typeof contactManagedAtInputSchema>): ManagedAtColumns {
  if (!input) return { managedAtUserId: null, managedAtPersonName: null, managedAtPersonPosition: null }
  if (input.kind === "member") {
    return { managedAtUserId: input.userId, managedAtPersonName: null, managedAtPersonPosition: null }
  }
  return { managedAtUserId: null, managedAtPersonName: input.name, managedAtPersonPosition: input.position ?? null }
}

/** Same stored value (decides whether «who / when set» is stamped again). */
export function sameManagedAt(a: ManagedAtColumns, b: ManagedAtColumns): boolean {
  return (
    (a.managedAtUserId ?? null) === (b.managedAtUserId ?? null) &&
    (a.managedAtPersonName ?? null) === (b.managedAtPersonName ?? null) &&
    (a.managedAtPersonPosition ?? null) === (b.managedAtPersonPosition ?? null)
  )
}

/** Display value from the stored columns + the member's name. */
export function readManagedAt(
  cols: ManagedAtColumns,
  member: { name: string | null; isMember: boolean } | null,
): ContactManagedAt | null {
  if (cols.managedAtUserId) {
    return {
      kind: "member",
      userId: cols.managedAtUserId,
      name: member?.name ?? null,
      isMember: member?.isMember ?? false,
    }
  }
  if (cols.managedAtPersonName) {
    return { kind: "person", name: cols.managedAtPersonName, position: cols.managedAtPersonPosition }
  }
  return null
}

/** One-line Russian label: «Иван Петров, генеральный директор» / «Анна (не в организации)». */
export function managedAtLabel(v: ContactManagedAt | null): string {
  if (!v) return ""
  if (v.kind === "member") {
    const name = v.name ?? "Пользователь"
    return v.isMember ? name : `${name} (не в организации)`
  }
  return v.position ? `${v.name}, ${v.position}` : v.name
}

/**
 * The two names of a contact (product owner, 2026-11-22):
 *
 * - «Имя на родном языке» (`contact.name_native`) = the ONE name people see,
 *   everywhere in the UI, in notifications, Telegram, emails and AI answers.
 * - «Системное имя» (`contact.name`) = the name the sources use (the e-mail
 *   display name, the Telegram profile name). Read-only in the UI; used for
 *   matching. A manual contact gets a copy of the native name; a source may
 *   replace that copy later.
 *
 * `contact.name_native_source` says who set the native name: `manual` (a
 * person — never overwritten by a source) or `source` (a source / the system
 * — a signature found later may replace it). Pure, client-safe, unit-tested.
 */

export const NAME_NATIVE_SOURCES = ["manual", "source"] as const
export type NameNativeSource = (typeof NAME_NATIVE_SOURCES)[number]

/** The name to SHOW for a contact: the native name, else the system name. */
export function contactDisplayName(c: { name?: string | null; nameNative?: string | null }): string {
  const native = (c.nameNative ?? "").trim()
  if (native) return native
  return (c.name ?? "").trim()
}

/** Names of a contact a PERSON creates: only the native name is asked; the system name is its copy. */
export function manualContactNames(nameNative: string, name?: string | null): {
  name: string
  nameNative: string
  nameNativeSource: NameNativeSource
} {
  const native = nameNative.trim()
  return { name: (name ?? "").trim() || native, nameNative: native, nameNativeSource: "manual" }
}

/**
 * Names of a contact a SOURCE creates: system name = the account / display
 * name (else the address); native name = the signature name when found, else
 * the same value as the system name.
 */
export function sourceContactNames(input: {
  displayName?: string | null
  signatureName?: string | null
  email?: string | null
}): { name: string; nameNative: string; nameNativeSource: NameNativeSource } {
  const name = (input.displayName ?? "").trim() || (input.email ?? "").trim() || "(unknown)"
  const nameNative = (input.signatureName ?? "").trim() || name
  return { name, nameNative, nameNativeSource: "source" }
}

/** True when the system name is a placeholder (the address itself or «(unknown)»). */
function isPlaceholderName(name: string, email?: string | null): boolean {
  const n = name.trim().toLowerCase()
  return !n || n === "(unknown)" || (!!email && n === email.trim().toLowerCase()) || /^[^\s@]+@[^\s@]+$/.test(n)
}

/**
 * What a source found about an EXISTING contact (matched by e-mail) may change:
 * - system name ← the display name, only while the system name is still the
 *   copy of the native name or a placeholder (a name the source gave earlier
 *   and that differs from the native name stays);
 * - native name ← the signature name, only when the native name came from a
 *   source (`source`); a person's native name (`manual`) is never replaced. A
 *   source native name that is only the copy of the system name follows the
 *   new system name when no signature name is found.
 * Returns only the fields to write (empty = nothing to do).
 */
export function namesFromSource(
  current: { name: string; nameNative: string | null; nameNativeSource: NameNativeSource | string | null; email?: string | null },
  seen: { displayName?: string | null; signatureName?: string | null },
): { name?: string; nameNative?: string } {
  const out: { name?: string; nameNative?: string } = {}
  const name = current.name.trim()
  const native = (current.nameNative ?? "").trim()
  const display = (seen.displayName ?? "").trim()
  const signature = (seen.signatureName ?? "").trim()
  const nativeIsCopy = !native || native === name

  let nextName = name
  if (display && !isPlaceholderName(display, current.email) && display !== name && (nativeIsCopy || isPlaceholderName(name, current.email))) {
    nextName = display
    out.name = display
  }
  if (current.nameNativeSource !== "manual") {
    const nextNative = signature || (nativeIsCopy ? nextName : native)
    if (nextNative && nextNative !== native) out.nameNative = nextNative
  }
  return out
}

/**
 * A person edits the native name in the form: it becomes `manual`; the system
 * name follows while it was the copy of the old native name.
 */
export function namesFromManualEdit(
  current: { name: string; nameNative: string | null },
  nextNative: string,
): { name?: string; nameNative: string; nameNativeSource: NameNativeSource } {
  const native = nextNative.trim()
  const oldNative = (current.nameNative ?? "").trim()
  const nameIsCopy = !oldNative || current.name.trim() === oldNative
  return {
    ...(nameIsCopy && native !== current.name.trim() ? { name: native } : {}),
    nameNative: native,
    nameNativeSource: "manual",
  }
}

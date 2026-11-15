// «Us» identity sets — PURE, client-safe (identity spec I2, §3.5 / §3.6).
// Built by src/server/identity/own-org.ts from the DB rows and read by the
// deterministic consumers: org attribution, discovery, parse-time company
// stripping and the internal-mail fact `allInternal`. No DB, no server imports.

import { addressMatchKey } from "@/lib/address-match"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
import {
  normaliseEmailAddress,
  normaliseMailDomain,
  normalisePhone,
  normaliseTelegramHandle,
} from "@/lib/identity/registry"
import { companyMatchKey } from "@/lib/translit-ru"

export type OwnOrgIdentitySets = {
  /** Company match keys of the org name + registry `name` entries. */
  nameKeys: string[]
  /** The same names as entered (org name first). */
  nameLabels: string[]
  /**
   * `nameKeys` + for every own domain its second-level label and the full
   * domain as company keys («globex-group», «globex-groupcom») — the forms the
   * parser LLM emits as a «company».
   */
  companyKeys: string[]
  /**
   * Own domains: `organization.web_url` host + registry `website` +
   * `email_domain` entries + the `organization.email` domain — every one
   * free-mail guarded. Member sign-in domains never become own domains.
   */
  ownDomains: string[]
  /** Website hosts only: `web_url` + registry `website` (attribution rule 4). */
  webDomains: string[]
  /** Shared mailboxes (registry `mailbox`), exact lower-case addresses. */
  mailboxes: string[]
  /**
   * Members' sign-in emails that count as «us» (humans only — never «Агент»).
   * Rule (2026-11-14, product owner): an org WITH own domains counts only the
   * members whose sign-in email is on an own domain (a test user
   * `boris@truffalo.ai` or a private gmail is NOT «us» automatically — the
   * member adds a work address in «Мои адреса для работы» if needed). An org
   * with «Нет своего домена» (or no domain at all) counts every member.
   */
  memberEmails: string[]
  /** Members' sign-in emails that do NOT count as «us» (for the profile tab hint). */
  excludedMemberEmails: string[]
  /** Staff extra emails (registry `person`, channel email). */
  staffEmails: string[]
  /** Staff Telegram handles, no «@», lower-case. */
  staffTelegram: string[]
  /** Staff phones, digits only (RU 8… → 7…). */
  staffPhones: string[]
  /** Address match keys: `organization.address` + registry `address`. */
  addressKeys: string[]
  /** The same addresses as entered. */
  addressLabels: string[]
}

export type OwnOrgRawInput = {
  org: {
    name: string | null
    webUrl: string | null
    email: string | null
    address: string | null
  } | null
  /** member → user rows; `role` = the platform `user.role` («agent» = skipped). */
  members: { email: string | null; role: string | null }[]
  /** `org_profile.no_own_domain` — every member's sign-in email counts as «us». */
  noOwnDomain?: boolean
  registry: { kind: string; matchKey: string | null; label: string; channel: string | null }[]
}

/** The label immediately before the TLD: "globex-group.example" → "globex-group". */
function secondLevelLabel(domain: string): string {
  const parts = domain.split(".").filter(Boolean)
  if (parts.length < 2) return ""
  return parts[parts.length - 2]
}

/** Guess the channel of a legacy / channel-less `person` value. */
function personChannel(channel: string | null, value: string): "email" | "telegram" | "phone" | null {
  if (channel === "email" || channel === "telegram" || channel === "phone") return channel
  const v = value.trim()
  if (normaliseEmailAddress(v)) return "email"
  if (/^@|t(?:elegram)?\.me\//i.test(v)) return "telegram"
  if (normalisePhone(v)) return "phone"
  return null
}

/** PURE. Identity sets from the raw rows (spec §3.5). Deterministic order. */
export function buildOwnOrgIdentitySets(input: OwnOrgRawInput): OwnOrgIdentitySets {
  const nameKeys = new Set<string>()
  const nameLabels: string[] = []
  const ownDomains = new Set<string>()
  const webDomains = new Set<string>()
  const mailboxes = new Set<string>()
  const memberEmails = new Set<string>()
  const excludedMemberEmails = new Set<string>()
  const staffEmails = new Set<string>()
  const staffTelegram = new Set<string>()
  const staffPhones = new Set<string>()
  const addressKeys = new Set<string>()
  const addressLabels: string[] = []

  const addDomain = (d: string, web: boolean) => {
    if (!d || isFreemailDomain(d)) return
    ownDomains.add(d)
    if (web) webDomains.add(d)
  }
  const addAddress = (key: string, label: string) => {
    if (!key || addressKeys.has(key)) return
    addressKeys.add(key)
    addressLabels.push(label)
  }

  const org = input.org
  if (org) {
    const name = (org.name ?? "").trim()
    const key = companyMatchKey(name)
    if (key) {
      nameKeys.add(key)
      nameLabels.push(name)
    }
    if (org.webUrl) addDomain(extractWebsiteDomain(org.webUrl), true)
    if (org.email) addDomain(extractEmailDomain(org.email.trim().toLowerCase()), false)
    if (org.address) addAddress(addressMatchKey(org.address), org.address.trim())
  }

  for (const r of input.registry) {
    const raw = (r.matchKey ?? "").trim()
    switch (r.kind) {
      case "name": {
        const key = raw || companyMatchKey(r.label)
        if (key && !nameKeys.has(key)) {
          nameKeys.add(key)
          nameLabels.push(r.label.trim())
        }
        break
      }
      case "website":
        addDomain(raw || extractWebsiteDomain(r.label), true)
        break
      case "email_domain":
        addDomain(normaliseMailDomain(raw || r.label), false)
        break
      case "address":
        addAddress(raw || addressMatchKey(r.label), r.label.trim())
        break
      case "mailbox": {
        const e = normaliseEmailAddress(raw || r.label)
        if (e) mailboxes.add(e)
        break
      }
      case "person": {
        const value = raw || r.label
        const ch = personChannel(r.channel, value)
        if (ch === "email") {
          const e = normaliseEmailAddress(value)
          if (e) staffEmails.add(e)
        } else if (ch === "telegram") {
          const h = normaliseTelegramHandle(value)
          if (h) staffTelegram.add(h)
        } else if (ch === "phone") {
          const p = normalisePhone(value)
          if (p) staffPhones.add(p)
        }
        break
      }
    }
  }

  const allMembersCount = !!input.noOwnDomain || ownDomains.size === 0
  const ownDomainList = [...ownDomains]
  for (const m of input.members) {
    if (m.role === "agent") continue
    const e = normaliseEmailAddress(m.email ?? "")
    if (!e) continue
    if (allMembersCount || domainInSet(extractEmailDomain(e), ownDomainList)) memberEmails.add(e)
    else excludedMemberEmails.add(e)
  }

  const companyKeys = new Set(nameKeys)
  for (const d of ownDomains) {
    const labelKey = companyMatchKey(secondLevelLabel(d))
    if (labelKey) companyKeys.add(labelKey)
    const fullKey = companyMatchKey(d)
    if (fullKey) companyKeys.add(fullKey)
  }

  const sorted = (s: Set<string>) => [...s].sort()
  return {
    nameKeys: [...nameKeys],
    nameLabels,
    companyKeys: sorted(companyKeys),
    ownDomains: sorted(ownDomains),
    webDomains: sorted(webDomains),
    mailboxes: sorted(mailboxes),
    memberEmails: sorted(memberEmails),
    excludedMemberEmails: sorted(excludedMemberEmails),
    staffEmails: sorted(staffEmails),
    staffTelegram: sorted(staffTelegram),
    staffPhones: sorted(staffPhones),
    addressKeys: [...addressKeys],
    addressLabels,
  }
}

// ── Matchers ─────────────────────────────────────────────────────────────

/** True when `domain` equals or is a subdomain of one of `owned`. */
export function domainInSet(domain: string, owned: readonly string[]): boolean {
  if (!domain) return false
  for (const own of owned) if (domain === own || domainMatches(domain, own)) return true
  return false
}

export type OwnAddressMatch =
  | "member_email"
  | "staff_address"
  | "mailbox"
  | "own_domain"
  | null

/**
 * Is this email address «us»? Exact sets first (counted members, staff extra
 * addresses, shared mailboxes — any domain, also free-mail), then the owned
 * domains (never a free-mail domain). Members' other domains never count.
 */
export function matchOwnEmail(
  sets: Pick<OwnOrgIdentitySets, "memberEmails" | "staffEmails" | "mailboxes" | "ownDomains">,
  email: string,
): OwnAddressMatch {
  const e = (email ?? "").trim().toLowerCase()
  if (!e || !e.includes("@")) return null
  if (sets.memberEmails.includes(e)) return "member_email"
  if (sets.staffEmails.includes(e)) return "staff_address"
  if (sets.mailboxes.includes(e)) return "mailbox"
  const d = extractEmailDomain(e)
  if (!d || isFreemailDomain(d)) return null
  if (domainInSet(d, sets.ownDomains)) return "own_domain"
  return null
}

/** Telegram handle (with or without «@») ∈ staff handles. */
export function isStaffTelegram(sets: Pick<OwnOrgIdentitySets, "staffTelegram">, handle: string | null | undefined): boolean {
  const h = (handle ?? "").trim().replace(/^@/, "").toLowerCase()
  return !!h && sets.staffTelegram.includes(h)
}

// ── Internal mail (decision Q9) ───────────────────────────────────────────

function addressList(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const p of v) {
    const raw =
      typeof p === "string" ? p : p && typeof p === "object" ? (p as Record<string, unknown>).email : null
    if (typeof raw !== "string") return null
    // "Name <a@b>" or a bare address.
    const m = raw.match(/<([^>]+)>/)
    const e = (m ? m[1] : raw).trim().toLowerCase()
    if (!e.includes("@")) return null
    out.push(e)
  }
  return out
}

/**
 * PURE. Deterministic fact «internal mail» (spec §3.6, Q9): the author is
 * ours AND every recipient (to / cc / bcc) is ours. Mail-shaped metadata only
 * (`from` + recipient lists); no recipients, an unreadable address, or any
 * non-mail item (chat, document, Telegram) → false, and the model decides the
 * direction as before.
 */
export function computeAllInternal(
  metadataJson: unknown,
  isOwn: (email: string) => boolean,
): boolean {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const from = addressList(m.from)
  if (!from || from.length === 0) return false
  const recipients: string[] = []
  for (const key of ["to", "cc", "bcc"] as const) {
    const list = addressList(m[key])
    if (!list) return false
    recipients.push(...list)
  }
  if (recipients.length === 0) return false
  return from.every(isOwn) && recipients.every(isOwn)
}

// Own-organisation identity registry (`org_identity_entry`) — PURE,
// client-safe normalisation per kind (identity spec I1, §3.1 A). Shared by the
// server (src/server/org-identity-registry.ts), the «Профиль организации» tab,
// «Мои адреса для работы» on /profile and the unit tests. No DB.
//
// Kinds:
//   name          → companyMatchKey («ООО Норлекс» ≡ «Norleks»)
//   website       → bare host (URL or host); free-mail hosts refused
//   email_domain  → bare mail domain («@norleks.example», «norleks.example», «x@norleks.example»); free-mail refused
//   address       → addressMatchKey, ≥ 2 alphabetic tokens
//   mailbox       → exact lower-case email address (any domain, also free-mail)
//   person        → a staff member's extra address, by channel:
//                     email    → lower-case address
//                     telegram → handle without «@», lower-case (5–32 chars, [a-z0-9_])
//                     phone    → digits only (RU «8XXXXXXXXXX» → «7XXXXXXXXXX»)

import { addressMatchKey } from "@/lib/address-match"
import { extractWebsiteDomain, isAnyFreemailDomain } from "@/lib/email-domain"
import { companyMatchKey } from "@/lib/translit-ru"
import { PERSON_CHANNELS, type PersonChannel } from "@/lib/identity/org-profile"

export const IDENTITY_KINDS = [
  "name",
  "website",
  "address",
  "email_domain",
  "mailbox",
  "person",
] as const
export type IdentityKind = (typeof IDENTITY_KINDS)[number]

/** Kinds that describe the org itself (owner only). `person` is per member. */
export const ORG_LEVEL_IDENTITY_KINDS = [
  "name",
  "website",
  "email_domain",
  "mailbox",
  "address",
] as const satisfies readonly IdentityKind[]

export function isIdentityKind(v: unknown): v is IdentityKind {
  return typeof v === "string" && (IDENTITY_KINDS as readonly string[]).includes(v)
}

export function isPersonChannel(v: unknown): v is PersonChannel {
  return typeof v === "string" && (PERSON_CHANNELS as readonly string[]).includes(v)
}

export const IDENTITY_KIND_LABELS_RU: Record<IdentityKind, string> = {
  name: "Название",
  website: "Сайт",
  address: "Адрес",
  email_domain: "Почтовый домен",
  mailbox: "Общий ящик",
  person: "Адрес сотрудника",
}

export type NormalisedIdentity =
  | { ok: true; matchKey: string; label: string; channel: PersonChannel | null }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Letters (any script: «сайт.рф»), digits, hyphen; ≥ 2 labels.
const DOMAIN_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u

const FREEMAIL_ERROR =
  "Это общий почтовый сервис — он не может быть доменом организации. Отметьте «Нет своего домена» и добавьте адреса сотрудников."

function fail(error: string): NormalisedIdentity {
  return { ok: false, error }
}

/** Lower-case exact address, or "" when it is not a valid email. */
export function normaliseEmailAddress(raw: string): string {
  const v = (raw ?? "").trim().replace(/^mailto:/i, "").toLowerCase()
  return EMAIL_RE.test(v) ? v : ""
}

/** Mail domain from «@norleks.example», «norleks.example», «x@norleks.example», «https://norleks.example». "" when not a domain. */
export function normaliseMailDomain(raw: string): string {
  let v = (raw ?? "").trim().toLowerCase()
  const at = v.lastIndexOf("@")
  if (at >= 0) v = v.slice(at + 1)
  const host = extractWebsiteDomain(v)
  return DOMAIN_RE.test(host) ? host : ""
}

/** Telegram handle key (no «@», lower-case) from «@Name», «name», «t.me/name». "" when invalid. */
export function normaliseTelegramHandle(raw: string): string {
  const key = telegramHandleAsTyped(raw).toLowerCase()
  return /^[a-z][a-z0-9_]{4,31}$/.test(key) ? key : ""
}

function telegramHandleAsTyped(raw: string): string {
  return (raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
}

/** Phone key: digits only; an 11-digit RU number starting with 8 → 7. "" when not 7–15 digits. */
export function normalisePhone(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1)
  return d.length >= 7 && d.length <= 15 ? d : ""
}

/**
 * Canonical form of a registry value. `label` is the value as typed (for
 * display; Telegram gets a leading «@»), `matchKey` is what the matchers
 * compare and the unique index dedups on.
 */
export function normaliseIdentityInput(
  kind: IdentityKind,
  raw: string,
  channel?: string | null,
): NormalisedIdentity {
  const label = (raw ?? "").trim()
  if (!label) return fail("Укажите значение")

  switch (kind) {
    case "name": {
      const key = companyMatchKey(label)
      return key ? { ok: true, matchKey: key, label, channel: null } : fail("Некорректное название")
    }
    case "website": {
      const host = extractWebsiteDomain(label)
      if (!host || !DOMAIN_RE.test(host)) return fail("Некорректный адрес сайта")
      if (isAnyFreemailDomain(host)) return fail(FREEMAIL_ERROR)
      return { ok: true, matchKey: host, label, channel: null }
    }
    case "email_domain": {
      const host = normaliseMailDomain(label)
      if (!host) return fail("Некорректный почтовый домен — например, norleks-inter.example")
      if (isAnyFreemailDomain(host)) return fail(FREEMAIL_ERROR)
      return { ok: true, matchKey: host, label: host, channel: null }
    }
    case "address": {
      const key = addressMatchKey(label)
      // A key with fewer than two alphabetic tokens can never match any
      // document (the matcher's floor) — storing it would be a silent no-op.
      const alphaTokens = (key ?? "").split(" ").filter((t) => t && !/^\d/.test(t))
      if (!key || alphaTokens.length < 2) {
        return fail("Адрес слишком короткий — укажите город и улицу")
      }
      return { ok: true, matchKey: key, label, channel: null }
    }
    case "mailbox": {
      const email = normaliseEmailAddress(label)
      return email
        ? { ok: true, matchKey: email, label: email, channel: null }
        : fail("Некорректный email — например, sales@norleks-inter.example")
    }
    case "person": {
      if (!isPersonChannel(channel)) return fail("Укажите тип адреса: email, Telegram или телефон")
      if (channel === "email") {
        const email = normaliseEmailAddress(label)
        return email
          ? { ok: true, matchKey: email, label: email, channel }
          : fail("Некорректный email")
      }
      if (channel === "telegram") {
        const h = normaliseTelegramHandle(label)
        return h
          ? { ok: true, matchKey: h, label: "@" + telegramHandleAsTyped(label), channel }
          : fail("Некорректный Telegram — укажите @имя (5–32 символа: латиница, цифры, «_»)")
      }
      const phone = normalisePhone(label)
      return phone
        ? { ok: true, matchKey: phone, label, channel }
        : fail("Некорректный телефон — от 7 до 15 цифр")
    }
  }
}

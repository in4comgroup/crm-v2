// Sender classification: automated senders, free-mail domains.

import { isFreemailDomain as baseIsFreemailDomain } from "@/lib/email-domain"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import { extractEmailAddress, getHeader } from "./common"

const AUTOMATED_TOKENS = new Set([
  "noreply", "noreplay", "donotreply", "mailer", "daemon", "postmaster",
  "bounce", "bounces", "notification", "notifications", "notify",
  "automated", "autoreply", "autoresponder", "robot", "newsletter", "newsletters",
  "news", "digest", "rassylka",
])
const COMPACT_MARKERS = ["noreply", "noreplay", "donotreply", "mailerdaemon"]

function localPartAutomated(local: string): boolean {
  const tokens = local.toLowerCase().split(/[.\-_+\d]+/).filter(Boolean)
  if (tokens.some((t) => AUTOMATED_TOKENS.has(t))) return true
  const compact = tokens.join("")
  return COMPACT_MARKERS.some((m) => compact.includes(m))
}

export function isAutomatedSender(input: {
  email?: string | null
  name?: string | null
  headers?: Record<string, string> | null
}): boolean {
  const h = input.headers
  const autoSubmitted = getHeader(h, "auto-submitted")
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== "no") return true
  const precedence = getHeader(h, "precedence")
  if (getHeader(h, "list-unsubscribe") !== null && precedence && /bulk|list|junk/i.test(precedence)) return true
  const suppress = getHeader(h, "x-auto-response-suppress")
  if (suppress && /\ball\b/i.test(suppress)) return true

  const addr = extractEmailAddress(input.email)
  if (addr) {
    if (isAutomatedEmail(addr)) return true
    if (localPartAutomated(addr.split("@")[0])) return true
  }
  if (input.name && /no[-\s]?reply|do not reply|mailer[-\s]daemon|не отвечайте|автоматическая рассылка/i.test(input.name)) return true
  return false
}

const EXTRA_FREEMAIL = new Set([
  "rambler.ru", "lenta.ru", "autorambler.ru", "myrambler.ru", "ro.ru",
  "bk.ru", "list.ru", "inbox.ru", "internet.ru", "mail.ua", "ukr.net",
  "ya.ru", "yandex.by", "yandex.kz", "yandex.ua", "yandex.uz", "yandex.com.tr",
])

/** Free-mail check: @/lib/email-domain's list plus RU/CIS providers. */
export function isFreemailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^@/, "")
  return EXTRA_FREEMAIL.has(d) || baseIsFreemailDomain(d)
}

// Bounce (DSN / non-delivery report) detection.

import { extractEmailAddress, getHeader, type MailProbe } from "./common"

const BOUNCE_SUBJECT_RES: RegExp[] = [
  /недоставленн[а-яё]*\s+сообщени/i,
  /не\s+удалось\s+доставить/i,
  /ошибка\s+доставки/i,
  /сообщение\s+не\s+доставлено/i,
  /возвращ[её]нн[а-яё]*\s+(?:письмо|сообщение)/i,
  /\bundeliverable\b/i,
  /delivery status notification/i,
  /mail delivery (?:failed|subsystem)/i,
  /\breturned mail\b/i,
  /delivery has failed/i,
  /undelivered mail returned to sender/i,
  /failure notice/i,
]

const DAEMON_LOCAL_RE = /^(?:mailer[-_.]?daemon|postmaster|mail[-_.]?delivery[-_.]?subsystem)(?:[-_.+].*)?$/i

function isDaemonSender(from: string | null | undefined): boolean {
  if (!from) return false
  const addr = extractEmailAddress(from)
  if (addr && DAEMON_LOCAL_RE.test(addr.split("@")[0])) return true
  return /mailer[-\s]daemon|mail delivery subsystem|почтовая система|postmaster/i.test(from)
}

const MSGID_RE = /<[^<>\s]+@[^<>\s]+>/g
const ID_LINE_RE = /^\s*(?:original-message-id|message-id|in-reply-to|references)\s*:\s*(.*)$/i

export function detectBounce(p: MailProbe): { isBounce: boolean; bouncedMessageIds: string[]; reason: string | null } {
  const ct = getHeader(p.headers, "content-type") ?? ""
  const dsnHeader = /multipart\/report/i.test(ct) && /report-type\s*=\s*"?delivery-status/i.test(ct)
  const subjectHit = !!p.subject && BOUNCE_SUBJECT_RES.some((re) => re.test(p.subject!))
  const isBounce = dsnHeader || subjectHit || isDaemonSender(p.from)
  if (!isBounce) return { isBounce: false, bouncedMessageIds: [], reason: null }

  const ids = new Set<string>()
  const addIds = (s: string | null) => {
    for (const m of s?.match(MSGID_RE) ?? []) ids.add(m)
  }
  addIds(getHeader(p.headers, "original-message-id"))
  addIds(getHeader(p.headers, "in-reply-to"))
  addIds(getHeader(p.headers, "references"))
  const lines = p.body.replace(/\r\n?/g, "\n").split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = ID_LINE_RE.exec(lines[i])
    if (!m) continue
    let rest = m[1]
    // References may be folded onto continuation lines.
    while (i + 1 < lines.length && /^\s+<[^<>\s]+@/.test(lines[i + 1])) rest += " " + lines[++i]
    addIds(rest)
  }

  let reason: string | null = null
  const diag = /diagnostic-code\s*:\s*[^;\n]*;\s*([^\n]{3,150})/i.exec(p.body)
  const status = /\b([45]\d\d)[ -]([45]\.\d{1,3}\.\d{1,3})\b([^\n]{0,100})/.exec(p.body)
  if (status) reason = `${status[1]} ${status[2]}${status[3]}`.trim().replace(/[\s.]+$/, "")
  else if (diag) reason = diag[1].trim()
  else {
    const ru = /(?:причина|reason)\s*:\s*([^\n]{3,150})/i.exec(p.body)
    if (ru) reason = ru[1].trim()
    else {
      const s = /\bstatus\s*:\s*([45]\.\d{1,3}\.\d{1,3})/i.exec(p.body)
      if (s) reason = s[1]
    }
  }
  return { isBounce: true, bouncedMessageIds: [...ids], reason }
}

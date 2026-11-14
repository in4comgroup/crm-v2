// Out-of-office auto-reply and calendar-reply detection.

import {
  EN_MONTHS,
  RU_MONTHS_GENITIVE,
  getHeader,
  resolveDayMonth,
  type MailProbe,
} from "./common"
import { splitQuotedHistory, stripReplyPrefixes } from "./quotes"

const SUBJECT_RES: RegExp[] = [
  /автоответ/i,
  /автоматическ[а-яё]+\s+ответ/i,
  /нет на месте/i,
  /out of (?:the )?office/i,
  /automatic reply/i,
  /auto-?reply/i,
  /auto-?response/i,
]

const BODY_CUE_RES: RegExp[] = [
  /в\s+отпуске/i,
  /нахожусь\s+в\s+отпуске/i,
  /на\s+больничном/i,
  /в\s+командировке/i,
  /вернусь/i,
  /буду\s+на\s+связи\s+с/i,
  /по\s+срочным\s+вопросам\s+обращайтесь\s+к/i,
  /нет\s+в\s+офисе/i,
  /out\s+of\s+the\s+office/i,
  /out\s+of\s+office/i,
  /i\s+am\s+away/i,
  /i['’]m\s+away/i,
  /will\s+be\s+back/i,
  /on\s+leave\s+until/i,
]

const SHORT_BODY_MAX = 600
const RU_MONTH_ALT = Object.keys(RU_MONTHS_GENITIVE).join("|")
const EN_MONTH_ALT = Object.keys(EN_MONTHS).sort((a, b) => b.length - a.length).join("|")
const RU_LEAD = String.raw`(?:до|по|вернусь|вернемся|вернёмся|выйду|буду\s+на\s+связи\s+с|буду\s+в\s+офисе\s+с|буду\s+с)(?:\s+на\s+работу)?`
const EN_LEAD = String.raw`(?:until|till|back\s+on|back\s+by|returning\s+on|return\s+on|will\s+be\s+back\s+on|on\s+leave\s+until)`

function parseReturnDate(text: string, baseIso: string | null | undefined): string | null {
  let m = new RegExp(String.raw`(?<![\p{L}])${RU_LEAD}\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)`, "iu").exec(text)
  if (m) return resolveDayMonth(+m[1], +m[2], m[3] ? +m[3] : null, baseIso)
  m = new RegExp(String.raw`(?<![\p{L}])${RU_LEAD}\s+(\d{1,2})\s+(${RU_MONTH_ALT})(?:\s+(\d{4}))?`, "iu").exec(text)
  if (m) return resolveDayMonth(+m[1], RU_MONTHS_GENITIVE[m[2].toLowerCase()], m[3] ? +m[3] : null, baseIso)
  m = new RegExp(String.raw`${EN_LEAD}\s+(${EN_MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, "i").exec(text)
  if (m) return resolveDayMonth(+m[2], EN_MONTHS[m[1].toLowerCase()], m[3] ? +m[3] : null, baseIso)
  m = new RegExp(String.raw`${EN_LEAD}\s+(\d{1,2})(?:st|nd|rd|th)?\s+(${EN_MONTH_ALT})\.?(?:,?\s+(\d{4}))?`, "i").exec(text)
  if (m) return resolveDayMonth(+m[1], EN_MONTHS[m[2].toLowerCase()], m[3] ? +m[3] : null, baseIso)
  m = new RegExp(String.raw`${EN_LEAD}\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?`, "i").exec(text)
  if (m) return resolveDayMonth(+m[1], +m[2], m[3] ? +m[3] : null, baseIso)
  return null
}

function parseDeputy(text: string): string | null {
  const tries = [
    /обращайтесь\s+к\s+(.+)/i,
    /по\s+срочным\s+вопросам\s*[:,\-–—]?\s*(?!обращайтесь)(\S.+)/i,
    /please\s+contact\s+(.+)/i,
  ]
  for (const re of tries) {
    const m = re.exec(text)
    if (!m) continue
    let v = m[1].split("\n")[0]
    v = v.split(/\.\s+(?=[A-ZА-ЯЁ])/)[0].trim().replace(/[.;,\s]+$/, "")
    if (v.length > 120) v = v.slice(0, 120).trim()
    if (v.length >= 2) return v
  }
  return null
}

export function detectOutOfOffice(p: MailProbe): {
  isOoo: boolean
  returnDate: string | null
  deputy: string | null
  evidence: string | null
} {
  const none = { isOoo: false, returnDate: null, deputy: null, evidence: null }
  const own = splitQuotedHistory(p.body).own || p.body
  const lines = own.replace(/\r\n?/g, "\n").split("\n")
  const lineWith = (res: RegExp[]) => {
    for (const line of lines) if (res.some((re) => re.test(line))) return line.trim()
    return null
  }

  let evidence: string | null = null
  const autoSubmitted = getHeader(p.headers, "auto-submitted")
  const precedence = getHeader(p.headers, "precedence")
  if (autoSubmitted && /auto-replied/i.test(autoSubmitted)) evidence = `Auto-Submitted: ${autoSubmitted}`
  else if (getHeader(p.headers, "x-autoreply") !== null) evidence = "X-Autoreply"
  else if (getHeader(p.headers, "x-autorespond") !== null) evidence = "X-Autorespond"
  else if (precedence && /auto_?reply/i.test(precedence)) evidence = `Precedence: ${precedence}`

  const subjectHit = !!p.subject && SUBJECT_RES.some((re) => re.test(p.subject!))
  const bodyHit = own.length < SHORT_BODY_MAX && lineWith(BODY_CUE_RES) !== null
  if (!evidence && !subjectHit && !bodyHit) return none

  // Prefer a verbatim body sentence as evidence; fall back to subject/header.
  evidence = lineWith(BODY_CUE_RES) ?? (subjectHit ? p.subject!.trim() : evidence)
  const text = `${p.subject ?? ""}\n${own}`
  return { isOoo: true, returnDate: parseReturnDate(text, p.date), deputy: parseDeputy(own), evidence }
}

const CAL_RE =
  /^\s*(предварительно принято|принято|отклонено|под вопросом|tentatively accepted|accepted|declined|tentative)\s*:\s*(.*)$/i

export function detectCalendarReply(p: MailProbe): {
  isReply: boolean
  response: "accepted" | "declined" | "tentative" | null
  meetingTitle: string | null
} {
  const none = { isReply: false, response: null, meetingTitle: null } as const
  if (!p.subject) return none
  const m = CAL_RE.exec(stripReplyPrefixes(p.subject))
  if (!m) return none
  const k = m[1].toLowerCase()
  const response = k === "принято" || k === "accepted" ? "accepted" : k === "отклонено" || k === "declined" ? "declined" : "tentative"
  return { isReply: true, response, meetingTitle: m[2].trim() || null }
}

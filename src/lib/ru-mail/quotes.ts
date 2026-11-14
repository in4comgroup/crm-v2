// Quoted-history splitting, forward detection, reply-prefix stripping.

const PREFIX_RE = /^\s*(?:re|fwd?|fw|aw|wg|отв|ответ|пересл|переслано)(?:\s*[[(]\d+[\])])?\s*:\s*/i

/** Remove Re:/Отв:/Fwd:/Пересл: chains, e.g. "Re: Fwd: Re[2]: Price" → "Price". */
export function stripReplyPrefixes(subject: string): string {
  let s = subject
  for (let i = 0; i < 20; i++) {
    const next = s.replace(PREFIX_RE, "")
    if (next === s) break
    s = next
  }
  return s.trim()
}

const HEADER_KEY = String.raw`(?:От кого|От|From|Отправлено|Дата|Date|Sent|Кому|To|Тема|Subject|Cc|Копия|Bcc)`
const HEADER_LINE_RE = new RegExp(String.raw`^[\s>*]*(?:\*\*)?(${HEADER_KEY})(?:\*\*)?\s*:\s*(.*)$`, "i")
const FROM_KEY_RE = /^(?:от кого|от|from)$/i
const FOLLOW_KEY_RE = /^(?:отправлено|sent|date|дата|кому|to|тема|subject|cc|копия)$/i

// "-----Исходное сообщение-----", "-------- Пересылаемое сообщение --------", "-----Original Message-----"
const BANNER_RE =
  /^\s*[-_=*]{2,}\s*(?:исходное сообщение|пересылаемое сообщение|пересланное сообщение|переслано|original message|forwarded message|forwarded|begin forwarded message)[^\n]*$/i
const APPLE_FWD_RE = /^\s*begin forwarded message\s*:?\s*$/i
const FORWARD_WORDS_RE = /пересылаем|пересланн|переслано|forwarded/i

function isHeaderStart(lines: string[], i: number): boolean {
  const m = HEADER_LINE_RE.exec(lines[i])
  if (!m || !FROM_KEY_RE.test(m[1]) || !m[2].trim()) return false
  for (let j = i + 1; j <= i + 6 && j < lines.length; j++) {
    const n = HEADER_LINE_RE.exec(lines[j])
    if (n && FOLLOW_KEY_RE.test(n[1])) return true
  }
  return false
}

function isAttributionLine(lines: string[], i: number): boolean {
  const line = lines[i].trim()
  if (!line || line.length > 300) return false
  if (/^On\s.{0,250}wrote:\s*$/i.test(line)) return true
  if (/wrote:\s*$/i.test(line) && i > 0 && /^On\s/i.test(lines[i - 1].trim())) return true
  if (/(?:пишет|написал(?:а|\(а\))?)\s*:\s*$/i.test(line)) return true
  // Yandex: «14.11.2026, 10:00, Иван <a@b.ru>:»
  if (/^\d{1,2}\.\d{2}\.\d{4},\s*\d{1,2}:\d{2},.*:\s*$/.test(line)) return true
  // Mail.ru: «Пятница, 14 ноября 2026, 10:00 +03:00 от Иван <a@b.ru>:»
  if (/\d{4}.{0,40}\s(?:от|from)\s.*<[^>]+@[^>]+>\s*:\s*$/i.test(line)) return true
  return false
}

/** Index of the first line that starts quoted history, or -1. */
function firstQuoteIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*>/.test(line)) return i
    if (BANNER_RE.test(line) || APPLE_FWD_RE.test(line)) return i
    if (isHeaderStart(lines, i)) return i
    if (isAttributionLine(lines, i)) {
      // Gmail wraps "On ... <a@b>\nwrote:" — the attribution begins on the previous line.
      if (i > 0 && /wrote:\s*$/i.test(lines[i]) && !/^\s*On\s/i.test(lines[i]) && /^\s*On\s/i.test(lines[i - 1])) return i - 1
      return i
    }
  }
  return -1
}

/** Own text = everything before the first quote marker. */
export function splitQuotedHistory(text: string): { own: string; quoted: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const idx = firstQuoteIndex(lines)
  if (idx < 0) return { own: text.trim(), quoted: "" }
  const own = lines.slice(0, idx).join("\n").replace(/\s*(?:--|__)\s*$/, "").trim()
  return { own, quoted: lines.slice(idx).join("\n").trim() }
}

export function detectForward(
  text: string,
  subject?: string | null,
): { isForward: boolean; originalFrom: string | null; originalDate: string | null; originalSubject: string | null } {
  const none: ReturnType<typeof detectForward> = { isForward: false, originalFrom: null, originalDate: null, originalSubject: null }
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const subjectFwd = !!subject && /^\s*(?:(?:re|отв|ответ)\s*(?:\[\d+\])?\s*:\s*)*(?:fwd?|пересл|переслано)\s*(?:\[\d+\])?\s*:/i.test(subject)

  let bannerAt = -1
  for (let i = 0; i < lines.length; i++) {
    if ((BANNER_RE.test(lines[i]) || APPLE_FWD_RE.test(lines[i])) && FORWARD_WORDS_RE.test(lines[i])) {
      bannerAt = i
      break
    }
  }
  let headerAt = -1
  const from = bannerAt >= 0 ? bannerAt : 0
  for (let i = from; i < lines.length; i++) {
    if (isHeaderStart(lines, i)) {
      headerAt = i
      break
    }
  }
  // A header block only counts as forward when a forward banner or Fwd: subject backs it up.
  const isForward = bannerAt >= 0 || (subjectFwd && headerAt >= 0)
  if (!isForward) return none
  const start = headerAt >= 0 ? headerAt : bannerAt
  const out = { ...none, isForward: true }
  // Yandex style: «07.11.2026, 10:00, "Name" <a@b.ru>:» right after the banner has no From: line.
  const window = lines.slice(start, start + 12)
  for (const line of window) {
    const m = HEADER_LINE_RE.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].replace(/\*\*/g, "").trim()
    if (!val) continue
    if (FROM_KEY_RE.test(key) && out.originalFrom === null) out.originalFrom = val
    else if (/^(?:date|дата|sent|отправлено)$/.test(key) && out.originalDate === null) out.originalDate = val
    else if (/^(?:subject|тема)$/.test(key) && out.originalSubject === null) out.originalSubject = val
  }
  return out
}

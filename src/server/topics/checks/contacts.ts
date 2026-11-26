// PURE logic of the CONTACT checks (topics CRM checks, group `contacts`):
// CONTACT_BIRTHDAY (2026-11-26, tester request «Поднимать карточку со
// срочностью „Сейчас“ в день рождения контакта»). No DB — the loader is
// ./contacts-data.ts.
//
// On the contact's birthday (the ORG time zone's calendar day) → one process
// instance per contact and year (`contact:<id>:birthday:<year>`) → a topic
// «<Компания> — День рождения: <Имя>» (weight 8 = P8 = «Сейчас»). Any open
// instance whose day is not today is cleared («День рождения прошёл»), so
// the topic resolves the next day.

import type { CheckFinding, CheckResult, OpenProcessInstance } from "@/lib/topics/checks"

export const BIRTHDAY_CODE = "CONTACT_BIRTHDAY"

export type BirthdayContact = {
  contactId: string
  /** The shown name (`name_native`, else `name`). */
  name: string
  /** «YYYY-MM-DD» (`contact.birthday`). */
  birthday: string
  clientId: string | null
  clientName: string | null
}

export type BirthdayEnv = {
  /** Today in the org time zone, «YYYY-MM-DD». */
  today: string
  existing: readonly OpenProcessInstance[]
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** PURE. The birthday's date in `year` (29 Feb → 28 Feb in a non-leap year). */
export function birthdayInYear(birthday: string, year: number): string {
  const md = birthday.slice(5, 10)
  if (md === "02-29" && !isLeap(year)) return `${year}-02-28`
  return `${year}-${md}`
}

function yearsWord(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return "год"
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return "года"
  return "лет"
}

/** PURE. Findings for today's birthdays + clears of the instances of other days. */
export function checkContactBirthday(contacts: readonly BirthdayContact[], env: BirthdayEnv): CheckResult {
  const year = Number(env.today.slice(0, 4))
  const findings: CheckFinding[] = []
  const skipped: Record<string, number> = {}
  const todayKeys = new Set<string>()
  for (const c of contacts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.birthday)) {
      skipped.bad_date = (skipped.bad_date ?? 0) + 1
      continue
    }
    if (birthdayInYear(c.birthday, year) !== env.today) continue
    const conditionKey = `contact:${c.contactId}:birthday:${year}`
    todayKeys.add(conditionKey)
    const birthYear = Number(c.birthday.slice(0, 4))
    const age = birthYear >= 1900 && birthYear < year ? year - birthYear : null
    const dm = `${env.today.slice(8, 10)}.${env.today.slice(5, 7)}`
    const ageText = age ? `; исполняется ${age} ${yearsWord(age)}${age % 10 === 0 ? " (юбилей)" : ""}` : ""
    findings.push({
      code: BIRTHDAY_CODE,
      conditionKey,
      topicId: null,
      clientId: c.clientId,
      contactId: c.contactId,
      companyName: c.clientName ?? c.name,
      matterRu: `День рождения: ${c.name}`,
      evidenceRu: `${c.name}: день рождения сегодня (${dm})${ageText}`,
      score: null,
      facts: { date: env.today, age, birthday: c.birthday },
    })
  }
  const clears = env.existing
    .filter((i) => i.code === BIRTHDAY_CODE && i.clearedAt === null && !todayKeys.has(i.conditionKey))
    .map((i) => ({ instanceId: i.id, reasonRu: "День рождения прошёл" }))
  return { findings, clears, evaluated: contacts.length, skipped }
}

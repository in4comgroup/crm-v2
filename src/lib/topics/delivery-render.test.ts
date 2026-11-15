import { describe, expect, it } from "vitest"
import { digestSubject, escapeHtml, formatDeadlineRu, renderDigest, type DigestEntry, type DigestModel } from "./delivery-render"

const entry = (n: number, p: Partial<DigestEntry> = {}): DigestEntry => ({
  topicId: `t${n}`,
  headline: `Тема ${n}`,
  whyNow: `Причина ${n}`,
  company: `Компания ${n}`,
  deadline: null,
  overdue: false,
  link: `https://app.example.com/dashboard?topic=t${n}`,
  ...p,
})

const model = (p: Partial<DigestModel> = {}): DigestModel => ({
  kind: "morning_digest",
  orgName: "Globex",
  userName: "Мария",
  dateLabel: "понедельник, 16 ноября",
  sections: [
    { title: "Сейчас", entries: [entry(1, { deadline: "2026-11-17", note: "Напоминание 1 из 3" })] },
    {
      title: "Сводка",
      entries: [2, 3, 4, 5, 6, 7, 8].map((n) => entry(n)),
      visible: 5,
      moreLink: "https://app.example.com/dashboard?tab=digest",
    },
  ],
  dashboardUrl: "https://app.example.com/dashboard",
  settingsUrl: "https://app.example.com/account?tab=notifications",
  timeZone: "Etc/GMT-3",
  ...p,
})

describe("delivery renderer", () => {
  it("subjects in Russian with plural forms and the test prefix", () => {
    expect(digestSubject("morning_digest", 3)).toBe("Темы на сегодня — 3 в работе")
    expect(digestSubject("weekly_digest", 9)).toBe("Итоги недели по темам")
    expect(digestSubject("evening_reminder", 1)).toBe("Не закрыто сегодня: 1 тема")
    expect(digestSubject("evening_reminder", 2)).toBe("Не закрыто сегодня: 2 темы")
    expect(digestSubject("evening_reminder", 5)).toBe("Не закрыто сегодня: 5 тем")
    expect(digestSubject("evening_reminder", 21)).toBe("Не закрыто сегодня: 21 тема")
    expect(digestSubject("morning_digest", 2, true)).toBe("[Тест] Темы на сегодня — 2 в работе")
  })

  it("morning digest: sections, 5 visible + «Ещё N», links, deadline, note, footer", () => {
    const r = renderDigest(model())
    expect(r.subject).toBe("Темы на сегодня — 8 в работе")
    expect(r.topicCount).toBe(8)
    expect(r.empty).toBe(false)
    expect(r.html).toContain("Доброе утро, Мария!")
    expect(r.html).toContain("Сейчас")
    expect(r.html).toContain("Тема 6")
    expect(r.html).not.toContain("Тема 7<")
    expect(r.html).toContain("Ещё 2 →")
    expect(r.html).toContain('href="https://app.example.com/dashboard?topic=t1"')
    expect(r.html).toContain("срок 17 ноября")
    expect(r.html).toContain("Напоминание 1 из 3")
    expect(r.html).toContain("Почему сейчас:")
    expect(r.html).toContain("Настроить уведомления")
    expect(r.html).toContain("https://app.example.com/account?tab=notifications")
    expect(r.text).toContain("СВОДКА (7)")
    expect(r.text).toContain("Ещё 2: https://app.example.com/dashboard?tab=digest")
    expect(r.text).toContain("Настроить уведомления: https://app.example.com/account?tab=notifications")
    expect(r.text).not.toContain("<")
  })

  it("escapes user text and drops non-http links", () => {
    const r = renderDigest(
      model({
        orgName: 'ООО "Норлекс" <script>',
        userName: "<b>Иван</b>",
        sections: [
          {
            title: "Сейчас",
            entries: [entry(1, { headline: "<img src=x onerror=alert(1)>", company: "A & B", whyNow: "'x'", link: "javascript:alert(1)" })],
          },
        ],
      }),
    )
    expect(r.html).not.toContain("<script>")
    expect(r.html).not.toContain("<img")
    expect(r.html).not.toContain("<b>Иван")
    expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(r.html).toContain("A &amp; B")
    expect(r.html).toContain("&#39;x&#39;")
    expect(r.html).toContain("ООО &quot;Норлекс&quot; &lt;script&gt;")
    expect(r.html).not.toContain("javascript:")
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;")
  })

  it("evening and weekly variants; empty model", () => {
    const ev = renderDigest(model({ kind: "evening_reminder", sections: [{ title: "Не закрыто сегодня", entries: [entry(1), entry(2)] }] }))
    expect(ev.subject).toBe("Не закрыто сегодня: 2 темы")
    expect(ev.html).toContain("Добрый вечер, Мария!")
    const wk = renderDigest(
      model({
        kind: "weekly_digest",
        sections: [
          { title: "Неделя", entries: [entry(1)] },
          { title: "Истекло", entries: [entry(2)] },
          { title: "Тема затихла", entries: [] },
        ],
      }),
    )
    expect(wk.subject).toBe("Итоги недели по темам")
    expect(wk.html).toContain("Истекло")
    expect(wk.html).not.toContain("Тема затихла")
    const empty = renderDigest(model({ sections: [{ title: "Сейчас", entries: [] }] }))
    expect(empty.empty).toBe(true)
  })

  it("deadline format: date only and datetime in the org time zone", () => {
    expect(formatDeadlineRu("2026-11-20", "Etc/GMT-3")).toBe("20 ноября")
    expect(formatDeadlineRu("2026-11-20T07:00:00.000Z", "Etc/GMT-3")).toBe("20 ноября, 10:00")
  })
})

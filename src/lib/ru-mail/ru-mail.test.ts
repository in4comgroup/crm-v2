import { describe, expect, it } from "vitest"
import {
  detectBounce,
  detectCalendarReply,
  detectForward,
  detectOutOfOffice,
  extractEmailAddress,
  isAutomatedSender,
  isFreemailDomain,
  parseMoneyRu,
  splitQuotedHistory,
  stripReplyPrefixes,
} from "./index"

describe("extractEmailAddress", () => {
  it("handles display names and bare addresses", () => {
    expect(extractEmailAddress("Иван Петров <Ivan.Petrov@Acme.RU>")).toBe("ivan.petrov@acme.ru")
    expect(extractEmailAddress("a@b.ru")).toBe("a@b.ru")
    expect(extractEmailAddress('"Doe, John" <john@x.com>')).toBe("john@x.com")
    expect(extractEmailAddress("no address")).toBeNull()
    expect(extractEmailAddress(null)).toBeNull()
  })
})

describe("stripReplyPrefixes", () => {
  it("strips chains", () => {
    expect(stripReplyPrefixes("Re: Fwd: Re[2]: Прайс")).toBe("Прайс")
    expect(stripReplyPrefixes("Отв: Ответ: Пересл: КП")).toBe("КП")
    expect(stripReplyPrefixes("FW: RE: Offer")).toBe("Offer")
    expect(stripReplyPrefixes("Fw: Offer")).toBe("Offer")
  })
  it("keeps real words", () => {
    expect(stripReplyPrefixes("Report: Q3")).toBe("Report: Q3")
    expect(stripReplyPrefixes("Ответственность сторон")).toBe("Ответственность сторон")
  })
})

describe("splitQuotedHistory", () => {
  it("cuts at Outlook header block", () => {
    const t = "Согласен, делаем.\n\nОт: Иван <i@a.ru>\nОтправлено: 12 ноября 2026 г. 10:00\nКому: Пётр\nТема: КП\n\nСтарый текст"
    const r = splitQuotedHistory(t)
    expect(r.own).toBe("Согласен, делаем.")
    expect(r.quoted).toContain("Старый текст")
  })
  it("cuts at Yandex/Mail.ru/Gmail attributions", () => {
    expect(splitQuotedHistory("Ок\n\n12.11.2026, 10:00, Иван <i@a.ru>:\n> привет").own).toBe("Ок")
    expect(splitQuotedHistory("Ок\n\nИван Петров пишет:\n> привет").own).toBe("Ок")
    expect(splitQuotedHistory("Ок\n\nOn Mon, Nov 12, 2026 at 10:00 AM John <j@x.com> wrote:\n> hi").own).toBe("Ок")
    expect(splitQuotedHistory("Ок\n\nOn Mon, Nov 12, 2026 at 10:00 AM John\n<j@x.com> wrote:\n> hi").own).toBe("Ок")
    expect(splitQuotedHistory("Ок\n\nПятница, 14 ноября 2026, 10:00 +03:00 от Иван <i@a.ru>:\nтекст").own).toBe("Ок")
    expect(splitQuotedHistory("Ок\n\nИван написала:\nтекст").own).toBe("Ок")
  })
  it("cuts at banners and > blocks", () => {
    expect(splitQuotedHistory("Да\n-----Исходное сообщение-----\nОт: x").own).toBe("Да")
    expect(splitQuotedHistory("Да\n-----Original Message-----\nFrom: x").own).toBe("Да")
    expect(splitQuotedHistory("Да\n---------- Forwarded message ---------\nFrom: x").own).toBe("Да")
    expect(splitQuotedHistory("Да\n-------- Пересылаемое сообщение --------\nтекст").own).toBe("Да")
    expect(splitQuotedHistory("Да\n> цитата\n> ещё").own).toBe("Да")
  })
  it("does not trigger on prose", () => {
    const t = "Письмо от 15 ноября получили.\nОт: клиента пока ничего нет, ждём.\nСпасибо."
    expect(splitQuotedHistory(t)).toEqual({ own: t, quoted: "" })
    const t2 = "Он написал нам вчера, что всё хорошо."
    expect(splitQuotedHistory(t2).quoted).toBe("")
  })
})

describe("detectForward", () => {
  it("Gmail forward", () => {
    const t = "FYI\n\n---------- Forwarded message ---------\nFrom: Anna <anna@x.com>\nDate: Mon, Nov 10, 2026 at 9:00 AM\nSubject: Quote\nTo: me@y.com\n\nbody\n\nFrom: Other <o@z.com>\nSent: later\n"
    const r = detectForward(t, "Fwd: Quote")
    expect(r).toEqual({
      isForward: true,
      originalFrom: "Anna <anna@x.com>",
      originalDate: "Mon, Nov 10, 2026 at 9:00 AM",
      originalSubject: "Quote",
    })
  })
  it("Yandex/Mail.ru RU forward", () => {
    const t = "Посмотри\n\n-------- Пересылаемое сообщение --------\nОт кого: Иван <ivan@a.ru>\nКому: Пётр\nТема: Счёт\nДата: 07.11.2026, 10:00\n"
    const r = detectForward(t, "Пересл: Счёт")
    expect(r.isForward).toBe(true)
    expect(r.originalFrom).toBe("Иван <ivan@a.ru>")
    expect(r.originalSubject).toBe("Счёт")
    expect(r.originalDate).toBe("07.11.2026, 10:00")
  })
  it("Outlook forward needs Fwd subject", () => {
    const t = "См. ниже\n\nОт: Иван <i@a.ru>\nОтправлено: 7 ноября 2026 г. 10:00\nКому: Пётр\nТема: КП\n"
    expect(detectForward(t, "FW: КП").isForward).toBe(true)
    expect(detectForward(t, "FW: КП").originalFrom).toBe("Иван <i@a.ru>")
    expect(detectForward(t, "Re: КП").isForward).toBe(false)
  })
  it("plain mail is not a forward", () => {
    expect(detectForward("Привет, как дела?", "Встреча").isForward).toBe(false)
  })
})

describe("detectBounce", () => {
  it("Yandex-style RU bounce with ids and reason", () => {
    const r = detectBounce({
      subject: "Недоставленное сообщение",
      from: "MAILER-DAEMON@yandex.ru",
      body: "Не удалось доставить сообщение.\n550 5.1.1 user unknown\n\nMessage-ID: <abc123@mail.acme.ru>\nReferences: <abc123@mail.acme.ru> <zzz@x.ru>\nIn-Reply-To: <abc123@mail.acme.ru>",
    })
    expect(r.isBounce).toBe(true)
    expect(r.bouncedMessageIds).toEqual(["<abc123@mail.acme.ru>", "<zzz@x.ru>"])
    expect(r.reason).toBe("550 5.1.1 user unknown")
  })
  it("Gmail EN bounce", () => {
    const r = detectBounce({
      subject: "Delivery Status Notification (Failure)",
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      body: "Message not delivered\nDiagnostic-Code: smtp; 550 mailbox unavailable\nOriginal-Message-ID: <m1@a.com>",
    })
    expect(r.isBounce).toBe(true)
    expect(r.bouncedMessageIds).toEqual(["<m1@a.com>"])
    expect(r.reason).toBe("550 mailbox unavailable")
  })
  it("subject-only, postmaster and DSN header", () => {
    expect(detectBounce({ subject: "Ошибка доставки", body: "" }).isBounce).toBe(true)
    expect(detectBounce({ subject: "Возвращенное письмо", body: "" }).isBounce).toBe(true)
    expect(detectBounce({ subject: "Undelivered Mail Returned to Sender", body: "" }).isBounce).toBe(true)
    expect(detectBounce({ subject: "x", from: "postmaster@corp.ru", body: "" }).isBounce).toBe(true)
    expect(
      detectBounce({ subject: "x", body: "", headers: { "Content-Type": 'multipart/report; report-type=delivery-status; boundary="b"' } }).isBounce,
    ).toBe(true)
  })
  it("normal mail is not a bounce", () => {
    const r = detectBounce({ subject: "Счёт на оплату", from: "Иван <ivan@acme.ru>", body: "Добрый день, счёт во вложении." })
    expect(r).toEqual({ isBounce: false, bouncedMessageIds: [], reason: null })
  })
})

describe("detectOutOfOffice", () => {
  it("RU auto-reply with date and deputy", () => {
    const r = detectOutOfOffice({
      subject: "Автоответ: Re: КП",
      body: "Здравствуйте! Я в отпуске до 15.11. По срочным вопросам обращайтесь к Ивану Сидорову (sidorov@acme.ru).",
      date: "2026-11-03T10:00:00Z",
    })
    expect(r.isOoo).toBe(true)
    expect(r.returnDate).toBe("2026-11-15")
    expect(r.deputy).toBe("Ивану Сидорову (sidorov@acme.ru)")
    expect(r.evidence).toContain("в отпуске")
  })
  it("genitive month, year rollover, explicit year", () => {
    const base = { subject: "Автоматический ответ", date: "2026-12-20T10:00:00Z" }
    expect(detectOutOfOffice({ ...base, body: "Нет на месте, вернусь 3 января." }).returnDate).toBe("2027-01-03")
    expect(detectOutOfOffice({ ...base, body: "Я в командировке до 15 ноября 2027" }).returnDate).toBe("2027-11-15")
    expect(detectOutOfOffice({ ...base, body: "Я на больничном до 25.12.2026" }).returnDate).toBe("2026-12-25")
    expect(detectOutOfOffice({ ...base, body: "Нахожусь в отпуске, до 20.12 на связи" }).returnDate).toBe("2026-12-20")
  })
  it("no base date, no year => null", () => {
    expect(detectOutOfOffice({ subject: "Автоответ", body: "до 15.11" }).returnDate).toBeNull()
  })
  it("EN auto-reply", () => {
    const r = detectOutOfOffice({
      subject: "Automatic reply: Quote",
      body: "I am out of the office until November 15. Please contact Jane Doe jane@x.com.",
      date: "2026-11-03T10:00:00Z",
    })
    expect(r.isOoo).toBe(true)
    expect(r.returnDate).toBe("2026-11-15")
    expect(r.deputy).toBe("Jane Doe jane@x.com")
    expect(detectOutOfOffice({ subject: "Out of Office", body: "back on 15/11", date: "2026-11-03" }).returnDate).toBe("2026-11-15")
    expect(detectOutOfOffice({ subject: "Out of Office", body: "away until 15/11", date: "2026-11-03" }).returnDate).toBe("2026-11-15")
  })
  it("headers alone are enough", () => {
    expect(detectOutOfOffice({ body: "Thanks", headers: { "Auto-Submitted": "auto-replied" } }).isOoo).toBe(true)
    expect(detectOutOfOffice({ body: "Thanks", headers: { "X-Autoreply": "yes" } }).isOoo).toBe(true)
    expect(detectOutOfOffice({ body: "Thanks", headers: { Precedence: "auto_reply" } }).isOoo).toBe(true)
    expect(detectOutOfOffice({ body: "Thanks", headers: { "Auto-Submitted": "no" } }).isOoo).toBe(false)
  })
  it("short body cue alone counts", () => {
    expect(detectOutOfOffice({ subject: "Re: КП", body: "Я на больничном, отвечу позже." }).isOoo).toBe(true)
  })
  it("long real letter mentioning vacation is not OOO", () => {
    const body =
      "Добрый день, Анна! Направляю обновлённое коммерческое предложение по поставке. " +
      "Условия по срокам согласованы, спецификация приложена. ".repeat(8) +
      "Кстати, в следующем месяце я планирую уйти в отпуск, поэтому давайте закроем вопрос до этого."
    expect(body.length).toBeGreaterThan(600)
    expect(detectOutOfOffice({ subject: "Re: КП", body }).isOoo).toBe(false)
  })
  it("quoted vacation text does not count", () => {
    const body = "Принято, оплатим завтра.\n\nИван пишет:\n> Я в отпуске до 15.11"
    expect(detectOutOfOffice({ subject: "Re: Счёт", body }).isOoo).toBe(false)
  })
})

describe("detectCalendarReply", () => {
  it("RU and EN", () => {
    expect(detectCalendarReply({ subject: "Принято: Встреча по КП", body: "" })).toEqual({ isReply: true, response: "accepted", meetingTitle: "Встреча по КП" })
    expect(detectCalendarReply({ subject: "Отклонено: Планёрка", body: "" }).response).toBe("declined")
    expect(detectCalendarReply({ subject: "Под вопросом: Планёрка", body: "" }).response).toBe("tentative")
    expect(detectCalendarReply({ subject: "Предварительно принято: Звонок", body: "" })).toMatchObject({ response: "tentative", meetingTitle: "Звонок" })
    expect(detectCalendarReply({ subject: "Accepted: Sync @ Mon", body: "" }).response).toBe("accepted")
    expect(detectCalendarReply({ subject: "Declined: Sync", body: "" }).response).toBe("declined")
    expect(detectCalendarReply({ subject: "Tentatively accepted: Sync", body: "" }).response).toBe("tentative")
    expect(detectCalendarReply({ subject: "Tentative: Sync", body: "" }).response).toBe("tentative")
  })
  it("invitations and normal subjects are not replies", () => {
    expect(detectCalendarReply({ subject: "Updated invitation: Sync", body: "" }).isReply).toBe(false)
    expect(detectCalendarReply({ subject: "Приглашение: Встреча", body: "" }).isReply).toBe(false)
    expect(detectCalendarReply({ subject: "Принято решение по КП", body: "" }).isReply).toBe(false)
    expect(detectCalendarReply({ subject: null, body: "" }).isReply).toBe(false)
  })
})

describe("parseMoneyRu", () => {
  it("separators and currencies", () => {
    expect(parseMoneyRu("Итого 1 250 000 руб.")[0]).toMatchObject({ value: 1250000, currency: "RUB" })
    expect(parseMoneyRu("Сумма 1 250 000 ₽")[0].value).toBe(1250000)
    expect(parseMoneyRu("Сумма 1 250 ₽")[0].value).toBe(1250)
    expect(parseMoneyRu("1.250.000 рублей")[0]).toMatchObject({ value: 1250000, currency: "RUB" })
    expect(parseMoneyRu("12 500,50 р.")[0]).toMatchObject({ value: 12500.5, currency: "RUB" })
    expect(parseMoneyRu("Цена 300 RUB")[0].currency).toBe("RUB")
    expect(parseMoneyRu("$1,500")[0]).toMatchObject({ value: 1.5, currency: "USD" }) // US thousands comma is not supported: decimal comma wins
    expect(parseMoneyRu("2 000 USD")[0]).toMatchObject({ value: 2000, currency: "USD" })
    expect(parseMoneyRu("500 долл.")[0].currency).toBe("USD")
    expect(parseMoneyRu("€ 200")[0]).toMatchObject({ value: 200, currency: "EUR" })
    expect(parseMoneyRu("200 евро")[0].currency).toBe("EUR")
    expect(parseMoneyRu("1 000 юаней")[0]).toMatchObject({ value: 1000, currency: "CNY" })
    expect(parseMoneyRu("¥500")[0].currency).toBe("CNY")
  })
  it("multipliers", () => {
    expect(parseMoneyRu("около 500 тыс. руб.")[0]).toMatchObject({ value: 500000, currency: "RUB" })
    expect(parseMoneyRu("5 т.р.")[0]).toMatchObject({ value: 5000, currency: "RUB" })
    expect(parseMoneyRu("2,5 млн руб")[0]).toMatchObject({ value: 2500000, currency: "RUB" })
    expect(parseMoneyRu("1 млрд ₽")[0].value).toBe(1e9)
    expect(parseMoneyRu("бюджет 500к")[0]).toMatchObject({ value: 500000, currency: "" })
    expect(parseMoneyRu("3 млн")[0]).toMatchObject({ value: 3000000, currency: "" })
  })
  it("VAT markers", () => {
    expect(parseMoneyRu("120 000 руб., в т.ч. НДС 20%")[0].vat).toBe("incl")
    expect(parseMoneyRu("120 000 руб. включая НДС")[0].vat).toBe("incl")
    expect(parseMoneyRu("100 000 руб. с НДС")[0].vat).toBe("incl")
    expect(parseMoneyRu("100 000 руб. без НДС")[0].vat).toBe("excl")
    expect(parseMoneyRu("100 000 руб. НДС не облагается")[0].vat).toBe("excl")
    expect(parseMoneyRu("100 000 руб.")[0].vat).toBe("unknown")
  })
  it("order and multiple amounts", () => {
    const r = parseMoneyRu("Позиция А — 10 000 руб., позиция Б — 25 000 руб. без НДС")
    expect(r.map((x) => x.value)).toEqual([10000, 25000])
    expect(r[0].vat).toBe("unknown")
    expect(r[1].vat).toBe("excl")
  })
  it("false positives", () => {
    expect(parseMoneyRu("Цена 12500 за штуку")).toEqual([])
    expect(parseMoneyRu("Встреча 15.11.2026 в 10:30")).toEqual([])
    expect(parseMoneyRu("Нужно 5 кг и 10 км")).toEqual([])
    expect(parseMoneyRu("в 12 к вам приедем")).toEqual([])
    expect(parseMoneyRu("Заказ №4521, 300 штук")).toEqual([])
    expect(parseMoneyRu("к 5 числу")).toEqual([])
  })
})

describe("isAutomatedSender", () => {
  it("token-anywhere on local part", () => {
    for (const e of [
      "noreply@x.ru",
      "info-noreply@x.ru",
      "no-reply@x.ru",
      "do.not.reply@x.ru",
      "company_notifications@x.ru",
      "system.notify@x.ru",
      "mailer-daemon@x.ru",
      "bounces+123@x.ru",
      "rassylka@x.ru",
      "weekly-digest@x.ru",
      "robot@x.ru",
      "Shop News <news@x.ru>",
    ]) {
      expect(isAutomatedSender({ email: e }), e).toBe(true)
    }
  })
  it("people and generic business boxes are not automated", () => {
    for (const e of ["ivan.petrov@x.ru", "info@x.ru", "sales@x.ru", "support@x.ru", "newsome@x.ru", "a.mailerov@x.ru"]) {
      expect(isAutomatedSender({ email: e }), e).toBe(false)
    }
    expect(isAutomatedSender({})).toBe(false)
  })
  it("headers", () => {
    expect(isAutomatedSender({ email: "a@b.ru", headers: { "Auto-Submitted": "auto-generated" } })).toBe(true)
    expect(isAutomatedSender({ email: "a@b.ru", headers: { "auto-submitted": "no" } })).toBe(false)
    expect(isAutomatedSender({ email: "a@b.ru", headers: { "List-Unsubscribe": "<mailto:x>", Precedence: "bulk" } })).toBe(true)
    expect(isAutomatedSender({ email: "a@b.ru", headers: { "List-Unsubscribe": "<mailto:x>" } })).toBe(false)
    expect(isAutomatedSender({ email: "a@b.ru", headers: { "X-Auto-Response-Suppress": "All" } })).toBe(true)
  })
})

describe("isFreemailDomain", () => {
  it("existing and RU additions", () => {
    for (const d of ["gmail.com", "mail.ru", "yandex.ru", "rambler.ru", "bk.ru", "list.ru", "inbox.ru", "ya.ru", "internet.ru", "yandex.by", "yandex.kz", "mail.ua", "MAIL.RU"]) {
      expect(isFreemailDomain(d), d).toBe(true)
    }
    expect(isFreemailDomain("acme.ru")).toBe(false)
  })
})

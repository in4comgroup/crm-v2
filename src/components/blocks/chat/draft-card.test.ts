import { createElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { ChatDraftPart, DealValues, TaskValues } from "@/lib/chat/actions"
import { DraftCard } from "./draft-card"

async function render(part: ChatDraftPart): Promise<string> {
  const s = await renderToReadableStream(createElement(DraftCard, { part }))
  await s.allReady
  return (await new Response(s).text()).replace(/<!-- -->/g, "")
}

function draft(): ChatDraftPart {
  return {
    actionId: "act-1",
    kind: "company_contact",
    status: "draft",
    draft: {
      files: [{ itemId: "f1", name: "визитка.jpg" }],
      items: [
        {
          key: "c1",
          type: "company",
          values: {
            name: "Вектор",
            aliases: [],
            website: "vector.ru",
            email: "",
            phone: "",
            address: "",
            comment: "",
          },
          meta: { name: { source: "file", fileName: "визитка.jpg" }, website: { source: "input" } },
          removed: [{ field: "phone", value: "+7 999 000-00-00", reason: "нет в тексте сообщения или файла" }],
          matches: [
            { kind: "exact", type: "client", id: "cl-9", title: "Вектор", subtitle: "Москва", reason: "совпадает сайт" },
          ],
          missing: [],
          refused: null,
        },
        {
          key: "p1",
          type: "contact",
          values: {
            name: "",
            nameNative: "",
            position: "Директор",
            emails: [],
            phones: [],
            telegram: "",
            companyId: null,
            companyKey: null,
            companyName: "",
          },
          meta: { position: { source: "input" } },
          removed: [],
          matches: [],
          missing: ["name", "companyOrChannel"],
          refused: null,
        },
      ],
    },
  }
}

describe("DraftCard", () => {
  test("exact match, removed value, missing fields, disabled «Создать всё»", async () => {
    const html = await render(draft())
    expect(html).toContain("Компания и контакт")
    expect(html).toContain("Похоже, уже есть: Компания «Вектор» (Москва) — совпадает сайт")
    expect(html).toContain("Использовать существующий")
    expect(html).toContain("Всё равно создать новый")
    expect(html).toContain("из файла «визитка.jpg»")
    expect(html).toContain("из сообщения")
    // Removed value: struck through with the reason.
    expect(html).toMatch(/line-through[^>]*>\+7 999 000-00-00</)
    expect(html).toContain("нет в тексте сообщения или файла")
    // Missing fields of the contact (computed live).
    expect(html).toContain("Укажите название / имя")
    expect(html).toContain("Укажите компанию или хотя бы один телефон, e-mail или Telegram")
    expect(html).toContain("Прикрепить файл к записи: «визитка.jpg»")
    // «Создать всё» is disabled while an included item misses something.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Создать всё/)
  })

  test("created state shows results, no form", async () => {
    const part = draft()
    const html = await render({
      ...part,
      status: "created",
      results: [
        { type: "client", id: "cl-9", title: "Вектор", href: "/clients/cl-9", existing: true },
        { type: "contact", id: "ct-1", title: "Иван Петров", href: "/contacts?openContact=ct-1" },
      ],
    })
    expect(html).toContain("Создано:")
    expect(html).toContain("Компания «Вектор» — существующая запись")
    expect(html).toContain("Контакт «Иван Петров»")
    expect(html).toContain("Открыть")
    expect(html).not.toContain("Создать всё")
  })

  test("confirming state", async () => {
    const html = await render({ ...draft(), status: "confirming" })
    expect(html).toContain("Создаю…")
    expect(html).not.toContain("Отмена")
  })

  test("tasks checklist: missing due date disables «Создать всё», assignee picker lists members", async () => {
    const html = await render({
      actionId: "act-2",
      kind: "tasks",
      status: "draft",
      options: {
        members: [
          { id: "u1", name: "Анна Иванова" },
          { id: "u2", name: "Борис Петров" },
        ],
        timeZone: "Europe/Vienna",
      },
      draft: {
        files: [],
        items: [
          {
            key: "t1",
            type: "task",
            values: task({ title: "Отправить КП Вектору", dueDate: "2026-11-20T18:00", dueText: "до пятницы", assigneeId: "u1", assigneeName: "Анна Иванова" }),
            meta: { title: { source: "input" }, dueDate: { source: "input" } },
            removed: [],
            matches: [],
            missing: [],
            refused: null,
          },
          {
            key: "t2",
            type: "task",
            values: task({ title: "Позвонить Смирнову", dealId: "d1", dealName: "Поставка 2027" }),
            meta: { title: { source: "input" } },
            removed: [],
            matches: [],
            missing: ["dueDate", "assignee"],
            refused: null,
          },
        ],
      },
    })
    expect(html).toContain("Задачи")
    expect(html.match(/Создать: задача/g)?.length).toBe(2)
    expect(html).toContain('value="2026-11-20T18:00"')
    expect(html).toContain("пт, 20.11.2026, 18:00")
    expect(html).toContain("время организации: Europe/Vienna")
    expect(html).toContain("Анна Иванова")
    expect(html).toContain("Борис Петров")
    expect(html).toContain("— выберите —")
    expect(html).toContain("Предложение")
    expect(html).toContain("Средний")
    expect(html).toContain("Сделка:")
    expect(html).toContain("Поставка 2027")
    expect(html).toContain("Укажите срок")
    expect(html).toContain("Выберите исполнителя")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Создать всё/)
  })

  test("group card: company + contact + task linked to the company item", async () => {
    const base = draft()
    const html = await render({
      ...base,
      actionId: "act-3",
      kind: "group",
      options: { members: [{ id: "u1", name: "Анна Иванова" }], timeZone: "Europe/Vienna" },
      draft: {
        files: [],
        items: [
          {
            key: "t1",
            type: "task",
            values: task({ title: "Отправить договор", dueDate: "2026-11-20T18:00", assigneeId: "u1", assigneeName: "Анна Иванова", companyKey: "c1", companyName: "Вектор" }),
            meta: {},
            removed: [],
            matches: [],
            missing: [],
            refused: null,
          },
          ...base.draft.items,
        ],
      },
    })
    expect(html).toContain("Новые записи")
    // Company first, then contact, then task.
    expect(html.indexOf("Создать: компания")).toBeLessThan(html.indexOf("Создать: контакт"))
    expect(html.indexOf("Создать: контакт")).toBeLessThan(html.indexOf("Создать: задача"))
    expect(html).toContain("Компания из этой карточки:")
    expect(html).not.toContain("(не будет создана)")
  })

  test("task result line", async () => {
    const html = await render({
      ...draft(),
      status: "created",
      results: [{ type: "task", id: "tk-1", title: "Отправить КП", href: "/tasks?openTask=tk-1" }],
    })
    expect(html).toContain("Задача «Отправить КП»")
    expect(html).toContain('href="/tasks?openTask=tk-1"')
  })
})

function task(v: Partial<TaskValues>): TaskValues {
  return {
    title: "",
    description: "",
    type: "offer",
    priority: "medium",
    dueDate: "",
    dueText: "",
    assigneeId: null,
    assigneeName: "",
    companyId: null,
    companyKey: null,
    companyName: "",
    contactId: null,
    contactKey: null,
    contactName: "",
    dealId: null,
    dealKey: null,
    dealName: "",
    ...v,
  }
}

function deal(v: Partial<DealValues>): DealValues {
  return {
    name: "",
    description: "",
    companyId: null,
    companyKey: null,
    companyName: "",
    contactIds: [],
    contactKeys: [],
    contactNames: [],
    value: "",
    valueText: "",
    currency: "",
    dealTypeId: null,
    dealTypeName: "",
    stageId: null,
    stageName: "",
    ruleNote: "",
    ...v,
  }
}

const DEAL_OPTIONS = {
  members: [{ id: "u1", name: "Анна Иванова" }],
  timeZone: "Europe/Vienna",
  stages: [
    { id: "s1", name: "Квалификация" },
    { id: "s2", name: "КП отправлено" },
  ],
  dealTypes: [{ id: "dt1", name: "Поставка" }],
}

function dealGroup(dealValues: Partial<DealValues>, matches: ChatDraftPart["draft"]["items"][number]["matches"] = []): ChatDraftPart {
  const company = draft().draft.items[0]
  return {
    actionId: "act-4",
    kind: "group",
    status: "draft",
    options: DEAL_OPTIONS,
    draft: {
      files: [],
      items: [
        {
          key: "t1",
          type: "task",
          values: task({ title: "Отправить КП", dueDate: "2026-11-20T18:00", assigneeId: "u1", assigneeName: "Анна Иванова", companyKey: "c1", dealKey: "d1" }),
          meta: {},
          removed: [],
          matches: [],
          missing: [],
          refused: null,
        },
        {
          key: "d1",
          type: "deal",
          values: deal({ name: "Вектор — поставка 200 позиций", companyKey: "c1", ...dealValues }),
          meta: { name: { source: "model" }, stageId: { source: "rule" } },
          removed: [],
          matches,
          missing: [],
          refused: null,
        },
        { ...company, matches: [] },
      ],
    },
  }
}

describe("DraftCard — deals", () => {
  test("group card: company + deal (open deal match, rule note) + task linked to the deal", async () => {
    const html = await render(
      dealGroup(
        {
          value: "2000000",
          valueText: "бюджет ~2 млн",
          currency: "RUB",
          dealTypeId: "dt1",
          dealTypeName: "Поставка",
          stageId: "s2",
          stageName: "КП отправлено",
          ruleNote: "по правилу воронки: КП отправлено",
        },
        [{ kind: "exact", type: "deal", id: "deal-9", title: "Вектор — поставка", subtitle: "Квалификация", reason: "та же компания и тип" }],
      ),
    )
    expect(html).toContain("Новые записи")
    // Order: company → deal → task.
    expect(html.indexOf("Создать: компания")).toBeLessThan(html.indexOf("Создать: сделка"))
    expect(html.indexOf("Создать: сделка")).toBeLessThan(html.indexOf("Создать: задача"))
    expect(html).toContain("Есть открытая сделка «Вектор — поставка» (Квалификация) — та же компания и тип")
    expect(html).toContain("Использовать существующую")
    expect(html).toContain("Всё равно создать новую")
    expect(html).toContain('value="2000000"')
    expect(html).toContain("из сообщения: бюджет ~2 млн")
    expect(html).toContain("валюта компании")
    expect(html).toContain("— без типа —")
    expect(html).toContain("Поставка")
    expect(html).toContain("КП отправлено")
    expect(html).toContain("по правилу воронки: КП отправлено")
    expect(html).toContain("по правилу воронки")
    expect(html).toContain("Что обсудили")
    expect(html).toContain("Сделка из этой карточки:")
    expect(html).toContain("Вектор — поставка 200 позиций")
    expect(html).not.toContain("Выберите стадию")
    // «Создать всё» is enabled: its <button> tag has no disabled attribute.
    const createAll = /<button[^>]*>(?:(?!<\/button>).)*Создать всё/.exec(html)?.[0] ?? ""
    expect(createAll).toContain("Создать всё")
    expect(createAll).not.toContain('disabled=""')
  })

  test("deal without a stage disables «Создать всё»", async () => {
    const html = await render(dealGroup({}))
    expect(html).toContain("Выберите стадию")
    expect(html).toContain("— выберите —")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Создать всё/)
  })

  test("deal result line", async () => {
    const html = await render({
      ...draft(),
      status: "created",
      results: [{ type: "deal", id: "dl-1", title: "Вектор — поставка", href: "/deals?openDeal=dl-1" }],
    })
    expect(html).toContain("Сделка «Вектор — поставка»")
    expect(html).toContain('href="/deals?openDeal=dl-1"')
  })
})

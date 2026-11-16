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
    done: false,
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

/** The <button …>…text part of the button with this text. */
function buttonTag(html: string, text: string): string {
  return new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}`).exec(html)?.[0] ?? ""
}

describe("DraftCard — T4", () => {
  test("contact exact match with fill: «Дополнить существующий» is offered, «Использовать» stays default", async () => {
    const html = await render({
      actionId: "act-5",
      kind: "contact",
      status: "draft",
      draft: {
        files: [],
        items: [
          {
            key: "p1",
            type: "contact",
            values: {
              name: "Алексей Смирнов",
              nameNative: "",
              position: "Директор",
              emails: ["a.smirnov@vector.ru"],
              phones: ["+7 912 345-67-89"],
              telegram: "",
              companyId: null,
              companyKey: null,
              companyName: "",
            },
            meta: {},
            removed: [],
            matches: [
              {
                kind: "exact",
                type: "contact",
                id: "ct-7",
                title: "Алексей Смирнов",
                subtitle: "Вектор",
                reason: "совпадает телефон",
                fill: [
                  { field: "position", label: "Должность", value: "Директор" },
                  { field: "extraEmail", label: "Доп. e-mail", value: "a.smirnov@vector.ru" },
                ],
              },
            ],
            missing: [],
            refused: null,
          },
        ],
      },
    })
    expect(html).toContain("Похоже, уже есть: Контакт «Алексей Смирнов» (Вектор) — совпадает телефон")
    expect(html).toContain("Дополнить существующий")
    expect(html).toContain("Добавится: Должность: ")
    expect(html).toContain("Добавится: Доп. e-mail: ")
    expect(html).toMatch(/aria-checked="true"[^>]*value="use:ct-7"/)
    expect(html).toMatch(/aria-checked="false"[^>]*value="fill:ct-7"/)
  })

  test("update card: an unticked change is not counted; «Дополнить» enabled while one is left", async () => {
    const part: ChatDraftPart = {
      actionId: "act-6",
      kind: "update",
      status: "draft",
      draft: {
        files: [],
        items: [
          {
            key: "u1",
            type: "update",
            values: {
              targetType: "client",
              targetId: "cl-9",
              targetName: "Вектор",
              changes: [
                { field: "phone", label: "Телефон", value: "+7 343 000-11-22" },
                { field: "alias", label: "Другое название", value: "Vector LLC" },
              ],
            },
            meta: {},
            removed: [],
            matches: [],
            missing: [],
            refused: null,
          },
        ],
      },
    }
    const html = await render(part)
    expect(html).toContain("Дополнить запись")
    expect(html).toContain('href="/clients/cl-9"')
    expect(html).toContain("«Вектор»")
    expect(html).toContain("+7 343 000-11-22")
    expect(html).toContain("Vector LLC")
    expect(buttonTag(html, "Дополнить<")).not.toContain('disabled=""')
    // No change left → «Нечего добавлять», button disabled.
    const empty = await render({
      ...part,
      draft: { ...part.draft, items: [{ ...part.draft.items[0], values: { targetType: "client", targetId: "cl-9", targetName: "Вектор", changes: [] } }] },
    })
    expect(empty).toContain("Нечего добавлять — всё уже есть в записи")
    expect(buttonTag(empty, "Дополнить<")).toContain('disabled=""')
  })

  test("link card: contact → company with «основная», deal", async () => {
    const html = await render({
      actionId: "act-7",
      kind: "link",
      status: "draft",
      draft: {
        files: [],
        items: [
          {
            key: "l1",
            type: "link",
            values: {
              contactId: "ct-7",
              contactName: "Алексей Смирнов",
              clientId: "cl-9",
              clientName: "Вектор",
              primary: true,
              dealId: "dl-1",
              dealName: "Вектор — поставка",
            },
            meta: {},
            removed: [],
            matches: [],
            missing: [],
            refused: null,
          },
        ],
      },
    })
    expect(html).toContain("Связать записи")
    expect(html).toContain("Контакт:")
    expect(html).toContain("Алексей Смирнов")
    expect(html).toContain("→ Компания:")
    expect(html).toContain("Сделать основной компанией контакта")
    expect(html).toMatch(/aria-checked="true"[^>]*id="[^"]*-primary"/)
    expect(html).toContain("→ Сделка:")
    expect(buttonTag(html, "Связать<")).not.toContain('disabled=""')
  })

  test("done task: «Когда было», checkbox checked", async () => {
    const html = await render({
      actionId: "act-8",
      kind: "task",
      status: "draft",
      options: { members: [{ id: "u1", name: "Анна Иванова" }], timeZone: "Europe/Vienna" },
      draft: {
        files: [],
        items: [
          {
            key: "t1",
            type: "task",
            values: task({ title: "Встреча с Вектором", type: "meet", dueDate: "2026-11-10T11:00", assigneeId: "u1", assigneeName: "Анна Иванова", done: true }),
            meta: {},
            removed: [],
            matches: [],
            missing: [],
            refused: null,
          },
        ],
      },
    })
    expect(html).toContain("Когда было")
    expect(html).not.toContain(">Срок<")
    expect(html).toContain("Уже было (записать встречу / звонок)")
    expect(html).toMatch(/aria-checked="true"[^>]*id="[^"]*-dueDate-done"/)
    expect(buttonTag(html, "Создать<")).not.toContain('disabled=""')
  })

  test("result lines: updated / linked", async () => {
    const html = await render({
      ...draft(),
      status: "created",
      results: [
        { type: "client", id: "cl-9", title: "Вектор", href: "/clients/cl-9", existing: true, updated: true },
        { type: "contact", id: "ct-7", title: "Алексей Смирнов", href: "/contacts?openContact=ct-7", existing: true, linked: true },
      ],
    })
    expect(html).toContain("Компания «Вектор» — дополнена")
    expect(html).toContain("Контакт «Алексей Смирнов» — связан")
  })
})

function single(kind: ChatDraftPart["kind"], item: ChatDraftPart["draft"]["items"][number], options?: ChatDraftPart["options"]): ChatDraftPart {
  return { actionId: `act-${kind}`, kind, status: "draft", options, draft: { files: [], items: [item] } }
}

function item(key: string, type: ChatDraftPart["draft"]["items"][number]["type"], values: ChatDraftPart["draft"]["items"][number]["values"]) {
  return { key, type, values, meta: {}, removed: [], matches: [], missing: [], refused: null }
}

const MOVE_OPTIONS = {
  members: [],
  timeZone: "Europe/Vienna",
  allStages: [
    { id: "s1", name: "Квалификация", role: "active" },
    { id: "s2", name: "Переговоры", role: "active" },
    { id: "sw", name: "Выиграна", role: "won" },
    { id: "sl", name: "Проиграна", role: "lost" },
  ],
  lostReasons: [
    { code: "price", label: "Цена" },
    { code: "competitor", label: "Выбрали конкурента" },
  ],
}

function move(v: Partial<import("@/lib/chat/actions").DealMoveValues>) {
  return {
    dealId: "dl-1",
    dealName: "Вектор — поставка",
    fromStageName: "Квалификация",
    stageId: null,
    stageName: "",
    outcome: null,
    reasonCode: "",
    reasonText: "",
    ...v,
  }
}

function taskUpd(v: Partial<import("@/lib/chat/actions").TaskUpdateValues>) {
  return {
    taskId: "tk-1",
    taskTitle: "Позвонить Смирнову",
    action: "done" as const,
    dueDate: "",
    dueText: "",
    currentDue: "2026-11-18T18:00",
    ...v,
  }
}

describe("DraftCard — T5", () => {
  test("order request: company line, read-only request, comment, «Разобрать запрос»", async () => {
    const html = await render(
      single(
        "order_request",
        item("o1", "order_request", {
          clientId: "cl-9",
          companyKey: null,
          clientName: "Вектор",
          requestText: "Прошу выставить счёт:\n— 20 коробок А\n— 5 коробок Б",
          comment: "",
        }),
      ),
    )
    expect(html).toContain("Заказ из запроса")
    expect(html).toContain("Компания:")
    expect(html).toContain("убрать")
    expect(html).toContain("Текст запроса клиента — из сообщения / файла")
    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("— 20 коробок А")
    expect(html).toContain("Комментарий")
    expect(buttonTag(html, "Разобрать запрос<")).not.toContain('disabled=""')
    // Company line comes before the request block.
    expect(html.indexOf("Компания:")).toBeLessThan(html.indexOf("Текст запроса клиента"))
  })

  test("deal move to a working stage: «Перевести» enabled, no reason fields", async () => {
    const html = await render(single("deal_move", item("m1", "deal_move", move({ stageId: "s2", stageName: "Переговоры" })), MOVE_OPTIONS))
    expect(html).toContain("Перевести сделку")
    expect(html).toContain('href="/deals?openDeal=dl-1"')
    expect(html).toContain("Сейчас:")
    expect(html).toContain("Квалификация")
    expect(html).toContain("Выиграна")
    expect(html).not.toContain("Причина проигрыша")
    expect(buttonTag(html, "Перевести<")).not.toContain('disabled=""')
  })

  test("lost move without a reason disables «Перевести»", async () => {
    const html = await render(
      single("deal_move", item("m1", "deal_move", move({ stageId: "sl", stageName: "Проиграна", outcome: "lost" })), MOVE_OPTIONS),
    )
    expect(html).toContain("Причина проигрыша")
    expect(html).toContain("Выбрали конкурента")
    expect(html).toContain("Подробнее о причине")
    expect(html).toContain("Выберите причину проигрыша")
    expect(buttonTag(html, "Перевести<")).toContain('disabled=""')
  })

  test("won move: only the comment field", async () => {
    const html = await render(
      single("deal_move", item("m1", "deal_move", move({ stageId: "sw", stageName: "Выиграна", outcome: "won" })), MOVE_OPTIONS),
    )
    expect(html).toContain("Комментарий к итогу")
    expect(html).not.toContain("Причина проигрыша")
    expect(buttonTag(html, "Перевести<")).not.toContain('disabled=""')
  })

  test("task update: done is fine; reschedule without a date disables «Сохранить»", async () => {
    const opts = { members: [], timeZone: "Europe/Vienna" }
    const done = await render(single("task_update", item("u1", "task_update", taskUpd({})), opts))
    expect(done).toContain("Изменить задачу")
    expect(done).toContain('href="/tasks?openTask=tk-1"')
    expect(done).toContain("Сейчас срок:")
    expect(done).toContain("ср, 18.11.2026, 18:00")
    expect(done).toContain("Отметить выполненной")
    expect(done).toContain("Перенести срок")
    expect(buttonTag(done, "Сохранить<")).not.toContain('disabled=""')

    const resched = await render(single("task_update", item("u1", "task_update", taskUpd({ action: "reschedule" })), opts))
    expect(resched).toContain('type="datetime-local"')
    expect(resched).toContain("время организации: Europe/Vienna")
    expect(resched).toContain("Укажите срок")
    expect(buttonTag(resched, "Сохранить<")).toContain('disabled=""')
  })

  test("result lines: order request, moved deal, done / rescheduled task", async () => {
    const order = await render({
      ...single("order_request", item("o1", "order_request", { clientId: "cl-9", companyKey: null, clientName: "Вектор", requestText: "x", comment: "" })),
      status: "created",
      results: [{ type: "order_request", id: "or-1", title: "Вектор", href: "/products?assembleRequest=or-1" }],
    })
    expect(order).toContain("Запрос клиента «Вектор»")
    expect(order).toContain("Собрать заказ")
    expect(order).toContain('href="/products?assembleRequest=or-1"')

    const moved = await render({
      ...single("deal_move", item("m1", "deal_move", move({ stageId: "s2" }))),
      status: "created",
      results: [{ type: "deal", id: "dl-1", title: "Вектор — поставка", href: "/deals?openDeal=dl-1", existing: true, moved: true }],
    })
    expect(moved).toContain("Сделка «Вектор — поставка» — переведена")

    const taskResult = [{ type: "task" as const, id: "tk-1", title: "Позвонить Смирнову", href: "/tasks?openTask=tk-1", existing: true, updated: true }]
    const doneRes = await render({ ...single("task_update", item("u1", "task_update", taskUpd({}))), status: "created", results: taskResult })
    expect(doneRes).toContain("Задача «Позвонить Смирнову» — выполнена")
    const reschedRes = await render({
      ...single("task_update", item("u1", "task_update", taskUpd({ action: "reschedule", dueDate: "2026-11-25T18:00" }))),
      status: "created",
      results: taskResult,
    })
    expect(reschedRes).toContain("Задача «Позвонить Смирнову» — срок перенесён")
  })
})

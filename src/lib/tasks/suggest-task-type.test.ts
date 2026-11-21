import { describe, expect, it } from "vitest"
import { suggestTaskType } from "./suggest-task-type"

describe("suggestTaskType", () => {
  it("reads the action of the task title first", () => {
    expect(suggestTaskType({ taskTitle: "Позвонить по договору" })).toBe("call")
    expect(suggestTaskType({ taskTitle: "Назначить встречу с клиентом" })).toBe("meet")
    expect(suggestTaskType({ taskTitle: "Отправить КП" })).toBe("offer")
    expect(suggestTaskType({ taskTitle: "Согласовать правки к договору" })).toBe("docs")
    expect(suggestTaskType({ taskTitle: "Ответить на жалобу" })).toBe("support")
    expect(suggestTaskType({ taskTitle: "Ответить клиенту" })).toBe("email")
  })

  it("matches stems at word start only", () => {
    // «контакт» must not hit «акт», «купить» must not hit «кп»
    expect(suggestTaskType({ taskTitle: "Купить новый контакт" })).toBe("other")
    expect(suggestTaskType({ taskTitle: "Демонтаж стенда" })).toBe("other")
    expect(suggestTaskType({ taskTitle: "Показать демо" })).toBe("meet")
  })

  it("falls back to headline + steps, then family, then category", () => {
    expect(suggestTaskType({ taskTitle: "Разобраться", headline: "Клиент ждёт коммерческое предложение" })).toBe("offer")
    expect(suggestTaskType({ taskTitle: "Разобраться", steps: ["Перезвонить менеджеру"] })).toBe("call")
    expect(suggestTaskType({ taskTitle: "Разобраться", family: "contract" })).toBe("docs")
    expect(suggestTaskType({ taskTitle: "Разобраться", family: "order" })).toBe("other")
    expect(suggestTaskType({ category: "support" })).toBe("support")
    expect(suggestTaskType({})).toBe("other")
  })
})

import { describe, expect, it } from "vitest"
import { closeTo, forbiddenChunks, leakProblems, mentionsNumber, parseSse, turnResult } from "./turn-result"

describe("eval turn parser", () => {
  it("reads answer, tools (from admin debug), records, stats, errors", () => {
    const body = [
      'data: {"type":"start","messageId":"m"}',
      'data: {"type":"data-records","id":"1","data":{"counts":{"client":{"total":1,"capped":false}},"hits":{"client":[{"type":"client","id":"c1","title":"Вектор","subtitle":null,"facts":[],"badge":null,"date":null,"href":"/clients/c1"}]}}}',
      'data: {"type":"text-delta","id":"t","delta":"Нашёл "}',
      'data: {"type":"text-delta","id":"t","delta":"компанию."}',
      'data: {"type":"data-debug","id":"debug","data":{"model":"m-x","steps":[{"kind":"tool","tool":"searchRecords","input":"{\\"query\\":\\"Вектор\\"}","output":"{}","ms":5}]}}',
      'data: {"type":"finish"}',
      "data: [DONE]",
    ].join("\n")
    const t = turnResult(200, parseSse(body), 1234)
    expect(t.answer).toBe("Нашёл компанию.")
    expect(t.tools).toEqual([{ tool: "searchRecords", input: { query: "Вектор" }, output: "{}", error: false, ms: 5 }])
    expect(t.hits.map((h) => h.id)).toEqual(["c1"])
    expect(t.model).toBe("m-x")
    expect(t.error).toBeNull()
    expect(turnResult(200, parseSse('data: {"type":"error","errorText":"chat_error:timeout"}'), 1).error).toBe("chat_error:timeout")
  })

  it("leaks, forbidden chunks, numbers", () => {
    expect(leakProblems("Нашёл компанию «Вектор».")).toEqual([])
    expect(leakProblems("ref a35c369d-fe21-474e-b64a-c38d9b10092d").length).toBeGreaterThan(0)
    expect(leakProblems("вызвал searchRecords")).toEqual(["tool name «searchRecords» in the answer"])
    expect(leakProblems('{"query": 1}')).toContain("JSON in the answer")
    expect(leakProblems("SbD8FphRhJpApi2wPaDWWG4hi5EahIgF")).toContain("id (32 chars) in the answer")
    expect(forbiddenChunks(["text-delta", "tool-input-available", "reasoning-delta", "data-records"])).toEqual(["tool-input-available", "reasoning-delta"])
    expect(mentionsNumber("В каталоге 2 753 товара", 2753)).toBe(true)
    expect(mentionsNumber("В каталоге 12753 товара", 2753)).toBe(false)
    expect(closeTo(100.4, 100)).toBe(true)
    expect(closeTo(154_521_802, 150_000_000)).toBe(false)
  })
})

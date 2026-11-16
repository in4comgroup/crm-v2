import { describe, expect, it } from "vitest"
import { parsePageRecord } from "./page-context"

describe("parsePageRecord", () => {
  it("reads the record of each deep link", () => {
    expect(parsePageRecord("/clients/a35c369d-fe21-474e-b64a-c38d9b10092d")).toEqual({ type: "client", id: "a35c369d-fe21-474e-b64a-c38d9b10092d" })
    expect(parsePageRecord("/clients/abc/")).toEqual({ type: "client", id: "abc" })
    expect(parsePageRecord("/cards/c1")).toEqual({ type: "card", id: "c1" })
    expect(parsePageRecord("/contacts?openContact=k1")).toEqual({ type: "contact", id: "k1" })
    expect(parsePageRecord("/deals?openDeal=d1&x=1")).toEqual({ type: "deal", id: "d1" })
    expect(parsePageRecord("/tasks?openTask=t1")).toEqual({ type: "task", id: "t1" })
    expect(parsePageRecord("/products?openOrder=o1")).toEqual({ type: "order", id: "o1" })
    expect(parsePageRecord("/dashboard?topic=tp")).toEqual({ type: "topic", id: "tp" })
    expect(parsePageRecord("/sources?item=s1")).toEqual({ type: "source_item", id: "s1" })
  })

  it("no record → null; bad input → null", () => {
    for (const p of ["/clients", "/deals", "/products?q=вино", "/clients/a/b", "https://evil/clients/x", "clients/x", "", null, undefined, "/clients/" + "x".repeat(80), "/deals?openDeal=a%20b", "/x".repeat(300)]) {
      expect(parsePageRecord(p as string)).toBeNull()
    }
  })
})

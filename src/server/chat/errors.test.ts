import { describe, expect, it } from "vitest"
import { chatErrorCode, classifyChatError } from "./errors"

describe("classifyChatError", () => {
  it("maps errors to the four Russian classes", () => {
    expect(classifyChatError(Object.assign(new Error("limit"), { name: "AiBudgetExceededError", period: "month" }))).toBe("limit")
    expect(classifyChatError(Object.assign(new Error("no compliant model"), { name: "AiProcessResolutionError" }))).toBe("model_unavailable")
    expect(classifyChatError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("timeout")
    expect(classifyChatError(Object.assign(new Error("x"), { name: "AI_APICallError" }))).toBe("model_unavailable")
    expect(classifyChatError(new Error("Gateway returned 503"))).toBe("model_unavailable")
    expect(classifyChatError(new Error("weird"))).toBe("unknown")
    expect(classifyChatError(Object.assign(new Error("wrapped"), { cause: Object.assign(new Error("t"), { name: "TimeoutError" }) }))).toBe("timeout")
    expect(chatErrorCode("timeout")).toBe("chat_error:timeout")
  })
})

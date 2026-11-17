import { describe, expect, it } from "vitest"

import { appendDictated } from "./dictation-button"

describe("appendDictated", () => {
  it("starts an empty input with the phrase", () => {
    expect(appendDictated("", "  Позвонить Ивану ")).toBe("Позвонить Ивану")
  })
  it("adds a space between phrases", () => {
    expect(appendDictated("Позвонить Ивану", "завтра в десять")).toBe("Позвонить Ивану завтра в десять")
  })
  it("keeps the user's own trailing space", () => {
    expect(appendDictated("Позвонить ", "Ивану")).toBe("Позвонить Ивану")
  })
  it("ignores an empty phrase", () => {
    expect(appendDictated("Текст", "   ")).toBe("Текст")
  })
})

import { describe, expect, it } from "vitest"
import { visibleLength } from "./html"
import { answerAllowedTagsOnly } from "./render"
import { transcriptEcho, transcriptPlainText } from "./voice"

// Same shape as `renderTranscript` in src/server/parsers/audio.ts.
const content = [
  "**Total duration:** 0:42 · **Speakers:** 2",
  "",
  "**0:00** · *12s* · **Speaker 1**",
  "",
  "Сколько у нас открытых сделок?",
  "",
  "**0:12** · *1m 5s* · **Speaker 2**",
  "",
  "И какие из них по Альфе.",
].join("\n")

describe("transcriptPlainText", () => {
  it("keeps only the spoken text, one line per segment", () => {
    expect(transcriptPlainText(content)).toBe("Сколько у нас открытых сделок?\nИ какие из них по Альфе.")
  })
  it("reads the «## Content» section of the whole parsed markdown", () => {
    const md = `---\nsource: x\n---\n\n## Summary\n\nРазговор о сделках.\n\n## Content\n\n${content}\n`
    expect(transcriptPlainText(md)).toBe("Сколько у нас открытых сделок?\nИ какие из них по Альфе.")
  })
  it("no speech → empty", () => {
    expect(transcriptPlainText("**Total duration:** 0:03 · **Speakers:** 0\n\n_(no speech detected)_")).toBe("")
  })
})

describe("transcriptEcho", () => {
  it("short → one italic line, escaped", () => {
    expect(transcriptEcho("Сколько сделок у <Альфы>?")).toBe("🎤 <i>Сколько сделок у &lt;Альфы&gt;?</i>")
  })
  it("long → first ≤ 300 chars + the rest in an expandable quote", () => {
    const text = "слово ".repeat(120).trim()
    const html = transcriptEcho(text)
    const [head, rest] = html.split("\n")
    expect(head.startsWith("🎤 <i>")).toBe(true)
    expect(head.length).toBeLessThanOrEqual(300 + 12)
    expect(rest.startsWith("<blockquote expandable>")).toBe(true)
    expect(answerAllowedTagsOnly(html)).toBe(true)
  })
  it("very long → still one message", () => {
    const html = transcriptEcho("а ".repeat(6000))
    expect(visibleLength(html)).toBeLessThanOrEqual(4096)
    expect(answerAllowedTagsOnly(html)).toBe(true)
  })
})

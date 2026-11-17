import { describe, expect, it } from "vitest"
import {
  escapeHtml,
  htmlToVisibleText,
  markdownToTelegramHtml,
  splitTelegramHtml,
  tableToTelegramHtml,
  visibleLength,
} from "./html"
import { answerAllowedTagsOnly } from "./render"

const md = markdownToTelegramHtml

describe("escapeHtml / visibleLength", () => {
  it("escapes only & < >", () => {
    expect(escapeHtml(`a < b & c > "d" 'e'`)).toBe(`a &lt; b &amp; c &gt; "d" 'e'`)
  })
  it("counts text without tags, entities decoded, in UTF-16 units", () => {
    expect(visibleLength("<b>a&lt;b</b> &amp; <a href=\"https://x.ru\">c</a>")).toBe(7)
    expect(visibleLength("🎤 x")).toBe(4)
    expect(htmlToVisibleText("&#1055;&#x0440;и")).toBe("При")
  })
})

describe("markdownToTelegramHtml — inline", () => {
  it("bold, italic, strike, code", () => {
    expect(md("**жирный** и __тоже__, *курсив* и _тоже_, ~~нет~~, `x<y`")).toBe(
      "<b>жирный</b> и <b>тоже</b>, <i>курсив</i> и <i>тоже</i>, <s>нет</s>, <code>x&lt;y</code>",
    )
  })
  it("nested formatting stays valid (no code inside bold, no same tag inside itself)", () => {
    const html = md("**жирный с *курсивом* и `кодом`** и ***оба***")
    expect(html).toBe("<b>жирный с <i>курсивом</i> и кодом</b> и <b><i>оба</i></b>")
    expect(answerAllowedTagsOnly(html)).toBe(true)
    expect(md("**a **b** c**")).toSatisfy((h: string) => answerAllowedTagsOnly(h))
    expect(md("**жирный *курсив***")).toBe("<b>жирный <i>курсив</i></b>")
  })
  it("leaves snake_case, arithmetic and lone markers alone", () => {
    expect(md("поле client_type_id и 2 * 3 = 6, 5*3*2, цена 10*")).toBe("поле client_type_id и 2 * 3 = 6, 5*3*2, цена 10*")
    expect(md("**не закрыто")).toBe("**не закрыто")
  })
  it("links: only http(s) become <a>; others stay text", () => {
    expect(md("[Сайт](https://alfa.ru/a?b=1&c=2)")).toBe('<a href="https://alfa.ru/a?b=1&amp;c=2">Сайт</a>')
    expect(md('[кавычка](https://x.ru/"onmouseover)')).toBe("кавычка")
    expect(md("[плохо](javascript:alert(1)) и [путь](/clients/1) и [почта](mailto:a@b.ru)")).toBe("плохо и путь и почта")
    expect(md("[**жирная** ссылка](https://x.ru)")).toBe('<a href="https://x.ru"><b>жирная</b> ссылка</a>')
    expect(md("[`код` в ссылке](https://x.ru)")).toBe('<a href="https://x.ru">код в ссылке</a>')
    expect(md("<https://x.ru/p>")).toBe('<a href="https://x.ru/p">https://x.ru/p</a>')
    expect(md("![картинка](https://x.ru/i.png)")).toBe("картинка")
  })
  it("escapes HTML the model writes", () => {
    expect(md("<script>alert(1)</script> & <b>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;")
  })
})

describe("markdownToTelegramHtml — blocks", () => {
  it("headings → bold line, lists, quotes, rules dropped", () => {
    const html = md("## Итоги **недели**\n\n- первое\n* второе\n  - вложенное\n1. раз\n2. два\n\n---\n\n> цитата *с курсивом*\n> и `кодом`")
    expect(html).toBe(
      "<b>Итоги недели</b>\n\n• первое\n• второе\n    ◦ вложенное\n1. раз\n2. два\n\n<blockquote>цитата <i>с курсивом</i>\nи кодом</blockquote>",
    )
    expect(answerAllowedTagsOnly(html)).toBe(true)
  })
  it("fenced code → pre (with language), never formatted inside", () => {
    expect(md("```ts\nconst a = 1 < 2 && **b**\n```")).toBe('<pre><code class="language-ts">const a = 1 &lt; 2 &amp;&amp; **b**</code></pre>')
    expect(md("```\nплain\n```")).toBe("<pre>плain</pre>")
    // A fenced block inside a quote is plain text (Telegram: no pre inside a quote).
    const q = md("> ```\n> x\n> ```")
    expect(answerAllowedTagsOnly(q)).toBe(true)
    expect(q).not.toContain("<pre>")
  })
  it("a narrow table → pre with right-aligned numbers", () => {
    const html = md("| Месяц | Выручка |\n|---|---:|\n| Январь | 1,2 млн ₽ |\n| Февраль | 350 тыс ₽ |")
    expect(html.startsWith("<pre>")).toBe(true)
    const text = htmlToVisibleText(html).split("\n")
    expect(text[0]).toBe("Месяц      Выручка")
    expect(text[2]).toBe("Январь   1,2 млн ₽")
    expect(text[3]).toBe("Февраль  350 тыс ₽")
    expect(answerAllowedTagsOnly(html)).toBe(true)
  })
  it("a wide table → «a — b — c» lines", () => {
    const html = md("| Компания | Ответственный | Сумма | Стадия |\n|---|---|---|---|\n| **Альфа** | Анна | 1 млн | КП |")
    expect(html).toBe("<i>Компания — Ответственный — Сумма — Стадия</i>\n<b>Альфа</b> — Анна — 1 млн — КП")
    const long = md("| Компания | Сумма |\n|---|---|\n| Очень длинное название компании | 5 |")
    expect(long).not.toContain("<pre>")
    expect(long).toContain("Очень длинное название компании — 5")
  })
  it("tableToTelegramHtml right-aligns only numeric columns", () => {
    const html = tableToTelegramHtml(null, [
      ["А", "1"],
      ["Бэ", "100"],
    ])
    expect(htmlToVisibleText(html)).toBe("А     1\nБэ  100")
  })
  it("output is always valid for messy input", () => {
    const inputs = [
      "**a _b** c_",
      "[a](https://x.ru) [[b]](https://y.ru) [c](",
      "`unclosed *x* **y",
      "> > nested quote\n> **bold",
      "| a |\n|---|\n| `x|y` |",
      "***",
      "_a_b_ __init__ ~single~",
      "1. **x\n2. y**",
    ]
    for (const s of inputs) expect(answerAllowedTagsOnly(md(s)), s).toBe(true)
  })
})

describe("splitTelegramHtml", () => {
  it("returns one part when it fits", () => {
    expect(splitTelegramHtml("<b>x</b>")).toEqual(["<b>x</b>"])
    expect(splitTelegramHtml("   ")).toEqual([])
  })
  it("splits long text at paragraph borders, each ≤ max visible chars", () => {
    const para = "слово ".repeat(150).trim() // ≈ 900 chars
    const html = Array.from({ length: 12 }, (_, i) => `<b>${i}</b> ${para}`).join("\n\n")
    const parts = splitTelegramHtml(html)
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) {
      expect(visibleLength(p)).toBeLessThanOrEqual(4096)
      expect(answerAllowedTagsOnly(p)).toBe(true)
      expect(p.startsWith("<b>")).toBe(true) // cut at a paragraph border
    }
    expect(parts.map(htmlToVisibleText).join("\n\n")).toBe(htmlToVisibleText(html))
  })
  it("closes and reopens a long pre / blockquote", () => {
    const pre = `<pre><code class="language-text">${Array.from({ length: 400 }, (_, i) => `строка номер ${i}`).join("\n")}</code></pre>`
    const parts = splitTelegramHtml(pre, 1000)
    expect(parts.length).toBeGreaterThan(5)
    for (const p of parts) {
      expect(p.startsWith('<pre><code class="language-text">')).toBe(true)
      expect(p.endsWith("</code></pre>")).toBe(true)
      expect(visibleLength(p)).toBeLessThanOrEqual(1000)
      expect(answerAllowedTagsOnly(p)).toBe(true)
    }
    const quote = `<blockquote expandable>${"a ".repeat(3000)}</blockquote>`
    const qp = splitTelegramHtml(quote)
    expect(qp.length).toBe(2)
    for (const p of qp) expect(answerAllowedTagsOnly(p)).toBe(true)
  })
  it("counts entities as one character and never cuts inside them", () => {
    const html = "&lt;".repeat(5000)
    const parts = splitTelegramHtml(html)
    expect(parts.length).toBe(2)
    expect(visibleLength(parts[0])).toBe(4096)
    expect(parts[0].length).toBe(4096 * 4)
    expect(parts.every((p) => /^(&lt;)+$/.test(p))).toBe(true)
  })
  it("cuts a text without spaces hard, and avoids cutting inside a link", () => {
    const parts = splitTelegramHtml("x".repeat(9000))
    expect(parts.map((p) => p.length)).toEqual([4096, 4096, 808])
    const link = `${"a ".repeat(2040)}<a href="https://x.ru">${"ссылка ".repeat(5)}</a> конец`
    const lp = splitTelegramHtml(link)
    expect(lp.length).toBe(2)
    expect(lp[1].startsWith('<a href="https://x.ru">')).toBe(true)
  })
})

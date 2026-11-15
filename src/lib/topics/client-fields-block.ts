// PURE. The «Поля компании:» block of the topics prompts (card writer, deal
// state) — the company's shown custom values, spec clients-contacts Q11.
// Gated by `identity.promptContext` at the call site.

/** «Поля компании:» + the «Название: значение» lines; "" when there are none. */
export function clientFieldsBlock(text: string | null | undefined): string {
  const t = (text ?? "").trim()
  return t ? `Поля компании:\n${t}` : ""
}

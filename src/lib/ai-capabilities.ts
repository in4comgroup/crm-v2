// Vendor-neutral model capabilities (docs/specs/models/02-model-registry.md §4).
// Client-safe: used by the «Модели» tab and (P2) the process compatibility
// rules. Derived only from normalized registry fields, never from
// gateway-specific data.

export const AI_CAPABILITIES = [
  "tools",
  "structured_output",
  "web_search",
  "reasoning",
  "image_input",
  "pdf_input",
  "audio_input",
  "video_input",
] as const

export type AiCapability = (typeof AI_CAPABILITIES)[number]

export const AI_CAPABILITY_LABELS: Record<AiCapability, string> = {
  tools: "Инструменты",
  structured_output: "Структурированный вывод",
  web_search: "Поиск в интернете",
  reasoning: "Рассуждения",
  image_input: "Изображения",
  pdf_input: "PDF",
  audio_input: "Аудио",
  video_input: "Видео",
}

export type AiCapabilityFields = {
  toolCall: boolean | null
  structuredOutput: boolean | null
  webSearch: boolean | null
  reasoning: boolean | null
  inputModalities: string[] | null
}

export function modelCapabilities(m: AiCapabilityFields): AiCapability[] {
  const input = new Set(m.inputModalities ?? [])
  const out: AiCapability[] = []
  if (m.toolCall) out.push("tools")
  if (m.structuredOutput) out.push("structured_output")
  if (m.webSearch) out.push("web_search")
  if (m.reasoning) out.push("reasoning")
  if (input.has("image")) out.push("image_input")
  if (input.has("pdf")) out.push("pdf_input")
  if (input.has("audio")) out.push("audio_input")
  if (input.has("video")) out.push("video_input")
  return out
}

// Model types as the catalogs name them. "language" is the UI default.
export const AI_MODEL_TYPE_LABELS: Record<string, string> = {
  language: "Языковые",
  embedding: "Эмбеддинги",
  image: "Изображения",
  video: "Видео",
  speech: "Синтез речи",
  transcription: "Распознавание речи",
  realtime: "Реального времени",
  reranking: "Ранжирование",
  evaluation: "Оценка",
}

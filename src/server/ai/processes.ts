import "server-only"

import type { AiCapability } from "@/lib/ai-capabilities"

// Process catalog (docs/specs/models/03-processes-and-model-selection.md §2).
//
// Every place that calls a model is a named process. Defined in code because
// each process is tied to code (prompt, schema, tools); the DB stores only
// the admin's choice (ai_process_assignment). These defaults are the ONLY
// model ids allowed in code (01 §3 rule 3) — business code names a process,
// never a model.

export const AI_PROCESS_GROUPS = [
  "Чат и ассистенты",
  "Клиенты",
  "Заказы",
  "Разбор источников",
  "Темы и сигналы",
] as const

export type AiProcessGroup = (typeof AI_PROCESS_GROUPS)[number]

export type AiProcessDefinition = {
  key: string
  label: string
  group: AiProcessGroup
  description: string
  kind: "interactive" | "background"
  requires: AiCapability[]
  defaultModelId: string
  // Users pick among admin-allowed models (allowed_model_ids). Only processes
  // that already had a user-facing model picker.
  userSelectable?: boolean
  // Allowed list used while the admin has not set one (= today's picker).
  defaultAllowedModelIds?: string[]
  // Interactive processes normally run past the org's AI limits and only log
  // (models spec 07 / 08). true = this one is refused like a background
  // process once the MONTHLY limit is used up (AI chat, docs/specs/ai-chat Q15).
  // The daily budget keeps the interactive rule.
  stopAtMonthlyLimit?: boolean
}

// Today's picker models — kept as the initial allowed list so the switch to
// the registry changes nothing for users.
const PICKER_DEFAULTS = [
  "google/gemini-3.1-flash-lite",
  "openai/gpt-5-mini",
  "anthropic/claude-sonnet-4.6",
]

const FLASH_LITE = "google/gemini-3.1-flash-lite"
const PARSER = "google/gemini-2.5-flash"

const DEFINITIONS = [
  {
    key: "chat.assistant",
    label: "ИИ чат",
    group: "Чат и ассистенты",
    description: "Глобальная панель ИИ чата: ответы с инструментами поиска по источникам и вебу.",
    kind: "interactive",
    requires: ["tools", "image_input"],
    defaultModelId: FLASH_LITE,
    userSelectable: true,
    defaultAllowedModelIds: PICKER_DEFAULTS,
    stopAtMonthlyLimit: true,
  },
  {
    key: "chat.web_search",
    label: "Поиск в интернете (чат)",
    group: "Чат и ассистенты",
    description: "Инструмент веб-поиска ИИ чата: отдельный вызов модели с поиском в интернете.",
    kind: "interactive",
    requires: ["web_search"],
    defaultModelId: FLASH_LITE,
    stopAtMonthlyLimit: true,
  },
  {
    key: "chat.session_analysis",
    label: "Сохранение чата",
    group: "Чат и ассистенты",
    description: "Анализ диалога при сохранении чата в источники.",
    kind: "interactive",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "analytics.assistant",
    label: "ИИ ассистент аналитики",
    group: "Чат и ассистенты",
    description: "Вкладка «ИИ ассистент» на странице аналитики.",
    kind: "interactive",
    requires: ["tools"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "clients.enrichment_research",
    label: "Обогащение компаний: поиск",
    group: "Клиенты",
    description: "Поиск сведений о компании в интернете (первый шаг обогащения).",
    kind: "interactive",
    requires: ["web_search"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "clients.enrichment_extract",
    label: "Обогащение компаний: извлечение",
    group: "Клиенты",
    description: "Извлечение реквизитов компании из результатов поиска.",
    kind: "interactive",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "orders.request_split",
    label: "Заказ из запроса",
    group: "Заказы",
    description: "Разбор текста запроса клиента на позиции заказа.",
    kind: "interactive",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "parsing.email",
    label: "Разбор писем",
    group: "Разбор источников",
    description: "Разбор писем (Nylas, IMAP): текст, метаданные, участники.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.chat_message",
    label: "Разбор сообщений (Google Chat, Telegram, WhatsApp)",
    group: "Разбор источников",
    description: "Разбор сообщений мессенджеров.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.document_metadata",
    label: "Разбор Google Docs/Sheets",
    group: "Разбор источников",
    description: "Метаданные документов Google Drive.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.office",
    label: "Разбор Word/PowerPoint",
    group: "Разбор источников",
    description: "Очистка и метаданные документов .docx / .pptx.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.pdf",
    label: "Разбор PDF",
    group: "Разбор источников",
    description: "Текст и метаданные PDF-файлов.",
    kind: "background",
    requires: ["structured_output", "pdf_input"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.image",
    label: "Разбор изображений",
    group: "Разбор источников",
    description: "Описание и текст изображений.",
    kind: "background",
    requires: ["structured_output", "image_input"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.audio",
    label: "Расшифровка аудио",
    group: "Разбор источников",
    description: "Расшифровка голосовых и аудиофайлов с разметкой говорящих.",
    kind: "background",
    requires: ["structured_output", "audio_input"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.video",
    label: "Разбор видео",
    group: "Разбор источников",
    description: "Описание видео и расшифровка речи.",
    kind: "background",
    requires: ["structured_output", "video_input"],
    defaultModelId: PARSER,
  },
  {
    key: "parsing.org_attribution",
    label: "Определение авторства документа",
    group: "Разбор источников",
    description: "Определяет, создан ли документ своей организацией или внешней.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  // ── Topics (docs/specs/topics/01-specification.md §3; plan phase 0 task 5)
  {
    key: "topics.signal_extraction",
    label: "Извлечение сигналов",
    group: "Темы и сигналы",
    description: "Находит в разобранном сообщении сигналы из реестра, их доказательства, участников и факты.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
  {
    key: "topics.signal_block_classifier",
    label: "Сигналы: выбор блоков",
    group: "Темы и сигналы",
    description: "Первый проход двухэтапного извлечения: выбирает блоки реестра для сообщения (если используется).",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "topics.topic_match",
    label: "Сопоставление тем",
    group: "Темы и сигналы",
    description: "Решает, к какой открытой теме относится сообщение, или создаёт новую.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "topics.card_writer",
    label: "Текст карточки темы",
    group: "Темы и сигналы",
    description: "Пишет и обновляет текст карточки темы на русском языке.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: FLASH_LITE,
  },
  {
    key: "deals.state_summary",
    label: "Текущее состояние сделки и риски",
    group: "Темы и сигналы",
    description: "Короткий текст о состоянии сделки и объяснения активных рисков.",
    kind: "background",
    requires: ["structured_output"],
    defaultModelId: PARSER,
  },
] as const satisfies readonly AiProcessDefinition[]

export type AiProcessKey = (typeof DEFINITIONS)[number]["key"]

export const AI_PROCESSES: readonly AiProcessDefinition[] = DEFINITIONS

const BY_KEY = new Map<string, AiProcessDefinition>(
  AI_PROCESSES.map((p) => [p.key, p]),
)

export function getAiProcess(key: string): AiProcessDefinition | undefined {
  return BY_KEY.get(key)
}

export function requireAiProcess(key: AiProcessKey): AiProcessDefinition {
  const p = BY_KEY.get(key)
  if (!p) throw new Error(`Unknown AI process: ${key}`)
  return p
}

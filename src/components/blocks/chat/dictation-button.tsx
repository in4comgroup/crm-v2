"use client"

// Browser dictation for the AI chat input (Web Speech API): speech becomes
// text IN the input field — the user checks it and sends it. The API takes
// ONE language per session (no mixed-language mode), so the user picks RU
// (default) or EN; the choice is remembered per browser. Browsers without
// the API (Firefox) get no dictation button — the voice message recorder
// works there.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"

import { usePromptInputController } from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { usePersistentTab } from "@/lib/use-persistent-tab"

const LANGS = {
  ru: { code: "ru-RU", label: "RU", name: "русский", other: "английский" },
  en: { code: "en-US", label: "EN", name: "английский", other: "русский" },
} as const
type DictationLang = keyof typeof LANGS
const LANG_KEYS = ["ru", "en"] as const

const noSubscribe = () => () => {}
const speechSupported = () =>
  typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

/** Adds a dictated phrase to the end of the input text. */
export function appendDictated(current: string, phrase: string): string {
  const t = phrase.trim()
  if (!t) return current
  if (!current) return t
  return /\s$/.test(current) ? `${current}${t}` : `${current} ${t}`
}

export function DictationButton() {
  const supported = useSyncExternalStore(noSubscribe, speechSupported, () => false)
  const [lang, setLang] = usePersistentTab<DictationLang>("chat.dictationLang", "ru", {
    allowed: LANG_KEYS,
    urlParam: false,
  })
  const { textInput } = usePromptInputController()
  // Several phrases can arrive before the next render: keep the latest text here.
  const valueRef = useRef(textInput.value)
  useEffect(() => {
    valueRef.current = textInput.value
  }, [textInput.value])

  const onPhrase = useCallback(
    (text: string) => {
      const next = appendDictated(valueRef.current, text)
      valueRef.current = next
      textInput.setInput(next)
    },
    [textInput],
  )

  if (!supported) return null
  const l = LANGS[lang]

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center">
        <Tooltip>
          {/* A wrapper is the trigger: SpeechInput spreads its props after its
              own onClick, so a trigger's onClick would replace the toggle. */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              {/* key: a language switch makes a new recognizer (and stops a running one cleanly). */}
              <SpeechInput
                key={lang}
                lang={l.code}
                size="icon-sm"
                variant="ghost"
                aria-label={`Диктовка (${l.name})`}
                onTranscriptionChange={onPhrase}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            <p className="font-medium">Диктовка ({l.name})</p>
            <p>
              Речь сразу становится текстом в поле ввода — проверьте и отправьте. Быстро и бесплатно, но имена,
              телефоны и e-mail может записать с ошибками.
            </p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="w-7 text-[10px] font-semibold text-muted-foreground"
              aria-label={`Язык диктовки: ${l.name}. Переключить на ${l.other}`}
              onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            >
              {l.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            Язык диктовки: {l.name}. Нажмите, чтобы переключить на {l.other}.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

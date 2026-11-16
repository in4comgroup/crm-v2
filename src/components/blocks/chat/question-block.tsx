"use client"

// Clarification question of the AI chat (docs/specs/ai-chat-tools/01-
// specification.md §12, T4): the question + up to 5 quick replies. A click
// sends the option text as the user's next message, so the history reads
// naturally. Once the user has answered (any later user message), the
// buttons are disabled and the chosen one is marked.
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ChatQuestionPart } from "@/lib/chat/turn"
import { cn } from "@/lib/utils"

const MAX_OPTIONS = 5

export function QuestionBlock({
  part,
  answer,
  busy,
  onAnswer,
  className,
}: {
  part: ChatQuestionPart
  /** Text of the next user message after this answer; null = not answered yet. */
  answer: string | null
  /** A chat request is running. */
  busy: boolean
  onAnswer: (text: string) => void
  className?: string
}) {
  const answered = answer !== null
  const chosen = answer?.trim() ?? null
  const options = (part.options ?? []).filter((o) => o.trim()).slice(0, MAX_OPTIONS)
  return (
    <div role="group" aria-label="Уточняющий вопрос" className={cn("mt-2 space-y-1.5", className)}>
      <p className="text-sm font-medium">{part.question}</p>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o, i) => {
            const isChosen = answered && chosen === o.trim()
            return (
              <Button
                key={`${i}-${o}`}
                type="button"
                size="sm"
                variant={isChosen ? "secondary" : "outline"}
                aria-pressed={isChosen}
                disabled={answered || busy}
                onClick={() => onAnswer(o)}
                className="h-7 text-xs"
              >
                {isChosen && <Check className="size-3.5" aria-hidden />}
                {o}
              </Button>
            )
          })}
        </div>
      )}
      {part.allowFreeText && !answered && <p className="text-muted-foreground text-xs">или напишите свой ответ</p>}
    </div>
  )
}

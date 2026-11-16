"use client"

// Chat history controls of the AI chat panel (docs/specs/ai-chat §16.1,
// CH5): the user's chat list, «Новый чат», rename, «Удалить чат», and the
// thumbs up / down of an answer (Q14).
import { useState } from "react"
import { toast } from "sonner"
import { Check, ChevronDown, History, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react"
import { MessageAction } from "@/components/ai-elements/message"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { ChatFeedback, ChatThreadSummary } from "@/lib/chat/thread"
import { cn } from "@/lib/utils"

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : DATE.format(d)
}

export function ThreadControls({
  title,
  currentId,
  threads,
  saved,
  disabled,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  title: string
  currentId: string
  threads: ChatThreadSummary[]
  /** The current chat exists on the server (it has messages). */
  saved: boolean
  disabled: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (title: string) => Promise<boolean>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    const t = draft.trim()
    if (!t || t === title) return setEditing(false)
    if (await onRename(t)) setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save()
            if (e.key === "Escape") setEditing(false)
          }}
          className="h-8 text-sm"
          aria-label="Название чата"
        />
        <Button variant="ghost" size="icon-sm" onClick={() => void save()} aria-label="Сохранить название">
          <Check className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(false)} aria-label="Отмена">
          <X className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 max-w-[260px] gap-1.5" disabled={disabled}>
            <History className="size-4 shrink-0" />
            <span className="truncate">{title}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuItem onSelect={onNew}>
            <Plus className="size-4" />
            Новый чат
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Мои чаты</DropdownMenuLabel>
          <div className="max-h-80 overflow-y-auto">
            {threads.length === 0 && (
              <p className="text-muted-foreground px-2 py-1.5 text-sm">Пока нет сохранённых чатов</p>
            )}
            {threads.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => onSelect(t.id)}
                className={cn("flex items-center gap-2", t.id === currentId && "bg-accent/60")}
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{when(t.lastMessageAt)}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {saved && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => {
              setDraft(title)
              setEditing(true)
            }}
            aria-label="Переименовать чат"
            title="Переименовать чат"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => setConfirmDelete(true)}
            aria-label="Удалить чат"
            title="Удалить чат"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={onNew} aria-label="Новый чат" title="Новый чат">
        <Plus className="size-4" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
            <AlertDialogDescription>
              Чат «{title}» исчезнет из вашего списка. Сведения, которые уже переданы в источники организации,
              останутся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

async function sendFeedback(messageId: string, feedback: ChatFeedback | null, comment: string | null): Promise<boolean> {
  try {
    const r = await fetch("/api/chat/feedback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, feedback, comment }),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Thumbs up / down of one answer (Q14); «down» asks for an optional comment. */
export function FeedbackButtons({
  messageId,
  initial,
}: {
  messageId: string
  initial: ChatFeedback | null
}) {
  const [value, setValue] = useState<ChatFeedback | null>(initial)
  const [asking, setAsking] = useState(false)
  const [comment, setComment] = useState("")

  async function set(next: ChatFeedback | null, text: string | null = null) {
    const prev = value
    setValue(next)
    if (!(await sendFeedback(messageId, next, text))) {
      setValue(prev)
      toast.error("Не удалось сохранить оценку")
      return false
    }
    return true
  }

  return (
    <>
      <MessageAction
        tooltip="Хороший ответ"
        onClick={() => {
          setAsking(false)
          void set(value === "up" ? null : "up")
        }}
      >
        <ThumbsUp className={cn("size-3.5", value === "up" && "fill-current")} />
      </MessageAction>
      <MessageAction
        tooltip="Плохой ответ"
        onClick={() => {
          if (value === "down") {
            setAsking(false)
            void set(null)
          } else {
            void set("down").then((ok) => ok && setAsking(true))
          }
        }}
      >
        <ThumbsDown className={cn("size-3.5", value === "down" && "fill-current")} />
      </MessageAction>
      {asking && (
        <div className="mt-1 flex w-full basis-full flex-col gap-1.5">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Что не так с ответом? (необязательно)"
            maxLength={2000}
            className="min-h-16 text-sm"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void set("down", comment.trim() || null).then((ok) => {
                  if (ok) {
                    setAsking(false)
                    toast.success("Спасибо, оценка сохранена")
                  }
                })
              }
            >
              Отправить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

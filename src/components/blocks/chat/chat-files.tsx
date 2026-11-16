"use client"

// Files in the AI chat input (docs/specs/ai-chat-tools §5, decision Q22):
// chips of the attached files, «Сделать фото» (phone camera), the voice
// recorder, and the upload that runs when the message is sent — in chunks of
// ≤ 4 MB to our own route; the file becomes a source item of the org's
// «AI Chat» source and the message carries only its link. The server reads
// the file with the parser of its type; the chat model gets only the text.
import { useRef } from "react"
import type { FileUIPart } from "ai"
import { Camera, FileAudio, FileText, FileVideo, ImageIcon, X } from "lucide-react"
import {
  PromptInputActionMenuItem,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { VoiceRecorderButton } from "@/components/blocks/chat/voice-recorder"
import { chatFileKind, chatFileProblem, type ChatAttachmentPart } from "@/lib/chat/files"
import { cn } from "@/lib/utils"

function FileKindIcon({ mediaType, name }: { mediaType: string; name: string }) {
  const kind = chatFileKind(mediaType, name) ?? "pdf"
  const props = { className: "text-muted-foreground size-3.5 shrink-0" }
  switch (kind) {
    case "image":
      return <ImageIcon {...props} />
    case "audio":
      return <FileAudio {...props} />
    case "video":
      return <FileVideo {...props} />
    default:
      return <FileText {...props} />
  }
}

// ── Upload ────────────────────────────────────────────────────────────

/** Longest side of an image sent to the parser (a phone photo is 4000+ px and often > 5 MB). */
const IMAGE_MAX_SIDE = 2400
const IMAGE_KEEP_BYTES = 4 * 1024 * 1024

/**
 * Images → what the image parser reads: JPEG / PNG ≤ 5 MB. Other types (WebP,
 * GIF, HEIC the browser can decode) become JPEG; a big photo is scaled down
 * to ≤ 2400 px (still sharp enough to read a business card).
 */
async function normaliseImage(blob: Blob, name: string): Promise<{ blob: Blob; name: string; type: string }> {
  const type = blob.type.toLowerCase()
  if (!type.startsWith("image/")) return { blob, name, type: type || blob.type }
  const native = type === "image/jpeg" || type === "image/png"
  if (native && blob.size <= IMAGE_KEEP_BYTES) return { blob, name, type }
  const bitmap = await createImageBitmap(blob)
  if (native && Math.max(bitmap.width, bitmap.height) <= IMAGE_MAX_SIDE && blob.size <= 5 * 1024 * 1024) {
    return { blob, name, type }
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext("2d")
  if (g) {
    g.fillStyle = "#fff" // a transparent PNG would turn black in JPEG
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  bitmap.close()
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92))
  if (!jpeg) throw new Error(`Не удалось подготовить изображение «${name}»`)
  return { blob: jpeg, name: name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", type: "image/jpeg" }
}

async function readError(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `Ошибка загрузки (${r.status})`
}

/** Upload one file (chunked) → the file part of the message. Throws an Error with a Russian message. */
async function uploadOne(part: FileUIPart): Promise<FileUIPart> {
  const source = await (await fetch(part.url)).blob()
  const { blob, name, type } = await normaliseImage(source, part.filename ?? "file")
  const mediaType = type || part.mediaType || "application/octet-stream"
  const problem = chatFileProblem(mediaType, name, blob.size)
  if (problem) throw new Error(problem)
  const created = await fetch("/api/chat/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mediaType, size: blob.size }),
  })
  if (!created.ok) throw new Error(await readError(created))
  const { itemId, parts, chunkBytes } = (await created.json()) as { itemId: string; parts: number; chunkBytes: number }
  for (let n = 1; n <= parts; n++) {
    const chunk = blob.slice((n - 1) * chunkBytes, n * chunkBytes)
    const r = await fetch(`/api/chat/files/${encodeURIComponent(itemId)}/parts/${n}`, { method: "PUT", body: chunk })
    if (!r.ok) throw new Error(await readError(r))
  }
  const done = await fetch(`/api/chat/files/${encodeURIComponent(itemId)}/complete`, { method: "POST" })
  if (!done.ok) throw new Error(await readError(done))
  const { url } = (await done.json()) as { url: string }
  return { type: "file", url, mediaType, filename: name }
}

/** Upload all files of a message (in order). */
export async function uploadChatFiles(files: FileUIPart[]): Promise<FileUIPart[]> {
  const out: FileUIPart[] = []
  for (const f of files) out.push(await uploadOne(f))
  return out
}

// ── Input pieces (inside <PromptInput>) ───────────────────────────────

/** Chips of the files attached to the message being written. */
export function InputAttachmentChips() {
  const { files, remove } = usePromptInputAttachments()
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {files.map((f) => {
        return (
          <span key={f.id} className="bg-muted flex max-w-[220px] items-center gap-1 rounded-md px-2 py-1 text-xs">
            <FileKindIcon mediaType={f.mediaType} name={f.filename ?? ""} />
            <span className="truncate">{f.filename ?? "файл"}</span>
            <button
              type="button"
              onClick={() => remove(f.id)}
              className="text-muted-foreground hover:text-foreground ml-0.5"
              aria-label={`Убрать «${f.filename ?? "файл"}»`}
            >
              <X className="size-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/** Menu item «Сделать фото» — the phone camera (or a file picker on a desktop). */
export function CameraMenuItem() {
  const { add } = usePromptInputAttachments()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <PromptInputActionMenuItem onSelect={() => ref.current?.click()}>
        <Camera className="size-4" />
        Сделать фото
      </PromptInputActionMenuItem>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) add(e.target.files)
          e.target.value = ""
        }}
      />
    </>
  )
}

/** The voice recorder; the recording is attached as a WAV file. */
export function VoiceAttachButton({ disabled }: { disabled?: boolean }) {
  const { add } = usePromptInputAttachments()
  return <VoiceRecorderButton disabled={disabled} onRecorded={(file) => add([file])} />
}

// ── Sent messages ─────────────────────────────────────────────────────

/** A sent file that is not an image: a chip that opens the original. */
export function SentFileChip({ url, mediaType, name }: { url: string; mediaType: string; name: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="bg-muted hover:bg-muted/70 flex max-w-xs items-center gap-1.5 rounded-md px-2 py-1 text-xs"
    >
      <FileKindIcon mediaType={mediaType} name={name} />
      <span className="truncate">{name}</span>
    </a>
  )
}

/** What the system read from the files of a sent message. */
export function AttachmentReadStatus({ items }: { items: ChatAttachmentPart[] }) {
  if (!items.length) return null
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((a) => (
        <p
          key={a.itemId}
          className={cn("text-xs", a.status === "parsed" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}
        >
          {a.status === "parsed"
            ? `${a.kind === "audio" || a.kind === "video" ? "Расшифровано" : "Прочитано"}: «${a.name}»`
            : `Не прочитано: «${a.name}» — ${a.reason ?? "ошибка"}`}
        </p>
      ))}
    </div>
  )
}

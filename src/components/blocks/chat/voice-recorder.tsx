"use client"

// Voice recorder for the AI chat. Records raw PCM through Web Audio (not
// MediaRecorder: Chrome gives WebM, which the server audio parser does not
// accept) and delivers a 16 kHz mono 16-bit WAV file.

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, Square, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { VOICE_MAX_SECONDS, WAV_SAMPLE_RATE, downsampleTo, encodeWav16, voiceFileName } from "@/lib/chat/wav"

const MIN_SECONDS = 1
const PROCESSOR_NAME = "chat-pcm-capture"

// AudioWorklet processor: copies input channel 0 and posts it in ~4096-sample batches.
const PROCESSOR_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.len = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.len++] = ch[i]
        if (this.len === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(4096); this.len = 0 }
      }
    }
    return true
  }
}
registerProcessor("${PROCESSOR_NAME}", PcmCapture)
`

type Session = {
  stream: MediaStream
  ctx: AudioContext
  nodes: AudioNode[]
  chunks: Float32Array[]
  timer: ReturnType<typeof setInterval>
}

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

function getAudioContextClass(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

function errorText(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ""
  if (name === "NotAllowedError" || name === "SecurityError") return "Нет доступа к микрофону"
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Микрофон не найден"
  if (name === "NotReadableError") return "Микрофон занят другим приложением"
  return "Не удалось начать запись"
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** Builds the capture graph: mic → worklet (or ScriptProcessor) → muted gain → destination. */
async function startCapture(ctx: AudioContext, stream: MediaStream, onChunk: (c: Float32Array) => void) {
  const source = ctx.createMediaStreamSource(stream)
  const mute = ctx.createGain()
  mute.gain.value = 0
  mute.connect(ctx.destination)

  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "application/javascript" }))
    try {
      await ctx.audioWorklet.addModule(url)
      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data)
      source.connect(node)
      node.connect(mute)
      return [source, node, mute]
    } catch (err) {
      // E.g. a CSP that blocks blob: modules — use the ScriptProcessor path below.
      console.warn("[voice-recorder] AudioWorklet unavailable, using ScriptProcessor", err)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Fallback for browsers without AudioWorklet.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  node.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
  source.connect(node)
  node.connect(mute)
  return [source, node, mute]
}

export function VoiceRecorderButton({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void
  disabled?: boolean
}) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle")
  const [seconds, setSeconds] = useState(0)
  const sessionRef = useRef<Session | null>(null)
  // Bumped on every start / stop so a start that resolves late can tell it was cancelled.
  const runRef = useRef(0)
  const onRecordedRef = useRef(onRecorded)

  useEffect(() => {
    onRecordedRef.current = onRecorded
  }, [onRecorded])

  /** Stops the tracks, closes the context and returns what was recorded. */
  const teardown = useCallback(() => {
    runRef.current++
    const s = sessionRef.current
    sessionRef.current = null
    if (!s) return null
    clearInterval(s.timer)
    for (const n of s.nodes) {
      try {
        n.disconnect()
      } catch {
        // already disconnected
      }
    }
    s.stream.getTracks().forEach((t) => t.stop())
    const sampleRate = s.ctx.sampleRate
    void s.ctx.close().catch(() => {})
    return { chunks: s.chunks, sampleRate }
  }, [])

  const finish = useCallback(
    (deliver: boolean) => {
      const rec = teardown()
      setState("idle")
      setSeconds(0)
      if (!deliver || !rec) return
      const samples = mergeChunks(rec.chunks)
      if (samples.length < rec.sampleRate * MIN_SECONDS) {
        toast.info("Слишком короткая запись")
        return
      }
      const pcm = downsampleTo(samples, rec.sampleRate, Math.min(WAV_SAMPLE_RATE, rec.sampleRate))
      const bytes = encodeWav16(pcm, Math.min(WAV_SAMPLE_RATE, rec.sampleRate))
      onRecordedRef.current(new File([bytes], voiceFileName(new Date()), { type: "audio/wav" }))
    },
    [teardown],
  )

  const start = useCallback(async () => {
    const AudioContextClass = getAudioContextClass()
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
      toast.error("Браузер не поддерживает запись звука")
      return
    }
    const run = ++runRef.current
    setState("starting")
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (run !== runRef.current) throw new DOMException("cancelled", "AbortError")
      ctx = new AudioContextClass()
      if (ctx.state === "suspended") await ctx.resume()
      const chunks: Float32Array[] = []
      const nodes = await startCapture(ctx, stream, (c) => chunks.push(c))
      if (run !== runRef.current) throw new DOMException("cancelled", "AbortError")

      const startedAt = Date.now()
      const timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        setSeconds(elapsed)
        if (elapsed >= VOICE_MAX_SECONDS) {
          toast.info("Запись остановлена: максимум 5 минут")
          finish(true)
        }
      }, 250)
      sessionRef.current = { stream, ctx, nodes, chunks, timer }
      setSeconds(0)
      setState("recording")
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
      if (err instanceof DOMException && err.name === "AbortError") return
      if (run === runRef.current) setState("idle")
      console.error("[voice-recorder] start failed", err)
      toast.error(errorText(err))
    }
  }, [finish])

  // Release the microphone when the component goes away.
  useEffect(() => () => void teardown(), [teardown])

  if (state === "idle" || state === "starting") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Записать голосовое сообщение"
        title="Записать голосовое сообщение"
        disabled={disabled || state === "starting"}
        onClick={() => void start()}
      >
        <Mic />
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Запись голосового сообщения">
      <span className="relative flex size-2.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
      </span>
      <span className="min-w-9 text-xs text-muted-foreground tabular-nums" aria-live="off">
        {formatTime(seconds)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Остановить запись"
        title="Остановить запись"
        onClick={() => finish(true)}
      >
        <Square className="fill-current" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Отменить запись"
        title="Отменить запись"
        onClick={() => finish(false)}
      >
        <X />
      </Button>
    </div>
  )
}

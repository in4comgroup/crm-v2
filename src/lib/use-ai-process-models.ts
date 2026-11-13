"use client"

import { useEffect, useState } from "react"
import type { AiPickerModel, AiPickerResponse } from "@/app/api/ai/models/route"

// Model picker data for a user-selectable AI process (admin-allowed list).
// `process` is a process key from src/server/ai/processes.ts, e.g.
// "chat.assistant", "cards.generation", "deals.discovery".
// Send the picked `id` to the server as the requested model; the server
// ignores ids outside the allowed list.
export function useAiProcessModels(process: string): {
  models: AiPickerModel[]
  defaultModelId: string | null
  loading: boolean
  error: string | null
} {
  const [state, setState] = useState<{
    process: string
    data: AiPickerResponse | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/ai/models?process=${encodeURIComponent(process)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as AiPickerResponse
      })
      .then((data) => !cancelled && setState({ process, data, error: null }))
      .catch(
        (e) =>
          !cancelled &&
          setState({ process, data: null, error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      cancelled = true
    }
  }, [process])

  const current = state?.process === process ? state : null
  return {
    models: current?.data?.models ?? [],
    defaultModelId: current?.data?.defaultModelId ?? null,
    loading: !current,
    error: current?.error ?? null,
  }
}

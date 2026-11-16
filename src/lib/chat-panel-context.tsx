"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import type { RecordType } from "@/lib/chat/records"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A json-render spec (the original panel content; `kind` may be omitted). */
export interface SpecPanelContent {
  kind?: "spec"
  spec: unknown
  messageId: string
  title?: string
}

/**
 * One CRM record, rendered by <RecordDetailView> (AI chat spec §7.2).
 * `title` = the title known when opening (e.g. the row title); the panel
 * shows «Загрузка…» until the detail is loaded when it is missing.
 */
export interface RecordPanelContent {
  kind: "record"
  type: RecordType
  id: string
  title?: string
}

export type PanelContent = SpecPanelContent | RecordPanelContent

export function isRecordPanelContent(c: PanelContent | null | undefined): c is RecordPanelContent {
  return c?.kind === "record"
}

interface PanelContextValue {
  isOpen: boolean
  content: PanelContent | null
  history: PanelContent[]
  openPanel: (content: PanelContent) => void
  /** Shortcut for `openPanel({ kind: "record", type, id, title })`. */
  openRecord: (type: RecordType, id: string, title?: string) => void
  closePanel: () => void
  goBack: () => void
}

function samePanel(a: PanelContent, b: PanelContent): boolean {
  if (isRecordPanelContent(a) && isRecordPanelContent(b)) return a.type === b.type && a.id === b.id
  return false
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PanelContext = createContext<PanelContextValue | null>(null)

export function usePanelContext() {
  const ctx = useContext(PanelContext)
  if (!ctx)
    throw new Error("usePanelContext must be used within PanelProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<PanelContent | null>(null)
  const [history, setHistory] = useState<PanelContent[]>([])

  const openPanel = useCallback((newContent: PanelContent) => {
    setContent((prev) => {
      // Re-opening the record already shown adds no history step.
      if (prev && samePanel(prev, newContent)) return prev
      if (prev) setHistory((h) => [...h, prev])
      return newContent
    })
  }, [])

  const openRecord = useCallback(
    (type: RecordType, id: string, title?: string) =>
      openPanel({ kind: "record", type, id, title }),
    [openPanel],
  )

  const closePanel = useCallback(() => {
    setContent(null)
    setHistory([])
  }, [])

  const goBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1]
      if (prev) {
        setContent(prev)
        return h.slice(0, -1)
      }
      setContent(null)
      return []
    })
  }, [])

  return (
    <PanelContext.Provider
      value={{
        isOpen: content !== null,
        content,
        history,
        openPanel,
        openRecord,
        closePanel,
        goBack,
      }}
    >
      {children}
    </PanelContext.Provider>
  )
}

"use client"

// The org's time context in the browser (2026-11-26): time zone + default
// task due time, loaded once by the (protected) layout (`loadOrgTime`) and
// read with `useOrgTime()`. Task deadlines are entered and shown in the ORG
// zone, never in the browser's zone (src/lib/org-time.ts).

import { createContext, useContext } from "react"
import { ORG_TIME_FALLBACK, type OrgTime } from "@/lib/org-time"

const OrgTimeContext = createContext<OrgTime>(ORG_TIME_FALLBACK)

export function OrgTimeProvider({ value, children }: { value: OrgTime; children: React.ReactNode }) {
  return <OrgTimeContext.Provider value={value}>{children}</OrgTimeContext.Provider>
}

export function useOrgTime(): OrgTime {
  return useContext(OrgTimeContext)
}

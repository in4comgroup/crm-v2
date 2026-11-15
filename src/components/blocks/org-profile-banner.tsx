"use client"

// Banner for the org OWNER while the mandatory minimum of «Профиль
// организации» is incomplete (identity spec §3.3). Red when the org already
// runs topics `shadow` / `on` (decision Q4). Shown on /dashboard and /account.
// The server decides who sees it (GET /api/org-profile?banner=1).

import { useEffect, useState } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OrgProfileBanner as BannerState } from "@/app/api/org-profile/route"

export function OrgProfileBanner({
  refreshKey,
  onOpen,
  className,
}: {
  /** Change it to re-check (e.g. after a profile save). */
  refreshKey?: number
  /** In-page handler (the /account tab); else a link to /account?tab=org-profile. */
  onOpen?: () => void
  className?: string
}) {
  const [state, setState] = useState<BannerState | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/org-profile?banner=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setState(d)
      })
      .catch(() => {
        if (!cancelled) setState(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!state?.show) return null

  const linkClass = "font-medium underline underline-offset-2"
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        state.severe
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span className="flex-1">
        Заполните профиль организации — без него ИИ не отличает внутреннюю переписку от внешней.
      </span>
      <span className="whitespace-nowrap">
        {state.done} из {state.total}
      </span>
      {onOpen ? (
        <button type="button" className={linkClass} onClick={onOpen}>
          Открыть профиль
        </button>
      ) : (
        <Link href="/account?tab=org-profile" className={linkClass}>
          Открыть профиль
        </Link>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"

// Remember the open tab / view of a page per browser (2026-11-15, product
// owner: «every reload comes to the initial state and the user is lost»).
//
// - Storage: `localStorage["ui.tab.<key>"]` — a per-viewer convenience only;
//   every access is in try/catch (private mode, blocked storage) and the page
//   works without it.
// - A deep link wins: `?<urlParam>=<value>` (default param `tab`) is read on
//   mount and also stored. `urlParam: false` = no URL reading (several tab
//   sets on one page: only the main one reads `?tab=`).
// - `allowed` limits values (a stale stored value of a removed / hidden tab
//   falls back to `initial`).
// - SSR-safe: the first render uses `initial`, the stored value is applied
//   right after mount.

const PREFIX = "ui.tab."

export function readStoredTab(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writeStoredTab(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    // storage blocked — nothing to remember
  }
}

/** The tab the page should open: `?tab=` first, then the stored one, if allowed. */
export function initialTabFromBrowser<T extends string>(
  key: string,
  opts: { allowed?: readonly T[]; urlParam?: string | false } = {},
): T | null {
  const ok = (v: string | null): v is T => !!v && (!opts.allowed || (opts.allowed as readonly string[]).includes(v))
  if (opts.urlParam !== false && typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get(opts.urlParam ?? "tab")
    if (ok(fromUrl)) {
      writeStoredTab(key, fromUrl)
      return fromUrl
    }
  }
  const stored = readStoredTab(key)
  return ok(stored) ? stored : null
}

export function usePersistentTab<T extends string>(
  key: string,
  initial: T,
  opts: { allowed?: readonly T[]; urlParam?: string | false } = {},
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const allowedKey = opts.allowed?.join("|") ?? ""
  useEffect(() => {
    const restored = initialTabFromBrowser<T>(key, opts)
    if (restored) setValue(restored)
    // `opts` is read once on mount (and when the allowed set changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowedKey])
  const set = useCallback(
    (v: T) => {
      setValue(v)
      writeStoredTab(key, v)
    },
    [key],
  )
  return [value, set]
}

"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefCallback } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { SheetContent } from "@/components/ui/sheet"
import { TabsList } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const MeasureTabsContext = createContext<RefCallback<HTMLDivElement> | null>(null)

export type DetailNavigationStatus = "ready" | "dirty" | "busy"
type RequestNavigation = (run: () => void) => void

export function useDetailNavigation(
  currentId: string | null,
  ids: readonly string[],
  openRecord: (id: string) => void,
  edges?: { previous?: (request: RequestNavigation) => void; next?: (request: RequestNavigation) => void },
) {
  const guard = useRef<(() => DetailNavigationStatus) | undefined>(undefined)
  const pendingRequest = useRef<(() => void) | null>(null)
  const [pending, setPending] = useState(false)
  const registerGuard = useCallback((getStatus: (() => DetailNavigationStatus) | undefined) => {
    guard.current = getStatus
    return () => { guard.current = undefined }
  }, [])

  const request = useCallback((run: () => void) => {
    if (!currentId) {
      run()
      return
    }
    if (pendingRequest.current) return
    const status = guard.current?.()
    if (status === "busy") return
    if (status === "dirty") {
      pendingRequest.current = run
      setPending(true)
    } else run()
  }, [currentId])

  function resolvePending(proceed: boolean) {
    const run = pendingRequest.current
    pendingRequest.current = null
    setPending(false)
    if (proceed) run?.()
  }

  const index = currentId === null ? -1 : ids.indexOf(currentId)
  const previous = index > 0 ? () => request(() => openRecord(ids[index - 1])) : index === 0 && edges?.previous ? () => edges.previous?.(request) : undefined
  const next = index < 0 ? undefined : index + 1 < ids.length ? () => request(() => openRecord(ids[index + 1])) : edges?.next ? () => edges.next?.(request) : undefined

  return {
    request,
    select: (id: string) => {
      if (id !== currentId) request(() => openRecord(id))
    },
    navigation: {
      registerGuard,
      pending,
      resolvePending,
      previous,
      next,
    },
  }
}

export type DetailNavigation = ReturnType<typeof useDetailNavigation>["navigation"]

const KEYBOARD_SURFACES = ':is([data-slot="sheet-content"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"]:not(.pointer-events-none), [role="menu"], [role="listbox"])[data-state="open"]'
const ARROW_CONTROLS = 'input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="tablist"], [role="separator"]'

function DetailDrawerNavigation({ navigation }: { navigation: DetailNavigation }) {
  const footerRef = useRef<HTMLElement>(null)
  const { previous, next, pending, resolvePending } = navigation

  useEffect(() => {
    const sheet = footerRef.current?.closest('[data-slot="sheet-content"]')
    if (!sheet || pending) return
    function handleKeyDown(event: KeyboardEvent) {
      const move = event.key === "ArrowUp" ? previous : event.key === "ArrowDown" ? next : undefined
      if (!move || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.closest(ARROW_CONTROLS)) return
      const surfaces = document.querySelectorAll(KEYBOARD_SURFACES)
      if (surfaces[surfaces.length - 1] !== sheet) return
      event.preventDefault()
      move()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [previous, next, pending])

  return (
    <>
      <nav ref={footerRef} aria-label="Навигация по записям" className="mt-auto flex shrink-0 items-center gap-1 border-t px-4 py-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Предыдущий" aria-keyshortcuts="ArrowUp" disabled={!previous} onClick={previous}>
                  <ChevronUp aria-hidden />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">Предыдущий (↑)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Следующий" aria-keyshortcuts="ArrowDown" disabled={!next} onClick={next}>
                  <ChevronDown aria-hidden />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">Следующий (↓)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </nav>
      <AlertDialog open={pending} onOpenChange={(open) => { if (!open) resolvePending(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перейти к другой записи?</AlertDialogTitle>
            <AlertDialogDescription>Текущие изменения будут потеряны.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Остаться</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolvePending(true)}>Перейти без сохранения</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function DetailDrawerContent({
  children, className, defaultWidth = "576px", minimumWidth = 360, widthStorageKey,
  navigation, getNavigationStatus, onInteractOutside, ...props
}: Omit<ComponentProps<typeof SheetContent>, "side" | "style"> & {
  defaultWidth?: string
  minimumWidth?: number
  widthStorageKey?: string
  navigation?: DetailNavigation
  getNavigationStatus?: () => DetailNavigationStatus
}) {
  const registerGuard = navigation?.registerGuard
  useLayoutEffect(() => registerGuard?.(getNavigationStatus), [registerGuard, getNavigationStatus])
  const [width, setWidth] = useState<number | null>(() => {
    if (!widthStorageKey) return null
    try {
      const stored = Number(localStorage.getItem(widthStorageKey))
      return Number.isFinite(stored) && stored > 0 ? stored : null
    } catch {
      return null
    }
  })
  const [tabsWidth, setTabsWidth] = useState(0)
  const measuredMinimum = tabsWidth || minimumWidth
  const measureTabs = useCallback((tabs: HTMLDivElement | null) => {
    const scrollArea = tabs?.parentElement
    const sheet = tabs?.closest('[data-slot="sheet-content"]')
    if (!tabs || !scrollArea || !sheet) return
    const observer = new ResizeObserver(() => {
      const inset = sheet.getBoundingClientRect().width - scrollArea.getBoundingClientRect().width
      setTabsWidth(Math.ceil(tabs.getBoundingClientRect().width + inset))
    })
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [])

  function resize(nextWidth: number) {
    const max = Math.max(measuredMinimum, window.innerWidth * 0.85)
    const next = Math.min(max, Math.max(measuredMinimum, nextWidth))
    setWidth(next)
    return next
  }

  function remember(next: number | null) {
    if (!widthStorageKey || next === null) return
    try {
      localStorage.setItem(widthStorageKey, String(next))
    } catch {
      // The drawer also works without browser storage.
    }
  }

  return (
    <SheetContent
      {...props}
      onInteractOutside={(event) => {
        if (navigation) event.preventDefault()
        onInteractOutside?.(event)
      }}
      className={cn("w-full gap-0 p-0", className)}
      style={{
        maxWidth: width === null
          ? `max(${measuredMinimum}px, ${defaultWidth})`
          : `clamp(${measuredMinimum}px, ${width}px, 85vw)`,
      }}
    >
      <div
        role="separator"
        aria-label="Изменить ширину панели"
        aria-orientation="vertical"
        tabIndex={0}
        className="absolute inset-y-0 left-0 z-10 hidden w-1 cursor-col-resize touch-none select-none hover:bg-[#669BBC]/40 focus-visible:bg-[#669BBC]/40 sm:block"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            resize(window.innerWidth - event.clientX)
          }
        }}
        onLostPointerCapture={() => remember(width)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          const currentWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? measuredMinimum
          remember(resize(currentWidth + (event.key === "ArrowLeft" ? 32 : -32)))
        }}
      />
      <MeasureTabsContext.Provider value={measureTabs}>{children}</MeasureTabsContext.Provider>
      {navigation && <DetailDrawerNavigation navigation={navigation} />}
    </SheetContent>
  )
}

export function DetailDrawerTabs({ children }: { children: React.ReactNode }) {
  const measureTabs = useContext(MeasureTabsContext)
  return (
    <div className="mt-1 overflow-x-auto overflow-y-hidden scrollbar-none">
      <TabsList
        ref={measureTabs}
        variant="line"
        className="w-max justify-start gap-2 whitespace-nowrap p-0 [&_[role=tab]]:h-full! [&_[role=tab]]:after:bottom-0! [&_[role=tab]:focus-visible]:border-transparent! [&_[role=tab]:focus-visible]:ring-0! [&_[role=tab]:focus-visible]:outline-none! [&_[role=tab]:focus-visible]:bg-foreground/10!"
      >
        {children}
      </TabsList>
    </div>
  )
}

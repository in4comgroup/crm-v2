"use client"

import { useState } from "react"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AlertTriangle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Trash2,
  PauseCircle,
  Bot,
  Undo2,
  Clock,
} from "lucide-react"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import type { DealRow } from "@/app/api/deals/route"
import type { DealTaskInfo } from "@/hooks/use-board-intel"
import { formatAmount } from "@/lib/deal-board"
import { formatPauseUntil, isOpenDealStatus } from "@/lib/deal-funnel"
import {
  dealStaleInfo,
  lastActivityHint,
  type DealStaleInfo,
} from "@/lib/deal-activity"

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()


// Заголовок: компания (клиент) сверху, продукт/проект (название сделки) — строкой
// ниже. Если клиент не привязан, название сделки само становится заголовком.
function DealTitle({ deal }: { deal: DealRow }) {
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium leading-snug truncate">{company}</div>
      {product && (
        // Две строки (UX №8) — в одну описание не вмещается. Дедуп названия
        // компании в описании — на стороне генератора текста (бэк-вопрос).
        <div className="text-xs text-muted-foreground leading-snug line-clamp-2">
          {product}
        </div>
      )}
      {/* Тип сделки (topics phase 5, §9.2) — мелкой строкой под названием. */}
      {deal.dealTypeLabel && (
        <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/80 truncate">
          {deal.dealTypeLabel}
        </div>
      )}
    </div>
  )
}

// «Пауза до …» (status `paused`, §9.2): сделка остаётся в своей стадии,
// бейдж показывает дату возврата, причина — в подсказке по наведению.
export function DealPausedBadge({ deal }: { deal: DealRow }) {
  if (deal.status !== "paused") return null
  const until = formatPauseUntil(deal.pausedUntil)
  const badge = (
    <Badge
      variant="secondary"
      className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300"
    >
      <PauseCircle className="h-3 w-3" />
      {until ? `Пауза до ${until}` : "На паузе"}
    </Badge>
  )
  if (!deal.pauseReason) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-help"
          aria-label="Почему сделка на паузе"
          onPointerDown={stop}
          onClick={stop}
        >
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-xs text-xs">
        {deal.pauseReason}
      </TooltipContent>
    </Tooltip>
  )
}

// Бейдж «создал агент» (topics phase 5): сделку создал движок тем. Пока
// сделка открыта (active / paused) — рядом кнопка «Отменить» (undo →
// подтверждение в диалоге доски, сделка уходит в `deleted`, причина
// сохраняется).
export function DealCreatedByAgentBadge({
  deal,
  onUndo,
}: {
  deal: DealRow
  onUndo?: (deal: DealRow) => void
}) {
  if (!deal.createdByAgent) return null
  const canUndo = Boolean(onUndo) && isOpenDealStatus(deal.status)
  return (
    <div className="flex items-center gap-1">
      <Badge
        variant="secondary"
        className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
      >
        <Bot className="h-3 w-3" />
        создал агент
      </Badge>
      {canUndo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e)
            onUndo?.(deal)
          }}
        >
          <Undo2 className="h-3 w-3" />
          Отменить
        </Button>
      )}
    </div>
  )
}

// «N дн» / «N дн без активности» (src/lib/deal-activity.ts): дни с последней
// активности — последнее сообщение по темам сделки, иначе журнал / задачи /
// создание сделки. Серая строка всегда, когда дата известна; больше нормы
// стадии — красный бейдж (норма — в подсказке). Не на Закрыта / Проиграна и
// не на паузе (`dealStaleInfo` → null).
export function DealActivityAge({
  deal,
  info,
}: {
  deal: DealRow
  info: DealStaleInfo
}) {
  const tip = useAnchorTooltip()
  const hint = lastActivityHint(deal, info.isStale ? info.norm : undefined)
  return (
    <>
      <span
        className="inline-flex w-fit self-start cursor-help"
        aria-label={hint ?? undefined}
        onPointerDown={stop}
        onClick={stop}
        {...tip.bind}
      >
        {info.isStale ? (
          <Badge
            variant="secondary"
            className="gap-1 bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
          >
            <Clock className="h-3 w-3" />
            {info.days} дн без активности
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {info.days} дн
          </span>
        )}
      </span>
      {hint && (
        <AnchorTooltip text={hint} open={tip.open} virtualRef={tip.virtualRef} />
      )}
    </>
  )
}

// Сумма и имя менеджера — в две строки (сумма сверху, менеджер под ней).
function DealMetaLine({ deal }: { deal: DealRow }) {
  const amount = formatAmount(deal.value, deal.currency)
  if (!amount && !deal.userName) return null
  return (
    <div className="text-sm leading-tight">
      {amount && <div className="font-semibold">{amount}</div>}
      {deal.userName && (
        <div className="text-xs text-muted-foreground">{deal.userName}</div>
      )}
    </div>
  )
}

export function DealKanbanCard({
  deal,
  onOpen,
  tasks = [],
  boardLoaded = false,
  onUndoAgent,
}: {
  deal: DealRow
  onOpen: (deal: DealRow) => void
  // «Отменить» у бейджа «создал агент» — открывает диалог подтверждения на
  // доске (deals-board.tsx). Без пропа кнопки нет.
  onUndoAgent?: (deal: DealRow) => void
  // Все задачи сделки (по createdAt desc). Карточка листает их шевронами.
  tasks?: DealTaskInfo[]
  // Загружены ли данные доски (задачи). До загрузки НЕ показываем
  // «Задач нет» — иначе ложная «красная» вспышка на первом рендере.
  boardLoaded?: boolean
}) {
  // Индекс листаемой задачи (0 = самая свежая). Клампится к длине списка.
  const [taskIdx, setTaskIdx] = useState(0)
  const taskCount = tasks.length
  const safeIdx = taskCount ? Math.min(taskIdx, taskCount - 1) : 0
  const currentTask = tasks[safeIdx] ?? null
  // Перетаскиваются ВСЕ активные сделки — человек вправе двигать как хочет
  // (в т.ч. переигрывать агентские переводы). Заблокированы только
  // отменённые/удалённые: их статус терминальный, перенос не имеет смысла.
  // Сделка на паузе (`paused`) — открытая: остаётся в своей стадии и
  // перетаскивается как активная (§9.2: пауза — статус, не стадия).
  const isActive = isOpenDealStatus(deal.status)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !isActive,
  })
  // Карточка ещё и droppable — для точной вставки before/after в колонке
  // (collisionDetection в board.tsx предпочитает card-цели колоночной).
  // Drag остаётся на всей карточке; клик-vs-drag разведён justDraggedRef в board.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${deal.id}`,
    data: { type: "card" as const, stageId: deal.funnelStageId, dealId: deal.id },
  })

  // Исход в финальной колонке: выиграна (роль стадии `won`) / проиграна
  // (`lost`) — по роли стадии воронки, не по имени (docs/specs/funnel §3.1).
  // Только активные — отменённые/удалённые несут свои бейджи.
  const isWon = isActive && deal.funnelStageRole === "won"
  const isLost = isActive && deal.funnelStageRole === "lost"

  // Метка «перевёл агент»: последний перевод стадии сделал агент (движок
  // тем) и человек его ещё не пересматривал. Причина перевода (changes) — в поповере бейджа.
  const movedByAgent = deal.lastMovedBy === "agent"
  // «Есть риски» (topics phase 5a, spec §9.4): ≥ 1 активный риск сделки.
  // `riskSummary` = самый критичный риск (батч-запрос вместе с доской).
  // Удалённые сделки бейдж не показывают.
  const risk = deal.status !== "deleted" ? (deal.riskSummary?.top ?? null) : null
  const atRisk = Boolean(risk)
  const isPaused = deal.status === "paused"
  // «N дн без активности»: null на терминальных стадиях / паузе / без даты.
  const stale = dealStaleInfo(deal)
  const hasBadgeRow =
    Boolean(stale?.isStale) ||
    movedByAgent ||
    atRisk ||
    isPaused ||
    deal.createdByAgent

  // «Негативные» карточки (удалённые/отменённые/не состоявшиеся = активная
  // Rejected) — обычная тема-зависимая поверхность карточки, просто
  // притушенная (opacity), а не отдельный жёстко-тёмный фон: тот фон был
  // захардкожен под тёмную тему и в светлой выглядел чужеродным плотным
  // чёрным блоком среди светлых карточек.
  const isGraphite =
    deal.status === "deleted" || deal.status === "cancelled" || isLost
  // border-border (not border-muted): unlike Companies/Dashboard, these
  // cards sit directly on the atmospheric page background (no bg-card
  // wrapper around the columns) — border-muted (oklch 0.955) is nearly
  // indistinguishable from that background (oklch 0.98) in light theme.
  // Light theme uses a solid `bg-card` (pure white, oklch 1) instead of the
  // translucent cream tint Companies/Dashboard use — those sit ON TOP of an
  // already-white `bg-card` wrapper, so a tint reads as a card; here, with
  // no such wrapper, a tint over the atmospheric background just looked
  // washed-out rather than like a real card. Stays white on hover too
  // (hover:bg-card, not hover:bg-muted) — only the shadow signals hover in
  // light theme. Dark theme also uses solid `bg-card` (oklch 0.2938 — same
  // token the toolbar/column-header panels already sit on) instead of the
  // cream tint, for the same "real card" reasoning; `dark:hover:bg-secondary`
  // (oklch 0.3314) is the next step up in the palette, a modest "slightly
  // lighter" rather than the bigger jump `accent` would be.
  const normalSurface =
    "bg-card border-border shadow-sm hover:shadow-lg hover:bg-card dark:hover:bg-secondary"
  const surfaceClass = isGraphite ? `${normalSurface} opacity-55` : normalSurface

  return (
    <Card
      ref={(node) => {
        setNodeRef(node)
        setDropRef(node)
      }}
      data-deal-id={deal.id}
      {...attributes}
      {...listeners}
      className={`gap-4 p-3 transition-[box-shadow,background-color] duration-200 ${surfaceClass} ${
        isActive ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${isDragging ? "opacity-40" : ""}`}
      aria-label={`Открыть сделку: ${deal.clientName ?? deal.name}`}
      onClick={() => onOpen(deal)}
      onKeyDown={(e) => {
        // Клавиатурная активация: карточка получает role=button/tabIndex от
        // dnd-kit, поэтому Enter/Space должны открывать drawer. Реагируем только
        // на фокус самой карточки, не вложенных кнопок.
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(deal)
        }
      }}
    >
      {/* Редактирование — только через дровер (карточка подробностей слита с
          формой правки); клик по всей карточке уже открывает его, отдельной
          кнопки-карандаша на карточке больше нет. */}
      <DealTitle deal={deal} />

      {isWon && (
        <Badge
          variant="secondary"
          className="gap-1 bg-[#1F7A4D]/15 text-[#1F7A4D] dark:text-[#5BD69A]"
        >
          <Trophy className="h-3 w-3" />
          Выиграно
        </Badge>
      )}
      {isLost && (
        <Badge
          variant="secondary"
          className="gap-1 bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
        >
          <Trash2 className="h-3 w-3" />
          Не состоялась
        </Badge>
      )}
      {deal.status === "cancelled" && (
        <Badge
          variant="secondary"
          className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
        >
          Отменена
        </Badge>
      )}
      {deal.status === "deleted" && (
        <Badge
          variant="secondary"
          className="bg-red-500/15 text-red-600 dark:text-red-300"
        >
          Удалена
        </Badge>
      )}

      <DealMetaLine deal={deal} />

      {stale && !stale.isStale && <DealActivityAge deal={deal} info={stale} />}

      {/* «Текущее состояние» (topics phase 5a, spec §9.3 + topics/10): only
          the engine's stored text, built from the topics linked to the deal,
          up to 3 lines (full text + sources in the drawer). The old discovery
          text (changes / reasoning) is never shown as the status. Plain
          background + border (a translucent card «ate» muted/50). */}
      {deal.stateText && (
        <div
          className="rounded-md border border-border bg-muted p-2 text-xs text-foreground/80"
          title={deal.stateText}
        >
          <p className="line-clamp-3">{deal.stateText}</p>
        </div>
      )}

      {/* Задачи: заголовок СНАРУЖИ плашки. Одна задача → «Задача»; несколько →
          «Задачи» + счётчик, а справа шевроны для листания задач прямо на
          карточке. Внутри плашки — имя + исполнитель (бейджи не показываем —
          вся детализация в подробностях). Нет задач → «Задач нет» оранжевым. */}
      {isActive &&
        (currentTask ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {taskCount > 1 ? `Задачи ${taskCount}` : "Задача"}
              </div>
              {taskCount > 1 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Предыдущая задача"
                    disabled={safeIdx === 0}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.max(0, i - 1))
                    }}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    aria-label="Следующая задача"
                    disabled={safeIdx >= taskCount - 1}
                    onPointerDown={stop}
                    onClick={(e) => {
                      stop(e)
                      setTaskIdx((i) => Math.min(taskCount - 1, i + 1))
                    }}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-muted p-2 space-y-1">
              <div className="truncate text-xs text-foreground">
                {currentTask.name}
              </div>
              {currentTask.assigneeName && (
                <div className="truncate text-[11px] text-muted-foreground">
                  Исполнитель: {currentTask.assigneeName}
                </div>
              )}
            </div>
          </div>
        ) : (
          boardLoaded && (
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Задач нет
            </div>
          )
        ))}

      {hasBadgeRow && (
        // Все бейджи строго в столбик, один под другим — не строкой/wrap.
        <div className="flex flex-col items-start gap-1">
          <DealPausedBadge deal={deal} />
          <DealCreatedByAgentBadge deal={deal} onUndo={onUndoAgent} />
          {stale?.isStale && <DealActivityAge deal={deal} info={stale} />}
          {risk && (
            // Наведение — тултип: только САМЫЙ критичный риск (§9.4):
            // название + объяснение «в чём риск / на чём основана оценка».
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help"
                  aria-label="Почему есть риски"
                  onPointerDown={stop}
                  onClick={stop}
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Есть риски
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent align="start" className="max-w-xs text-xs space-y-1">
                <div className="font-semibold">{risk.labelRu}</div>
                {risk.explanationRu && <div>{risk.explanationRu}</div>}
              </TooltipContent>
            </Tooltip>
          )}
          {movedByAgent && (
            // Наведение (не клик) — тот же паттерн, что у бейджа «есть риски»:
            // ризонинг агента виден сразу по hover.
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help"
                  aria-label="Почему стадию перевёл агент"
                  onPointerDown={stop}
                  onClick={stop}
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  >
                    <Sparkles className="h-3 w-3" />
                    перевёл агент
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent align="start" className="max-w-xs text-xs space-y-1.5">
                <div>
                  {deal.changes ??
                    deal.reasoning ??
                    "Автоматический перевод по сигналу из источников."}
                </div>
                <div className="text-muted-foreground pt-1 border-t border-white/10">
                  Не согласны — просто перетащите карточку на нужную стадию.
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </Card>
  )
}

// Превью карточки под курсором при перетаскивании (DragOverlay).
export function DealKanbanCardOverlay({ deal }: { deal: DealRow }) {
  return (
    <Card className="w-64 gap-4 p-3 bg-card border-border shadow-xl rotate-2 cursor-grabbing">
      <DealTitle deal={deal} />
      <DealMetaLine deal={deal} />
    </Card>
  )
}

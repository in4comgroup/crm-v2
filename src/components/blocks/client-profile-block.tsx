"use client"

// «Профиль компании» (identity spec I5 / I6, §4 / §6): what the client does,
// «Отрасль», «Роль на рынке», products, needs, size, geography — each with a
// source badge («Вручную · <имя> · <дата>», «Из интернета — проверьте» +
// «Подтвердить»), derived «Сегмент» / «Отношения», pending proposals
// («Принять» / «Отклонить») and «Заполнить из интернета».
// Editors = the client's responsible member and the org owner (the server is
// the gate: PUT / POST /api/clients/[id]/profile → 403 for others).
//
// NOTE: in the company drawer this block sits INSIDE the drawer's <form>:
// every button here is type="button" and Enter in an input is swallowed, so
// nothing here submits the drawer form.

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Check, Globe, Pencil, Plus, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  CLIENT_PROFILE_FIELD_LABELS_RU,
  CLIENT_PROFILE_LIMITS as L,
  CLIENT_SIZE_BANDS,
  CLIENT_SIZE_LABELS_RU,
  type ClientProfileField,
  type ClientProfileValues,
  type ClientSizeBand,
  type ProfileConfidence,
} from "@/lib/identity/client-profile"
import { withFieldValue, type FieldSlice } from "@/lib/identity/client-profile-apply"
import { MARKET_ROLES, MARKET_ROLE_LABELS_RU, type MarketRole } from "@/lib/identity/org-profile"
import type { ClientRelation } from "@/lib/topics/types"
import type {
  ClientProfileView,
  FieldMetaView,
  FillProfileResult,
} from "@/app/api/clients/[id]/profile/route"

const NONE = "__none__"

const RELATION_LABELS_RU: Record<ClientRelation, string> = {
  active: "Активный клиент",
  dormant: "Затих",
  prospect: "Потенциальный",
  supplier: "Поставщик",
  unknown: "Не определено",
}

const CONFIDENCE_LABELS_RU: Record<ProfileConfidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

function stopEnter(e: React.KeyboardEvent) {
  if (e.key === "Enter") e.preventDefault()
}

/** Human text of one field value (used for current values AND proposals). */
function fieldText(
  field: ClientProfileField,
  v: ClientProfileValues,
  industryLabels: Record<string, string>,
): string {
  switch (field) {
    case "description":
      return v.description ?? ""
    case "industry": {
      const label = v.industryCode ? (industryLabels[v.industryCode] ?? v.industryCode) : ""
      return [label, v.industryNote].filter(Boolean).join(" — ")
    }
    case "marketRoles":
      return v.marketRoles.map((r) => MARKET_ROLE_LABELS_RU[r as MarketRole] ?? r).join(", ")
    case "products":
      return v.products.map((p) => p.name).join(", ")
    case "needs":
      return [v.needs.lines.join(", "), v.needs.note].filter(Boolean).join(" · ")
    case "size": {
      const band = v.sizeBand ? CLIENT_SIZE_LABELS_RU[v.sizeBand] : ""
      const pos = v.pointsOfSale ? `${v.pointsOfSale} точек` : ""
      return [band, pos].filter(Boolean).join(", ")
    }
    case "geography":
      return v.geography ?? ""
  }
}

const EMPTY_VALUES: ClientProfileValues = {
  description: null,
  industryCode: null,
  industryNote: null,
  marketRoles: [],
  products: [],
  needs: { lines: [] },
  sizeBand: null,
  pointsOfSale: null,
  geography: null,
}

function sliceText(field: ClientProfileField, slice: FieldSlice, industryLabels: Record<string, string>): string {
  return fieldText(field, withFieldValue(EMPTY_VALUES, field, slice), industryLabels)
}

// ── Source badge ──────────────────────────────────────────────────────────

function SourceBadge({
  meta,
  canEdit,
  busy,
  onConfirm,
  onRemove,
}: {
  meta: FieldMetaView | undefined
  canEdit: boolean
  busy: boolean
  onConfirm: () => void
  /** «Убрать» the unconfirmed automatic value (2026-11-21). */
  onRemove: () => void
}) {
  if (!meta) return null
  if (meta.source === "manual") {
    return (
      <span className="text-xs text-muted-foreground">
        Вручную{meta.byName ? ` · ${meta.byName}` : ""}
        {fmtDate(meta.at) ? ` · ${fmtDate(meta.at)}` : ""}
      </span>
    )
  }
  const sourceLabel = meta.source === "web" ? "Из интернета" : meta.source === "import" ? "Из импорта" : "Из переписки"
  const link = meta.evidenceUrl ? (
    <a
      href={meta.evidenceUrl}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2"
      onClick={(e) => e.stopPropagation()}
    >
      источник
    </a>
  ) : null
  if (meta.verified) {
    return (
      <span className="text-xs text-muted-foreground">
        {sourceLabel}
        {meta.verifiedByName ? ` · подтвердил ${meta.verifiedByName}` : ""}
        {fmtDate(meta.verifiedAt ?? meta.at) ? ` · ${fmtDate(meta.verifiedAt ?? meta.at)}` : ""}
        {link && <> · {link}</>}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
        {sourceLabel} — проверьте
      </Badge>
      {meta.confidence && (
        <span className="text-muted-foreground">уверенность: {CONFIDENCE_LABELS_RU[meta.confidence]}</span>
      )}
      {link && <span className="text-muted-foreground">{link}</span>}
      {canEdit && (
        <>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={onConfirm}>
            <Check className="mr-1 h-3 w-3" />
            Подтвердить
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={onRemove}>
            <X className="mr-1 h-3 w-3" />
            Убрать
          </Button>
        </>
      )}
    </span>
  )
}

// ── Editor pieces ─────────────────────────────────────────────────────────

function ToggleChips<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[]
  labels: (v: T) => string
  value: readonly T[]
  onChange: (next: T[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <Button
            key={o}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            className="h-7 rounded-full"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
          >
            {labels(o)}
          </Button>
        )
      })}
    </div>
  )
}

function LinesInput({
  lines,
  max,
  maxLen,
  onChange,
}: {
  lines: string[]
  max: number
  maxLen: number
  onChange: (next: string[]) => void
}) {
  const [text, setText] = useState("")
  const add = () => {
    const t = text.trim()
    if (!t || lines.length >= max) return
    if (!lines.some((l) => l.toLowerCase() === t.toLowerCase())) onChange([...lines, t])
    setText("")
  }
  return (
    <div className="flex flex-col gap-2">
      {lines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lines.map((l) => (
            <Badge key={l} variant="secondary" className="gap-1 pr-1">
              {l}
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-foreground/10"
                aria-label={`Убрать ${l}`}
                onClick={() => onChange(lines.filter((x) => x !== l))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {lines.length < max && (
        <div className="flex gap-2">
          <Input
            value={text}
            maxLength={maxLen}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={add} disabled={!text.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      <span className="text-xs text-muted-foreground">
        {lines.length} / {max}
      </span>
    </div>
  )
}

// ── Block ─────────────────────────────────────────────────────────────────

export function ClientProfileBlock({ clientId, className }: { clientId: string; className?: string }) {
  const [view, setView] = useState<ClientProfileView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ClientProfileValues | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/profile`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(data.error ?? "Не удалось загрузить профиль")
        return
      }
      setView(data.view)
    } catch {
      setLoadError("Не удалось загрузить профиль")
    }
  }, [clientId])

  useEffect(() => {
    setView(null)
    setEditing(false)
    setDraft(null)
    void load()
  }, [load])

  const industryLabels = useMemo(
    () => Object.fromEntries((view?.industries ?? []).map((i) => [i.code, i.label])) as Record<string, string>,
    [view?.industries],
  )

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось выполнить действие")
        return null
      }
      if (data.view) setView(data.view)
      return data
    } catch {
      toast.error("Не удалось выполнить действие")
      return null
    } finally {
      setBusy(null)
    }
  }

  const enrich = async () => {
    const data = (await post("enrich", { action: "enrich" })) as { result?: FillProfileResult } | null
    const r = data?.result
    if (!r) return
    if (r.outcome === "ambiguous") {
      toast.warning(`Найдено несколько похожих компаний (${r.candidateCount})`, {
        description: "Укажите сайт компании в «Поиск в интернете» и повторите.",
      })
    } else if (r.outcome === "no_match") {
      toast.info("В интернете ничего не найдено")
    } else {
      const filled = r.profile.filled.length
      const proposed = r.profile.proposed.length
      if (filled === 0 && proposed === 0) toast.info("Новых данных нет")
      else
        toast.success("Профиль дополнен из интернета", {
          description: [
            filled ? `заполнено полей: ${filled} (проверьте)` : "",
            proposed ? `предложений: ${proposed}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        })
    }
  }

  const save = async () => {
    if (!draft) return
    setBusy("save")
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить профиль")
        return
      }
      setView(data.view)
      setEditing(false)
      setDraft(null)
      toast.success(data.changed?.length ? "Профиль сохранён" : "Изменений нет")
    } catch {
      toast.error("Не удалось сохранить профиль")
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <div className={cn("rounded-lg border p-3 text-sm text-muted-foreground", className)}>
        {loadError}{" "}
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void load()}>
          Повторить
        </Button>
      </div>
    )
  }
  if (!view) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground", className)}>
        <Spinner /> Загрузка профиля…
      </div>
    )
  }

  const v = view.values
  const d = draft ?? v
  const set = <K extends keyof ClientProfileValues>(k: K, val: ClientProfileValues[K]) =>
    setDraft((prev) => ({ ...(prev ?? v), [k]: val }))
  const needsOptions = [...new Set([...view.ourProductLines, ...d.needs.lines])]

  const row = (field: ClientProfileField, editor: React.ReactNode) => {
    const text = fieldText(field, v, industryLabels)
    return (
      <div key={field} className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
        <div className="text-xs font-medium text-muted-foreground">{CLIENT_PROFILE_FIELD_LABELS_RU[field]}</div>
        {editing ? (
          editor
        ) : (
          <>
            <div className={cn("text-sm whitespace-pre-line", !text && "text-muted-foreground")}>
              {text || "Не заполнено"}
            </div>
            {text && (
              <SourceBadge
                meta={view.meta[field]}
                canEdit={view.canEdit}
                busy={busy !== null}
                onConfirm={() => void post(`confirm:${field}`, { action: "confirm", field })}
                onRemove={() => void post(`remove:${field}`, { action: "remove", field })}
              />
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">Профиль компании</div>
        <div className="ml-auto flex items-center gap-1.5">
          {view.canEdit && !editing && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy !== null}
                onClick={() => void enrich()}
              >
                {busy === "enrich" ? <Spinner className="mr-1" /> : <Globe className="mr-1 h-3.5 w-3.5" />}
                Заполнить из интернета
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="size-7"
                aria-label="Изменить профиль компании"
                title="Изменить профиль компании"
                disabled={busy !== null}
                onClick={() => {
                  setDraft(v)
                  setEditing(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="font-normal">
          Сегмент: {view.segment ?? "-"}
        </Badge>
        {view.relation && view.relation !== "unknown" && (
          <Badge variant="secondary" className="font-normal">
            Отношения: {RELATION_LABELS_RU[view.relation]}
          </Badge>
        )}
      </div>

      {busy === "enrich" && (
        <p className="text-xs text-muted-foreground">Ищем компанию в интернете — это занимает до минуты.</p>
      )}

      {view.proposals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="text-xs font-medium">Предложения ({view.proposals.length})</div>
          {view.proposals.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 text-sm">
              <div>
                <span className="text-muted-foreground">{CLIENT_PROFILE_FIELD_LABELS_RU[p.field]}: </span>
                {sliceText(p.field, p.value, industryLabels) || "—"}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {p.source === "web" ? "Из интернета" : p.source === "import" ? "Из импорта" : "Из переписки"}
                  {p.confidence ? ` · уверенность: ${CONFIDENCE_LABELS_RU[p.confidence]}` : ""}
                  {` · ${fmtDate(p.createdAt)}`}
                </span>
                {p.evidenceUrl && (
                  <a href={p.evidenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    источник
                  </a>
                )}
                {view.canEdit && (
                  <span className="ml-auto flex gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => void post(`p:${p.id}`, { action: "acceptProposal", proposalId: p.id })}
                    >
                      Принять
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => void post(`p:${p.id}`, { action: "rejectProposal", proposalId: p.id })}
                    >
                      Отклонить
                    </Button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {row(
          "description",
          <>
            <Textarea
              value={d.description ?? ""}
              maxLength={L.description}
              rows={3}
              onChange={(e) => set("description", e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {(d.description ?? "").length} / {L.description}
            </span>
          </>,
        )}
        {row(
          "industry",
          <div className="flex flex-col gap-2">
            <Select value={d.industryCode ?? NONE} onValueChange={(x) => set("industryCode", x === NONE ? null : x)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите отрасль" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не выбрана</SelectItem>
                {view.industries.map((i) => (
                  <SelectItem key={i.code} value={i.code}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={d.industryNote ?? ""}
              maxLength={L.industryNote}
              placeholder="Комментарий к отрасли"
              onKeyDown={stopEnter}
              onChange={(e) => set("industryNote", e.target.value)}
            />
          </div>,
        )}
        {row(
          "marketRoles",
          <ToggleChips
            options={MARKET_ROLES}
            labels={(r) => MARKET_ROLE_LABELS_RU[r]}
            value={d.marketRoles}
            onChange={(next) => set("marketRoles", next)}
          />,
        )}
        {row(
          "products",
          <LinesInput
            lines={d.products.map((p) => p.name)}
            max={L.products}
            maxLen={L.productName}
            onChange={(next) => set("products", next.map((name) => ({ name })))}
          />,
        )}
        {row(
          "needs",
          <div className="flex flex-col gap-2">
            {needsOptions.length > 0 ? (
              <ToggleChips
                options={needsOptions}
                labels={(x) => x}
                value={d.needs.lines}
                onChange={(next) => set("needs", { ...d.needs, lines: next })}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                Наши продукты и услуги ещё не заполнены в профиле организации.
              </span>
            )}
            <Input
              value={d.needs.note ?? ""}
              maxLength={L.needsNote}
              placeholder="Комментарий"
              onKeyDown={stopEnter}
              onChange={(e) => set("needs", { ...d.needs, note: e.target.value })}
            />
          </div>,
        )}
        {row(
          "size",
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={d.sizeBand ?? NONE}
              onValueChange={(x) => set("sizeBand", x === NONE ? null : (x as ClientSizeBand))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Размер" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не указан</SelectItem>
                {CLIENT_SIZE_BANDS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {CLIENT_SIZE_LABELS_RU[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              max={L.pointsOfSaleMax}
              className="w-36"
              placeholder="Точек продаж"
              value={d.pointsOfSale ?? ""}
              onKeyDown={stopEnter}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                set("pointsOfSale", Number.isFinite(n) && n >= 1 ? n : null)
              }}
            />
          </div>,
        )}
        {row(
          "geography",
          <Input
            value={d.geography ?? ""}
            maxLength={L.geography}
            onKeyDown={stopEnter}
            onChange={(e) => set("geography", e.target.value)}
          />,
        )}
      </div>

      {editing ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" && <Spinner className="mr-1" />}
            Сохранить
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => {
              setEditing(false)
              setDraft(null)
            }}
          >
            Отмена
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {view.canEdit
            ? view.webEnrichedAt
              ? `Последнее заполнение из интернета: ${fmtDate(view.webEnrichedAt)}.`
              : "Данные из интернета не перезаписывают ваши значения — для заполненных полей приходят предложения."
            : "Менять профиль могут ответственный за компанию и владелец организации."}
        </p>
      )}
    </div>
  )
}

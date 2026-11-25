"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Send, UserCheck, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  HANDOVER_REASON_MAX,
  assignableMembers,
  coResponsibleMode,
  handoverOwners,
  memberLabel,
  responsibleMode,
  type ResponsibleMember,
} from "@/lib/client-responsible"

// «Ответственный» (Responsible) on a company — used by the company drawer and
// the company page. Controls by viewer (rules: src/lib/client-responsible.ts):
// owner → member Select (+ «Оставить за собой» while a handover is pending);
// the responsible non-owner → «Передать владельцу»; others → the name only.
// «Также отвечают» (additional responsible members, 2026-11-19): the owner
// adds / removes; an additional member may remove themselves.

export type ResponsibleOptionsData = {
  viewerUserId: string
  viewerRole: string | null
  members: ResponsibleMember[]
}

/** Loads the viewer + human members of the active org (`GET /api/clients?responsibleOptions=1`). */
export function useResponsibleOptions(): ResponsibleOptionsData | null {
  const [data, setData] = useState<ResponsibleOptionsData | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/clients?responsibleOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as ResponsibleOptionsData)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return data
}

export type ResponsibleClient = {
  id: string
  responsibleUserId: string | null
  responsibleName: string | null
  responsibleHandoverFromUserId: string | null
  responsibleHandoverFromName: string | null
  responsibleHandoverReason: string | null
  /** Additional responsible members (absent on rows built without them). */
  coResponsible?: { userId: string; name: string | null }[]
}

async function putResponsible(clientId: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/responsible`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || "Не удалось изменить ответственного")
      return false
    }
    return true
  } catch {
    toast.error("Не удалось изменить ответственного")
    return false
  }
}

/** Badge «Ждёт решения владельца · передал <имя>» (everyone sees it). */
export function HandoverPendingBadge({
  client,
  className,
}: {
  client: Pick<ResponsibleClient, "responsibleHandoverFromUserId" | "responsibleHandoverFromName">
  className?: string
}) {
  if (!client.responsibleHandoverFromUserId) return null
  return (
    <Badge
      variant="secondary"
      className={cn(
        "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 font-normal",
        className,
      )}
    >
      Ждёт решения владельца · передал {client.responsibleHandoverFromName ?? "—"}
    </Badge>
  )
}

export function ClientResponsibleField({
  client,
  options,
  onChanged,
  className,
}: {
  client: ResponsibleClient
  /** Pass when the parent already loaded them; otherwise the field loads its own. */
  options?: ResponsibleOptionsData | null
  onChanged?: () => void
  className?: string
}) {
  const own = useResponsibleOptions()
  const opts = options ?? own
  const [busy, setBusy] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)

  const members = opts?.members ?? []
  const responsibleMember = members.find((m) => m.userId === client.responsibleUserId) ?? null
  const notInOrg = !!client.responsibleUserId && !!opts && !responsibleMember
  const name = client.responsibleName ?? responsibleMember?.name ?? null
  const mode = opts
    ? responsibleMode(
        { userId: opts.viewerUserId, role: opts.viewerRole },
        { responsibleUserId: client.responsibleUserId },
      )
    : "read"

  const assign = useCallback(
    async (userId: string) => {
      setBusy(true)
      const ok = await putResponsible(client.id, { action: "setResponsible", userId })
      setBusy(false)
      if (ok) {
        toast.success("Ответственный назначен")
        onChanged?.()
      }
    },
    [client.id, onChanged],
  )

  const nameLine = (
    <span className="text-sm">
      {name ?? "не назначен"}
      {notInOrg && <span className="ml-1.5 text-xs text-muted-foreground">(не в организации)</span>}
    </span>
  )

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-xs text-muted-foreground">Ответственный</div>
      <div className="flex flex-wrap items-center gap-2">
        {mode === "assign" ? (
          <>
            <Select
              value={responsibleMember && !responsibleMember.banned ? responsibleMember.userId : ""}
              onValueChange={(v) => void assign(v)}
              disabled={busy}
            >
              <SelectTrigger size="sm" className="min-w-48 w-fit">
                <SelectValue
                  placeholder={
                    name ? `${name}${notInOrg ? " (не в организации)" : ""}` : "Выберите участника"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {assignableMembers(members).map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {memberLabel(m, members)}
                    {m.role === "owner" && (
                      <span className="ml-1 text-xs text-muted-foreground">· владелец</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {client.responsibleHandoverFromUserId && opts && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void assign(opts.viewerUserId)}
              >
                <UserCheck className="h-4 w-4 mr-1" />
                Оставить за собой
              </Button>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </>
        ) : mode === "handover" ? (
          <>
            {nameLine}
            {!client.responsibleHandoverFromUserId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHandoverOpen(true)}
              >
                <Send className="h-4 w-4 mr-1" />
                Передать владельцу
              </Button>
            )}
          </>
        ) : (
          nameLine
        )}
        <HandoverPendingBadge client={client} />
      </div>
      {opts && <CoResponsibleRow client={client} opts={opts} onChanged={onChanged} />}
      {client.responsibleHandoverFromUserId && client.responsibleHandoverReason && (
        <div className="text-xs text-muted-foreground">
          Причина: {client.responsibleHandoverReason}
        </div>
      )}
      {mode === "handover" && opts && handoverOpen && (
        <HandoverDialog
          open={handoverOpen}
          onOpenChange={setHandoverOpen}
          clientId={client.id}
          owners={handoverOwners(members)}
          onDone={() => {
            setHandoverOpen(false)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

/** «Также отвечают: Анна ×, Пётр × [+ Добавить]». */
function CoResponsibleRow({
  client,
  opts,
  onChanged,
}: {
  client: ResponsibleClient
  opts: ResponsibleOptionsData
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const co = client.coResponsible ?? []
  const mode = coResponsibleMode(
    { userId: opts.viewerUserId, role: opts.viewerRole },
    { responsibleUserId: client.responsibleUserId, coResponsibleUserIds: co.map((c) => c.userId) },
  )
  if (!co.length && mode !== "manage") return null
  const candidates = assignableMembers(opts.members).filter(
    (m) => m.userId !== client.responsibleUserId && !co.some((c) => c.userId === m.userId),
  )
  const change = async (action: "addCoResponsible" | "removeCoResponsible", userId: string) => {
    setBusy(true)
    const ok = await putResponsible(client.id, { action, userId })
    setBusy(false)
    if (ok) {
      toast.success(action === "addCoResponsible" ? "Ответственный добавлен" : "Ответственный убран")
      onChanged?.()
    }
  }
  const nameOf = (c: { userId: string; name: string | null }) =>
    c.name ?? opts.members.find((m) => m.userId === c.userId)?.name ?? "—"
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">Также отвечают</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {co.map((c) => {
          const canRemove = mode === "manage" || (mode === "self" && c.userId === opts.viewerUserId)
          const gone = !opts.members.some((m) => m.userId === c.userId)
          return (
            <Badge key={c.userId} variant="secondary" className="gap-1 font-normal">
              {nameOf(c)}
              {gone && <span className="text-muted-foreground">(не в организации)</span>}
              {canRemove && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={c.userId === opts.viewerUserId && mode === "self" ? "Снять с себя" : `Убрать ${nameOf(c)}`}
                  title={c.userId === opts.viewerUserId && mode === "self" ? "Снять с себя" : "Убрать"}
                  onClick={() => void change("removeCoResponsible", c.userId)}
                  className="rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          )
        })}
        {mode === "manage" && candidates.length > 0 && (
          <Select value="__none__" onValueChange={(v) => { if (v !== "__none__") void change("addCoResponsible", v) }} disabled={busy}>
            <SelectTrigger size="sm" className="h-7 w-fit text-xs" aria-label="Также отвечают">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не выбрано</SelectItem>
              {candidates.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {memberLabel(m, opts.members)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}

function HandoverDialog({
  open,
  onOpenChange,
  clientId,
  owners,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  clientId: string
  owners: ResponsibleMember[]
  onDone: () => void
}) {
  // Mounted only while open, so the state starts fresh every time.
  const [ownerId, setOwnerId] = useState<string>(owners.length === 1 ? owners[0].userId : "")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const needPick = owners.length > 1

  const submit = async () => {
    if (needPick && !ownerId) {
      toast.error("Выберите владельца")
      return
    }
    setBusy(true)
    const ok = await putResponsible(clientId, {
      action: "handoverToOwner",
      ownerUserId: ownerId || null,
      reason: reason.trim() || null,
    })
    setBusy(false)
    if (ok) {
      toast.success("Компания передана владельцу")
      onDone()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Передать владельцу</DialogTitle>
          <DialogDescription>
            Если это не ваша компания, передайте её владельцу организации. Владелец решит, кто будет
            ответственным.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {owners.length === 0 ? (
            <p className="text-sm text-muted-foreground">В организации нет владельца.</p>
          ) : needPick ? (
            <div className="space-y-1.5">
              <Label>Владелец</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите владельца" />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.userId} value={o.userId}>
                      {memberLabel(o, owners)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm">
              Владелец: <span className="font-medium">{owners[0].name}</span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="handover-reason">Причина</Label>
            <Textarea
              id="handover-reason"
              value={reason}
              maxLength={HANDOVER_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Необязательно"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || owners.length === 0}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Передать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

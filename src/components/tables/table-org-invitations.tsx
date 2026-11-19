"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { isInvitationExpired, type OrgPendingInvitation } from "@/lib/invitations"
import { orgRoleLabel } from "@/lib/org-roles"
import { Loader } from "lucide-react"
import { toast } from "sonner"

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU")

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

/**
 * «Приглашения» — pending invitations of the active org (org owner only).
 * List: GET /api/organization/invitations (owner check + inviter name on the
 * server). Resend = inviteMember with resend: true (new expiry + the mail
 * again); cancel = better-auth cancelInvitation (status canceled → the link
 * stops working). `refreshKey` changes when the invite dialog sent one.
 */
export function TableOrgInvitations({
  organizationId,
  refreshKey = 0,
}: {
  organizationId: string
  refreshKey?: number
}) {
  const [invitations, setInvitations] = useState<OrgPendingInvitation[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toCancel, setToCancel] = useState<OrgPendingInvitation | null>(null)

  const fetchInvitations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/invitations", {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Не удалось загрузить приглашения")
        return
      }
      setActiveOrgId(data.organizationId ?? null)
      setInvitations((data.invitations as OrgPendingInvitation[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvitations()
  }, [fetchInvitations, refreshKey])

  const resend = async (inv: OrgPendingInvitation) => {
    setBusyId(inv.id)
    try {
      const { data, error: sendError } =
        await authClient.organization.inviteMember({
          email: inv.email,
          role:
            inv.role === "owner" || inv.role === "admin" ? inv.role : "member",
          organizationId,
          resend: true,
        })
      if (sendError) {
        toast.error(sendError.message || "Не удалось отправить приглашение")
        return
      }
      // better-auth refreshes only a NON-expired invitation; for an expired
      // one it creates a new row and leaves the old one `pending`. Cancel the
      // old row (its link is already dead) so it does not stay in the list.
      const newId = (data as { id?: string } | null)?.id
      if (newId && newId !== inv.id) {
        await authClient.organization
          .cancelInvitation({ invitationId: inv.id })
          .catch(() => undefined)
      }
      toast.success(`Приглашение отправлено ещё раз на ${inv.email}`)
      await fetchInvitations()
    } finally {
      setBusyId(null)
    }
  }

  const cancel = async (inv: OrgPendingInvitation) => {
    setBusyId(inv.id)
    try {
      const { error: cancelError } =
        await authClient.organization.cancelInvitation({
          invitationId: inv.id,
        })
      if (cancelError) {
        toast.error(cancelError.message || "Не удалось отменить приглашение")
        return
      }
      toast.success(`Приглашение для ${inv.email} отменено`)
      await fetchInvitations()
    } finally {
      setBusyId(null)
      setToCancel(null)
    }
  }

  // The page shows the user's first organization; the list is always the
  // session's ACTIVE one. In the rare case they differ, say so instead of
  // showing another org's invitations under this org's members.
  const otherOrg = activeOrgId !== null && activeOrgId !== organizationId

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold">Приглашения</h3>
        {!loading && !error && !otherOrg && (
          <span className="text-sm text-gray-400">
            {invitations.length > 0
              ? `ожидают ответа: ${invitations.length}`
              : ""}
          </span>
        )}
      </div>

      {error ? (
        <div className="text-sm text-red-500">{error}</div>
      ) : loading ? (
        <div className="flex justify-center p-6">
          <Loader className="animate-spin h-5 w-5 text-gray-900 dark:text-gray-100" />
        </div>
      ) : otherOrg ? (
        <p className="text-sm text-gray-500">
          Приглашения показываются для активной организации. Переключитесь на
          эту организацию, чтобы увидеть её приглашения.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Пригласил</TableHead>
              <TableHead>Отправлено</TableHead>
              <TableHead>Действует до</TableHead>
              <TableHead>Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500">
                  Нет приглашений, ожидающих ответа
                </TableCell>
              </TableRow>
            ) : (
              invitations.map((inv) => {
                const expired = isInvitationExpired(inv.expiresAt)
                const busy = busyId === inv.id
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{orgRoleLabel(inv.role)}</Badge>
                    </TableCell>
                    <TableCell>{inv.inviterName ?? "—"}</TableCell>
                    <TableCell>{formatDate(inv.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={expired ? "text-gray-400" : undefined}>
                          {formatDateTime(inv.expiresAt)}
                        </span>
                        {expired && (
                          <Badge variant="destructive">Истекло</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => resend(inv)}
                        >
                          {busy && toCancel?.id !== inv.id ? (
                            <Loader className="h-4 w-4 animate-spin" />
                          ) : null}
                          Отправить ещё раз
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => setToCancel(inv)}
                        >
                          Отменить
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={toCancel !== null}
        onOpenChange={(open) => {
          if (!open && busyId === null) setToCancel(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить приглашение?</AlertDialogTitle>
            <AlertDialogDescription>
              Приглашение для <strong>{toCancel?.email}</strong> будет
              отменено, ссылка из письма перестанет работать. Чтобы пригласить
              этого человека снова, отправьте новое приглашение.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>
              Не отменять
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (toCancel) void cancel(toCancel)
              }}
            >
              {busyId !== null && <Loader className="h-4 w-4 animate-spin" />}
              Отменить приглашение
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

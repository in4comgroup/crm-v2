"use client"

import { useState, useTransition } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/blocks/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { authClient } from "@/lib/auth-client"
import {
  ASSIGNABLE_ORG_ROLES,
  isAssignableOrgRole,
  orgRoleLabel,
  type AssignableOrgRole,
} from "@/lib/org-roles"
import { toast } from "sonner"

export default function SetOrgRoleDialog({
  memberId,
  memberName,
  currentRole,
  organizationId,
  onSuccess,
}: {
  memberId: string
  memberName: string
  currentRole: string
  organizationId: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  // Only «Владелец» / «Участник» are offered (src/lib/org-roles.ts). A
  // member who still has the legacy admin role starts with no choice made.
  const [role, setRole] = useState<AssignableOrgRole | "">(
    isAssignableOrgRole(currentRole) ? currentRole : "",
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    if (!role) return
    startTransition(async () => {
      const { error } = await authClient.organization.updateMemberRole({
        memberId,
        role,
        organizationId,
      })

      if (error) {
        toast.error(error.message || "Не удалось изменить роль")
        return
      }

      toast.success(`Роль изменена на «${orgRoleLabel(role)}» для ${memberName}`)
      onSuccess?.()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Роль
        </Button>
      </DialogTrigger>
      <DialogContent className="dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle>Назначить роль для {memberName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Текущая роль: <span className="text-foreground">{orgRoleLabel(currentRole)}</span>
          </p>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Новая роль</label>
            <Select
              value={role}
              onValueChange={(val) => {
                if (isAssignableOrgRole(val)) setRole(val)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите роль" />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ORG_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {orgRoleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <LoadingButton
              onClick={handleSubmit}
              className="w-full"
              loading={isPending}
              disabled={!role}
            >
              Сохранить роль
            </LoadingButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

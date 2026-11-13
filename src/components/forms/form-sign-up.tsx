"use client"

import { EmailOtpForm } from "@/components/forms/form-email-otp"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function SignUpForm() {
  const router = useRouter()
  const [pendingInviteEmail, setPendingInviteEmail] = useState<string | null>(
    null,
  )

  // Block standalone sign-up if the email has a live invitation — the user
  // should use the invite link instead (so they end up in the inviter's org
  // rather than a fresh "Моя организация").
  async function checkNoPendingInvite(email: string): Promise<boolean> {
    setPendingInviteEmail(null)
    try {
      const res = await fetch(
        `/api/invitations/check?email=${encodeURIComponent(email)}`,
        { cache: "no-store" },
      )
      if (res.ok) {
        const body = (await res.json()) as { hasPending?: boolean }
        if (body.hasPending) {
          setPendingInviteEmail(email)
          return false
        }
      }
    } catch {
      // If the check endpoint fails we let sign-up proceed — better to allow
      // creation than block indefinitely on a transient error.
    }
    return true
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Регистрация</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Введите имя и email. Мы отправим одноразовый код для подтверждения.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pendingInviteEmail && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
          >
            <p className="font-medium">У вас есть активное приглашение.</p>
            <p className="mt-1 text-xs">
              Организация уже пригласила{" "}
              <strong>{pendingInviteEmail}</strong>. Пожалуйста, используйте
              ссылку-приглашение из письма, чтобы присоединиться. Если её нет,
              попросите администратора организации отправить её повторно.
            </p>
          </div>
        )}
        <EmailOtpForm
          askName
          verifyLabel="Создать аккаунт"
          beforeSend={checkNoPendingInvite}
          onSignedIn={() => {
            toast.success("Регистрация прошла успешно!")
            router.push("/dashboard")
          }}
        />
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Уже есть аккаунт?{" "}
            <Link href="/sign-in" className="underline">
              Войти
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}

"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { LoadingButton } from "@/components/blocks/loading-button"
import { EmailOtpForm } from "@/components/forms/form-email-otp"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import {
  CheckCircle,
  XCircle,
  Loader,
  AlertTriangle,
} from "lucide-react"
import type { PublicInvitation } from "@/server/invitations"

type InvitationInfo = {
  id: string
  email: string
  organizationId: string
  organizationName: string | null
  status: string
  expired: boolean
}

export function AcceptInvitationContent({
  initialInvitation,
}: {
  initialInvitation: PublicInvitation | null
}) {
  const router = useRouter()

  const { data: session, isPending: sessionLoading } = authClient.useSession()

  // Invitation data is loaded server-side and passed in as a prop, so we can
  // compute the error/active state synchronously up-front.
  const { invitation, invitationError } = resolveInvitation(initialInvitation)

  const [acceptState, setAcceptState] = useState<
    "idle" | "accepting" | "success" | "error"
  >("idle")
  const [acceptError, setAcceptError] = useState("")

  async function acceptNow() {
    if (!invitation) return
    setAcceptState("accepting")
    setAcceptError("")
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: invitation.id,
    })
    if (error) {
      setAcceptError(error.message || "Не удалось принять приглашение")
      toast.error(error.message || "Не удалось принять приглашение")
      setAcceptState("error")
      return
    }
    // Make the newly joined org the active one
    if (invitation.organizationId) {
      await authClient.organization.setActive({
        organizationId: invitation.organizationId,
      })
    }
    setAcceptState("success")
    toast.success("Приглашение принято!")
    setTimeout(() => router.push("/dashboard"), 1200)
  }

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  if (sessionLoading) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <Loader className="h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">
              Загрузка приглашения…
            </p>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  if (invitationError || !invitation) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <XCircle className="h-12 w-12 text-red-500" />
            <p className="text-lg font-medium">Недействительное приглашение</p>
            <p className="text-sm text-muted-foreground text-center">
              {invitationError ?? "Эта ссылка-приглашение больше недействительна."}
            </p>
            <Button onClick={() => router.push("/sign-in")} className="w-full">
              Перейти ко входу
            </Button>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  if (acceptState === "success") {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-lg font-medium">Приглашение принято!</p>
            <p className="text-sm text-muted-foreground">
              Перенаправляем на панель…
            </p>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  // --- Signed in ----------------------------------------------------------
  if (session?.user) {
    const sameEmail =
      session.user.email.toLowerCase() === invitation.email.toLowerCase()

    if (!sameEmail) {
      return (
        <Centered>
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-lg text-center">
                Не тот аккаунт
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-center text-muted-foreground">
                Это приглашение было отправлено на{" "}
                <strong className="text-foreground">{invitation.email}</strong>
                , но вы вошли как{" "}
                <strong className="text-foreground">
                  {session.user.email}
                </strong>
                .
              </p>
              <p className="text-sm text-center text-muted-foreground">
                Сначала выйдите из аккаунта, затем снова откройте эту
                ссылку-приглашение.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await authClient.signOut()
                  // Stay on this page so the next render shows signup/sign-in branch
                  router.refresh()
                }}
              >
                Выйти
              </Button>
            </CardContent>
          </Card>
        </Centered>
      )
    }

    // Signed in with matching email — show accept button
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg text-center">
              Вас пригласили
            </CardTitle>
            {invitation.organizationName && (
              <CardDescription className="text-center">
                Присоединиться к <strong>{invitation.organizationName}</strong>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-center text-muted-foreground">
              Вы вошли как{" "}
              <strong className="text-foreground">{session.user.email}</strong>
              .
            </p>
            {acceptState === "error" && (
              <p className="text-sm text-red-600 text-center">{acceptError}</p>
            )}
            <LoadingButton
              className="w-full"
              loading={acceptState === "accepting"}
              onClick={acceptNow}
            >
              Принять приглашение
            </LoadingButton>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  // --- Not signed in -----------------------------------------------------
  return (
    <Centered>
      <SignUpForInvitation
        invitation={invitation}
        onDone={async () => {
          // After successful signup the user is signed in; now accept + set active.
          await acceptNow()
        }}
      />
    </Centered>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function resolveInvitation(initial: PublicInvitation | null): {
  invitation: InvitationInfo | null
  invitationError: string | null
} {
  if (!initial) {
    return {
      invitation: null,
      invitationError: "Приглашение не найдено или его срок истёк",
    }
  }
  if (initial.expired) {
    return { invitation: null, invitationError: "Срок действия этого приглашения истёк." }
  }
  if (initial.status !== "pending") {
    return {
      invitation: null,
      invitationError: `Это приглашение больше не активно (статус: ${initial.status}).`,
    }
  }
  return {
    invitation: {
      id: initial.id,
      email: initial.email,
      organizationId: initial.organizationId,
      organizationName: initial.organizationName,
      status: initial.status,
      expired: initial.expired,
    },
    invitationError: null,
  }
}

// -----------------------------------------------------------------------------
// Sign-up / sign-in form (email locked to invitation.email). Email OTP is the
// only auth method: the code signs in an existing account or creates a new
// one (name is only used for a new account), then we accept the invitation.
// -----------------------------------------------------------------------------

function SignUpForInvitation({
  invitation,
  onDone,
}: {
  invitation: InvitationInfo
  onDone: () => Promise<void>
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Вас пригласили</CardTitle>
        <CardDescription>
          {invitation.organizationName && (
            <>
              Присоединиться к <strong>{invitation.organizationName}</strong>.{" "}
            </>
          )}
          Мы отправим одноразовый код на{" "}
          <strong className="text-foreground">{invitation.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmailOtpForm
          askName
          fixedEmail={invitation.email}
          verifyLabel="Принять приглашение"
          onSignedIn={onDone}
        />
        <p className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
          Если у вас уже есть аккаунт с этим email, код войдёт в него. Имя
          тогда не изменится.
        </p>
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      {children}
    </main>
  )
}

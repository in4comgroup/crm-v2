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
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Only same-app paths: "/x" yes; "//evil.com", "https://evil.com" no
  // (would be an open redirect after sign-in).
  const requested = searchParams.get("redirect") ?? ""
  const redirect =
    requested.startsWith("/") && !requested.startsWith("//") && !requested.startsWith("/\\")
      ? requested
      : "/dashboard"

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Вход</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Введите email, и мы отправим вам одноразовый код для входа.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmailOtpForm
          onSignedIn={() => {
            toast.success("Вход выполнен!")
            router.push(redirect)
          }}
        />
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Нет аккаунта?{" "}
            <Link href="/sign-up" className="underline">
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}

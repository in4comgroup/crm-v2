"use client"

// The ONLY way to authenticate: a 6-digit code sent to the user's email.
// Step 1 collects the email (and the name, for sign-up) and sends the code;
// step 2 verifies it via `signIn.emailOtp`. The same call registers a new user
// on first login (`disableSignUp: false` in src/lib/auth.ts) — `name` is only
// used then. Used by /sign-in, /sign-up and the accept-invitation page.

import { LoadingButton } from "@/components/blocks/loading-button"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { authClient } from "@/lib/auth-client"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

const detailsSchema = z.object({
  email: z.email({ message: "Введите корректный email" }),
  name: z.string().trim(),
})
type DetailsValues = z.infer<typeof detailsSchema>

const otpSchema = z.object({
  otp: z.string().length(6, { message: "Введите 6-значный код" }),
})
type OtpValues = z.infer<typeof otpSchema>

export function EmailOtpForm({
  askName = false,
  fixedEmail,
  sendLabel = "Отправить код",
  verifyLabel = "Войти",
  beforeSend,
  onSignedIn,
}: {
  /** Show a required "Имя" field (sign-up / invitation). */
  askName?: boolean
  /** Lock the email to this value (invitation). */
  fixedEmail?: string
  sendLabel?: string
  verifyLabel?: string
  /** Runs before the code is sent. Return false to stop. */
  beforeSend?: (email: string) => Promise<boolean>
  onSignedIn: () => void | Promise<void>
}) {
  const [step, setStep] = useState<"details" | "otp">("details")
  const [details, setDetails] = useState<DetailsValues>({
    email: fixedEmail ?? "",
    name: "",
  })
  const [error, setError] = useState<string | null>(null)

  const detailsForm = useForm<DetailsValues>({
    resolver: zodResolver(
      askName
        ? detailsSchema.extend({
            name: z.string().trim().min(1, { message: "Введите имя" }),
          })
        : detailsSchema,
    ),
    defaultValues: { email: fixedEmail ?? "", name: "" },
  })

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: "" },
  })

  async function sendCode(email: string): Promise<boolean> {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    })
    if (error) {
      const msg = error.message || "Не удалось отправить код"
      setError(msg)
      toast.error(msg)
      return false
    }
    return true
  }

  async function onSend(values: DetailsValues) {
    setError(null)
    const email = fixedEmail ?? values.email
    if (beforeSend && !(await beforeSend(email))) return
    if (!(await sendCode(email))) return
    setDetails({ email, name: values.name })
    setStep("otp")
    toast.success("Код отправлен. Проверьте почту.")
  }

  async function onVerify({ otp }: OtpValues) {
    setError(null)
    const { error } = await authClient.signIn.emailOtp({
      email: details.email,
      otp,
      name: details.name || undefined,
    })
    if (error) {
      const msg = error.message || "Неверный или просроченный код"
      setError(msg)
      toast.error(msg)
      return
    }
    await onSignedIn()
  }

  async function onResend() {
    setError(null)
    if (await sendCode(details.email)) toast.success("Новый код отправлен.")
  }

  const errorBox = error && (
    <div role="alert" className="text-sm text-red-600">
      {error}
    </div>
  )

  // The two steps use two separate useForm instances. Each step's <Form> MUST
  // carry its own `key`: without it React reuses the details step's field
  // (e.g. the email <Controller>) for the OTP field at the same tree position,
  // and that Controller stays subscribed to the OLD form — the OTP input then
  // never re-renders, so typed digits vanish and submit fails validation.
  if (step === "details") {
    return (
      <Form key="details" {...detailsForm}>
        <form
          onSubmit={detailsForm.handleSubmit(onSend)}
          className="space-y-4"
        >
          {askName && (
            <FormField
              control={detailsForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Имя</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Иван Иванов"
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {fixedEmail ? (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input value={fixedEmail} disabled />
              </FormControl>
            </FormItem>
          ) : (
            <FormField
              control={detailsForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {errorBox}

          <LoadingButton
            type="submit"
            className="w-full"
            loading={detailsForm.formState.isSubmitting}
          >
            {sendLabel}
          </LoadingButton>
        </form>
      </Form>
    )
  }

  return (
    <Form key="otp" {...otpForm}>
      <form onSubmit={otpForm.handleSubmit(onVerify)} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Введите 6-значный код, отправленный на{" "}
          <strong className="text-foreground">{details.email}</strong>.
          Код действует 5 минут.
        </p>

        <FormField
          control={otpForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem className="flex flex-col items-center">
              <FormLabel className="sr-only">Код подтверждения</FormLabel>
              <FormControl>
                <InputOTP
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  // Digits only. A code copied from an email often carries
                  // spaces / a line break (" 123 456\n"); strip them on paste
                  // so it isn't cut to "123 4" by maxLength.
                  pattern={REGEXP_ONLY_DIGITS}
                  pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
                  value={field.value}
                  onChange={field.onChange}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {errorBox}

        <LoadingButton
          type="submit"
          className="w-full"
          loading={otpForm.formState.isSubmitting}
        >
          {verifyLabel}
        </LoadingButton>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep("details")
              setError(null)
              otpForm.reset()
            }}
          >
            {fixedEmail ? "Назад" : "Изменить email"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onResend}>
            Отправить код повторно
          </Button>
        </div>
      </form>
    </Form>
  )
}

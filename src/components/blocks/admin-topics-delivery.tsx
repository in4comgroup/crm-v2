"use client"

// Block «Рассылка» on /settings → «Темы» (topics plan phase 7) — platform
// admin only. Per org: the switch `topics.delivery.email`, the email
// provider state, the schedule, recipients with their choices and today's
// counts, a preview of the morning / weekly / evening email for one member
// (rendered HTML in a dialog — no sending), the test send to the CURRENT
// admin's own email, and the delivery log (last 100 rows). Telegram topic
// pushes (topics/08 T6): the separate switch `topics.delivery.telegram`, the
// recipients' bindings, and a test push to the CURRENT admin's own Telegram.
// Data: /api/admin/topics/delivery.

import { useCallback, useEffect, useState } from "react"
import { Eye, Loader, MessageCircle, RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/components/blocks/admin-ai-models"
import { DELIVERY_KIND_LABELS_RU, DELIVERY_KINDS, type DeliveryKind } from "@/lib/topics/delivery-routing"
import type {
  DeliveryAdminView,
  DeliveryOrgRow,
  DeliveryPreviewResponse,
} from "@/app/api/admin/topics/delivery/route"

const WEEKDAY_RU = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
const STATUS_LABEL: Record<string, string> = { sent: "Отправлено", failed: "Ошибка", skipped: "Пропущено" }
const REASON_LABEL: Record<string, string> = {
  empty: "нет тем",
  opted_out: "пользователь отключил",
  no_email: "нет адреса",
}
const MODE_LABEL: Record<string, string> = { off: "Выключено", shadow: "Тень", on: "Включено" }

function reasonText(r: string | null): string {
  if (!r) return ""
  return REASON_LABEL[r] ?? r
}

export function AdminTopicsDelivery() {
  const [orgs, setOrgs] = useState<DeliveryOrgRow[] | null>(null)
  const [orgId, setOrgId] = useState<string>("")
  const [view, setView] = useState<DeliveryAdminView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingTelegram, setSavingTelegram] = useState(false)
  const [userId, setUserId] = useState<string>("")
  const [kind, setKind] = useState<DeliveryKind>("morning_digest")
  const [preview, setPreview] = useState<DeliveryPreviewResponse["preview"] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [sendingTelegramTest, setSendingTelegramTest] = useState(false)

  useEffect(() => {
    fetch("/api/admin/topics/delivery")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        const list = (d.orgs ?? []) as DeliveryOrgRow[]
        setOrgs(list)
        const first = list.find((o) => o.mode === "on") ?? list.find((o) => o.mode !== "off") ?? list[0]
        if (first) setOrgId(first.organizationId)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/topics/delivery?organizationId=${encodeURIComponent(orgId)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      const v = d.view as DeliveryAdminView
      setView(v)
      setUserId((cur) => (v.recipients.some((m) => m.userId === cur) ? cur : (v.recipients[0]?.userId ?? "")))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    setView(null)
    void load()
  }, [load])

  const saveSwitch = async (emailEnabled: boolean) => {
    if (!view) return
    setSaving(true)
    try {
      const r = await fetch("/api/admin/topics/delivery", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: view.organizationId, emailEnabled }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d.view as DeliveryAdminView)
      setOrgs((prev) => prev?.map((o) => (o.organizationId === view.organizationId ? { ...o, emailOn: emailEnabled } : o)) ?? prev)
      toast.success(emailEnabled ? "Рассылка по почте включена" : "Рассылка по почте выключена")
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const saveTelegramSwitch = async (telegramEnabled: boolean) => {
    if (!view) return
    setSavingTelegram(true)
    try {
      const r = await fetch("/api/admin/topics/delivery", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: view.organizationId, telegramEnabled }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d.view as DeliveryAdminView)
      setOrgs((prev) => prev?.map((o) => (o.organizationId === view.organizationId ? { ...o, telegramOn: telegramEnabled } : o)) ?? prev)
      toast.success(telegramEnabled ? "Сообщения о темах в Telegram включены" : "Сообщения о темах в Telegram выключены")
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingTelegram(false)
    }
  }

  const showPreview = async () => {
    if (!orgId || !userId) return
    setPreviewing(true)
    try {
      const qs = new URLSearchParams({ organizationId: orgId, userId, kind, preview: "1" })
      const r = await fetch(`/api/admin/topics/delivery?${qs}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setPreview((d as DeliveryPreviewResponse).preview)
    } catch (e) {
      toast.error(`Не удалось построить письмо: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPreviewing(false)
    }
  }

  const sendTest = async () => {
    if (!orgId || !userId) return
    setSendingTest(true)
    try {
      const r = await fetch("/api/admin/topics/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", organizationId: orgId, userId, kind }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      if (d.status === "sent") toast.success(`Тестовое письмо отправлено вам: «${d.subject}»`)
      else toast.warning(`Письмо не отправлено: ${reasonText(d.reason) || d.status}`)
      void load()
    } catch (e) {
      toast.error(`Не удалось отправить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSendingTest(false)
    }
  }

  const sendTelegramTest = async () => {
    if (!orgId || !userId) return
    setSendingTelegramTest(true)
    try {
      const r = await fetch("/api/admin/topics/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_telegram", organizationId: orgId, userId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      if (d.status === "sent") toast.success("Тестовое сообщение отправлено вам в Telegram")
      else toast.warning(`Сообщение не отправлено: ${reasonText(d.reason) || d.status}`)
      void load()
    } catch (e) {
      toast.error(`Не удалось отправить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSendingTelegramTest(false)
    }
  }

  const p = view?.params

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={orgId} onValueChange={setOrgId} disabled={!orgs?.length}>
          <SelectTrigger size="sm" className="w-fit min-w-56">
            <SelectValue placeholder="Организация" />
          </SelectTrigger>
          <SelectContent>
            {(orgs ?? []).map((o) => (
              <SelectItem key={o.organizationId} value={o.organizationId}>
                {o.name} · {MODE_LABEL[o.mode] ?? o.mode}
                {o.emailOn ? " · почта вкл." : ""}
                {o.telegramOn ? " · Telegram вкл." : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" aria-label="Обновить" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {view && p && (
        <>
          <Card className="p-4 gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id="delivery-email-switch"
                checked={view.emailOn}
                disabled={saving}
                onCheckedChange={(v) => void saveSwitch(v)}
              />
              <Label htmlFor="delivery-email-switch" className="cursor-pointer">
                Рассылка тем по почте для этой организации
              </Label>
              {view.mode !== "on" && (
                <Badge variant="outline" className="font-normal">
                  режим тем «{MODE_LABEL[view.mode]}»: рассылки нет
                </Badge>
              )}
              {view.provider.configured ? (
                <Badge variant="secondary" className="font-normal">
                  почта: {view.provider.provider}
                </Badge>
              ) : (
                <Badge variant="destructive" className="font-normal">
                  почта не настроена: {view.provider.reason}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Пока переключатель выключен, письма не уходят никому. Вечерние напоминания в приложении работают всегда.
              {view.emailSwitchChange && (
                <> Последнее изменение: {formatDateTime(view.emailSwitchChange.at)}{view.emailSwitchChange.by ? `, ${view.emailSwitchChange.by}` : ""}.</>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id="delivery-telegram-switch"
                checked={view.telegramOn}
                disabled={savingTelegram}
                onCheckedChange={(v) => void saveTelegramSwitch(v)}
              />
              <Label htmlFor="delivery-telegram-switch" className="cursor-pointer">
                Сообщения о темах в Telegram
              </Label>
              {view.telegramBot ? (
                <Badge variant="secondary" className="font-normal">
                  бот: {view.telegramBot.username ? `@${view.telegramBot.username}` : "подключён"}
                </Badge>
              ) : (
                <Badge variant="outline" className="font-normal">
                  Telegram-бот не подключён
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Сообщение участнику с привязанным Telegram, когда тема попадает в «Сейчас». По умолчанию включено.
            </p>
            <p className="text-sm text-muted-foreground">
              Расписание ({p.timeZone}): утренняя сводка {p.morningDigestTime} в рабочие дни; итоги недели —{" "}
              {WEEKDAY_RU[p.weeklyReviewWeekday]} {p.weeklyReviewTime} (если праздник — последний рабочий день недели);
              вечерние напоминания {p.eveningDigestTime}, не больше {p.p6RepeatMax} за цикл. Лимит «Сейчас»:{" "}
              {p.dailyPushLimit} новых тем P6 в день на человека. В сводке видно {p.digestVisibleItems}. Ссылки: {view.appUrl}
            </p>
          </Card>

          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Получатель</TableHead>
                  <TableHead>Утро</TableHead>
                  <TableHead>Неделя</TableHead>
                  <TableHead>Вечер</TableHead>
                  <TableHead>Telegram</TableHead>
                  <TableHead className="text-right">Сейчас / Сводка / Неделя</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.recipients.map((m) => (
                  <TableRow key={m.userId} className="even:bg-muted/40">
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.email || "нет адреса"}
                        {m.banned ? " · заблокирован" : ""}
                      </div>
                    </TableCell>
                    <TableCell>{m.prefs.emailMorning ? "да" : "нет"}</TableCell>
                    <TableCell>{m.prefs.emailWeekly ? "да" : "нет"}</TableCell>
                    <TableCell>{m.prefs.emailEvening ? "да" : "нет"}</TableCell>
                    <TableCell>
                      {m.telegramBound ? (
                        <>
                          ✓ привязан
                          {!m.prefs.telegramEnabled && <span className="text-muted-foreground"> · выкл.</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.counts.now} / {m.counts.digest} / {m.counts.week}
                    </TableCell>
                  </TableRow>
                ))}
                {view.recipients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Нет участников
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <span className="text-sm">Письмо для</span>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger size="sm" className="w-fit min-w-48">
                <SelectValue placeholder="Участник" />
              </SelectTrigger>
              <SelectContent>
                {view.recipients.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(v) => setKind(v as DeliveryKind)}>
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DELIVERY_KIND_LABELS_RU[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void showPreview()} disabled={!userId || previewing}>
              {previewing ? <Loader className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              Показать письмо
            </Button>
            <Button size="sm" variant="outline" onClick={() => void sendTest()} disabled={!userId || sendingTest}>
              {sendingTest ? <Loader className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Отправить мне тестовое письмо
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void sendTelegramTest()}
              disabled={!userId || sendingTelegramTest || !view.telegramBot}
            >
              {sendingTelegramTest ? <Loader className="h-4 w-4 mr-1 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1" />}
              Тест в Telegram (мне)
            </Button>
            <span className="text-xs text-muted-foreground">
              Тест уходит только вам (на ваш адрес или в ваш Telegram), с пометкой «[Тест]». Участнику ничего не
              отправляется.
            </span>
          </div>

          <div>
            <h3 className="text-sm font-medium pb-2">Журнал рассылки (последние 100)</h3>
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Получатель</TableHead>
                    <TableHead>Вид</TableHead>
                    <TableHead>День</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Тема письма</TableHead>
                    <TableHead className="text-right">Тем</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.log.map((r) => (
                    <TableRow key={r.id} className="even:bg-muted/40">
                      <TableCell className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell>{r.userName ?? r.userEmail ?? r.userId}</TableCell>
                      <TableCell>
                        {DELIVERY_KIND_LABELS_RU[r.kind as keyof typeof DELIVERY_KIND_LABELS_RU] ?? r.kind}
                        {r.channel !== "email" ? ` · ${r.channel}` : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.localDate}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "failed" ? "destructive" : r.status === "sent" ? "secondary" : "outline"}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {r.error && <div className="text-xs text-muted-foreground pt-1">{reasonText(r.error)}</div>}
                      </TableCell>
                      <TableCell>{r.subject ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.topicCount}</TableCell>
                    </TableRow>
                  ))}
                  {view.log.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Рассылок ещё не было
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        </>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.subject}</DialogTitle>
            <DialogDescription>
              {preview?.empty
                ? "Для этого участника сейчас нет тем — такое письмо не отправляется."
                : `Тем в письме: ${preview?.topicCount ?? 0}. Это предпросмотр, письмо не отправлено.`}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <iframe
              title="Предпросмотр письма"
              sandbox=""
              srcDoc={preview.html}
              className="w-full h-[65vh] rounded-md border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

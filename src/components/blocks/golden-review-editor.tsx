"use client"

// Golden-set review editor (spec topics/01 §12, plan phase 0 task 7 +
// phase 3 «Open»). ONE component for both places:
//   • /settings → «Тесты и отладка» → «Эталонный набор» (platform admin,
//     apiBase /api/admin/topics/golden, `allowJson` = «JSON (для администратора)»);
//   • /review «Проверка эталона» (org owner / admin of the active org,
//     apiBase /api/topics/golden — review actions only).
// Left: the message (date, channel, direction, text). Right: the form —
// «Ожидаемые сигналы» (code picker over the org's effective active codes,
// «Цитата», «О ком / о чём»), «Сигналов нет», «Темы сообщения» (chips with
// autocomplete from the org's labels + «Взять из движка»), «Заметка
// проверяющего», pre-annotation suggestions, and the actions «Сохранить»,
// «Сохранить и отметить «Проверен»», «Исключить из набора», «Следующее».
// Stored shape: src/lib/topics/golden-expected.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, ChevronsUpDown, Cpu, Loader, Plus, TextSelect, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  dedupeTopicGroups,
  normalizeTopicGroupLabel,
  quoteFoundInText,
  readGoldenExpected,
  reviewReadinessError,
  topicGroupKey,
} from "@/lib/topics/golden-expected"
import type { GoldenCodeOption, GoldenItemDetail } from "@/app/api/admin/topics/golden/route"

export type GoldenApiBase = "/api/admin/topics/golden" | "/api/topics/golden"

export const GOLDEN_STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  pre_annotated: "Предразмечен",
  reviewed: "Проверен",
  excluded: "Исключён",
}

const STATUS_CLASS: Record<string, string> = {
  new: "bg-muted text-foreground",
  pre_annotated: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  reviewed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  excluded: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
}

export function GoldenStatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${STATUS_CLASS[status] ?? ""}`}>
      {GOLDEN_STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function GoldenCodeList({ codes, muted }: { codes: string[] | null; muted?: boolean }) {
  if (codes === null) return <span className="text-muted-foreground">—</span>
  if (codes.length === 0) return <span className="text-muted-foreground">нет сигнала</span>
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((c, i) => (
        <Badge key={`${c}-${i}`} variant={muted ? "outline" : "secondary"} className="font-mono text-[10px]">
          {c}
        </Badge>
      ))}
    </div>
  )
}

export function GoldenGroupList({ groups }: { groups: string[] | null }) {
  if (groups === null) return <span className="text-muted-foreground">—</span>
  if (groups.length === 0) return <span className="text-muted-foreground">нет темы</span>
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((g) => (
        <Badge key={g} variant="outline" className="text-[10px]">
          {g}
        </Badge>
      ))}
    </div>
  )
}

export const PROVIDER_LABEL: Record<string, string> = {
  nylas: "Почта",
  imap: "Почта",
  telegram: "Telegram",
  gchat: "Google Chat",
  whatsapp: "WhatsApp",
  gdrive: "Google Drive",
  dropoff: "Файл",
  aichat: "ИИ чат",
}

const DIRECTION_LABEL: Record<string, string> = {
  inbound: "входящее",
  outbound: "исходящее",
  internal: "внутреннее",
}

export const fmtGoldenDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"

const TOPIC_RULE_HINT =
  "Одна тема = один бизнес-вопрос. Одинаковая подпись у всех сообщений об одном вопросе. Пустое поле = сообщение не относится ни к одной теме"

type CodeRow = { key: string; code: string; evidence: string; subject: string }
type PreCode = { code: string; evidence?: string; subject?: string; confidence?: string }

let rowSeq = 0
const newKey = () => `r${++rowSeq}`

type FormState = { codes: CodeRow[]; noSignal: boolean; groups: string[]; reviewNote: string }

function formFromExpected(raw: unknown): FormState {
  const v = readGoldenExpected(raw)
  return {
    codes: (v?.codes ?? []).map((c) => ({
      key: newKey(),
      code: c.code,
      evidence: c.evidence ?? "",
      subject: c.subject ?? "",
    })),
    noSignal: v?.noSignal ?? false,
    groups: v?.topicGroups ?? [],
    reviewNote: v?.reviewNote ?? "",
  }
}

/** The answer to store: extra stored keys are kept, the form fields win. */
function expectedFromForm(form: FormState, base: Record<string, unknown> | null): Record<string, unknown> {
  const rest = { ...(base ?? {}) }
  for (const k of ["codes", "noSignal", "topicGroups", "topicGroup", "reviewNote"]) delete rest[k]
  const note = form.reviewNote.trim()
  return {
    ...rest,
    codes: form.noSignal
      ? []
      : form.codes
          .filter((r) => r.code)
          .map((r) => ({
            code: r.code,
            ...(r.evidence.trim() ? { evidence: r.evidence.trim() } : {}),
            ...(r.subject.trim() ? { subject: r.subject.trim() } : {}),
          })),
    noSignal: form.noSignal,
    topicGroups: dedupeTopicGroups(form.groups),
    ...(note ? { reviewNote: note } : {}),
  }
}

const formSignature = (form: FormState) =>
  JSON.stringify({
    c: form.noSignal ? [] : form.codes.filter((r) => r.code).map((r) => [r.code, r.evidence.trim(), r.subject.trim()]),
    n: form.noSignal,
    g: dedupeTopicGroups(form.groups),
    r: form.reviewNote.trim(),
  })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Ошибка")
  return data as T
}

/** Sheet with the editor; both review surfaces open items through it. */
export function GoldenItemSheet({
  apiBase,
  id,
  allowJson = false,
  onClose,
  onSaved,
  onNavigate,
}: {
  apiBase: GoldenApiBase
  id: string | null
  allowJson?: boolean
  onClose: () => void
  onSaved: () => void
  onNavigate: (id: string) => void
}) {
  const [title, setTitle] = useState<{ title: string; sub: string } | null>(null)
  return (
    <Sheet open={id !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[min(96vw,1400px)]">
        <SheetHeader className="pr-12">
          <SheetTitle className="truncate">{title?.title ?? "Элемент эталонного набора"}</SheetTitle>
          <SheetDescription>{title?.sub ?? "Загрузка…"}</SheetDescription>
        </SheetHeader>
        {id && (
          <GoldenReviewEditor
            key={id}
            apiBase={apiBase}
            id={id}
            allowJson={allowJson}
            onSaved={onSaved}
            onNavigate={onNavigate}
            onTitle={setTitle}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

export function GoldenReviewEditor({
  apiBase,
  id,
  allowJson,
  onSaved,
  onNavigate,
  onTitle,
}: {
  apiBase: GoldenApiBase
  id: string
  allowJson: boolean
  onSaved: () => void
  onNavigate: (id: string) => void
  onTitle?: (t: { title: string; sub: string }) => void
}) {
  const [item, setItem] = useState<GoldenItemDetail | null>(null)
  const [form, setForm] = useState<FormState>({ codes: [], noSignal: false, groups: [], reviewNote: "" })
  const [baseline, setBaseline] = useState("")
  const [adminNote, setAdminNote] = useState("")
  const [codeOptions, setCodeOptions] = useState<GoldenCodeOption[]>([])
  const [labels, setLabels] = useState<{ label: string; count: number }[]>([])
  const [busy, setBusy] = useState<null | "save" | "review" | "exclude" | "next" | "engine">(null)
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [fullText, setFullText] = useState(false)
  const selectionRef = useRef("")
  const textRef = useRef<HTMLDivElement>(null)

  const applyItem = useCallback(
    (it: GoldenItemDetail) => {
      setItem(it)
      const f = formFromExpected(it.expected)
      setForm(f)
      setBaseline(formSignature(f))
      setAdminNote(it.note ?? "")
      setJsonMode(false)
      setJsonError(null)
      onTitle?.({
        title: it.synthetic ? "Синтетическое сообщение" : (it.subject ?? "Элемент эталонного набора"),
        sub: `${GOLDEN_STATUS_LABEL[it.status] ?? it.status} · ${it.textChars} симв.${it.reviewedAt ? ` · проверен ${fmtGoldenDate(it.reviewedAt)}` : ""}`,
      })
    },
    [onTitle],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ item: GoldenItemDetail }>(`${apiBase}?id=${encodeURIComponent(id)}`)
        if (cancelled) return
        applyItem(data.item)
        const org = encodeURIComponent(data.item.organizationId)
        const [codes, groups] = await Promise.all([
          api<{ codes: GoldenCodeOption[] }>(`${apiBase}?codeOptions=1&orgId=${org}`),
          api<{ labels: { label: string; count: number }[] }>(`${apiBase}?groupLabels=1&orgId=${org}`),
        ])
        if (cancelled) return
        setCodeOptions(codes.codes)
        setLabels(groups.labels)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось открыть элемент")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase, id, applyItem])

  const optionByCode = useMemo(() => new Map(codeOptions.map((o) => [o.code, o])), [codeOptions])
  const dirty =
    !!item && (formSignature(form) !== baseline || (allowJson && adminNote.trim() !== (item.note ?? "").trim()))
  const pre = (item?.preAnnotation ?? null) as { codes?: PreCode[]; noSignal?: boolean; direction?: string } | null
  const preCodes = pre?.codes ?? []

  const setCodes = (fn: (rows: CodeRow[]) => CodeRow[]) => setForm((f) => ({ ...f, codes: fn(f.codes) }))
  const updateRow = (key: string, patch: Partial<CodeRow>) =>
    setCodes((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const isAccepted = (p: PreCode) =>
    form.codes.some((r) => r.code === p.code && r.evidence.trim() === (p.evidence ?? "").trim())
  const accept = (list: PreCode[]) => {
    setForm((f) => {
      const rows = [...f.codes]
      for (const p of list) {
        if (rows.some((r) => r.code === p.code && r.evidence.trim() === (p.evidence ?? "").trim())) continue
        rows.push({ key: newKey(), code: p.code, evidence: p.evidence ?? "", subject: p.subject ?? "" })
      }
      return { ...f, codes: rows, noSignal: false }
    })
  }

  // Selection inside the message panel, for «Выделить в тексте».
  const captureSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null
    if (!sel || sel.isCollapsed || !textRef.current) return
    if (!textRef.current.contains(sel.anchorNode) || !textRef.current.contains(sel.focusNode)) return
    selectionRef.current = sel.toString().replace(/\s+/g, " ").trim()
  }
  const fillFromSelection = (key: string) => {
    captureSelection()
    const quote = selectionRef.current
    if (!quote) {
      toast.info("Сначала выделите цитату в тексте сообщения")
      return
    }
    updateRow(key, { evidence: quote.slice(0, 500) })
  }

  const currentExpected = (): { value: Record<string, unknown> | null; error: string | null } => {
    if (!jsonMode) return { value: expectedFromForm(form, item?.expected ?? null), error: null }
    try {
      const v = JSON.parse(jsonText)
      if (!v || typeof v !== "object" || Array.isArray(v)) return { value: null, error: "Ожидается объект { codes: [...] }" }
      return { value: v as Record<string, unknown>, error: null }
    } catch (e) {
      return { value: null, error: `JSON: ${e instanceof Error ? e.message : "ошибка разбора"}` }
    }
  }

  const toggleJson = (on: boolean) => {
    if (on) {
      setJsonText(JSON.stringify(expectedFromForm(form, item?.expected ?? null), null, 2))
      setJsonError(null)
      setJsonMode(true)
      return
    }
    const { value, error } = currentExpected()
    if (error || !value) {
      setJsonError(error ?? "Ошибка")
      return
    }
    setForm(formFromExpected(value))
    setJsonMode(false)
  }

  const save = async (action: "save" | "review" | "exclude") => {
    if (!item) return
    const { value, error } = currentExpected()
    if (error) {
      setJsonError(error)
      toast.error(error)
      return
    }
    if (action === "review") {
      const why = reviewReadinessError(readGoldenExpected(value))
      if (why) {
        toast.error(why)
        return
      }
    }
    const body: Record<string, unknown> = { id: item.id }
    if (action !== "exclude" || dirty || jsonMode) body.expected = value
    if (action === "review") body.status = "reviewed"
    if (action === "exclude") body.status = "excluded"
    if (allowJson && adminNote.trim() !== (item.note ?? "").trim()) body.note = adminNote
    setBusy(action)
    try {
      const data = await api<{ item: GoldenItemDetail }>(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      applyItem(data.item)
      toast.success(action === "review" ? "Сохранено, отмечено «Проверен»" : action === "exclude" ? "Исключено из набора" : "Сохранено")
      onSaved()
      // New labels become suggestions for the next items.
      api<{ labels: { label: string; count: number }[] }>(
        `${apiBase}?groupLabels=1&orgId=${encodeURIComponent(data.item.organizationId)}`,
      )
        .then((d) => setLabels(d.labels))
        .catch(() => {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setBusy(null)
    }
  }

  const goNext = async () => {
    if (!item) return
    if (dirty && !window.confirm("Есть несохранённые изменения. Перейти без сохранения?")) return
    setBusy("next")
    try {
      const data = await api<{ id: string | null }>(
        `${apiBase}?next=1&after=${encodeURIComponent(item.id)}&orgId=${encodeURIComponent(item.organizationId)}`,
      )
      if (data.id) onNavigate(data.id)
      else toast.info("Непроверенных элементов больше нет")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setBusy(null)
    }
  }

  const takeFromEngine = async () => {
    if (!item) return
    setBusy("engine")
    try {
      const data = await api<{ topics: { id: string; title: string }[] }>(
        `${apiBase}?engineTopics=${encodeURIComponent(item.id)}`,
      )
      if (data.topics.length === 0) {
        toast.info("Движок не связал это сообщение ни с одной темой")
        return
      }
      setForm((f) => ({ ...f, groups: dedupeTopicGroups([...f.groups, ...data.topics.map((t) => t.title)]) }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setBusy(null)
    }
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader className="size-4 animate-spin" /> Загрузка…
      </div>
    )
  }

  const shownText = fullText || item.synthetic ? item.text : item.contentText
  const direction = item.direction ?? (pre?.direction && DIRECTION_LABEL[pre.direction] ? pre.direction : null)
  const directionNote =
    item.direction === null && direction ? " (по предразметке)" : item.directionSource === "attribution" ? " (по автору)" : ""

  return (
    <div className="grid grid-cols-1 gap-4 px-4 pb-6 lg:grid-cols-2">
      {/* ── Message ── */}
      <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <GoldenStatusBadge status={item.status} />
          <span>{fmtGoldenDate(item.itemDate)}</span>
          <span>
            {item.synthetic
              ? "синтетика"
              : `${PROVIDER_LABEL[item.provider ?? ""] ?? item.provider ?? "—"}${item.kind ? ` · ${item.kind}` : ""}`}
          </span>
          {direction && (
            <span>
              {DIRECTION_LABEL[direction] ?? direction}
              {directionNote}
            </span>
          )}
        </div>
        {item.from && <div className="truncate text-xs">От: {item.from}</div>}
        {item.note && <div className="text-xs italic text-muted-foreground">{item.note}</div>}
        <div className="flex items-center justify-between">
          <Label>Текст сообщения</Label>
          {!item.synthetic && (
            <Button size="xs" variant="ghost" onClick={() => setFullText((v) => !v)}>
              {fullText ? "Только текст сообщения" : "Весь markdown"}
            </Button>
          )}
        </div>
        <div
          ref={textRef}
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
          className="min-h-48 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm"
        >
          {shownText || <span className="text-muted-foreground">Нет текста</span>}
        </div>
      </div>

      {/* ── Form ── */}
      <div className="flex min-w-0 flex-col gap-4">
        {jsonMode ? (
          <div className="flex flex-col gap-1">
            <Label>Ожидаемый результат (JSON)</Label>
            <Textarea
              rows={18}
              className="font-mono text-xs"
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                setJsonError(null)
              }}
            />
            {jsonError ? (
              <div className="text-xs text-rose-600">{jsonError}</div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Формат: {"{ codes: [{ code, evidence?, subject? }], noSignal?, topicGroups?: string[], reviewNote? }"}.
                Коды проверяются по каталогу при сохранении.
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Suggestions from the pre-annotation */}
            {pre && (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Предложения (предразметка)</Label>
                  {preCodes.length > 0 && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => accept(preCodes)}
                      disabled={preCodes.every(isAccepted)}
                    >
                      Принять все
                    </Button>
                  )}
                </div>
                {preCodes.length === 0 ? (
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>Предразметка: сигналов нет</span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={form.noSignal || form.codes.length > 0}
                      onClick={() => setForm((f) => ({ ...f, noSignal: true }))}
                    >
                      Принять предложение
                    </Button>
                  </div>
                ) : (
                  preCodes.map((p, i) => {
                    const opt = optionByCode.get(p.code)
                    const done = isAccepted(p)
                    return (
                      <div key={`${p.code}-${i}`} className="flex items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <div>
                            <span className="font-medium">{opt?.labelRu ?? p.code}</span>{" "}
                            <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                            {p.confidence && (
                              <span className="ml-1 text-xs text-muted-foreground">· уверенность {p.confidence}</span>
                            )}
                          </div>
                          {p.evidence && <div className="text-xs text-muted-foreground">«{p.evidence}»</div>}
                          {p.subject && <div className="text-xs text-muted-foreground">о ком / о чём: {p.subject}</div>}
                        </div>
                        <Button size="xs" variant={done ? "ghost" : "outline"} disabled={done} onClick={() => accept([p])}>
                          {done ? <Check className="size-3" /> : null}
                          {done ? "Принято" : "Принять предложение"}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* Expected signals */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Ожидаемые сигналы</Label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.noSignal}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, noSignal: v === true }))}
                  />
                  Сигналов нет
                </label>
              </div>
              <div className={`flex flex-col gap-2 ${form.noSignal ? "pointer-events-none opacity-50" : ""}`}>
                {form.codes.length === 0 && !form.noSignal && (
                  <div className="text-sm text-muted-foreground">
                    Добавьте сигнал или отметьте «Сигналов нет».
                  </div>
                )}
                {form.codes.map((r) => {
                  const quoteMissing = r.evidence.trim() !== "" && !quoteFoundInText(r.evidence, item.text)
                  return (
                    <div key={r.key} className="flex flex-col gap-2 rounded-lg border p-2">
                      <div className="flex items-center gap-2">
                        <CodePicker
                          options={codeOptions}
                          value={r.code}
                          onChange={(code) => updateRow(r.key, { code })}
                          disabled={form.noSignal}
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Удалить сигнал"
                          disabled={form.noSignal}
                          onClick={() => setCodes((rows) => rows.filter((x) => x.key !== r.key))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs text-muted-foreground">Цитата</Label>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={form.noSignal}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => fillFromSelection(r.key)}
                          >
                            <TextSelect className="size-3" />
                            Выделить в тексте
                          </Button>
                        </div>
                        <Textarea
                          rows={2}
                          className="min-h-0 text-sm"
                          value={r.evidence}
                          disabled={form.noSignal}
                          placeholder="Короткая точная цитата из текста сообщения (необязательно)"
                          onChange={(e) => updateRow(r.key, { evidence: e.target.value })}
                        />
                        {quoteMissing && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            Цитата не найдена в тексте сообщения
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs text-muted-foreground">О ком / о чём</Label>
                        <Input
                          className="h-8"
                          value={r.subject}
                          disabled={form.noSignal}
                          placeholder="Например: Альфа — счёт № 124 (необязательно)"
                          onChange={(e) => updateRow(r.key, { subject: e.target.value })}
                        />
                      </div>
                    </div>
                  )
                })}
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={form.noSignal}
                    onClick={() => setCodes((rows) => [...rows, { key: newKey(), code: "", evidence: "", subject: "" }])}
                  >
                    <Plus className="size-4" />
                    Добавить сигнал
                  </Button>
                </div>
              </div>
            </div>

            {/* Topic groups */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Темы сообщения</Label>
                {!item.synthetic && (
                  <Button size="xs" variant="outline" onClick={takeFromEngine} disabled={busy !== null}>
                    {busy === "engine" ? <Loader className="size-3 animate-spin" /> : <Cpu className="size-3" />}
                    Взять из движка
                  </Button>
                )}
              </div>
              <TopicGroupsField
                value={form.groups}
                onChange={(groups) => setForm((f) => ({ ...f, groups }))}
                suggestions={labels}
              />
              <div className="text-xs text-muted-foreground">{TOPIC_RULE_HINT}</div>
            </div>

            {/* Review note */}
            <div className="flex flex-col gap-1">
              <Label>Заметка проверяющего</Label>
              <Textarea
                rows={2}
                value={form.reviewNote}
                onChange={(e) => setForm((f) => ({ ...f, reviewNote: e.target.value }))}
                placeholder="Сомнения, пограничный случай, что уточнить"
              />
            </div>
          </>
        )}

        {allowJson && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={jsonMode} onCheckedChange={toggleJson} />
              JSON (для администратора)
            </label>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Заметка администратора (почему в наборе)</Label>
              <Input className="h-8" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button onClick={() => save("save")} disabled={busy !== null || (!dirty && !jsonMode)}>
            {busy === "save" && <Loader className="size-4 animate-spin" />}
            Сохранить
          </Button>
          <Button variant="secondary" onClick={() => save("review")} disabled={busy !== null}>
            {busy === "review" && <Loader className="size-4 animate-spin" />}
            Сохранить и отметить «Проверен»
          </Button>
          <Button
            variant="outline"
            onClick={() => save("exclude")}
            disabled={busy !== null || item.status === "excluded"}
          >
            {busy === "exclude" && <Loader className="size-4 animate-spin" />}
            Исключить из набора
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={goNext} disabled={busy !== null}>
            {busy === "next" && <Loader className="size-4 animate-spin" />}
            Следующее
          </Button>
        </div>
        {dirty && <div className="text-xs text-amber-700 dark:text-amber-300">Есть несохранённые изменения</div>}
      </div>
    </div>
  )
}

/** Searchable code picker: the org's effective ACTIVE codes, grouped by block. */
function CodePicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: GoldenCodeOption[]
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.code === value)
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: GoldenCodeOption[] }>()
    for (const o of options) {
      if (!o.active) continue
      const g = m.get(o.blockCode) ?? { label: `${o.blockCode} · ${o.blockLabel}`, items: [] }
      g.items.push(o)
      m.set(o.blockCode, g)
    }
    return [...m.values()]
  }, [options])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-8 min-w-0 flex-1 justify-between py-1 text-left font-normal"
        >
          {value ? (
            <span className="min-w-0 truncate">
              {current?.labelRu ?? value}{" "}
              <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
              {current && !current.active && (
                <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">(не активен)</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Выберите сигнал…</span>
          )}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(90vw,560px)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск: название, код или блок…" />
          <CommandList className="max-h-80">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.items.map((o) => (
                  <CommandItem
                    key={o.code}
                    value={`${o.labelRu} ${o.code} ${o.blockCode} ${o.blockLabel}`}
                    onSelect={() => {
                      onChange(o.code)
                      setOpen(false)
                    }}
                  >
                    <Check className={`size-4 ${o.code === value ? "opacity-100" : "opacity-0"}`} />
                    <span className="min-w-0 flex-1 truncate">{o.labelRu}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{o.code}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** «Темы сообщения»: chips + input with autocomplete from the org's labels. */
function TopicGroupsField({
  value,
  onChange,
  suggestions,
}: {
  value: string[]
  onChange: (v: string[]) => void
  suggestions: { label: string; count: number }[]
}) {
  const [text, setText] = useState("")
  const [focused, setFocused] = useState(false)
  // Highlighted suggestion (-1 = none: Enter adds the typed text).
  const [active, setActive] = useState(-1)
  const taken = new Set(value.map(topicGroupKey))
  const q = topicGroupKey(text)
  const matches = suggestions
    .filter((s) => !taken.has(topicGroupKey(s.label)) && (!q || topicGroupKey(s.label).includes(q)))
    .slice(0, 8)
  const add = (label: string) => {
    const l = normalizeTopicGroupLabel(label)
    if (!l) return
    onChange(dedupeTopicGroups([...value, l]))
    setText("")
    setActive(-1)
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((g) => (
            <Badge key={g} variant="secondary" className="gap-1 pr-1 text-xs">
              {g}
              <button
                type="button"
                aria-label={`Убрать тему ${g}`}
                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                onClick={() => onChange(value.filter((x) => x !== g))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          className="h-8"
          value={text}
          placeholder="Например: Альфа — счёт № 124 (Enter — добавить)"
          onChange={(e) => {
            setText(e.target.value)
            setActive(-1)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((a) => Math.max(-1, a - 1))
            } else if (e.key === "Enter") {
              e.preventDefault()
              // A typed label that equals a known one (by key) reuses its spelling.
              const exact = suggestions.find((s) => topicGroupKey(s.label) === q)
              if (active >= 0 && matches[active]) add(matches[active].label)
              else if (exact) add(exact.label)
              else if (text.trim()) add(text)
            }
          }}
        />
        {focused && matches.length > 0 && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {matches.map((s, i) => (
              <button
                key={s.label}
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm ${i === active ? "bg-accent" : "hover:bg-accent"}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(s.label)
                }}
              >
                <span className="truncate">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

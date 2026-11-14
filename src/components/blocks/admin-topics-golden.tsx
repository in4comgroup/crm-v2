"use client"

// Topics golden set (plan phase 0 task 7, spec 01 §12) — platform admin.
// Org select → sample real items / add synthetic messages → LLM
// pre-annotation of selected rows → review: a row opens the shared review
// editor (golden-review-editor.tsx — the same one reviewers use on /review)
// with the form for `expected` and «JSON (для администратора)».
// API: /api/admin/topics/golden.

import { DEFAULT_PAGE_SIZE, TablePager } from "@/components/blocks/table-pager"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader, Plus, RefreshCcw, Sparkles, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { GoldenListRow } from "@/app/api/admin/topics/golden/route"
import {
  fmtGoldenDate as fmtDate,
  GOLDEN_STATUS_LABEL,
  GoldenCodeList as CodeList,
  GoldenGroupList,
  GoldenItemSheet,
  GoldenStatusBadge,
  PROVIDER_LABEL,
} from "@/components/blocks/golden-review-editor"

const ALL = "__all__"
const PREANNOTATE_CHUNK = 10

export { GOLDEN_STATUS_LABEL }

export type GoldenOrgOption = { id: string; name: string; goldenItems: number }

/** Org picker shared by the golden-set and spike blocks. */
export function useGoldenOrgs() {
  const [orgs, setOrgs] = useState<GoldenOrgOption[]>([])
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/topics/golden?orgOptions=1")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setOrgs(data.orgs ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить организации")
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { orgs, reload }
}

export function AdminTopicsGolden() {
  const { orgs, reload: reloadOrgs } = useGoldenOrgs()
  const [orgId, setOrgId] = useState("")
  const [status, setStatus] = useState(ALL)
  const [kind, setKind] = useState(ALL)
  const [suggest, setSuggest] = useState(ALL)
  const [rows, setRows] = useState<GoldenListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [sampleCount, setSampleCount] = useState("50")
  const [sampleDays, setSampleDays] = useState("180")
  const [sampling, setSampling] = useState(false)
  const [synthOpen, setSynthOpen] = useState(false)
  const [preRunning, setPreRunning] = useState<{ done: number; total: number } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId && orgs.length > 0) {
      const withItems = orgs.find((o) => o.goldenItems > 0)
      setOrgId((withItems ?? orgs[0]).id)
    }
  }, [orgs, orgId])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const sp = new URLSearchParams({ orgId, limit: String(pageSize), offset: String(page * pageSize) })
      if (status !== ALL) sp.set("status", status)
      if (kind !== ALL) sp.set("synthetic", kind)
      if (suggest !== ALL) sp.set("suggestions", suggest)
      const res = await fetch(`/api/admin/topics/golden?${sp}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
      // A filter change can leave the current page past the end.
      if ((data.rows ?? []).length === 0 && (data.total ?? 0) > 0 && page > 0) setPage(0)
      setCounts(data.counts ?? {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить золотой набор")
    } finally {
      setLoading(false)
    }
  }, [orgId, status, kind, suggest, page, pageSize])

  useEffect(() => {
    setSelected(new Set())
    load()
  }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/topics/golden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Ошибка")
    return data
  }

  const sample = async () => {
    setSampling(true)
    try {
      const data = await post({
        action: "sample",
        count: Number(sampleCount) || 50,
        days: Number(sampleDays) || 180,
      })
      const by = Object.entries(data.byProvider ?? {})
        .map(([p, n]) => `${p}: ${n}`)
        .join(", ")
      toast.success(`Добавлено: ${data.added}${by ? ` (${by})` : ""}`)
      await load()
      reloadOrgs()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сделать выборку")
    } finally {
      setSampling(false)
    }
  }

  const preannotate = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setPreRunning({ done: 0, total: ids.length })
    let ok = 0
    const errors: string[] = []
    for (let i = 0; i < ids.length; i += PREANNOTATE_CHUNK) {
      try {
        const data = await post({ action: "preannotate", ids: ids.slice(i, i + PREANNOTATE_CHUNK) })
        for (const r of data.results ?? []) {
          if (r.ok) ok++
          else errors.push(r.error ?? "ошибка")
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "ошибка")
      }
      setPreRunning({ done: Math.min(ids.length, i + PREANNOTATE_CHUNK), total: ids.length })
      await load()
    }
    setPreRunning(null)
    setSelected(new Set())
    if (errors.length) toast.error(`Предразметка: ${ok} готово, ошибок ${errors.length}: ${errors[0]}`)
    else toast.success(`Предразметка готова: ${ok}`)
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const countLine = useMemo(
    () =>
      Object.entries(GOLDEN_STATUS_LABEL)
        .map(([k, label]) => `${label}: ${counts[k] ?? 0}`)
        .join(" · "),
    [counts],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Организация</Label>
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Выберите организацию" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} {o.goldenItems > 0 ? `(${o.goldenItems})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Кол-во</Label>
          <Input
            className="h-8 w-20"
            type="number"
            min={1}
            max={200}
            value={sampleCount}
            onChange={(e) => setSampleCount(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">За дней</Label>
          <Input
            className="h-8 w-20"
            type="number"
            min={1}
            value={sampleDays}
            onChange={(e) => setSampleDays(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={sample} disabled={!orgId || sampling}>
          {sampling ? <Loader className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Добавить выборку
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSynthOpen(true)} disabled={!orgId}>
          <Sparkles className="size-4" />
          Добавить синтетическое сообщение
        </Button>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            {Object.entries(GOLDEN_STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все элементы</SelectItem>
            <SelectItem value="real">Реальные</SelectItem>
            <SelectItem value="synthetic">Синтетические</SelectItem>
          </SelectContent>
        </Select>
        <Select value={suggest} onValueChange={setSuggest}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все (предложения)</SelectItem>
            <SelectItem value="1">С предложениями</SelectItem>
            <SelectItem value="0">Без предложений</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            onClick={preannotate}
            disabled={selected.size === 0 || preRunning !== null}
          >
            {preRunning ? <Loader className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {preRunning
              ? `Предразметка ${preRunning.done}/${preRunning.total}`
              : `Предразметка${selected.size ? ` (${selected.size})` : ""}`}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={load} disabled={loading} aria-label="Обновить">
            <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        {rows.length} из {total} · {countLine}
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Выбрать все" />
              </TableHead>
              <TableHead>Источник</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Текст</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Ожидаемые коды</TableHead>
              <TableHead>Предразметка</TableHead>
              <TableHead>Темы сообщения</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {loading ? "Загрузка…" : "Пусто. Добавьте выборку или синтетическое сообщение."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer even:bg-muted/40"
                onClick={() => setOpenId(r.id)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {r.synthetic ? (
                    <Badge variant="outline">синтетика</Badge>
                  ) : (
                    <>
                      {PROVIDER_LABEL[r.provider ?? ""] ?? r.provider ?? "—"}
                      <div className="text-muted-foreground">{r.kind ?? ""}</div>
                    </>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.itemDate)}</TableCell>
                <TableCell className="max-w-md text-xs">
                  {r.subject && <div className="truncate font-medium">{r.subject}</div>}
                  <div className="line-clamp-2 text-muted-foreground">{r.textPreview}</div>
                  {r.note && <div className="mt-0.5 italic text-muted-foreground">{r.note}</div>}
                </TableCell>
                <TableCell>
                  <GoldenStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="max-w-56">
                  <CodeList codes={r.expectedCodes} />
                </TableCell>
                <TableCell className="max-w-56">
                  <CodeList codes={r.preCodes} muted />
                </TableCell>
                <TableCell className="max-w-56">
                  <GoldenGroupList groups={r.topicGroups} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <TablePager
        page={page}
        pageSize={pageSize}
        total={total}
        disabled={loading}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(0)
        }}
      />

      <SyntheticDialog
        open={synthOpen}
        onOpenChange={setSynthOpen}
        onSubmit={async (text, note) => {
          await post({ action: "synthetic", text, note })
          toast.success("Сообщение добавлено")
          await load()
          reloadOrgs()
        }}
      />
      <GoldenItemSheet
        apiBase="/api/admin/topics/golden"
        allowJson
        id={openId}
        onClose={() => setOpenId(null)}
        onSaved={load}
        onNavigate={setOpenId}
      />
    </div>
  )
}

function SyntheticDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (text: string, note: string) => Promise<void>
}) {
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      await onSubmit(text, note)
      setText("")
      setNote("")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить")
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Синтетическое сообщение</DialogTitle>
          <DialogDescription>
            Тестовое письмо или сообщение чата для редкого кода или примера из спецификации. В метриках
            синтетика считается отдельно.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Текст</Label>
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Добрый день! Прошу отгрузить к пятнице…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Заметка</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: редкий код ORDER_CHANGE_REQUESTED"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving || !text.trim()}>
            {saving && <Loader className="size-4 animate-spin" />}
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

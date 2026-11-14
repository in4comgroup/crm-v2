"use client"

// «Проверка эталона» (/review) — golden-set review for org owners / admins
// of the ACTIVE org (IN4COM reviewers are org members, not platform admins).
// Lists the org's golden items (filters: status, real / synthetic, with /
// without suggestions) and opens the shared review editor
// (golden-review-editor.tsx). API: /api/topics/golden (org from the session).

import { DEFAULT_PAGE_SIZE, TablePager } from "@/components/blocks/table-pager"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Play, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GoldenListRow } from "@/app/api/admin/topics/golden/route"
import {
  fmtGoldenDate,
  GOLDEN_STATUS_LABEL,
  GoldenCodeList,
  GoldenGroupList,
  GoldenItemSheet,
  GoldenStatusBadge,
  PROVIDER_LABEL,
} from "@/components/blocks/golden-review-editor"

const ALL = "__all__"
const API = "/api/topics/golden"

export function GoldenReviewList() {
  const [status, setStatus] = useState(ALL)
  const [kind, setKind] = useState(ALL)
  const [suggest, setSuggest] = useState(ALL)
  const [rows, setRows] = useState<GoldenListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
      if (status !== ALL) sp.set("status", status)
      if (kind !== ALL) sp.set("synthetic", kind)
      if (suggest !== ALL) sp.set("suggestions", suggest)
      const res = await fetch(`${API}?${sp}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
      // A filter change can leave the current page past the end.
      if ((data.rows ?? []).length === 0 && (data.total ?? 0) > 0 && page > 0) setPage(0)
      setCounts(data.counts ?? {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить эталонный набор")
    } finally {
      setLoading(false)
    }
  }, [status, kind, suggest, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const startReview = async () => {
    try {
      const res = await fetch(`${API}?next=1`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      if (data.id) setOpenId(data.id)
      else toast.info("Непроверенных элементов нет")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка")
    }
  }

  const countLine = useMemo(
    () =>
      Object.entries(GOLDEN_STATUS_LABEL)
        .map(([k, label]) => `${label}: ${counts[k] ?? 0}`)
        .join(" · "),
    [counts],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Button size="sm" onClick={startReview}>
          <Play className="size-4" />
          Начать проверку
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
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          onClick={load}
          disabled={loading}
          aria-label="Обновить"
        >
          <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        {rows.length} из {total} · {countLine}
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Источник</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Текст</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Ожидаемые сигналы</TableHead>
              <TableHead>Предложения</TableHead>
              <TableHead>Темы сообщения</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? "Загрузка…" : "Пусто. Эталонный набор собирает администратор платформы."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer even:bg-muted/40" onClick={() => setOpenId(r.id)}>
                <TableCell className="whitespace-nowrap text-xs">
                  {r.synthetic ? (
                    <Badge variant="outline">синтетика</Badge>
                  ) : (
                    (PROVIDER_LABEL[r.provider ?? ""] ?? r.provider ?? "—")
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{fmtGoldenDate(r.itemDate)}</TableCell>
                <TableCell className="max-w-md text-xs">
                  {r.subject && <div className="truncate font-medium">{r.subject}</div>}
                  <div className="line-clamp-2 text-muted-foreground">{r.textPreview}</div>
                </TableCell>
                <TableCell>
                  <GoldenStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="max-w-56">
                  <GoldenCodeList codes={r.expectedCodes} />
                </TableCell>
                <TableCell className="max-w-56">
                  <GoldenCodeList codes={r.preCodes} muted />
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

      <GoldenItemSheet
        apiBase={API}
        id={openId}
        onClose={() => setOpenId(null)}
        onSaved={load}
        onNavigate={setOpenId}
      />
    </div>
  )
}

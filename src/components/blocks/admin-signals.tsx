"use client"

// «Сигналы» (Signals registry) tab on /settings — platform admin only.
// Full editor of the signal taxonomy: codes, packs, blocks, attributes,
// relations, pack overrides, per-org activation / overrides, stage rules,
// risk types and their per-org stage guards; history and Markdown export.
// Spec: docs/specs/topics/05-signals-registry.md (§3, §5, §7) and
// 01-specification.md §4.1. Contract: src/lib/signals/types.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, History, Loader, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CLASS_LABELS_RU,
  DISPLAY_PROFILES,
  PROFILE_LABELS_RU,
  SIGNAL_CLASSES,
  SIGNAL_FAMILIES,
  SIGNAL_STAGES,
  STAGE_LABELS_RU,
  type SignalsOrgResponse,
  type SignalsOrgsResponse,
  type SignalsRegistryResponse,
  type SignalsSaveRequest,
} from "@/lib/signals/types"
import {
  CodeEditorSheet,
  CodesTable,
  EMPTY_FILTERS,
  type CodeFilters,
} from "@/components/blocks/admin-signals-codes"
import {
  AttributesPanel,
  PacksBlocksPanel,
  RelationsPanel,
  RiskTypesPanel,
} from "@/components/blocks/admin-signals-platform"
import { StageRulesPanel } from "@/components/blocks/admin-signals-stage-rules"
import { OrgPanel } from "@/components/blocks/admin-signals-org"
import { SignalsHistorySheet } from "@/components/blocks/admin-signals-history"
import {
  FAMILY_LABELS_RU,
  SIGNALS_API,
  SignalsContext,
  ValueSelect,
  getJson,
  putSignals,
  type SaveResult,
  type SignalsContextValue,
} from "@/components/blocks/admin-signals-shared"
import { usePersistentTab } from "@/lib/use-persistent-tab"

type OrgState = { id: string; data: SignalsOrgResponse | null; error: string | null }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""))
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : null
}

const SIGNALS_TABS = [
  "codes",
  "packs",
  "attributes",
  "relations",
  "risks",
  "templates",
  "org",
] as const
type SignalsTab = (typeof SIGNALS_TABS)[number]

export function AdminSignals() {
  const [registry, setRegistry] = useState<SignalsRegistryResponse | null>(null)
  const [regError, setRegError] = useState<string | null>(null)
  const [orgs, setOrgs] = useState<SignalsOrgsResponse["orgs"]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgState, setOrgState] = useState<OrgState | null>(null)
  const [filters, setFilters] = useState<CodeFilters>(EMPTY_FILTERS)
  // Remembered per browser; no URL param (`?tab=` belongs to /settings).
  const [tab, setTab] = usePersistentTab<SignalsTab>("settings.signals", "codes", {
    allowed: SIGNALS_TABS,
    urlParam: false,
  })
  const [editor, setEditor] = useState<{ isNew: boolean; code: string | null }>({ isNew: false, code: null })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const orgSeq = useRef(0)

  const loadRegistry = useCallback(async () => {
    try {
      const d = await getJson<SignalsRegistryResponse>(`${SIGNALS_API}?view=registry`)
      setRegistry(d)
      setRegError(null)
    } catch (e) {
      setRegError(errMsg(e))
    }
  }, [])

  const loadOrgs = useCallback(async () => {
    try {
      const d = await getJson<SignalsOrgsResponse>(`${SIGNALS_API}?view=orgs`)
      setOrgs(d.orgs)
    } catch (e) {
      toast.error(`Не удалось загрузить организации: ${errMsg(e)}`)
    }
  }, [])

  const loadOrg = useCallback(async (id: string) => {
    const seq = ++orgSeq.current
    try {
      const d = await getJson<SignalsOrgResponse>(`${SIGNALS_API}?view=org&orgId=${encodeURIComponent(id)}`)
      if (seq === orgSeq.current) setOrgState({ id, data: d, error: null })
    } catch (e) {
      if (seq === orgSeq.current) setOrgState({ id, data: null, error: errMsg(e) })
    }
  }, [])

  useEffect(() => {
    loadRegistry()
    loadOrgs()
  }, [loadRegistry, loadOrgs])

  useEffect(() => {
    if (orgId) loadOrg(orgId)
  }, [orgId, loadOrg])

  const org = orgState && orgState.id === orgId ? orgState.data : null
  const orgLoading = !!orgId && (!orgState || orgState.id !== orgId)
  const orgError = orgState && orgState.id === orgId ? orgState.error : null

  const reload = useCallback(async () => {
    await Promise.all([loadRegistry(), orgId ? loadOrg(orgId) : Promise.resolve(), loadOrgs()])
  }, [loadRegistry, loadOrg, loadOrgs, orgId])

  const save = useCallback(
    async (req: SignalsSaveRequest): Promise<SaveResult> => {
      try {
        const r = await putSignals(req)
        if (r.ok) {
          toast.success(`Сохранено (версия ${r.version})`)
          if (r.warnings?.length) {
            toast.warning(`Предупреждения: ${r.warnings.map((w) => w.message).join("; ")}`)
          }
          await reload()
        } else {
          toast.error(`Не сохранено: ошибок ${r.errors.length}`)
        }
        return r
      } catch (e) {
        const message = errMsg(e)
        toast.error(`Не удалось сохранить: ${message}`)
        return { ok: false, errors: [{ field: "", message }] }
      }
    },
    [reload],
  )

  const ctx = useMemo<SignalsContextValue | null>(
    () => (registry ? { registry, org, orgId, reload, save } : null),
    [registry, org, orgId, reload, save],
  )

  const onExport = async () => {
    setExporting(true)
    try {
      const url = `${SIGNALS_API}/export${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`
      const r = await fetch(url)
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const blob = await r.blob()
      const name =
        filenameFrom(r.headers.get("Content-Disposition")) ??
        `signals-registry-v${registry?.version ?? 0}${orgId ? `-${orgId}` : ""}.md`
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (e) {
      toast.error(`Экспорт не удался: ${errMsg(e)}`)
    } finally {
      setExporting(false)
    }
  }

  const setF = <K extends keyof CodeFilters>(k: K, v: CodeFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  if (!registry || !ctx) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-sm">
        {regError ? (
          <>
            <span className="text-red-500">Не удалось загрузить реестр сигналов: {regError}</span>
            <Button size="sm" variant="outline" onClick={() => loadRegistry()}>
              Повторить
            </Button>
          </>
        ) : (
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </Card>
    )
  }

  const blockOpts = registry.blocks
    .filter((b) => !filters.pack || b.packCode === filters.pack)
    .sort((a, b) => a.packCode.localeCompare(b.packCode) || a.sort - b.sort)
    .map((b) => ({ value: b.code, label: `${b.code} · ${b.labelRu}` }))

  return (
    <SignalsContext.Provider value={ctx}>
      <div className="flex flex-col gap-3">
        {/* White toolbar (src/app/AGENTS.md § "White toolbar convention") */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          {tab === "codes" && (
            <Button size="sm" onClick={() => setEditor({ isNew: true, code: null })}>
              <Plus className="h-4 w-4" />
              Создать код
            </Button>
          )}
          <Badge variant="secondary" className="h-8 px-2.5">
            Версия {registry.version}
          </Badge>
          <div className="w-64">
            <ValueSelect
              size="sm"
              value={orgId}
              onChange={(v) => {
                setOrgId(v)
                if (!v) setF("activeOnly", false)
              }}
              options={orgs.map((o) => ({ value: o.id, label: `${o.name} · ${o.activeCodes} кодов` }))}
              nullable
              noneLabel="Платформа (без организации)"
            />
          </div>
          {orgLoading && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}

          {tab === "codes" && (
            <>
              <div className="w-40">
                <ValueSelect
                  size="sm"
                  value={filters.pack}
                  onChange={(v) => setFilters((f) => ({ ...f, pack: v, block: null }))}
                  options={registry.packs.map((p) => ({ value: p.code, label: p.labelRu }))}
                  nullable
                  noneLabel="Все пакеты"
                />
              </div>
              <div className="w-44">
                <ValueSelect size="sm" value={filters.block} onChange={(v) => setF("block", v)} options={blockOpts} nullable noneLabel="Все блоки" />
              </div>
              <div className="w-40">
                <ValueSelect
                  size="sm"
                  value={filters.stage}
                  onChange={(v) => setF("stage", v)}
                  options={SIGNAL_STAGES.map((s) => ({ value: s, label: STAGE_LABELS_RU[s] }))}
                  nullable
                  noneLabel="Все стадии"
                />
              </div>
              <div className="w-40">
                <ValueSelect
                  size="sm"
                  value={filters.profile}
                  onChange={(v) => setF("profile", v)}
                  options={[
                    { value: "auto", label: "Авто (по оценке)" },
                    ...DISPLAY_PROFILES.map((p) => ({ value: p, label: PROFILE_LABELS_RU[p] })),
                  ]}
                  nullable
                  noneLabel="Все профили"
                />
              </div>
              <div className="w-40">
                <ValueSelect
                  size="sm"
                  value={filters.klass}
                  onChange={(v) => setF("klass", v)}
                  options={[
                    ...SIGNAL_CLASSES.map((c) => ({ value: c, label: CLASS_LABELS_RU[c] })),
                    { value: "none", label: "Без класса" },
                  ]}
                  nullable
                  noneLabel="Все классы"
                />
              </div>
              <div className="w-44">
                <ValueSelect
                  size="sm"
                  value={filters.family}
                  onChange={(v) => setF("family", v)}
                  options={SIGNAL_FAMILIES.map((f) => ({ value: f, label: FAMILY_LABELS_RU[f] }))}
                  nullable
                  noneLabel="Все семейства"
                />
              </div>
              <label className={`flex items-center gap-2 text-sm ${orgId ? "cursor-pointer" : "opacity-50"}`}>
                <Checkbox
                  checked={filters.activeOnly}
                  disabled={!orgId}
                  onCheckedChange={(v) => setF("activeOnly", v === true)}
                />
                Только активные для организации
              </label>
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.q}
                  onChange={(e) => setF("q", e.target.value)}
                  placeholder="Код, подпись, признак…"
                  className="h-8 pl-8"
                />
              </div>
              {filtered && (
                <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Сбросить
                </Button>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
              {exporting ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Экспорт в Markdown
            </Button>
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" />
              История
            </Button>
          </div>
        </div>

        {orgError && (
          <p className="text-sm text-red-500">
            Не удалось загрузить настройки организации: {orgError}{" "}
            <button type="button" className="underline" onClick={() => orgId && loadOrg(orgId)}>
              Повторить
            </button>
          </p>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as SignalsTab)}>
          <TabsList>
            <TabsTrigger value="codes">Коды</TabsTrigger>
            <TabsTrigger value="packs">Пакеты и блоки</TabsTrigger>
            <TabsTrigger value="attributes">Атрибуты</TabsTrigger>
            <TabsTrigger value="relations">Связи</TabsTrigger>
            <TabsTrigger value="risks">Риски</TabsTrigger>
            <TabsTrigger value="templates">Шаблоны правил</TabsTrigger>
            <TabsTrigger value="org">
              Организация{org ? ` · ${org.organizationName}` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="codes" className="mt-3">
            <CodesTable filters={filters} onOpen={(code) => setEditor({ isNew: false, code })} />
          </TabsContent>
          <TabsContent value="packs" className="mt-3">
            <PacksBlocksPanel />
          </TabsContent>
          <TabsContent value="attributes" className="mt-3">
            <AttributesPanel />
          </TabsContent>
          <TabsContent value="relations" className="mt-3">
            <RelationsPanel />
          </TabsContent>
          <TabsContent value="risks" className="mt-3">
            <RiskTypesPanel />
          </TabsContent>
          <TabsContent value="templates" className="mt-3">
            <StageRulesPanel mode="template" />
          </TabsContent>
          <TabsContent value="org" className="mt-3">
            {orgLoading ? (
              <Card className="flex justify-center py-10">
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              </Card>
            ) : (
              <OrgPanel />
            )}
          </TabsContent>
        </Tabs>

        <CodeEditorSheet
          code={editor.code}
          isNew={editor.isNew}
          onClose={() => setEditor({ isNew: false, code: null })}
          onCreated={(code) => setEditor({ isNew: false, code })}
        />
        <SignalsHistorySheet
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          orgs={orgs}
          refreshKey={registry.version}
        />
      </div>
    </SignalsContext.Provider>
  )
}

"use client"

import { authClient } from "@/lib/auth-client"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ShieldAlert } from "lucide-react"
import { TableAdminUsers } from "@/components/tables/table-admin-users"
import { TableAdminOrgs } from "@/components/tables/table-admin-orgs"
import { TableAdminSources } from "@/components/tables/table-admin-sources"
import { AdminAutoProcessing } from "@/components/blocks/admin-auto-processing"
import { TableAdminTemplates } from "@/components/tables/table-admin-templates"
import { AdminTeardown } from "@/components/blocks/admin-teardown"
import { AdminAiModels } from "@/components/blocks/admin-ai-models"
import { AdminAiProcesses } from "@/components/blocks/admin-ai-processes"
import { AdminAiUsage } from "@/components/blocks/admin-ai-usage"
import { AdminTopics } from "@/components/blocks/admin-topics"
import { AdminSignals } from "@/components/blocks/admin-signals"
import { AdminTopicsTesting } from "@/components/blocks/admin-topics-testing"
import { PageLoader } from "@/components/blocks/page-loader"
import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { usePersistentTab } from "@/lib/use-persistent-tab"

import { useState } from "react"
import { DealStageSettingsDialog, type FunnelSettingsTab } from "@/components/blocks/deal-stage-settings-dialog"
import { CustomFieldsDialog } from "@/components/blocks/custom-fields-dialog"
import { useCustomFieldDefs } from "@/components/blocks/custom-field-filters"
import { Button } from "@/components/ui/button"

function FunnelSettings() {
  const [tab, setTab] = useState<FunnelSettingsTab | null>(null)
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 pt-6">
        <Button variant="outline" onClick={() => setTab("stages")}>Настроить воронку</Button>
        <Button variant="outline" onClick={() => setTab("types")}>Типы сделок</Button>
        <DealStageSettingsDialog open={tab !== null} initialTab={tab ?? "stages"}
          onOpenChange={(open) => { if (!open) setTab(null) }} onSaved={() => setTab(null)} />
      </CardContent>
    </Card>
  )
}

function CustomFieldsSettings() {
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 pt-6">
        <CustomFieldsDialog entity="client" trigger={<Button variant="outline">Поля компаний</Button>} />
        <CustomFieldsDialog entity="contact" trigger={<Button variant="outline">Поля контактов</Button>} />
      </CardContent>
    </Card>
  )
}

const SETTINGS_TABS = [
  "users",
  "organizations",
  "custom-fields",
  "funnel",
  "sources",
  "models",
  "ai-processes",
  "ai-usage",
  "topics",
  "signals",
  "testing",
] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession()
  // Remembered per browser; `?tab=` deep link wins (all tabs are shown to every admin).
  const [tab, setTab] = usePersistentTab<SettingsTab>("settings", "users", {
    allowed: SETTINGS_TABS,
  })

  const { canManage, ready } = useCustomFieldDefs("client")

  if (isPending || !ready) {
    return (
      <PageLoader className="min-h-screen" />
    )
  }

  if (session?.user?.role !== "admin" && canManage) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-medium">Настройки</h1>
          <PageHeaderActions />
        </div>
        <CustomFieldsSettings />
        <FunnelSettings />
      </div>
    )
  }

  if (session?.user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <ShieldAlert className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-medium">Доступ запрещён</h1>
        <p className="text-gray-500 mt-2">
          У вас нет прав для доступа к этой странице.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-10 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium">Настройки системы</h1>
        <PageHeaderActions />
      </div>

      <div className="w-full">
        <Tabs
          value={tab === "custom-fields" && !canManage ? "users" : tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="w-full"
        >
          <TabsList>
            <TabsTrigger value="users">Пользователи</TabsTrigger>
            <TabsTrigger value="organizations">Организации</TabsTrigger>
            {canManage && <TabsTrigger value="custom-fields">Поля</TabsTrigger>}
            <TabsTrigger value="funnel">Воронка</TabsTrigger>
            <TabsTrigger value="sources">Источники</TabsTrigger>
            <TabsTrigger value="models">Модели</TabsTrigger>
            <TabsTrigger value="ai-processes">Процессы ИИ</TabsTrigger>
            <TabsTrigger value="ai-usage">Использование ИИ</TabsTrigger>
            <TabsTrigger value="topics">Темы</TabsTrigger>
            <TabsTrigger value="signals">Сигналы</TabsTrigger>
            <TabsTrigger value="testing">Тесты и отладка</TabsTrigger>
          </TabsList>

          <TabsContent
            value="users"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminUsers />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="organizations"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminOrgs />
              </CardContent>
            </Card>
          </TabsContent>

          {canManage && <TabsContent value="custom-fields" className="mt-4"><CustomFieldsSettings /></TabsContent>}

          <TabsContent value="funnel" className="mt-4"><FunnelSettings /></TabsContent>

          {/* One «Источники» tab: templates, sources, teardown (top to bottom). */}
          <TabsContent
            value="sources"
            forceMount
            className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <h2 className="text-lg font-medium">Шаблоны источников</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  Справочник шаблонов: по ним создаются источники организаций.
                </p>
                <TableAdminTemplates />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-medium">Источники</h2>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/sources?tab=org">Источники организации</Link>
                  </Button>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Все источники платформы. Можно отфильтровать по организации.
                </p>
                <TableAdminSources />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h2 className="text-lg font-medium">Автоматическая обработка</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  «Авторазбор» включается у каждого источника в таблице выше: синхронизация и разбор по расписанию.
                  Переключатель организации создаёт компании, контакты и связи из разобранных сообщений, как «Найти в
                  источниках» → «Применить». «Запустить сейчас» делает это один раз, даже когда переключатель выключен.
                </p>
                <AdminAutoProcessing />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h2 className="text-lg font-medium">Сброс источника</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  Полное удаление данных одного источника и сброс курсора синхронизации.
                </p>
                <AdminTeardown />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Not forceMount: the registry loads only when the tab opens. */}
          <TabsContent value="models" className="mt-4">
            <AdminAiModels />
          </TabsContent>

          <TabsContent value="ai-processes" className="mt-4">
            <AdminAiProcesses />
          </TabsContent>

          <TabsContent value="ai-usage" className="mt-4">
            <AdminAiUsage />
          </TabsContent>

          {/* Topics engine operations: mode per org, runs, CRM checks, delivery (not forceMount). */}
          <TabsContent value="topics" className="mt-4">
            <AdminTopics />
          </TabsContent>

          {/* Signals registry editor (not forceMount: loads when opened). */}
          <TabsContent value="signals" className="mt-4">
            <AdminSignals />
          </TabsContent>

          {/* Topics engine tests + debugging: signal review, topic debug,
              golden set, eval (not forceMount: loads when opened). */}
          <TabsContent value="testing" className="mt-4">
            <AdminTopicsTesting />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

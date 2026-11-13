"use client"

import { authClient } from "@/lib/auth-client"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ShieldAlert } from "lucide-react"
import { TableAdminUsers } from "@/components/tables/table-admin-users"
import { TableAdminOrgs } from "@/components/tables/table-admin-orgs"
import { TableAdminSources } from "@/components/tables/table-admin-sources"
import { TableAdminTemplates } from "@/components/tables/table-admin-templates"
import { AdminTeardown } from "@/components/blocks/admin-teardown"
import { AdminAiModels } from "@/components/blocks/admin-ai-models"
import { AdminAiProcesses } from "@/components/blocks/admin-ai-processes"
import { AdminAiUsage } from "@/components/blocks/admin-ai-usage"
import { AdminTopics } from "@/components/blocks/admin-topics"
import { AdminSignals } from "@/components/blocks/admin-signals"
import { PageLoader } from "@/components/blocks/page-loader"
import { PageHeaderActions } from "@/components/blocks/page-header-actions"

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <PageLoader className="min-h-screen" />
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
        <Tabs defaultValue="users" className="w-full">
          <TabsList>
            <TabsTrigger value="users">Пользователи</TabsTrigger>
            <TabsTrigger value="organizations">Организации</TabsTrigger>
            <TabsTrigger value="templates">Шаблоны</TabsTrigger>
            <TabsTrigger value="sources">Источники</TabsTrigger>
            <TabsTrigger value="teardown">Сброс источника</TabsTrigger>
            <TabsTrigger value="models">Модели</TabsTrigger>
            <TabsTrigger value="ai-processes">Процессы ИИ</TabsTrigger>
            <TabsTrigger value="ai-usage">Использование ИИ</TabsTrigger>
            <TabsTrigger value="topics">Темы</TabsTrigger>
            <TabsTrigger value="signals">Сигналы</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
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

          <TabsContent
            value="templates"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminTemplates />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="sources"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <TableAdminSources />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="teardown"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
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

          {/* Topics engine: mode per org + hourly run log (not forceMount). */}
          <TabsContent value="topics" className="mt-4">
            <AdminTopics />
          </TabsContent>

          {/* Signals registry editor (not forceMount: loads when opened). */}
          <TabsContent value="signals" className="mt-4">
            <AdminSignals />
          </TabsContent>

          <TabsContent
            value="settings"
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center py-8">
                  Настроек платформы пока нет.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

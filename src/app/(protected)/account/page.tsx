"use client"

import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TableUserApiKeys } from "@/components/tables/table-user-api-keys"
import { OrganizationInfoForm } from "@/components/blocks/organization-info-form"
import { TableOrgMembers } from "@/components/tables/table-org-members"
import type { InferSelectModel } from "drizzle-orm"
import type { schema } from "@/db/schema"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { PageLoader } from "@/components/blocks/page-loader"
import { AccountAiUsage } from "@/components/blocks/account-ai-usage"
import { AccountTopicDelivery } from "@/components/blocks/account-topic-delivery"
import { AccountNotificationPrefs } from "@/components/blocks/account-notification-prefs"
import { OrgProfileTab } from "@/components/blocks/org-profile-tab"
import { OrgProfileBanner } from "@/components/blocks/org-profile-banner"
import { AiLimitBanner } from "@/components/blocks/ai-limit-banner"

type User = {
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null | undefined
}

// The API-key card is BUILT BUT NOT IN PRODUCTION — hidden for every
// organisation; its markup and table are deliberately kept, not deleted.
// Flip this to `true` to bring it back. (Billing / Polar was removed.)
// (Typed as `boolean` on purpose so the JSX below is not analysed as dead.)
const SHOW_PREVIEW_API_KEYS: boolean = false

type Organization = InferSelectModel<typeof schema.organization>

export default function AccountPage() {
  const { data: session } = authClient.useSession()
  const user = session?.user as User | undefined

  const [organization, setOrganization] = useState<Organization | null>(null)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // «Уведомления» tab: every member (in-app notification prefs,
  // docs/specs/notifications §6); its «Уведомления по темам» block (topics
  // phase 7) only when the org's topics mode is `on`.
  // `?tab=notifications` (link in the digest emails) opens it.
  const [topicsOn, setTopicsOn] = useState(false)
  const [tab, setTab] = useState("info")
  // «Профиль организации» (identity I1): mounted on the first visit and then
  // kept mounted (hidden), so unsaved edits survive a tab switch.
  // `?tab=org-profile` (link in the banner on /dashboard) opens it.
  const [profileVisited, setProfileVisited] = useState(false)
  const [bannerKey, setBannerKey] = useState(0)
  const openTab = (v: string) => {
    if (v === "org-profile") setProfileVisited(true)
    setTab(v)
  }

  //console.log("User session in settings page:", session)

  useEffect(() => {
    async function fetchOrganization() {
      if (!user?.id) return
      // Организация и роль текущего пользователя грузятся ПАРАЛЛЕЛЬНО, и
      // страница показывается, только когда пришли оба ответа: раньше роль
      // запрашивалась после организации полным списком участников, и вкладка
      // «Участники» с кнопкой «Сохранить» появлялись на несколько секунд
      // позже остальной страницы.
      try {
        const [orgRes, activeMember, topicsState] = await Promise.all([
          fetch(`/api/organization?userId=${encodeURIComponent(user.id)}`).then(
            (r) => r.json(),
          ),
          authClient.organization.getActiveMember(),
          fetch("/api/topics?state=1")
            .then((r) => (r.ok ? r.json() : { visible: false }))
            .catch(() => ({ visible: false })),
        ])
        const on = topicsState?.visible === true
        setTopicsOn(on)
        const wantTab = new URLSearchParams(window.location.search).get("tab")
        if (wantTab === "notifications") {
          setTab("notifications")
        } else if (wantTab === "org-profile") {
          setProfileVisited(true)
          setTab("org-profile")
        } else if (wantTab === "ai-usage" || wantTab === "members") {
          // Links from notifications (docs/specs/notifications). The tabs
          // themselves are shown only to the roles that may see them.
          setTab(wantTab)
        }
        const org: Organization | null = orgRes.organization ?? null
        let role: string | null = null
        if (org?.id && activeMember.data?.organizationId === org.id) {
          role = activeMember.data.role ?? null
        } else if (org?.id) {
          // Активная организация сессии ≠ показываемой — редкий случай
          // (несколько организаций): берём роль из списка участников.
          const { data: members } = await authClient.organization.listMembers({
            query: { organizationId: org.id },
          })
          role =
            members?.members?.find(
              (m: { userId: string }) => m.userId === user.id,
            )?.role ?? null
        }
        setOrganization(org)
        setMemberRole(role)
      } catch (e) {
        console.error("Failed to fetch organization:", e)
      } finally {
        setLoaded(true)
      }
    }

    fetchOrganization()
  }, [user?.id])

  const initials = (name: string | null | undefined) =>
    name
      ? name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
      : "О"

  // Страница организации: заголовок — название организации, ниже две
  // вкладки («Информация об организации» / «Участники»). Данные пользователя
  // переехали на отдельную страницу профиля (/profile).
  if (!loaded || !organization) {
    // Как на «Правилах»/«Настройках»: лоадер на всю высоту страницы — иначе
    // в колонке без растяжения он прилипал к верху.
    return <PageLoader className="min-h-screen" />
  }

  const isOwner = memberRole === "owner"

  return (
    <div className="flex flex-col gap-4 p-4 min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="border border-border">
            <AvatarImage
              src={organization.logo ?? undefined}
              alt={organization.name ?? "Организация"}
            />
            <AvatarFallback>{initials(organization.name)}</AvatarFallback>
          </Avatar>
          <h1 className="truncate text-xl font-medium">{organization.name}</h1>
        </div>
        <PageHeaderActions />
      </div>

      {tab !== "org-profile" && (
        <OrgProfileBanner refreshKey={bannerKey} onOpen={() => openTab("org-profile")} />
      )}
      {isOwner && tab !== "ai-usage" && <AiLimitBanner onOpen={() => openTab("ai-usage")} />}

      <Tabs value={tab} onValueChange={openTab} className="flex-1 gap-4">
        <TabsList>
          <TabsTrigger value="info">Информация об организации</TabsTrigger>
          <TabsTrigger value="org-profile">Профиль организации</TabsTrigger>
          {isOwner && user && (
            <TabsTrigger value="members">Участники</TabsTrigger>
          )}
          {isOwner && <TabsTrigger value="ai-usage">Использование ИИ</TabsTrigger>}
          <TabsTrigger value="notifications">Уведомления</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="flex flex-col gap-4">
          <OrganizationInfoForm
            organization={organization}
            canEdit={isOwner}
            onSaved={(patch) => {
              setOrganization((prev) => (prev ? { ...prev, ...patch } : prev))
              setBannerKey((k) => k + 1)
            }}
          />

          {SHOW_PREVIEW_API_KEYS && isOwner && (
            <>
              <Card className="w-full">
                <CardHeader className="flex flex-row items-center gap-6 justify-start">
                  <CardTitle className="text-xl font-medium">
                    Управление API-ключами — ТОЛЬКО ПРЕДПРОСМОТР
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <TableUserApiKeys />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Any member reads; the owner edits (the API is the gate). */}
        {profileVisited && (
          <TabsContent value="org-profile" forceMount className="data-[state=inactive]:hidden">
            <OrgProfileTab
              reloadKey={[
                organization.name,
                organization.webUrl,
                organization.address,
                organization.email,
              ].join("|")}
              onOpenInfoTab={() => openTab("info")}
              onChanged={() => setBannerKey((k) => k + 1)}
            />
          </TabsContent>
        )}

        {isOwner && user && (
          <TabsContent value="members">
            <Card className="w-full">
              <CardContent>
                <TableOrgMembers
                  organizationId={organization.id}
                  currentUserId={user.id}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Owners only; the API checks the owner role itself. Mounted only
            when opened, so the page does not load usage data up front. */}
        {isOwner && (
          <TabsContent value="ai-usage">
            <AccountAiUsage />
          </TabsContent>
        )}

        {/* Any member: the user's own in-app notification categories, then
            the topics delivery choices (topics mode `on` only). */}
        <TabsContent value="notifications" className="flex flex-col gap-4">
          <AccountNotificationPrefs />
          {topicsOn && <AccountTopicDelivery />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

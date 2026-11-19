import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/blocks/app-sidebar"
import { getServerSession } from "@/lib/get-session"
import { getOrganizationLogo, listUserOrganizations } from "@/server/organizations"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { PanelProvider } from "@/lib/chat-panel-context"
import { GlobalChatProvider } from "@/lib/global-chat-context"
import { AiChatPanel } from "@/components/blocks/global-ai-chat"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  if (!session?.user) redirect("/sign-in")

  // The org logo is loaded here (server-side) rather than carried on the
  // session — it's a large base64 data URL and would overflow the session
  // cookie (431 Request Header Fields Too Large). See src/lib/auth.ts note.
  const orgId = session.session.activeOrganizationId
  // Platform admins get an org switcher in the sidebar footer: their own
  // memberships (id + name, sorted by name). Nobody else needs the query.
  const isPlatformAdmin = session.user.role === "admin"
  const [orgLogo, cookieStore, adminOrganizations] = await Promise.all([
    orgId ? getOrganizationLogo(orgId) : Promise.resolve(null),
    cookies(),
    isPlatformAdmin ? listUserOrganizations(session.user.id) : Promise.resolve(null),
  ])
  // The sidebar remembers open / closed: shadcn's SidebarProvider writes the
  // `sidebar_state` cookie on every toggle; reading it here makes a reload /
  // a new page start in the same state (no cookie = open).
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <SidebarProvider
      defaultOpen={sidebarOpen}
      style={
        // Ширина развёрнутого сайдбара — впритык к контенту. НЕ используем
        // max-content: у shadcn пустой gap-спейсер (sidebar-gap) тогда даёт
        // ширину 0 и fixed-панель наезжает на контент — ширина ОБОИХ элементов
        // должна быть одним конкретным значением. 13rem покрывает самый широкий
        // элемент (шапка: лого 126px + триггер), заметно у́же прежних 16rem.
        { "--sidebar-width": "13rem" } as React.CSSProperties
      }
    >
      <AppSidebar session={session} orgLogo={orgLogo} adminOrganizations={adminOrganizations} />

      <div className="relative flex-1 flex flex-col min-w-0">
        {/* Атмосфера лендинга (сетка + свечения, globals.css) — фон всего
            продукта. Лежит на колонке контента ВНЕ скролла, поэтому при
            прокрутке страниц неподвижна, как fixed .sd-bg на лендинге. */}
        <div className="sd-atmosphere" aria-hidden />
        <div className="relative z-[1] flex-1 overflow-auto">
          {/* ИИ-чат — общий для всего продукта, поднят из /dashboard сюда,
              чтобы кнопка "ИИ чат" (рядом с глобальным поиском) была
              доступна с любой страницы. Панель всегда смонтирована здесь и
              переживает переходы между страницами, поэтому история
              переписки не сбрасывается. */}
          <PanelProvider>
            <GlobalChatProvider>
              {children}
              <AiChatPanel isAdmin={session.user.role === "admin"} />
            </GlobalChatProvider>
          </PanelProvider>
        </div>
      </div>
    </SidebarProvider>
  )
}

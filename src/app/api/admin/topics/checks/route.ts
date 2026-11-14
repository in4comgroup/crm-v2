import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getServerSession } from "@/lib/get-session"
import { CHECK_KEYS, checksSwitchSchema } from "@/lib/topics/checks"
import { organizationExists } from "@/server/topics/mode"
import {
  ChecksRunError,
  getChecksView,
  listChecksOrgs,
  previewChecks,
  runChecksNow,
  setChecksSwitch,
} from "@/server/topics/checks/run"

// Block «Проверки CRM» on /settings → «Темы» (topics plan phase 8). Platform
// admins only (401 / 403).
//   GET                      → { orgs }
//   GET ?organizationId=     → { view }
//   PUT { organizationId, switch: { orders, watchdogs } } → { view }
//   POST { organizationId, action: "preview" | "run", checks?: CheckKey[] }
//        → { previews } (dry run, no write) | { outcomes } (writes; 409 when topics mode is off)

export const maxDuration = 300

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { userId: session.user.id }
}

function fail(error: unknown, where: string) {
  if (error instanceof ChecksRunError) return NextResponse.json({ error: error.message }, { status: 409 })
  console.error(`[admin/topics/checks] ${where} error:`, error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

const keysSchema = z.array(z.enum(CHECK_KEYS)).optional()
const putSchema = z.object({ organizationId: z.string().min(1), switch: checksSwitchSchema })
const postSchema = z.object({
  organizationId: z.string().min(1),
  action: z.enum(["preview", "run"]),
  checks: keysSchema,
})

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const organizationId = request.nextUrl.searchParams.get("organizationId") ?? ""
  try {
    if (!organizationId) return NextResponse.json({ orgs: await listChecksOrgs() })
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    return NextResponse.json({ view: await getChecksView(organizationId) })
  } catch (error) {
    return fail(error, "GET")
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "organizationId and switch are required" }, { status: 400 })
  try {
    const { organizationId } = parsed.data
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    await setChecksSwitch(organizationId, parsed.data.switch, auth.userId)
    return NextResponse.json({ view: await getChecksView(organizationId) })
  } catch (error) {
    return fail(error, "PUT")
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "organizationId and action are required" }, { status: 400 })
  const { organizationId, action, checks } = parsed.data
  try {
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    if (action === "preview") return NextResponse.json({ previews: await previewChecks(organizationId, checks) })
    return NextResponse.json({ outcomes: await runChecksNow(organizationId, checks, auth.userId) })
  } catch (error) {
    return fail(error, "POST")
  }
}

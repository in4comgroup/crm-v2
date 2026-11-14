import "server-only"
import { getServerSession } from "@/lib/get-session"
import { getActiveOrgRole } from "@/server/sources"
import {
  getGoldenItem,
  goldenCodeOptions,
  goldenEngineTopics,
  goldenGroupLabels,
  listGoldenItems,
  nextUnreviewedGoldenId,
  updateGoldenItem,
  type GoldenListFilters,
} from "@/server/topics/golden-set"

// Session-bound wrapper of the golden set for REVIEWERS (/review «Проверка
// эталона», API /api/topics/golden). Every function resolves the caller and
// the org from the session: an org `owner` or `admin` of the ACTIVE org.
// The org id never comes from the request; every row is tenant-checked by
// the org-explicit helpers in golden-set.ts. Review actions only: read, save
// the expected answer, mark «Проверен», exclude. Sampling, synthetic items,
// pre-annotation and every eval stay on /settings (platform admin).

export const GOLDEN_REVIEWER_ROLES = ["owner", "admin"] as const

export class GoldenReviewAccessError extends Error {
  constructor(public reason: "unauthorized" | "forbidden") {
    super(reason === "unauthorized" ? "Unauthorized" : "Нужна роль владельца или администратора организации")
  }
}

/** Caller + active org, or throws GoldenReviewAccessError. */
export async function requireGoldenReviewer(): Promise<{ userId: string; orgId: string; role: string }> {
  const session = await getServerSession()
  if (!session?.user) throw new GoldenReviewAccessError("unauthorized")
  const active = await getActiveOrgRole()
  if (!active) throw new GoldenReviewAccessError("forbidden")
  if (!(GOLDEN_REVIEWER_ROLES as readonly string[]).includes(active.role)) {
    throw new GoldenReviewAccessError("forbidden")
  }
  return { userId: session.user.id, orgId: active.organizationId, role: active.role }
}

/** For pages / the sidebar: may the caller review the active org's golden set? */
export async function canReviewGoldenSet(): Promise<boolean> {
  const active = await getActiveOrgRole()
  return !!active && (GOLDEN_REVIEWER_ROLES as readonly string[]).includes(active.role)
}

export async function reviewerListGoldenItems(filters: GoldenListFilters) {
  const { orgId } = await requireGoldenReviewer()
  return listGoldenItems(orgId, filters)
}

export async function reviewerGetGoldenItem(id: string) {
  const { orgId } = await requireGoldenReviewer()
  return getGoldenItem(id, orgId)
}

export async function reviewerCodeOptions() {
  const { orgId } = await requireGoldenReviewer()
  return goldenCodeOptions(orgId)
}

export async function reviewerGroupLabels() {
  const { orgId } = await requireGoldenReviewer()
  return goldenGroupLabels(orgId)
}

export async function reviewerEngineTopics(goldenId: string) {
  const { orgId } = await requireGoldenReviewer()
  return goldenEngineTopics(orgId, goldenId)
}

export async function reviewerNextUnreviewed(afterId: string | null) {
  const { orgId } = await requireGoldenReviewer()
  return nextUnreviewedGoldenId(orgId, afterId)
}

/** Reviewers may set only `reviewed` / `excluded`; the admin note is not theirs. */
export async function reviewerSaveGoldenItem(id: string, patch: { expected?: unknown; status?: string }) {
  const { orgId, userId } = await requireGoldenReviewer()
  if (patch.status !== undefined && patch.status !== "reviewed" && patch.status !== "excluded") {
    throw new GoldenReviewAccessError("forbidden")
  }
  return updateGoldenItem(
    id,
    {
      ...(patch.expected !== undefined ? { expected: patch.expected } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    },
    userId,
    orgId,
  )
}

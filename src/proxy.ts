import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// Central sign-in gate (Next.js 16 "proxy", formerly middleware).
//
// Rule: nothing works without sign-in. Every request without a session cookie
// is rejected here, except the short allowlist below of entry points that are
// public BY DESIGN (each protected by something else — see
// docs/specs/auth/api-access.md).
//
// This is an optimistic check (cookie present), as Next.js recommends for
// proxy. It is defense in depth: every route and server function still
// validates the session itself (getServerSession / require* helpers), because
// a cookie can be stale or forged.

const PUBLIC_PAGES: RegExp[] = [
  /^\/$/, // landing page: static, links to sign-in / sign-up only
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/accept-invitation\/[^/]+$/, // invitation id is the capability
  /^\/o\/[^/]+$/, // guest order link: the token is the capability
]

const PUBLIC_API: RegExp[] = [
  /^\/api\/auth\/(?!keys(\/|$)).+/, // better-auth (sign-in, OTP, session); NOT /api/auth/keys
  /^\/api\/invitations\/.+/, // invitation lookup before sign-up
  /^\/api\/webhooks\/.+/, // Telegram webhook: per-source secret header
  /^\/api\/cron\/.+/, // Vercel Cron: CRON_SECRET bearer token
]

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return PUBLIC_API.some((r) => r.test(pathname))
  return PUBLIC_PAGES.some((r) => r.test(pathname))
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (isPublic(pathname) || getSessionCookie(request)) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const signIn = new URL("/sign-in", request.url)
  signIn.searchParams.set("redirect", pathname + search)
  return NextResponse.redirect(signIn)
}

export const config = {
  // Everything except Next.js internals, the Vercel Workflow runtime routes
  // (/.well-known/workflow/*, called by the platform) and static files
  // (any path with a file extension, e.g. /logo.png, /favicon.ico).
  matcher: ["/((?!_next/static|_next/image|\\.well-known/|.*\\.[^/]+$).*)"],
}

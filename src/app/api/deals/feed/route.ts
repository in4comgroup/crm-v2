// Лента решений — реальный журнал (deal_activity), одна строка на КАЖДЫЙ
// перевод/создание сделки, пишется в src/server/deals.ts (moveDealStage,
// createDeal). Больше не мок/деривация из deal.changes.

import { NextResponse } from "next/server"
import { listRecentDealActivity } from "@/server/deals"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const events = await listRecentDealActivity()
    return NextResponse.json({ events })
  } catch (error) {
    return errorResponse(error)
  }
}

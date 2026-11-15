import { NextResponse } from "next/server"
import { DocumentError } from "@/server/documents"

export function documentErrorResponse(error: unknown, where: string) {
  if (error instanceof DocumentError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`[${where}]`, error)
  return NextResponse.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

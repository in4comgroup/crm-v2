import { NextResponse } from "next/server"
import { CustomFieldError } from "@/server/custom-fields"
import { CUSTOM_FIELD_ENTITIES, type CustomFieldEntity } from "@/lib/custom-fields"

export function parseEntity(v: unknown): CustomFieldEntity | null {
  return typeof v === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(v) ? (v as CustomFieldEntity) : null
}

export function customFieldErrorResponse(error: unknown, where: string) {
  if (error instanceof CustomFieldError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`[${where}]`, error)
  return NextResponse.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

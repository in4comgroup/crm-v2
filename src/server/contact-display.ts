import "server-only"

import { sql, type AnyColumn, type SQL } from "drizzle-orm"
import { contact } from "@/db/schema"

/**
 * SQL for the name to SHOW for a contact (the native name, else the system
 * name) — same rule as `contactDisplayName` in src/lib/contact-names.ts.
 * Pass an alias (`alias(contact, "x")`) when the query joins `contact` twice.
 * Display only: matching / dedupe keep reading `contact.name` + `name_native`.
 */
export function contactDisplaySql(t: { name: AnyColumn; nameNative: AnyColumn } = contact): SQL<string> {
  return sql<string>`coalesce(nullif(trim(${t.nameNative}), ''), ${t.name})`
}

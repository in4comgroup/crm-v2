import { redirect } from "next/navigation"

// «Проверка эталона» moved into the organization page as a tab (2026-11-15):
// old links / bookmarks land there.
export default function ReviewPage() {
  redirect("/account?tab=review")
}

/**
 * Prefill of «Создать задачу» on a card row (the cards feed «История
 * карточек» and the card page `/cards/[id]`; topic entries on the dashboard
 * build their own in `topic-card.tsx` from the topic). Bug list 2026-11-21,
 * item 24: company + contact + deal from the card, type from the card's
 * meaning; «Исполнитель» = the creator (default of the task form itself).
 * Pure, client-safe.
 */

import type { CardRow } from "@/server/cards"
import type { TaskPriority, TaskStatus, TaskType } from "@/db/schema"
import { suggestTaskType } from "@/lib/tasks/suggest-task-type"

export type CardTaskPrefill = {
  name: string
  description: string
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  clientId?: string
  contactId?: string
  dealId?: string
}

export function cardTaskPrefill(card: CardRow, fallbackName: string): CardTaskPrefill {
  const recommendation = card.message?.recommendation ?? ""
  const taskTitle = card.message?.taskTitle?.trim() || ""
  // The contact's own company is preferred so the form's company-scoped
  // contact picker keeps the contact; else the first linked / resolved company.
  const linkedContact = card.contacts[0] ?? null
  const clientId = linkedContact?.clientId ?? card.clients[0]?.id ?? card.company?.id ?? undefined
  const contactId = linkedContact && linkedContact.clientId === clientId ? linkedContact.id : undefined
  return {
    name: taskTitle || fallbackName,
    description: recommendation,
    type: suggestTaskType({ taskTitle, headline: recommendation, category: card.category }),
    priority: card.priority === "high" ? "high" : "medium",
    status: "todo",
    ...(clientId ? { clientId } : {}),
    ...(contactId ? { contactId } : {}),
    ...(card.dealId ? { dealId: card.dealId } : {}),
  }
}

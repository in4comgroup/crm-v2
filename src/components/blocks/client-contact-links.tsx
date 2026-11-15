"use client"

// Company side of «contact ↔ company links over time»
// (docs/specs/clients-contacts/04 §6): pending proposals «Контакт сменил
// компанию?», the «также: Y (консультант)» line of a two-company contact,
// contacts that work here through a NON-primary link, and the collapsible
// group «Бывшие» («теперь в Y»). Data: GET /api/clients/[id]/contact-links.
// Used by the company drawer and the /clients/[id] page next to their
// existing contact lists (which stay as they are).

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContactLinkProposalsList,
  linkPeriodText,
  relationShort,
} from "@/components/blocks/contact-companies-block"
import { cn } from "@/lib/utils"
import {
  LINK_RELATION_LABELS,
  type ClientContactLinkEntry,
  type ClientContactLinksResponse,
} from "@/lib/contact-links"

export function useClientContactLinks(clientId: string | null | undefined, enabled = true) {
  const [data, setData] = useState<ClientContactLinksResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  const reload = useCallback(async () => {
    if (!clientId) return
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/contact-links`,
      )
      if (reqIdRef.current !== reqId) return
      if (!res.ok) {
        setData(null)
        return
      }
      const json = (await res.json()) as ClientContactLinksResponse
      if (reqIdRef.current === reqId) setData(json)
    } catch {
      if (reqIdRef.current === reqId) setData(null)
    } finally {
      if (reqIdRef.current === reqId) setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    if (!enabled || !clientId) return
    setData(null)
    void reload()
  }, [enabled, clientId, reload])

  const entryFor = useCallback(
    (contactId: string) =>
      data?.current.find((e) => e.contactId === contactId) ?? null,
    [data],
  )

  return { data, loading, reload, entryFor }
}

function ClientLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/clients?openClient=${encodeURIComponent(id)}`}
      className="underline-offset-2 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  )
}

/** «также: Y (консультант / подрядчик), Z (сотрудник)» — nothing when none. */
export function ContactAlsoLine({
  entry,
  className,
}: {
  entry: ClientContactLinkEntry | null
  className?: string
}) {
  if (!entry || entry.elsewhere.length === 0) return null
  return (
    <div className={cn("truncate text-xs text-muted-foreground", className)}>
      также:{" "}
      {entry.elsewhere.map((o, i) => (
        <span key={o.clientId}>
          {i > 0 && ", "}
          <ClientLink id={o.clientId} name={o.clientName} /> ({relationShort(o.relation)})
        </span>
      ))}
    </div>
  )
}

function ContactName({
  entry,
  onOpenContact,
}: {
  entry: ClientContactLinkEntry
  onOpenContact?: (contactId: string) => void
}) {
  if (onOpenContact) {
    return (
      <button
        type="button"
        className="truncate text-left font-medium leading-snug underline-offset-2 hover:underline"
        onClick={() => onOpenContact(entry.contactId)}
      >
        {entry.name}
      </button>
    )
  }
  return (
    <Link
      href={`/contacts?openContact=${encodeURIComponent(entry.contactId)}`}
      className="truncate font-medium leading-snug underline-offset-2 hover:underline"
    >
      {entry.name}
    </Link>
  )
}

/**
 * Pending proposals + contacts that work here through a non-primary link
 * (not in the old list, which shows `contact.client_id` only) + «Бывшие».
 */
export function ClientContactLinksExtras({
  data,
  listedContactIds,
  onOpenContact,
  onChanged,
  showProposals = true,
}: {
  data: ClientContactLinksResponse | null
  /** false = the caller renders the proposals itself (e.g. on top). */
  showProposals?: boolean
  /** Contacts the existing list already shows (primary = this company). */
  listedContactIds: string[]
  onOpenContact?: (contactId: string) => void
  /** After a proposal decision — reload links + the company. */
  onChanged: () => void
}) {
  const [formerOpen, setFormerOpen] = useState(false)
  if (!data) return null
  const listed = new Set(listedContactIds)
  const extraCurrent = data.current.filter((e) => !listed.has(e.contactId))

  return (
    <div className="space-y-3">
      {showProposals && (
        <ContactLinkProposalsList
          proposals={data.proposals}
          showContactName
          onDecided={() => onChanged()}
        />
      )}

      {extraCurrent.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Также работают с компанией
          </div>
          {extraCurrent.map((e) => (
            <div key={e.contactId} className="rounded-md border p-2.5">
              <ContactName entry={e} onOpenContact={onOpenContact} />
              <div className="truncate text-xs text-muted-foreground">
                {[
                  LINK_RELATION_LABELS[e.relation] ?? e.relation,
                  e.position,
                  e.startedAt ? linkPeriodText(e.startedAt, null) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {e.elsewhere.length > 0 && (
                <div className="truncate text-xs text-muted-foreground">
                  основная:{" "}
                  {e.elsewhere.map((o, i) => (
                    <span key={o.clientId}>
                      {i > 0 && ", "}
                      <ClientLink id={o.clientId} name={o.clientName} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.former.length > 0 && (
        <Collapsible open={formerOpen} onOpenChange={setFormerOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Бывшие
              <span className="font-normal normal-case">{data.former.length}</span>
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 transition-transform",
                  formerOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 space-y-1.5">
              {data.former.map((e) => (
                <div
                  key={e.contactId}
                  className="rounded-md border bg-muted/30 p-2.5"
                >
                  <ContactName entry={e} onOpenContact={onOpenContact} />
                  <div className="truncate text-xs text-muted-foreground">
                    {[e.position, linkPeriodText(e.startedAt, e.endedAt), e.endReason]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                  {e.elsewhere.length > 0 && (
                    <div className="truncate text-xs text-muted-foreground">
                      теперь в{" "}
                      {e.elsewhere.map((o, i) => (
                        <span key={o.clientId}>
                          {i > 0 && ", "}
                          <ClientLink id={o.clientId} name={o.clientName} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

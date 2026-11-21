"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ArrowLeft,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  User,
} from "lucide-react"
import ClientEditDialog from "@/components/forms/form-client-edit"
import ContactEditDialog from "@/components/forms/form-contact-edit"
import { ClientFunnelStages } from "@/components/blocks/client-funnel-stages"
import { ClientLookupDialog } from "@/components/blocks/client-lookup-dialog"
import { ClientContentTable } from "@/components/blocks/client-content-table"
import { AccountSummary } from "@/components/blocks/client-card"
import {
  RelatedTopicsList,
  useRelatedTopics,
} from "@/components/blocks/related-topics"
import type { ClientDetail } from "@/server/client-content"
import { ClientResponsibleField } from "@/components/blocks/client-responsible-field"
import { ClientProfileBlock } from "@/components/blocks/client-profile-block"
import { ClientTelegramBlock } from "@/components/blocks/client-telegram-block"
import { CustomFieldsPanel } from "@/components/blocks/custom-fields-tab"
import type { ClientRow, ClientRevenueSummary } from "@/app/api/clients/route"
import type { DealRow } from "@/app/api/deals/route"
import type { SourceSummary } from "@/server/sources"
import { DocumentsPanel } from "@/components/blocks/documents-panel"
import { ContactLinkProposalsList } from "@/components/blocks/contact-companies-block"
import {
  ClientContactLinksExtras,
  ContactAlsoLine,
  useClientContactLinks,
} from "@/components/blocks/client-contact-links"

const STATUS_LABEL: Record<string, string> = {
  active: "Активная",
  initial: "Новая",
  suspended: "Приостановлена",
  deleted: "Удалена",
}

const CONTACTS_PAGE_SIZE = 5

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ClientDetailShell({
  detail,
  sources,
  revenue,
  activeDeal,
}: {
  detail: ClientDetail
  sources: SourceSummary[]
  revenue?: ClientRevenueSummary
  activeDeal?: DealRow
}) {
  const router = useRouter()
  const refresh = () => router.refresh()
  // «Темы» (spec topics/01 §14): open + recent topics of the company; the
  // block is shown only when the org's topics mode is `on`.
  const relatedTopics = useRelatedTopics({ clientId: detail.id })
  // Contacts over time (docs/specs/clients-contacts/04 §6).
  const contactLinks = useClientContactLinks(detail.id)
  const onContactsChanged = () => {
    void contactLinks.reload()
    refresh()
  }

  // ClientEditDialog expects the existing list-shape (ClientRow with
  // ClientContactPreview[]). Build the slimmer row from the detail so
  // the dialog can be reused unchanged.
  const clientRowForEdit = useMemo<ClientRow>(
    () => ({
      id: detail.id,
      name: detail.name,
      namePhys: detail.namePhys,
      comment: detail.comment,
      aliases: detail.aliases,
      phone: detail.phone,
      email: detail.email,
      address: detail.address,
      webUrl: detail.webUrl,
      customFields: detail.customFields,
      funnelPhase: detail.funnelPhase,
      status: detail.status,
      currency: detail.currency,
      userId: detail.userId,
      userName: detail.userName,
      responsibleUserId: detail.responsibleUserId,
      responsibleName: detail.responsibleName,
      responsibleChangedAt: detail.responsibleChangedAt,
      responsibleHandoverFromUserId: detail.responsibleHandoverFromUserId,
      responsibleHandoverFromName: detail.responsibleHandoverFromName,
      responsibleHandoverReason: detail.responsibleHandoverReason,
      coResponsible: detail.coResponsible ?? [],
      organizationId: detail.organizationId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      lastActivityAt: detail.lastActivityAt,
      contacts: detail.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        nameNative: c.nameNative,
        email: c.email,
        phone: c.phone,
        position: c.position,
        status: c.status,
      })),
    }),
    [detail],
  )

  const [contactPage, setContactPage] = useState(1)
  const totalContactPages = Math.max(
    1,
    Math.ceil(detail.contacts.length / CONTACTS_PAGE_SIZE),
  )
  const effectiveContactPage = Math.min(contactPage, totalContactPages)
  const contactStart = (effectiveContactPage - 1) * CONTACTS_PAGE_SIZE
  const visibleContacts = detail.contacts.slice(
    contactStart,
    contactStart + CONTACTS_PAGE_SIZE,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад к компаниям
          </Link>
        </Button>
      </div>

      {/* Big company card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-2xl truncate">{detail.name}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {detail.status !== "active" && (
                <Badge variant="outline" className="text-muted-foreground">
                  {STATUS_LABEL[detail.status] ?? detail.status}
                </Badge>
              )}
              {typeof detail.customFields?.discount === "number" &&
                detail.customFields.discount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/15 text-amber-600 dark:text-amber-300"
                  >
                    Скидка {detail.customFields.discount}%
                  </Badge>
                )}
            </div>
            {/* Stages of the company's deals (bug list 2026-11-21, item 13). */}
            <ClientFunnelStages clientId={detail.id} className="mt-3" />
          </div>
          <div className="flex items-center gap-2">
            <ClientLookupDialog
              client={clientRowForEdit}
              onSaved={refresh}
              trigger={
                <Button variant="outline" size="sm">
                  <Globe className="h-4 w-4 mr-1" />
                  Поиск в интернете
                </Button>
              }
            />
            <ClientEditDialog
              mode="edit"
              client={clientRowForEdit}
              onSuccess={refresh}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="h-4 w-4 mr-1" />
                  Редактировать
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div className="sm:col-span-2">
            <AccountSummary
              client={clientRowForEdit}
              revenue={revenue}
              activeDeal={activeDeal}
            />
          </div>
          <DetailRow icon={<Mail className="h-4 w-4" />} value={detail.email} />
          <DetailRow icon={<Phone className="h-4 w-4" />} value={detail.phone} />
          <DetailRow
            icon={<MapPin className="h-4 w-4" />}
            value={detail.address}
          />
          <DetailRow
            icon={<Globe className="h-4 w-4" />}
            value={detail.webUrl}
            href={detail.webUrl ?? undefined}
          />
          <ClientResponsibleField
            client={detail}
            onChanged={refresh}
            className="sm:col-span-2 text-foreground"
          />
          <ClientProfileBlock
            clientId={detail.id}
            className="sm:col-span-2 text-foreground"
          />
          <ClientTelegramBlock
            clientId={detail.id}
            className="sm:col-span-2 text-foreground"
            onContactsChanged={onContactsChanged}
          />
          <div className="flex items-center gap-2 sm:col-span-2 text-xs">
            <User className="h-3.5 w-3.5" />
            <span>
              Создал {detail.userName ?? "—"},{" "}
              {formatDateTime(detail.createdAt)}
              {detail.updatedAt !== detail.createdAt && (
                <> · Обновлено {formatDateTime(detail.updatedAt)}</>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* «Поля» — org custom fields of the company (docs/specs/clients-contacts, Q4). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Поля</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomFieldsPanel entity="client" entityId={detail.id} />
        </CardContent>
      </Card>

      {/* «Документы» (docs/specs/attachments §6): files linked to the company
          (+ its contacts and deals by default, Q11). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Документы</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentsPanel entityType="client" entityId={detail.id} />
        </CardContent>
      </Card>

      {/* Contacts list (active + suspended) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Контакты ({detail.contacts.length})
          </CardTitle>
          <ContactEditDialog
            mode="create"
            onSuccess={onContactsChanged}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Новый контакт
              </Button>
            }
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <ContactLinkProposalsList
            proposals={contactLinks.data?.proposals ?? []}
            showContactName
            onDecided={onContactsChanged}
          />
          {detail.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              К этой компании ещё не привязаны контакты.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Имя</TableHead>
                      <TableHead>Имя на родном языке</TableHead>
                      <TableHead className="w-56">Email</TableHead>
                      <TableHead className="w-36">Телефон</TableHead>
                      <TableHead className="w-40">Должность</TableHead>
                      <TableHead className="w-24">Статус</TableHead>
                      <TableHead className="w-12">Изм.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleContacts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium truncate">
                          {c.name}
                          <ContactAlsoLine
                            entry={contactLinks.entryFor(c.id)}
                            className="font-normal"
                          />
                        </TableCell>
                        <TableCell className="text-sm truncate">
                          {c.nameNative ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate">
                          {c.position ?? "—"}
                        </TableCell>
                        <TableCell>
                          {c.status === "active" ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            >
                              активный
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground"
                            >
                              {STATUS_LABEL[c.status] ?? c.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <ContactEditDialog
                            mode="edit"
                            contact={c}
                            onSuccess={refresh}
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label="Редактировать контакт"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalContactPages > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Страница {effectiveContactPage} из {totalContactPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={effectiveContactPage <= 1}
                      onClick={() => setContactPage((p) => Math.max(1, p - 1))}
                    >
                      Назад
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={effectiveContactPage >= totalContactPages}
                      onClick={() =>
                        setContactPage((p) =>
                          Math.min(totalContactPages, p + 1),
                        )
                      }
                    >
                      Далее
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          <ClientContactLinksExtras
            data={contactLinks.data}
            listedContactIds={detail.contacts.map((c) => c.id)}
            onChanged={onContactsChanged}
            showProposals={false}
          />
        </CardContent>
      </Card>

      {relatedTopics.visible && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Темы
              {(relatedTopics.result?.open.length ?? 0) > 0 && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  открытых: {relatedTopics.result?.open.length}
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Открытые темы и темы, закрытые за последние{" "}
              {relatedTopics.result?.recentDays ?? 60} дней. Клик открывает тему.
            </p>
          </CardHeader>
          <CardContent>
            <RelatedTopicsList
              result={relatedTopics.result}
              loading={relatedTopics.loading}
              onChanged={relatedTopics.reload}
            />
          </CardContent>
        </Card>
      )}

      {/* Client Content table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Материалы компании</CardTitle>
          <p className="text-xs text-muted-foreground">
            Разобранные элементы источников, относящиеся к этой компании
            (сопоставление по названию, адресу, сайту, а также именам/email
            контактов). Показаны только материалы, загруженные в хранилище — полный
            поиск по тексту появится позже.
          </p>
        </CardHeader>
        <CardContent>
          <ClientContentTable clientId={detail.id} sources={sources} />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailRow({
  icon,
  value,
  href,
}: {
  icon: React.ReactNode
  value: string | null
  href?: string
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2 opacity-50">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">—</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0">{icon}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate hover:underline text-[#2F5D77] dark:text-[#9FC4DC]"
        >
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  )
}

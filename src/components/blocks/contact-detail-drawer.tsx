"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContactEditForm } from "@/components/forms/form-contact-edit"
import {
  RelatedTopicsList,
  useRelatedTopics,
} from "@/components/blocks/related-topics"
import type { ContactRow } from "@/app/api/contacts/route"

// Дровер контакта — по образцу <ClientDetailDrawer>/<DealDetailDrawer>: клик
// на строку/карточку контакта открывает его здесь, сразу со всеми полями в
// режиме редактирования (не отдельная страница, не модалка). Переиспользует
// <ContactEditForm> целиком (те же поля/кнопка блокировки), а не дублирует
// разметку формы — дровер лишь даёт ей выезжающую рамку с заголовком.
export function ContactDetailDrawer({
  contact,
  open,
  onOpenChange,
  onChanged,
  canBlock = false,
}: {
  contact: ContactRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  canBlock?: boolean
}) {
  // «Темы» (spec topics/01 §14): topics on this contact, including topics
  // with no company. Only when the org's topics mode is `on`; otherwise the
  // drawer stays the plain edit form (no tab row).
  const relatedTopics = useRelatedTopics(
    contact ? { contactId: contact.id } : null,
    open,
  )

  if (!contact) return null

  const form = (
    <ContactEditForm
      mode="edit"
      contact={contact}
      canBlock={canBlock}
      onSuccess={() => {
        onChanged()
        onOpenChange(false)
      }}
      onCancel={() => onOpenChange(false)}
    />
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
        // Иначе Radix при открытии автофокусит первое поле формы — см. тот
        // же фикс в client-detail-drawer.tsx/deal-detail-drawer.tsx.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="p-4 pb-3 border-b shrink-0">
          <SheetTitle>{contact.nameNative || contact.name}</SheetTitle>
        </SheetHeader>
        {relatedTopics.visible ? (
          <Tabs
            key={contact.id}
            defaultValue="info"
            className="flex flex-1 min-h-0 flex-col gap-0"
          >
            <div className="px-4 border-b shrink-0">
              <TabsList variant="line" className="w-full justify-start gap-4">
                <TabsTrigger value="info" className="flex-none">
                  Общая информация
                </TabsTrigger>
                <TabsTrigger value="topics" className="flex-none">
                  Темы
                  {(relatedTopics.result?.open.length ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {relatedTopics.result?.open.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <TabsContent value="info">{form}</TabsContent>
              <TabsContent value="topics" className="text-sm">
                <RelatedTopicsList
                  result={relatedTopics.result}
                  loading={relatedTopics.loading}
                  onChanged={relatedTopics.reload}
                  showCounterparty
                />
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">{form}</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

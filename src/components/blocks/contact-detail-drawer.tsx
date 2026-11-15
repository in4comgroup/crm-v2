"use client"

import { useRef, useState } from "react"
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
import {
  CustomFieldsPanel,
  type CustomFieldsPanelHandle,
} from "@/components/blocks/custom-fields-tab"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

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
  // «Темы» tab is not shown.
  const relatedTopics = useRelatedTopics(
    contact ? { contactId: contact.id } : null,
    open,
  )

  // «Поля» (custom contact fields): mounted on the first visit of the tab and
  // then kept mounted (hidden) so unsaved edits survive tab switches.
  const [fieldsVisitedFor, setFieldsVisitedFor] = useState<string | null>(null)
  const fieldsPanelRef = useRef<CustomFieldsPanelHandle | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [savingFields, setSavingFields] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next && fieldsPanelRef.current?.isDirty()) {
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(next)
  }

  async function saveFieldsAndClose() {
    setSavingFields(true)
    const ok = (await fieldsPanelRef.current?.save()) ?? true
    setSavingFields(false)
    if (!ok) return
    setConfirmCloseOpen(false)
    onOpenChange(false)
  }

  if (!contact) return null

  const fieldsMounted = fieldsVisitedFor === contact.id

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
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
        // Иначе Radix при открытии автофокусит первое поле формы — см. тот
        // же фикс в client-detail-drawer.tsx/deal-detail-drawer.tsx.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="p-4 pb-3 border-b shrink-0">
          <SheetTitle>{contact.nameNative || contact.name}</SheetTitle>
        </SheetHeader>
        <Tabs
          key={contact.id}
          defaultValue="info"
          onValueChange={(v) => {
            if (v === "fields") setFieldsVisitedFor(contact.id)
          }}
          className="flex flex-1 min-h-0 flex-col gap-0"
        >
          <div className="px-4 border-b shrink-0">
            <TabsList variant="line" className="w-full justify-start gap-4">
              <TabsTrigger value="info" className="flex-none">
                Общая информация
              </TabsTrigger>
              <TabsTrigger value="fields" className="flex-none">
                Поля
              </TabsTrigger>
              {relatedTopics.visible && (
                <TabsTrigger value="topics" className="flex-none">
                  Темы
                  {(relatedTopics.result?.open.length ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {relatedTopics.result?.open.length}
                    </span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <TabsContent value="info">{form}</TabsContent>
            <TabsContent
              value="fields"
              forceMount={fieldsMounted ? true : undefined}
              className="data-[state=inactive]:hidden"
            >
              {fieldsMounted && (
                <CustomFieldsPanel
                  entity="contact"
                  entityId={contact.id}
                  handleRef={fieldsPanelRef}
                  onChanged={onChanged}
                />
              )}
            </TabsContent>
            {relatedTopics.visible && (
              <TabsContent value="topics" className="text-sm">
                <RelatedTopicsList
                  result={relatedTopics.result}
                  loading={relatedTopics.loading}
                  onChanged={relatedTopics.reload}
                  showCounterparty
                />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </SheetContent>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Есть несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы изменили поля контакта, но не нажали «Сохранить». Что сделать
              с изменениями?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmCloseOpen(false)
                onOpenChange(false)
              }}
            >
              Не сохранять
            </Button>
            <Button disabled={savingFields} onClick={() => void saveFieldsAndClose()}>
              Сохранить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

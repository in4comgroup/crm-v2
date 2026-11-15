"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TaskEditForm } from "@/components/forms/form-task-edit"
import { DocumentsPanel } from "@/components/blocks/documents-panel"
import type { TaskRow } from "@/app/api/tasks/route"

// Дровер задачи — по образцу <ClientDetailDrawer>/<DealDetailDrawer>: клик
// на карточку задачи открывает её здесь, сразу со всеми полями в режиме
// редактирования. Переиспользует <TaskEditForm> целиком, не дублирует поля.
export function TaskDetailDrawer({
  task,
  open,
  onOpenChange,
  onChanged,
}: {
  task: TaskRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
        // Иначе Radix при открытии автофокусит первое поле формы — см. тот
        // же фикс в client-detail-drawer.tsx/deal-detail-drawer.tsx.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="p-4 pb-3 border-b shrink-0">
          <SheetTitle>{task.name}</SheetTitle>
        </SheetHeader>
        {/* Tabs «Задача» / «Документы» (docs/specs/attachments §6). The
            documents panel mounts only while its tab is open. */}
        <Tabs
          key={task.id}
          defaultValue="info"
          className="flex flex-1 min-h-0 flex-col gap-0"
        >
          <div className="px-4 border-b shrink-0">
            <TabsList variant="line" className="w-full justify-start gap-4">
              <TabsTrigger value="info" className="flex-none">
                Задача
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex-none">
                Документы
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {/* Kept mounted (hidden) so unsaved form edits survive a tab switch. */}
            <TabsContent
              value="info"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <TaskEditForm
                mode="edit"
                task={task}
                onSuccess={() => {
                  onChanged()
                  onOpenChange(false)
                }}
                onCancel={() => onOpenChange(false)}
              />
            </TabsContent>
            <TabsContent value="documents" className="text-sm">
              <DocumentsPanel entityType="task" entityId={task.id} />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

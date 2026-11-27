"use client"

import { useCallback, useRef } from "react"
import { DetailDrawerContent, DetailDrawerTabs, type DetailNavigation, type DetailNavigationStatus } from "@/components/blocks/detail-drawer-layout"
import {
  Sheet,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { TaskEditForm } from "@/components/forms/form-task-edit"
import { DocumentsPanel } from "@/components/blocks/documents-panel"
import type { TaskRow } from "@/app/api/tasks/route"

// Дровер задачи — по образцу <ClientDetailDrawer>/<DealDetailDrawer>: клик
// на карточку задачи открывает её здесь, сразу со всеми полями в режиме
// редактирования. Переиспользует <TaskEditForm> целиком, не дублирует поля.
export function TaskDetailDrawer({
  task,
  open,
  navigation,
  onOpenChange,
  onChanged,
}: {
  task: TaskRow | null
  open: boolean
  navigation?: DetailNavigation
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const formNavigationStatus = useRef<DetailNavigationStatus>("ready")
  const updateNavigationStatus = useCallback((status: DetailNavigationStatus) => {
    formNavigationStatus.current = status
  }, [])
  if (!task) return null

  return (
    <Sheet open={open} modal={!navigation} onOpenChange={onOpenChange}>
      <DetailDrawerContent navigation={navigation} getNavigationStatus={() => formNavigationStatus.current} onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Tabs «Задача» / «Документы» (docs/specs/attachments §6). The
            documents panel mounts only while its tab is open. */}
        <Tabs
          key={task.id}
          defaultValue="info"
          className="flex flex-1 min-h-0 flex-col gap-0"
        >
          <div className="px-4 pt-4 border-b shrink-0">
            <SheetTitle className="pr-10">{task.name}</SheetTitle>
            <DetailDrawerTabs>
              <TabsTrigger value="info" className="flex-none">
                Задача
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex-none">
                Документы
              </TabsTrigger>
            </DetailDrawerTabs>
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
                onNavigationStatusChange={updateNavigationStatus}
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
      </DetailDrawerContent>
    </Sheet>
  )
}

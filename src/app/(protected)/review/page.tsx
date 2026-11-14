import { PageHeaderActions } from "@/components/blocks/page-header-actions"
import { GoldenReviewList } from "@/components/blocks/golden-review-list"
import { canReviewGoldenSet } from "@/server/topics/golden-review"

// «Проверка эталона» — golden-set review for the ACTIVE org. Visible to org
// owners / admins only (the sidebar hides it for others; the API
// /api/topics/golden checks the role on every call).
export default async function ReviewPage() {
  const allowed = await canReviewGoldenSet()

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 pb-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium">Проверка эталона</h1>
        <PageHeaderActions />
      </div>
      {allowed ? (
        <>
          <p className="max-w-4xl text-sm text-muted-foreground">
            Эталонный набор сообщений организации. Для каждого сообщения отметьте ожидаемые сигналы
            (или «Сигналов нет») и темы сообщения, затем «Сохранить и отметить «Проверен»». По
            проверенным сообщениям измеряется качество извлечения сигналов и группировки по темам.
          </p>
          <GoldenReviewList />
        </>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Проверка эталона доступна владельцу и администраторам организации.
        </div>
      )}
    </div>
  )
}

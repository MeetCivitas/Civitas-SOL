import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { PayrollDetail } from "@/components/employer/payroll-detail"

export default async function PayrollDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  return (
    <DashboardLayout>
      <PayrollDetail runId={runId} />
    </DashboardLayout>
  )
}

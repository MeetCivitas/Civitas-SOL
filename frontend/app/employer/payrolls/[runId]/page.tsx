import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { PayrollDetail } from "@/components/employer/payroll-detail"

export default async function PayrollDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  
  const mockRun = {
    runId,
    status: "active",
    employeeCount: 0,
    merkleRoot: "Pending",
    createdAt: new Date().toISOString(),
  };

  return (
    <DashboardLayout>
      <PayrollDetail run={mockRun} />
    </DashboardLayout>
  )
}

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { EmployeeDetail } from "@/components/employer/employee-detail"

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <DashboardLayout>
      <EmployeeDetail employeeId={id} />
    </DashboardLayout>
  )
}

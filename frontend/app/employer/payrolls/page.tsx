import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { PayrollsList } from "@/components/employer/payrolls-list"

export default function PayrollsPage() {
  return (
    <DashboardLayout>
      <PayrollsList />
    </DashboardLayout>
  )
}

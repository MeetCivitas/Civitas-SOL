import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { EmployeesList } from "@/components/employer/employees-list"

export default function EmployeesPage() {
  return (
    <DashboardLayout>
      <EmployeesList />
    </DashboardLayout>
  )
}

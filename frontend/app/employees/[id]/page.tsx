import { EmployeePortal } from "@/components/employee/employee-portal"

type ParamsPromise = Promise<{ id: string }>

export default async function EmployeePage({ params }: { params: ParamsPromise }) {
  const { id } = await params
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <EmployeePortal employeeId={id} />
    </div>
  )
}


import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function CompaniesPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="companies" searchParams={searchParams}/>; }

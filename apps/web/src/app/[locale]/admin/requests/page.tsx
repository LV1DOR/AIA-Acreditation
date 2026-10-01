import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function RequestsPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="requests" searchParams={searchParams}/>; }

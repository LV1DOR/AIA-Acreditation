import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function SubmissionsPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="submissions" searchParams={searchParams}/>; }

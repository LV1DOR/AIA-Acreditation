import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function VehiclesPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="vehicles" searchParams={searchParams}/>; }

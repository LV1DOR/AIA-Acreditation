import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function PeoplePage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="people" searchParams={searchParams}/>; }

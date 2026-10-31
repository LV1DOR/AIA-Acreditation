import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";

export default function ExportsPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) {
  return <AdminAreaView area="exports" searchParams={searchParams}/>;
}

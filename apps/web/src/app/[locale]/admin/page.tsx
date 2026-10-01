import { AdminOverviewView, type OperationsSearch } from "./operations-view.tsx";

export default function AdminPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) {
  return <AdminOverviewView searchParams={searchParams}/>;
}

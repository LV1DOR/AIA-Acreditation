import { AdminAreaView, type OperationsSearch } from "../operations-view.tsx";
export default function CredentialsPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) { return <AdminAreaView area="credentials" searchParams={searchParams}/>; }

import { AdminPersonDetailView, type OperationsSearch } from "../../operations-view.tsx";
export default async function PersonPage({ params, searchParams }: { params: Promise<{ personId: string }>; searchParams: Promise<OperationsSearch> }) { return <AdminPersonDetailView personId={(await params).personId} searchParams={searchParams}/>; }

import { AdminCompanyDetailView, type OperationsSearch } from "../../operations-view.tsx";
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ registrationId: string }>; searchParams: Promise<OperationsSearch> }) { return <AdminCompanyDetailView registrationId={(await params).registrationId} searchParams={searchParams}/>; }

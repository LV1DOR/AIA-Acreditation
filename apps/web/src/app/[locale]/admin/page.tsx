import Link from "next/link";
import {getLocale} from "next-intl/server";
import { AdminOverviewView, type OperationsSearch } from "./operations-view.tsx";

export default async function AdminPage({ searchParams }: { searchParams: Promise<OperationsSearch> }) {
  const locale=await getLocale();return <><div className="ops-actions"><Link className="button secondary" href={`/${locale}/admin/operations`}>{locale==="pt"?"Privacidade e recuperação":"Privacy and recovery"}</Link></div><AdminOverviewView searchParams={searchParams}/></>;
}

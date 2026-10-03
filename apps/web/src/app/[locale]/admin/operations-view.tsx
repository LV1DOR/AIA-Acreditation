import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import type { CSSProperties, ReactNode } from "react";
import { loadAdminOperations } from "../../../server/portal-data.ts";
import { PortalIcon, type IconName } from "../../../components/portal-icon.tsx";
import { StatusBadge } from "../../../components/status-badge.tsx";
import { decideRequestAction } from "./queue/actions.ts";
import { decideVehicleAction } from "./vehicles/actions.ts";
import { operationsCopy } from "./operations-copy.ts";
import { DonutChart } from "../../../components/donut-chart.tsx";
import { SubmissionsReviewCard } from "../../../components/submissions-review-card.tsx";
import { Badge, type BadgeVariant } from "../../../components/ui/badge.tsx";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "../../../components/ui/card.tsx";
import { AdminAutoFilters } from "../../../components/admin-auto-filters.tsx";
import { createInvitedCompanyAction } from "./companies/actions.ts";

export type OperationsSearch = { eventId?: string; q?: string; status?: string; company?: string; role?: string; sort?: string; result?: string; add?: string };
type Labels = (typeof operationsCopy)[Locale];
type Area = "submissions" | "companies" | "people" | "vehicles" | "credentials" | "requests";
const areaTitles: Record<Area, keyof Labels> = { submissions: "submissions", companies: "companies", people: "people", vehicles: "vehicles", credentials: "credentials", requests: "requests" };
const areaIntros: Record<Area, keyof Labels> = { submissions: "submissionsIntro", companies: "companiesIntro", people: "peopleIntro", vehicles: "vehiclesIntro", credentials: "credentialsIntro", requests: "requestsIntro" };
const number = (value: number, locale: Locale) => new Intl.NumberFormat(locale === "pt" ? "pt-PT" : "en-GB").format(value);
const date = (value: Date, locale: Locale) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium" }).format(value);
const datetime = (value: Date, locale: Locale) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium", timeStyle: "short" }).format(value);
const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const matches = (haystack: string, needle?: string) => !needle || searchable(haystack).includes(searchable(needle.trim()));
const leaderEmail = (registration: { primaryLeader: { userId: string } | null; invitations: { acceptedByUserId: string | null; emailNormalized: string }[] }) => registration.invitations.find(invitation => invitation.acceptedByUserId === registration.primaryLeader?.userId)?.emailNormalized;
const statusLabels = {
  pt: { DRAFT: "Rascunho", AIA_REVIEW: "Em revisão AIA", RETURNED_FOR_CORRECTION: "A aguardar correções", APPROVED: "Aprovado", REJECTED: "Rejeitado", PENDING: "Pendente", CANCELLED: "Cancelado", AWAITING_EMPLOYEE: "A aguardar pessoa", AWAITING_LEADER_REVIEW: "A aguardar responsável", LEADER_APPROVED: "Aprovado pelo responsável", DUPLICATE_REVIEW_REQUIRED: "Verificação necessária" },
  en: { DRAFT: "Draft", AIA_REVIEW: "AIA review", RETURNED_FOR_CORRECTION: "Awaiting corrections", APPROVED: "Approved", REJECTED: "Rejected", PENDING: "Pending", CANCELLED: "Cancelled", AWAITING_EMPLOYEE: "Awaiting person", AWAITING_LEADER_REVIEW: "Awaiting leader", LEADER_APPROVED: "Leader approved", DUPLICATE_REVIEW_REQUIRED: "Review required" },
} as const;
const statusLabel = (value: string, locale: Locale) => (statusLabels[locale] as Record<string, string>)[value] ?? value;
function requestPayloadSummary(payload: unknown, locale: Locale, labels: Labels) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  if (data.type === "EXTRA_PERSONNEL" && typeof data.additionalSlots === "number") return `+${data.additionalSlots} ${labels.people.toLowerCase()}`;
  if (data.type === "ADD_AFTER_DEADLINE" && typeof data.count === "number") return `${data.count} ${labels.people.toLowerCase()}`;
  if (data.type === "REPLACE_PERSON" && typeof data.replacementName === "string") return data.replacementName;
  if (data.type === "EDIT_PERSON" && typeof data.scope === "string") return data.scope.replaceAll("_", " ");
  if (data.type === "CHANGE_WORK_DAYS" && Array.isArray(data.workDays)) return data.workDays.filter(value => typeof value === "string").join(", ");
  if (data.type === "VEHICLE_PASS_CHANGE") return `${labels.passes}: ${typeof data.requestedQuantity === "number" ? data.requestedQuantity : 0}${typeof data.justification === "string" && data.justification ? ` · ${data.justification}` : ""}`;
  if (data.type === "ZONE_CHANGE" && Array.isArray(data.zoneIds)) return locale === "pt" ? `${data.zoneIds.length} zonas pedidas` : `${data.zoneIds.length} zones requested`;
  return null;
}
const href = (locale: Locale, area: string, eventId: string, extra?: Record<string, string | undefined>) => {
  const query = new URLSearchParams({ eventId });
  for (const [key, value] of Object.entries(extra ?? {})) if (value) query.set(key, value);
  return `/${locale}/admin${area ? `/${area}` : ""}?${query.toString()}`;
};

function EmptyEvent({ labels }: { labels: Labels }) {
  return <section className="ops-empty"><h1>{labels.noEvent}</h1><p>{labels.noEventHelp}</p></section>;
}

function PageHeading({ title, intro, eventName, children }: { title: string; intro: string; eventName: string; children?: ReactNode }) {
  return <header className="ops-page-heading"><div><h1>{title}</h1><p>{intro} <span>{eventName}</span></p></div>{children}</header>;
}

function StatisticCard({ label, value, icon, secondary, indicator, indicatorVariant = "neutral", progress, to }: { label: string; value: string; icon: IconName; secondary: string; indicator?: string; indicatorVariant?: BadgeVariant; progress?: number; to?: string }) {
  const card = <Card className="ops-stat">
    <CardHeader><span className="ops-stat-icon"><PortalIcon name={icon} size={20}/></span><CardTitle>{label}</CardTitle>{to && <CardAction><PortalIcon name="arrow" size={16}/></CardAction>}</CardHeader>
    <strong className="ops-stat-value">{value}</strong>
    <CardDescription>{secondary}</CardDescription>
    <CardFooter>{typeof progress === "number" ? <span className="ops-stat-progress" aria-label={`${Math.round(progress)}%`}><i style={{ width: `${progress}%` }}/></span> : indicator ? <Badge variant={indicatorVariant}>{indicator}</Badge> : null}</CardFooter>
  </Card>;
  return to ? <Link className="ops-stat-link" href={to}>{card}</Link> : card;
}

function relativeTime(value: Date, locale: Locale) {
  const seconds = Math.round((value.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { numeric: "auto" });
  const ranges = [{ limit: 60, divisor: 1, unit: "second" }, { limit: 3600, divisor: 60, unit: "minute" }, { limit: 86400, divisor: 3600, unit: "hour" }, { limit: Infinity, divisor: 86400, unit: "day" }] as const;
  const range = ranges.find(item => Math.abs(seconds) < item.limit) ?? ranges.at(-1)!;
  return formatter.format(Math.round(seconds / range.divisor), range.unit);
}

function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return <div className="ops-table-scroll"><table><caption className="sr-only">{caption}</caption>{children}</table></div>;
}

function Filters({ locale, eventId, area, query, labels, statuses, companies, roles }: { locale: Locale; eventId: string; area: Area; query: OperationsSearch; labels: Labels; statuses?: string[]; companies?: { id: string; name: string }[]; roles?: string[] }) {
  return <AdminAutoFilters clearHref={href(locale, area, eventId)} clearLabel={labels.clear} updatingLabel={locale === "pt" ? "A atualizar resultados" : "Updating results"}><input type="hidden" name="eventId" value={eventId}/>
    <label><span>{labels.search}</span><input type="search" name="q" defaultValue={query.q ?? ""} placeholder={labels.searchPlaceholder}/></label>
    {companies && <label><span>{labels.company}</span><select name="company" defaultValue={query.company ?? ""}><option value="">{labels.allCompanies}</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
    {roles && <label><span>{labels.function}</span><select name="role" defaultValue={query.role ?? ""}><option value="">{labels.allRoles}</option>{roles.map(role => <option key={role} value={role}>{role}</option>)}</select></label>}
    {statuses && <label><span>{labels.status}</span><select name="status" defaultValue={query.status ?? ""}><option value="">{labels.allStatuses}</option>{statuses.map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label>}
    <label><span>{labels.sort}</span><select name="sort" defaultValue={query.sort ?? "name"}><option value="name">{labels.nameAsc}</option><option value="name-desc">{labels.nameDesc}</option><option value="newest">{labels.newest}</option><option value="oldest">{labels.oldest}</option></select></label>
  </AdminAutoFilters>;
}

function sortBy<T>(items: T[], query: OperationsSearch, name: (item: T) => string, timestamp: (item: T) => Date) {
  return [...items].sort((a, b) => query.sort === "newest" ? timestamp(b).getTime() - timestamp(a).getTime() : query.sort === "oldest" ? timestamp(a).getTime() - timestamp(b).getTime() : query.sort === "name-desc" ? name(b).localeCompare(name(a)) : name(a).localeCompare(name(b)));
}

function VehicleDecisionControls({ locale, eventId, id, version, labels }: { locale: Locale; eventId: string; id: string; version: number; labels: Labels }) {
  const fields = <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="eventId" value={eventId}/><input type="hidden" name="vehiclePassId" value={id}/><input type="hidden" name="version" value={version}/></>;
  return <div className="ops-vehicle-actions"><form action={decideVehicleAction}>{fields}<button className="button primary" name="decision" value="APPROVE">{labels.approve}</button></form>
    <details><summary>{labels.reject}</summary><form action={decideVehicleAction}>{fields}<label><span>{labels.rejectionComment}</span><textarea name="comment" minLength={5} maxLength={2000} required/></label><button className="button secondary" name="decision" value="REJECT">{labels.reject}</button></form></details>
  </div>;
}

export async function AdminOverviewView({ searchParams }: { searchParams: Promise<OperationsSearch> }) {
  const locale = await getLocale() as Locale;
  const labels = operationsCopy[locale];
  const query = await searchParams;
  const data = await loadAdminOperations(locale, query.eventId);
  const event = data.event;
  if (!event) return <EmptyEvent labels={labels}/>;
  const pending = data.registrations.filter(row => row.status === "AIA_REVIEW" && row.submissions[0]);
  const corrections = data.registrations.filter(row => row.status === "RETURNED_FOR_CORRECTION" && row.submissions[0]);
  const vehiclePending = data.registrations.filter(row => row.vehiclePass?.required && row.vehiclePass.approvedQuantity === null && row.submissions[0] && ["AIA_REVIEW", "APPROVED"].includes(row.status));
  const pendingRequests = data.requests.filter(row => row.status === "PENDING");
  const duplicateWarnings = data.participants.filter(row => row.status === "DUPLICATE_REVIEW_REQUIRED");
  const zones = new Map<string, { name: string; companies: Set<string> }>();
  for (const registration of data.registrations) for (const requested of registration.zones) {
    const zone = requested.eventZone.zone;
    const current = zones.get(zone.id) ?? { name: zone.name, companies: new Set<string>() };
    current.companies.add(registration.companyId);
    zones.set(zone.id, current);
  }
  const zoneData = [...zones.values()].map(zone => ({ name: zone.name, amount: zone.companies.size })).filter(zone => zone.amount > 0).sort((a, b) => b.amount - a.amount);
  const recent = [...pending, ...corrections].sort((a, b) => (b.submissions[0]?.submittedAt.getTime() ?? 0) - (a.submissions[0]?.submittedAt.getTime() ?? 0));
  const activity = data.activity.filter(item => item.action in labels.activity).slice(0, 6);
  const companyNames = new Map(data.registrations.map(row => [row.companyId, row.company.name]));
  const now = Date.now();
  const daysRemaining = Math.ceil((event.onboardingClosesAt.getTime() - now) / 86_400_000);
  const deadlineProgress = Math.min(100, Math.max(0, (now - event.onboardingOpensAt.getTime()) / Math.max(1, event.onboardingClosesAt.getTime() - event.onboardingOpensAt.getTime()) * 100));
  const nothingPending = locale === "pt" ? "Sem pendências" : "No pending items";
  const needsAction = locale === "pt" ? "Requer ação" : "Action required";
  const deadlineState = daysRemaining < 0 ? labels.deadlinePassed : daysRemaining === 0 ? labels.deadlineToday : `${daysRemaining} ${labels.daysRemaining}`;
  const reviewRows = recent.map(row => ({
    id: row.id,
    company: row.company.name,
    peopleCount: row._count.participants,
    relativeTime: relativeTime(row.submissions[0]!.submittedAt, locale),
    status: row.status as "AIA_REVIEW" | "RETURNED_FOR_CORRECTION",
    statusLabel: statusLabel(row.status, locale),
    href: href(locale, `submissions/${row.submissions[0]!.id}`, event.id),
  }));
  return <div className="ops-dashboard"><PageHeading title={labels.overview} intro={labels.overviewIntro} eventName={event.name}/>
    <section className="ops-event-banner" style={event.bannerObjectKey ? { "--event-banner-image": `url('/api/admin/events/${event.id}/banner')` } as CSSProperties : undefined}><div><p>{labels.eventStatus}</p><h2>{event.name}</h2><div className="ops-event-meta"><span><PortalIcon name="calendar" size={17}/>{date(event.startDate, locale)} – {date(event.endDate, locale)}</span><span><PortalIcon name="clock" size={17}/>{labels.deadline}: {datetime(event.onboardingClosesAt, locale)}</span><Link className="ops-banner-count" href={href(locale, "companies", event.id)}>{number(data.registrations.length, locale)} {labels.companies}<PortalIcon name="arrow" size={14}/></Link><StatusBadge value={event.status}/></div></div><Link href={href(locale, "setup", event.id)}>{labels.createEvent}<PortalIcon name="arrow" size={16}/></Link></section>
    <section className="ops-stats" aria-label={labels.overview}>
      <StatisticCard label={labels.deadline} value={date(event.onboardingClosesAt, locale)} icon="calendar" secondary={deadlineState} progress={deadlineProgress}/>
      <StatisticCard label={labels.pendingSubmissions} value={number(pending.length, locale)} icon="document" secondary={`${number(data.registrations.length, locale)} ${labels.companies.toLocaleLowerCase()}`} indicator={pending.length ? needsAction : nothingPending} indicatorVariant={pending.length ? "warning" : "success"} to={href(locale, "submissions", event.id, { status: "AIA_REVIEW" })}/>
      <StatisticCard label={labels.corrections} value={number(corrections.length, locale)} icon="clock" secondary={locale === "pt" ? "Participações devolvidas" : "Returned registrations"} indicator={corrections.length ? (locale === "pt" ? "A aguardar empresa" : "Awaiting company") : nothingPending} indicatorVariant={corrections.length ? "neutral" : "success"} to={href(locale, "submissions", event.id, { status: "RETURNED_FOR_CORRECTION" })}/>
      <StatisticCard label={labels.duplicateWarnings} value={number(duplicateWarnings.length, locale)} icon="alert" secondary={locale === "pt" ? "Pessoas a verificar" : "People requiring review"} indicator={duplicateWarnings.length ? needsAction : nothingPending} indicatorVariant={duplicateWarnings.length ? "danger" : "success"} to={href(locale, "queue", event.id)}/>
      <StatisticCard label={labels.pendingVehicles} value={number(vehiclePending.length, locale)} icon="car" secondary={`${number(vehiclePending.reduce((sum, row) => sum + (row.vehiclePass?.requestedQuantity ?? 0), 0), locale)} ${labels.passes.toLocaleLowerCase()}`} indicator={vehiclePending.length ? needsAction : nothingPending} indicatorVariant={vehiclePending.length ? "warning" : "success"} to={href(locale, "vehicles", event.id, { status: "PENDING" })}/>
      <StatisticCard label={labels.pendingRequests} value={number(pendingRequests.length, locale)} icon="requests" secondary={locale === "pt" ? `${pendingRequests.filter(row => row.priority === "URGENT").length} urgentes` : `${pendingRequests.filter(row => row.priority === "URGENT").length} urgent`} indicator={pendingRequests.length ? needsAction : nothingPending} indicatorVariant={pendingRequests.some(row => row.priority === "URGENT") ? "danger" : pendingRequests.length ? "warning" : "success"} to={href(locale, "requests", event.id, { status: "PENDING" })}/>
    </section>
    <div className="ops-dashboard-grid">
      <SubmissionsReviewCard rows={reviewRows} title={labels.reviewSubmissions} allLabel={labels.allSubmissions} reviewLabel={labels.inReview} correctionsLabel={labels.correctionsTab} peopleLabel={labels.workers} emptyLabel={labels.noPendingSubmissions} emptyDescription={labels.submissionsCaughtUp} refreshLabel={labels.refresh} viewAllLabel={labels.viewAllSubmissions} viewAllHref={href(locale, "submissions", event.id)}/>
      <Card className="ops-panel ops-chart"><CardHeader><div><CardTitle>{labels.zoneDistribution}</CardTitle><CardDescription>{labels.zoneHelp}</CardDescription></div></CardHeader><DonutChart data={zoneData} className="mx-auto" variant="pie" category="name" value="amount" locale={locale === "pt" ? "pt-PT" : "en-GB"} totalLabel={labels.zoneCompanyRequests} emptyLabel={labels.noChartData}/></Card>
    </div>
    <section className="ops-panel ops-activity"><div className="ops-panel-heading"><h2>{labels.recentActivity}</h2><Link href={href(locale, "audit", event.id)}>{labels.viewAll}<PortalIcon name="arrow" size={16}/></Link></div>{activity.length ? <ul>{activity.map(item => <li key={item.id}><span className="ops-activity-dot"/><div><strong>{labels.activity[item.action as keyof typeof labels.activity]} · {companyNames.get(item.companyId ?? "") ?? event.name}</strong><small>{datetime(item.occurredAt, locale)}</small></div><Link href={href(locale, item.entityType === "CompanySubmission" ? `submissions/${item.entityId}` : item.entityType === "CompanyRequest" ? "requests" : item.entityType === "VehiclePassRequest" ? "vehicles" : "audit", event.id)} aria-label={labels.view}><PortalIcon name="arrow" size={16}/></Link></li>)}</ul> : <p className="ops-empty-inline">{labels.noActivity}</p>}</section>
  </div>;
}

export async function AdminAreaView({ area, searchParams }: { area: Area; searchParams: Promise<OperationsSearch> }) {
  const locale = await getLocale() as Locale;
  const labels = operationsCopy[locale];
  const query = await searchParams;
  const data = await loadAdminOperations(locale, query.eventId);
  if (!data.event) return <EmptyEvent labels={labels}/>;
  const eventId = data.event.id;
  const heading = <PageHeading title={String(labels[areaTitles[area]])} intro={String(labels[areaIntros[area]])} eventName={data.event.name}/>;
  const empty = <p className="ops-empty-inline">{labels.noResults}</p>;

  if (area === "submissions") {
    const rows = sortBy(data.registrations.filter(row => row.submissions.length && matches(row.company.name, query.q) && (!query.status || row.status === query.status)), query, row => row.company.name, row => row.submissions[0]!.submittedAt);
    return <div className="ops-workspace">{heading}<Filters locale={locale} eventId={eventId} area={area} query={query} labels={labels} statuses={["AIA_REVIEW", "RETURNED_FOR_CORRECTION", "APPROVED", "REJECTED", "DRAFT"]}/><section className="ops-panel">{rows.length ? <Table caption={labels.submissions}><thead><tr><th>{labels.company}</th><th>{labels.workers}</th><th>{labels.submittedAt}</th><th>{labels.status}</th><th>{labels.actions}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.company.name}</strong><small>{row.submissions[0]!.version}</small></td><td>{row._count.participants}</td><td>{datetime(row.submissions[0]!.submittedAt, locale)}</td><td><StatusBadge value={row.status}/></td><td><Link className="ops-row-link" href={href(locale, `submissions/${row.submissions[0]!.id}`, eventId)}>{labels.review}<PortalIcon name="arrow" size={15}/></Link></td></tr>)}</tbody></Table> : empty}</section></div>;
  }

  if (area === "companies") {
    const rows = sortBy(data.registrations.filter(row => matches(row.company.name, query.q) && (!query.status || row.status === query.status)), query, row => row.company.name, row => row.createdAt);
    const companiesHeading = <PageHeading title={labels.companies} intro={labels.companiesIntro} eventName={data.event.name}><Link className="button primary ops-add-company" href={href(locale, "companies", eventId, { add: "1" })}>+ {locale === "pt" ? "Adicionar empresa" : "Add company"}</Link></PageHeading>;
    return <div className="ops-workspace">{companiesHeading}{query.result && <p className={`flash ${query.result === "saved" ? "success" : "error"}`}>{query.result === "saved" ? labels.saved : labels.error}</p>}<Filters locale={locale} eventId={eventId} area={area} query={query} labels={labels} statuses={["DRAFT", "AIA_REVIEW", "RETURNED_FOR_CORRECTION", "APPROVED", "REJECTED"]}/><section className="ops-panel">{rows.length ? <Table caption={labels.companies}><thead><tr><th>{labels.company}</th><th>{labels.leader}</th><th>{labels.submittedPeople}</th><th>{labels.zones}</th><th>{labels.status}</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.company.name}</strong></td><td>{leaderEmail(row) ?? labels.noLeader}</td><td>{number(row._count.participants, locale)}</td><td>{row.zones.map(zone => zone.eventZone.zone.name).join(", ") || labels.noValue}</td><td><StatusBadge value={row.status}/></td><td><Link className="ops-row-link" href={href(locale, `companies/${row.id}`, eventId)}>{labels.view}<PortalIcon name="arrow" size={15}/></Link></td></tr>)}</tbody></Table> : empty}</section>{query.add === "1" && <div className="portal-modal-backdrop"><section className="portal-modal ops-company-dialog" role="dialog" aria-modal="true" aria-labelledby="add-company-title"><header><div><h2 id="add-company-title">{locale === "pt" ? "Adicionar empresa" : "Add company"}</h2><p>{locale === "pt" ? "Associe a empresa ao evento e envie o convite ao responsável." : "Link the company to this event and invite its leader."}</p></div><Link className="modal-close" href={href(locale, "companies", eventId)} aria-label={locale === "pt" ? "Fechar" : "Close"}>×</Link></header><form action={createInvitedCompanyAction} className="ops-company-form"><input type="hidden" name="locale" value={locale}/><input type="hidden" name="eventId" value={eventId}/><label><span>{locale === "pt" ? "Nome da empresa" : "Company name"}</span><input name="name" required maxLength={200}/></label><label><span>{locale === "pt" ? "Email do responsável" : "Leader email"}</span><input name="email" type="email" required/></label><footer><Link className="button secondary" href={href(locale, "companies", eventId)}>{labels.clear}</Link><button className="button primary">{locale === "pt" ? "Criar e enviar convite" : "Create and send invitation"}</button></footer></form></section></div>}</div>;
  }

  if (area === "people" || area === "credentials") {
    const companies = data.registrations.map(row => ({ id: row.id, name: row.company.name }));
    const approvedPeople = data.participants.filter(row => row.registration.status === "APPROVED" && row.status === "LEADER_APPROVED");
    const roles = [...new Set(approvedPeople.flatMap(row => row.jobRole?.name ? [row.jobRole.name] : []))].sort();
    const rows = sortBy(approvedPeople.filter(row => matches(`${row.fullName ?? ""} ${row.registration.company.name}`, query.q) && (!query.company || row.registrationId === query.company) && (!query.role || row.jobRole?.name === query.role) && (!query.status || row.registration.status === query.status)), query, row => row.fullName ?? "", row => row.createdAt);
    return <div className="ops-workspace">{heading}{area === "credentials" && <p className="ops-note">{labels.credentialInfo}</p>}<Filters locale={locale} eventId={eventId} area={area} query={query} labels={labels} companies={companies} roles={area === "people" ? roles : undefined} statuses={area === "people" ? ["APPROVED"] : undefined}/><section className="ops-panel">{rows.length ? <Table caption={area === "people" ? labels.people : labels.credentials}><thead><tr><th>{labels.people}</th><th>{labels.company}</th><th>{labels.function}</th><th>{area === "people" ? labels.status : labels.credentialState}</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.fullName ?? labels.noValue}</strong></td><td>{row.registration.company.name}</td><td>{row.jobRole?.name ?? labels.noValue}</td><td><StatusBadge value={row.registration.status}/></td><td><Link className="ops-row-link" href={href(locale, `people/${row.id}`, eventId)}>{labels.view}<PortalIcon name="arrow" size={15}/></Link></td></tr>)}</tbody></Table> : empty}</section></div>;
  }

  if (area === "vehicles") {
    const rows = sortBy(data.registrations.filter(row => row.vehiclePass?.required && matches(`${row.company.name} ${row.vehiclePass.justification ?? ""}`, query.q) && (!query.status || (query.status === "PENDING" ? row.vehiclePass.approvedQuantity === null : query.status === "APPROVED" ? (row.vehiclePass.approvedQuantity ?? 0) > 0 : row.vehiclePass.approvedQuantity === 0))), query, row => row.company.name, row => row.vehiclePass?.requestedAt ?? row.createdAt);
    return <div className="ops-workspace">{heading}{query.result && <p className={`flash ${query.result === "saved" ? "success" : "error"}`}>{query.result === "saved" ? labels.saved : labels.error}</p>}<Filters locale={locale} eventId={eventId} area={area} query={query} labels={labels} statuses={["PENDING", "APPROVED", "REJECTED"]}/><section className="ops-panel">{rows.length ? <Table caption={labels.vehicles}><thead><tr><th>{labels.company}</th><th>{labels.passes}</th><th>{labels.reason}</th><th>{labels.requestedAt}</th><th>{labels.status}</th><th>{labels.actions}</th></tr></thead><tbody>{rows.map(row => { const request = row.vehiclePass!; const eligible = request.approvedQuantity === null && !!row.submissions[0] && ["AIA_REVIEW", "APPROVED"].includes(row.status); const status = request.approvedQuantity === null ? eligible ? labels.pending : labels.awaitingSubmission : request.approvedQuantity === 0 ? labels.rejected : labels.approved; return <tr key={row.id}><td><Link className="ops-text-link" href={href(locale, `companies/${row.id}`, eventId)}>{row.company.name}</Link></td><td>{request.requestedQuantity}</td><td className="ops-reason">{request.justification}</td><td>{request.requestedAt ? date(request.requestedAt, locale) : labels.noDate}</td><td><span className={`ops-state ${request.approvedQuantity === null ? "pending" : request.approvedQuantity === 0 ? "rejected" : "approved"}`}>{status}</span>{request.decisionComment && <small className="ops-decision-comment">{request.decisionComment}</small>}</td><td>{eligible ? <VehicleDecisionControls locale={locale} eventId={eventId} id={request.id} version={request.version} labels={labels}/> : null}</td></tr>; })}</tbody></Table> : <p className="ops-empty-inline">{labels.noVehicleRequests}</p>}</section></div>;
  }

  const rows = sortBy(data.requests.filter(row => matches(`${row.registration.company.name} ${row.reason} ${row.targetParticipant?.fullName ?? ""}`, query.q) && (!query.status || row.status === query.status)), query, row => row.registration.company.name, row => row.createdAt);
  return <div className="ops-workspace">{heading}{query.result && <p className={`flash ${query.result === "saved" ? "success" : "error"}`}>{query.result === "saved" ? labels.saved : labels.error}</p>}<Filters locale={locale} eventId={eventId} area="requests" query={query} labels={labels} statuses={["PENDING", "APPROVED", "REJECTED", "CANCELLED"]}/><section className="ops-panel ops-requests">{rows.length ? rows.map(row => <article key={row.id} className="ops-request-row"><div><div className="ops-request-title"><strong>{labels.requestType[row.type]}</strong>{row.priority === "URGENT" && <em className="ops-urgent">{locale === "pt" ? "Urgente" : "Urgent"}</em>}<span className={`ops-state ${row.status === "PENDING" ? "pending" : row.status === "APPROVED" ? "approved" : "rejected"}`}>{statusLabel(row.status, locale)}</span></div><p><Link className="ops-text-link" href={href(locale, `companies/${row.registrationId}`, eventId)}>{row.registration.company.name}</Link>{row.targetParticipant?.fullName ? ` · ${row.targetParticipant.fullName}` : ""} · {datetime(row.createdAt, locale)}</p><p>{row.reason}</p>{requestPayloadSummary(row.payload, locale, labels) && <p className="ops-request-detail">{requestPayloadSummary(row.payload, locale, labels)}</p>}{row.resolutionComment && <small>{row.resolutionComment}</small>}</div>{row.status === "PENDING" && <form action={decideRequestAction} className="ops-request-decision"><input type="hidden" name="locale" value={locale}/><input type="hidden" name="eventId" value={eventId}/><input type="hidden" name="returnArea" value="requests"/><input type="hidden" name="requestId" value={row.id}/><input type="hidden" name="version" value={row.version}/><input name="comment" maxLength={2000} aria-label={labels.rejectionComment} placeholder={labels.rejectionComment}/><button className="button secondary" name="decision" value="REJECT">{labels.reject}</button><button className="button primary" name="decision" value="APPROVE">{labels.approve}</button></form>}</article>) : <p className="ops-empty-inline">{labels.noRequests}</p>}</section></div>;
}

export async function AdminCompanyDetailView({ registrationId, searchParams }: { registrationId: string; searchParams: Promise<OperationsSearch> }) {
  const locale = await getLocale() as Locale;
  const labels = operationsCopy[locale];
  const query = await searchParams;
  const data = await loadAdminOperations(locale, query.eventId);
  const registration = data.registrations.find(row => row.id === registrationId);
  if (!registration || !data.event) notFound();
  const people = data.participants.filter(row => row.registrationId === registrationId);
  const requests = data.requests.filter(row => row.registrationId === registrationId);
  return <div className="ops-workspace"><Link className="ops-back" href={href(locale, "companies", data.event.id)}><PortalIcon name="back" size={17}/>{labels.backCompanies}</Link><PageHeading title={registration.company.name} intro={labels.detailCompany} eventName={data.event.name}/>
    <div className="ops-detail-grid"><section className="ops-panel"><h2>{labels.registration}</h2><dl className="ops-facts"><div><dt>{labels.status}</dt><dd><StatusBadge value={registration.status}/></dd></div><div><dt>{labels.leader}</dt><dd>{leaderEmail(registration) ?? labels.noLeader}</dd></div><div><dt>{labels.submittedPeople}</dt><dd>{registration._count.participants} / {registration.personnelLimit}</dd></div><div><dt>{labels.companyZones}</dt><dd>{registration.zones.map(zone => zone.eventZone.zone.name).join(", ") || labels.noValue}</dd></div><div><dt>{labels.companyVehicle}</dt><dd>{registration.vehiclePass?.required ? `${registration.vehiclePass.requestedQuantity} · ${registration.vehiclePass.approvedQuantity === null ? labels.pending : registration.vehiclePass.approvedQuantity === 0 ? labels.rejected : labels.approved}` : labels.noValue}</dd></div><div><dt>{labels.companySubmission}</dt><dd>{registration.submissions[0] ? <Link className="ops-text-link" href={href(locale, `submissions/${registration.submissions[0]!.id}`, data.event.id)}>{date(registration.submissions[0]!.submittedAt, locale)} →</Link> : labels.notSubmitted}</dd></div></dl></section>
    <section className="ops-panel"><div className="ops-panel-heading"><h2>{labels.companyRequests}</h2><Link href={href(locale, "requests", data.event.id, { q: registration.company.name })}>{labels.viewAll}<PortalIcon name="arrow" size={15}/></Link></div>{requests.length ? <ul className="ops-detail-list">{requests.slice(0, 8).map(row => <li key={row.id}><strong>{labels.requestType[row.type]}</strong><span>{statusLabel(row.status, locale)}</span></li>)}</ul> : <p className="ops-empty-inline">{labels.noRequests}</p>}</section></div>
    <section className="ops-panel"><h2>{labels.companyTeam}</h2>{people.length ? <Table caption={labels.companyTeam}><thead><tr><th>{labels.people}</th><th>{labels.function}</th><th>{labels.status}</th><th/></tr></thead><tbody>{people.map(person => <tr key={person.id}><td>{person.fullName ?? labels.noValue}</td><td>{person.jobRole?.name ?? labels.noValue}</td><td><StatusBadge value={person.status}/></td><td><Link className="ops-row-link" href={href(locale, `people/${person.id}`, data.event!.id)}>{labels.view}<PortalIcon name="arrow" size={15}/></Link></td></tr>)}</tbody></Table> : <p className="ops-empty-inline">{labels.noResults}</p>}</section>
  </div>;
}

export async function AdminPersonDetailView({ personId, searchParams }: { personId: string; searchParams: Promise<OperationsSearch> }) {
  const locale = await getLocale() as Locale;
  const labels = operationsCopy[locale];
  const query = await searchParams;
  const data = await loadAdminOperations(locale, query.eventId);
  const person = data.participants.find(row => row.id === personId);
  if (!person || !data.event) notFound();
  const registration = data.registrations.find(row => row.id === person.registrationId);
  const listedAsApproved = person.registration.status === "APPROVED" && person.status === "LEADER_APPROVED";
  return <div className="ops-workspace"><Link className="ops-back" href={listedAsApproved ? href(locale, "people", data.event.id) : href(locale, `companies/${person.registrationId}`, data.event.id)}><PortalIcon name="back" size={17}/>{listedAsApproved ? labels.backPeople : labels.backCompanies}</Link><PageHeading title={person.fullName ?? labels.noValue} intro={labels.detailPerson} eventName={data.event.name}/>
    <div className="ops-detail-grid"><section className="ops-panel"><h2>{labels.people}</h2><div className="ops-person-overview"><div className="ops-person-photo">{person.photoObjectKey ? <img src={`/api/participants/${person.id}/photo`} alt={person.fullName ?? labels.people}/> : <span><PortalIcon name="people" size={30}/><small>{locale === "pt" ? "Sem fotografia" : "No photo"}</small></span>}</div><dl className="ops-facts"><div><dt>{labels.status}</dt><dd><StatusBadge value={person.status}/></dd></div><div><dt>{labels.company}</dt><dd><Link className="ops-text-link" href={href(locale, `companies/${person.registrationId}`, data.event.id)}>{person.registration.company.name}</Link></dd></div><div><dt>{labels.function}</dt><dd>{person.jobRole?.name ?? labels.noValue}</dd></div><div><dt>{labels.birthDate}</dt><dd>{person.dateOfBirth ? date(person.dateOfBirth, locale) : labels.noValue}</dd></div><div><dt>{labels.nationality}</dt><dd>{person.nationalityCode ?? labels.noValue}</dd></div><div><dt>{labels.phone}</dt><dd>{person.mobileE164 ?? labels.noValue}</dd></div><div><dt>{labels.document}</dt><dd>{person.documentType ? `${person.documentType.replaceAll("_", " ")}${person.documentNumberLast3 ? ` · •••${person.documentNumberLast3}` : ""}` : labels.noValue}</dd></div><div><dt>{labels.documentExpiry}</dt><dd>{person.documentExpiryDate ? date(person.documentExpiryDate, locale) : labels.noValue}</dd></div><div><dt>{labels.workDays}</dt><dd>{person.workDays.length ? person.workDays.map(day => date(day.workDate, locale)).join(", ") : labels.noValue}</dd></div></dl></div></section>
    <section className="ops-panel"><h2>{labels.credentialState}</h2><dl className="ops-facts"><div><dt>{labels.registration}</dt><dd><StatusBadge value={person.registration.status}/></dd></div><div><dt>{labels.zones}</dt><dd>{registration?.zones.map(zone => zone.eventZone.zone.name).join(", ") || labels.noValue}</dd></div><div><dt>{labels.privacy}</dt><dd>{person.privacyAcknowledgedAt ? datetime(person.privacyAcknowledgedAt, locale) : labels.noValue}</dd></div><div><dt>{labels.companySubmission}</dt><dd>{registration?.submissions[0] ? <Link className="ops-text-link" href={href(locale, `submissions/${registration.submissions[0].id}`, data.event.id)}>{date(registration.submissions[0].submittedAt, locale)} →</Link> : labels.notSubmitted}</dd></div></dl><p className="ops-note">{labels.credentialInfo}</p></section></div>
  </div>;
}

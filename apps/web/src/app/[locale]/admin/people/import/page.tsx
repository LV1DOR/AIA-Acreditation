import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { adminEventOptions, internalImportContext } from "@aia/domain";
import { requirePortal } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
import { InternalImportUpload } from "./import-client.tsx";
import { selectInternalOrganisation } from "./actions.ts";
export default async function ImportPage({searchParams}:{searchParams:Promise<{eventId?:string;registrationId?:string;result?:string}>}) {
  const locale=await getLocale() as Locale,pt=locale==="pt",query=await searchParams,access=await requirePortal(locale,"ADMIN");
  const events=await adminEventOptions(database(),access.context);
  const context=query.registrationId?await internalImportContext(database(),access.context,query.registrationId):null;
  if(context && query.eventId!==context.event.id) redirect(`/${locale}/admin/people/import?registrationId=${context.registration.id}&eventId=${context.event.id}`);
  return <><header className="ops-page-heading"><div><h1>{pt?"Importar trabalhadores":"Import Workers"}</h1><p>{pt?"Pessoal interno AIA/Parkalgar · Zonas individuais por pessoa":"Internal AIA/Parkalgar staff · Individual zones for each worker"}</p></div><Link className="button secondary" href={`/${locale}/admin/people?eventId=${context?.event.id??query.eventId??""}`}>{pt?"Trabalhadores":"Workers"}</Link></header>
    {query.result && <p role="alert" className="flash error">{pt?"Verifique o evento, organização e capacidade e tente novamente.":"Check the event, organisation and capacity and try again."}</p>}
    <section className="internal-import-target"><h2>{pt?"Escolher evento e organização":"Select event and organisation"}</h2><form action={selectInternalOrganisation} className="form-grid"><input type="hidden" name="locale" value={locale}/><label>{pt?"Evento":"Event"}<select name="eventId" required defaultValue={context?.event.id??query.eventId}>{events.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>{pt?"Organização interna":"Internal organisation"}<select name="organisation" defaultValue={context?.organisation??"AIA"}><option>AIA</option><option>PARKALGAR</option></select></label><label>{pt?"Capacidade inicial (nova inscrição)":"Initial capacity (new registration)"}<input type="number" name="personnelLimit" min={1} max={10000} defaultValue={1000} required/></label><button className="button primary">{pt?"Selecionar ou criar inscrição interna":"Select or create internal registration"}</button></form></section>
    {context && <><section className="internal-import-template"><h2>{context.event.name} · {context.organisation}</h2><p>{pt?"Copie os UUIDs das folhas Zones e Roles. Separe várias zonas ou datas com ponto e vírgula. Não existem zonas atribuídas por defeito.":"Copy UUIDs from Zones and Roles. Separate multiple zones or dates with semicolons. No zones are assigned by default."}</p><a className="button secondary" href={`/api/admin/internal/${context.registration.id}/template`}>{pt?"Descarregar modelo Excel":"Download Excel template"}</a><a className="button secondary" href={`/api/admin/internal/${context.registration.id}/template?format=csv`}>{pt?"Descarregar cabeçalhos CSV":"Download CSV headers"}</a><p>{pt?"CSV: use a folha Zones do modelo Excel como referência. Documento e telemóvel devem ser texto. A fotografia é carregada depois, no registo da pessoa.":"CSV: use the Excel template's Zones sheet as reference. Documents and phones must be text. Upload the photograph later in the worker record."}</p></section><InternalImportUpload key={context.registration.id} locale={locale} registrationId={context.registration.id} eventId={context.event.id} zones={context.zones} roles={context.roles}/></>}
  </>;
}

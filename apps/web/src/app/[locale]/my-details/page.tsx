import Link from "next/link";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Locale } from "@aia/i18n";
import { leaderSelfProfiles, leaderParticipant, leaderRegistration } from "@aia/domain";
import { PublicHeader } from "../../../components/public-header.tsx";
import { ParticipantFields } from "../../../components/participant-fields.tsx";
import { requirePortal } from "../../../server/session.ts";
import { database } from "../../../server/runtime.ts";
import { storageEnvironment } from "../../../server/storage.ts";
import { saveMyDetails } from "./actions.ts";

export default async function MyDetailsPage({ searchParams }: { searchParams: Promise<{ registrationId?: string; result?: string }> }) {
  const locale = await getLocale() as Locale, pt = locale === "pt";
  const access = await requirePortal(locale, "COMPANY_LEADER", { allowIncompleteLeaderProfile: true });
  const query = await searchParams, db = database();
  const profiles = await leaderSelfProfiles(db, access.context);
  const row = query.registrationId ? profiles.find(p => p.registrationId === query.registrationId) : profiles.find(p => p.required) ?? profiles[0];
  if (query.registrationId && !row) notFound();
  const copy = pt ? {
    title: "Os meus dados", intro: "Antes de gerir a equipa, preencha os seus dados de acreditação como responsável da empresa.",
    help: "Será incluído na lista de trabalhadores e no limite de pessoas da empresa. Usa o mesmo aviso de privacidade que os restantes trabalhadores.",
    start: "Preencher os meus dados", existing: "Já estou na lista de trabalhadores", choose: "Escolher o meu registo", confirm: "Confirmo que o registo selecionado contém os meus próprios dados.", link: "Usar este registo", save: "Guardar e continuar", back: "Continuar para o portal", complete: "Os seus dados estão completos.",
    locked: "A inscrição não permite adicionar ou alterar dados neste momento. Contacte a AIA se precisar de corrigir o seu registo.",
    none: "Ainda não tem uma participação ativa associada à sua conta.",
  } : {
    title: "My details", intro: "Before managing your team, complete your own accreditation details as the company leader.",
    help: "You will appear in the worker list and count towards the company personnel limit. You accept the same privacy notice as the other workers.",
    start: "Enter my details", existing: "I am already in the worker list", choose: "Choose my record", confirm: "I confirm that the selected record contains my own personal details.", link: "Use this record", save: "Save and continue", back: "Continue to the portal", complete: "Your details are complete.",
    locked: "This registration cannot accept additions or changes right now. Contact AIA if you need to correct your record.",
    none: "Your account does not have an active registration yet.",
  };
  const hidden = row && <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={row.registrationId}/></>;
  const environment = row ? storageEnvironment() : null;
  const editor = row?.participantId ? await leaderParticipant(db, access.context, row.participantId, environment!.DOCUMENT_ENCRYPTION_KEY) : null;
  const team = row && !row.participantId ? await leaderRegistration(db, access.context, row.registrationId, environment!.DOCUMENT_ENCRYPTION_KEY) : null;
  const existing = team?.participants.filter(p => !["REMOVED", "REPLACED"].includes(p.status)) ?? [];
  const errors: Record<string, string> = pt ? {
    privacy_notice_changed: "O aviso de privacidade foi atualizado. Atualize esta página, leia o aviso e confirme novamente.",
    personnel_limit_reached: "O limite de pessoas foi atingido. Se já está na equipa, use o seu registo existente. Caso contrário, peça à AIA para rever o limite.",
    stale_write: "O registo mudou. Atualize a página e tente novamente.", edit_locked: copy.locked,
    invalid_input: "Não foi possível guardar. Reveja os campos assinalados, as datas e a fotografia.",
    busy: "O serviço está ocupado. Aguarde um minuto e tente novamente.",
  } : {
    privacy_notice_changed: "The privacy notice changed. Refresh this page, read the notice and confirm it again.",
    personnel_limit_reached: "The personnel limit has been reached. If you are already on the team, use your existing record. Otherwise ask AIA to review the limit.",
    stale_write: "This record changed. Refresh the page and try again.", edit_locked: copy.locked,
    invalid_input: "Your details could not be saved. Review the fields, dates and photograph.",
    busy: "The service is busy. Wait a minute and try again.",
  };
  return <><PublicHeader authenticated/><main className="my-details-page">
    <header className="my-details-heading"><p className="eyebrow">{pt ? "RESPONSÁVEL DA EMPRESA" : "COMPANY LEADER"}</p><h1>{copy.title}</h1><p>{copy.intro}</p><small>{copy.help}</small></header>
    {!row ? <section className="card"><p>{copy.none}</p><Link className="button secondary" href={`/${locale}/portal`}>{copy.back}</Link></section> : <>
      <section className="my-details-context"><strong>{row.companyName}</strong><span>{row.eventName}</span></section>
      {profiles.length > 1 && <nav className="my-details-events" aria-label={pt ? "Participações" : "Registrations"}>{profiles.map(p => <Link key={p.registrationId} href={`/${locale}/my-details?registrationId=${p.registrationId}`} aria-current={p.registrationId === row.registrationId ? "page" : undefined}>{p.companyName} · {p.eventName}</Link>)}</nav>}
      {query.result && <p role="alert" className="flash error">{errors[query.result] ?? (pt ? "Não foi possível guardar os dados. Tente novamente ou contacte a AIA." : "Your details could not be saved. Try again or contact AIA.")}</p>}
      {row.complete && <p role="status" className="flash success">{copy.complete} <Link href={`/${locale}/portal`}>{copy.back} →</Link></p>}
      {editor ? <section className="participant-editor"><form action={saveMyDetails}>{hidden}<input type="hidden" name="intent" value="save"/><input type="hidden" name="expectedVersion" value={editor.participant.version}/>
        {!editor.capabilities.editable && <p className="flash">{copy.locked}</p>}
        <fieldset className="participant-form-fields" disabled={!editor.capabilities.editable}>
          <ParticipantFields eventId={editor.participant.eventId} startDate={editor.participant.registration.event.startDate} endDate={editor.participant.registration.event.endDate}
            jobRoles={editor.jobRoles} editableFields={editor.capabilities.fields} defaults={{ ...editor.participant, workDays: editor.participant.workDays.map(day => day.workDate) }}
            requirePhoto={!editor.participant.photoObjectKey} existingPhotoUrl={editor.participant.photoObjectKey ? `/api/participants/${editor.participant.id}/photo` : undefined}
            privacy={!editor.participant.privacyAcknowledgedAt}/>
        </fieldset><footer className="participant-form-footer"><span>{pt ? "Os seus dados são guardados no registo normal da equipa." : "Your details are stored in the normal team record."}</span><button className="button primary" disabled={!editor.capabilities.editable}>{copy.save}</button></footer>
      </form></section> : <section className="card my-details-start">
        {row.canCreate ? <form action={saveMyDetails}>{hidden}<input type="hidden" name="intent" value="start"/><button className="button primary">{copy.start}</button></form> : <p>{copy.locked}</p>}
        {existing.length > 0 && <details><summary>{copy.existing}</summary><form action={saveMyDetails}>{hidden}<input type="hidden" name="intent" value="link"/>
          <label>{copy.choose}<select name="existingParticipantId" required defaultValue=""><option value="" disabled>—</option>{existing.map(p => <option value={p.id} key={p.id}>{p.fullName ?? (pt ? "Registo por preencher" : "Incomplete record")}</option>)}</select></label>
          <label className="check-card"><input name="thisIsMe" type="checkbox" required/><span>{copy.confirm}</span></label><button className="button secondary">{copy.link}</button>
        </form></details>}
      </section>}
    </>}
  </main></>;
}

"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { processInternalFile } from "./actions.ts";
import type { Locale } from "@aia/i18n";
type Preview=NonNullable<Awaited<ReturnType<typeof processInternalFile>>["preview"]>;
function diagnostic(message:string,locale:Locale) {
  if(message.startsWith("Nome Completo / Full name:")) return locale==="pt"?"Nome completo: 2–200 caracteres":"Full name: 2–200 characters";
  if(message.startsWith("Data de Nascimento:") || message.startsWith("Validade do Documento:")) return locale==="pt"?message.split(" / ")[0]!:message.startsWith("Data de Nascimento:")?"Date of birth: YYYY-MM-DD":"Document expiry: YYYY-MM-DD";
  if(message.includes(" / ")) return message.split(" / ")[locale==="pt"?0:1]!;
  const names:Record<string,string>={"Data de Nascimento":"Date of birth","Validade do Documento":"Document expiry","Tipo de Documento":"Document type","Número de Documento":"Document number","Telemóvel":"Mobile phone","Nacionalidade":"Nationality","Função":"Job role","Dias de Trabalho":"Work days","Zonas de Acesso":"Access zones"};
  return locale==="en"?names[message]??message:message;
}
export function InternalImportUpload({locale,registrationId,eventId,zones,roles}:{locale:Locale;registrationId:string;eventId:string;roles:{id:string;name:string}[];zones:{id:string;name:string}[]}) {
  const pt=locale==="pt";
  const fileInput=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(""),[pending,start]=useTransition();
  function run(commit:boolean) {
    if(!file) return;
    const data=new FormData();data.set("locale",locale);data.set("registrationId",registrationId);data.set("file",file);
    if(commit && preview) {data.set("intent","commit");data.set("fileHash",preview.fileHash);data.set("expectedVersion",String(preview.expectedVersion));if(confirmed)data.set("confirmed","on");}
    start(async()=>{
      const response=await processInternalFile(data).catch(()=>null);
      if(!response) {setMessage(pt?"Falha de ligação. Repita a mesma importação; um lote já guardado não será criado novamente.":"Connection failed. Retry the same import; an already saved batch will not be created again.");return;}
      if(!response.ok) {
        const messages:Record<string,string>=pt?{INVALID_SPREADSHEET:"Ficheiro inválido. Use o modelo XLSX ou CSV UTF-8, até 4 MiB e 1 000 linhas; sem fórmulas. Documentos e telefones devem ser texto.",STALE_WRITE:"Os dados mudaram. Volte a validar o ficheiro antes de confirmar.",PERSONNEL_LIMIT_REACHED:"O lote ultrapassa a capacidade interna. Ajuste o limite e volte a validar.",EDIT_LOCKED:"A inscrição está bloqueada. Abra-a para correções antes de importar."}:{INVALID_SPREADSHEET:"Invalid file. Use the XLSX template or UTF-8 CSV, up to 4 MiB and 1,000 rows; no formulas. Documents and phones must be text.",STALE_WRITE:"The records changed. Validate the file again before confirming.",PERSONNEL_LIMIT_REACHED:"The batch exceeds internal capacity. Adjust the limit and validate again.",EDIT_LOCKED:"Registration is locked. Reopen for corrections before importing."};
        setMessage(messages[response.error]??(pt?"Não foi possível importar. Verifique a seleção e tente novamente.":"Import failed. Check the selection and try again."));if(commit)setPreview(null);return;
      }
      if(response.preview) {setPreview(response.preview);setMessage(`${pt?"Validação concluída":"Validation completed"}: ${response.preview.create} ${pt?"registos a criar":"records to create"}, ${response.preview.invalid} ${pt?"linhas inválidas":"invalid rows"}. ${pt?"Reveja a pré-visualização abaixo e confirme antes de importar.":"Review the preview below and confirm before importing."}`);setConfirmed(false);}
      if(response.result) {setMessage(`${pt?"Importação concluída":"Import completed"}: ${response.result.created} ${pt?"criados":"created"}, ${response.result.skipped} ${pt?"ignorados":"skipped"}${response.result.replayed?(pt?" (lote já importado)":" (batch already imported)"):""}.`);setPreview(null);setFile(null);if(fileInput.current)fileInput.current.value="";}
    });
  }
  return <section className="internal-import-upload"><h2>{pt?"Carregar e validar":"Upload and validate"}</h2><p>{pt?"XLSX ou CSV · Até 4 MiB e 1 000 linhas. Todas as pessoas ficam incompletas até carregar fotografias e confirmar o aviso de privacidade.":"XLSX or CSV · Up to 4 MiB and 1,000 rows. All workers remain incomplete until photographs and privacy-notice acknowledgements are completed."}</p>
    <label>{pt?"Ficheiro de trabalhadores":"Workers file"}<input ref={fileInput} type="file" accept=".xlsx,.csv" disabled={pending} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setConfirmed(false);setMessage("");}}/></label>
    <button className="button primary" disabled={!file || pending} onClick={()=>run(false)}>{pending?(pt?"A processar…":"Processing…"):(pt?"Validar e pré-visualizar":"Validate and preview")}</button>
    <p role="status" aria-live="polite" aria-atomic="true" className={message?"flash":"sr-only"}>{message}</p>
    {preview && <><h2>{pt?"Rever antes de importar":"Review before importing"}</h2><p>{preview.total} {pt?"linhas":"rows"} · {preview.valid} {pt?"completas":"complete"} · {preview.incomplete} {pt?"incompletas":"incomplete"} · {preview.invalid} {pt?"inválidas":"invalid"} · {preview.duplicates} {pt?"duplicados para revisão":"duplicates for review"} · {preview.create} {pt?"a criar":"to create"} · {preview.skip} {pt?"a ignorar":"to skip"} · 0 {pt?"a atualizar":"to update"} · {preview.zoneAssignments} {pt?"atribuições de zonas":"zone assignments"}</p>
      <div className="ops-table-scroll" tabIndex={0} role="region" aria-label={pt?"Pré-visualização dos trabalhadores; deslocar para ver zonas":"Workers preview; scroll to see zones"}><table><caption>{pt?"Pré-visualização do ficheiro":"File preview"}</caption><thead><tr>{(pt?["Linha","Nome","Estado / pendências","Documento (final)","Dias","Zonas"]:["Row","Name","Status / outstanding","Document (last digits)","Days","Zones"]).map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{preview.rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.name}<small>{row.photoReference}</small><details><summary>{pt?"Ver dados":"View data"}</summary><dl className="ops-facts">{[[pt?"Função":"Job role",roles.find(r=>r.id===row.roleId)?.name??row.roleId],[pt?"Nascimento":"Date of birth",row.dateOfBirth],[pt?"Documento":"Document type",row.documentType],[pt?"Validade":"Document expiry",row.documentExpiry],[pt?"Telemóvel":"Mobile",row.mobile],[pt?"Nacionalidade":"Nationality",row.nationality],[pt?"Organização":"Organisation",row.organisation],[pt?"Referência interna":"Internal reference",row.reference]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"—"}</dd></div>)}</dl></details></td><td>{({INCOMPLETE:pt?"Incompleto":"Incomplete",INVALID:pt?"Inválido":"Invalid",EXISTING:pt?"Existente — ignorar":"Existing — skip",DUPLICATE:pt?"Duplicado — rever":"Duplicate — review"})[row.state]}<ul>{[...row.errors,...row.missing].map((x,i)=><li key={i}>{diagnostic(x,locale)}</li>)}</ul></td><td>{row.documentLast3?`•••${row.documentLast3}`:"—"}</td><td>{row.workDays||"—"}</td><td>{row.zoneIds.map(id=>zones.find(z=>z.id===id)?.name??id).join(", ")||"—"}</td></tr>)}</tbody></table></div>
      <label className="check-card"><input type="checkbox" checked={confirmed} disabled={pending} onChange={e=>setConfirmed(e.target.checked)}/><span>{pt?"Confirmo a criação dos registos indicados. Linhas inválidas e registos existentes serão ignorados; os duplicados exigem revisão. Nenhuma pessoa será aprovada automaticamente.":"I confirm creation of the indicated records. Invalid rows and existing records will be skipped; duplicates require review. No worker will be approved automatically."}</span></label>
      <button className="button primary" disabled={!confirmed || !preview.create || pending} onClick={()=>run(true)}>{pt?"Confirmar importação":"Confirm import"}</button></>}
    <Link className="button secondary" href={`/${locale}/admin/people/internal/${registrationId}?eventId=${eventId}`}>{pt?"Completar e rever trabalhadores":"Complete and review workers"}</Link>
  </section>;
}

import { parse } from "csv-parse/sync";
import { inflateRawSync } from "node:zlib";
import { DomainError } from "../shared/errors.ts";

export const importHeaders = ["Nome Completo", "Data de Nascimento", "Tipo de Documento", "Número de Documento", "Validade do Documento", "Telemóvel", "Nacionalidade", "Organização", "Função", "Dias de Trabalho", "Zonas de Acesso", "Fotografia", "Referência Interna"] as const;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
export type ImportRow = Record<typeof importHeaders[number], string>;
const fail = () => { throw new DomainError("INVALID_SPREADSHEET"); };

// ExcelJS loads ZIPs into memory. Inspect and bounded-decompress every entry first,
// independently of the attacker-controlled declared uncompressed sizes.
function inspectXlsx(bytes: Buffer) {
  if(bytes.length<22 || bytes.readUInt32LE(0)!==0x04034b50) fail();
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) fail();
  const count=bytes.readUInt16LE(end+10), start=bytes.readUInt32LE(end+16), size=bytes.readUInt32LE(end+12);
  if(!count || count>256 || bytes.readUInt16LE(end+8)!==count || start+size!==end || end+22+bytes.readUInt16LE(end+20)!==bytes.length) fail();
  let offset=start,total=0,cells=0; const names=new Set<string>();
  for(let n=0;n<count;n++) {
    if(offset+46>end || bytes.readUInt32LE(offset)!==0x02014b50) fail();
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),packed=bytes.readUInt32LE(offset+20),length=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
    if(offset+46+nameLength+extra+comment>end || flags&1 || ![0,8].includes(method) || length>8*1024*1024 || local+30>start || bytes.readUInt32LE(local)!==0x04034b50) fail();
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString("utf8");
    if(names.has(name) || name.includes("..") || name.startsWith("/") || name.includes("\\") || /vba|externalLinks|embeddings/i.test(name)) fail();
    names.add(name);
    const body=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(body+packed>start) fail();
    const data=method===8?inflateRawSync(bytes.subarray(body,body+packed),{maxOutputLength:8*1024*1024}):bytes.subarray(body,body+packed);
    if(data.length!==length || (total+=data.length)>32*1024*1024) fail();
    if(name.endsWith(".xml") || name.endsWith(".rels")) {
      const xml=data.toString("utf8");
      if(/<!DOCTYPE|<!ENTITY|<f(?:\s|\/|>)|TargetMode\s*=\s*["']External/i.test(xml)) fail();
      if(name.startsWith("xl/worksheets/")) {
        cells+=(xml.match(/<(?:\w+:)?c(?:\s|>)/g)??[]).length;
        if(cells>50000 || (xml.match(/<(?:\w+:)?row(?:\s|>)/g)??[]).length>20000) fail();
        for(const row of xml.matchAll(/<(?:\w+:)?row\s[^>]*\br\s*=\s*["'](\d+)["']/g)) if(Number(row[1])>20000) fail();
      }
    }
    offset+=46+nameLength+extra+comment;
  }
  if(offset!==end || !names.has("xl/workbook.xml")) fail();
}

function validateRows(rows:unknown[][]):ImportRow[] {
  if(rows.length<2 || rows.length>MAX_IMPORT_ROWS+1) fail();
  const headings=rows[0]!.map(x=>String(x??"").trim());
  if(headings.length<12 || headings.length>13 || headings.some((x,i)=>x!==importHeaders[i])) fail();
  const result:ImportRow[]=[];
  for(const cells of rows.slice(1)) {
    if(cells.every(x=>x===null || x===undefined || x==="")) continue;
    if(cells.length>13) fail();
    const row={} as ImportRow;
    for(let i=0;i<importHeaders.length;i++) {
      let value=cells[i];
      if(value instanceof Date) value=value.toISOString().slice(0,10);
      if(typeof value==="object" && value!==null) fail();
      if(typeof value==="number" && [3,5,12].includes(i)) fail(); // IDs/phones must preserve leading zeroes.
      const text=String(value??"").trim();
      if(text.length>10000 || (/^[=+@-]/.test(text) && !(i===5 && /^\+\d[\d ()-]*$/.test(text))) || [...text].some(c=>c.charCodeAt(0)<32 && ![9,10,13].includes(c.charCodeAt(0)))) fail();
      row[importHeaders[i]!]=text;
    }
    result.push(row);
  }
  if(!result.length) fail();
  return result;
}

export async function readInternalSpreadsheet(bytes:Uint8Array,filename:string):Promise<ImportRow[]> {
  if(!bytes.length || bytes.length>MAX_IMPORT_BYTES || !/\.(xlsx|csv)$/i.test(filename)) fail();
  try {
    const buffer=Buffer.from(bytes);
    if(/\.csv$/i.test(filename)) {
      const text=new TextDecoder("utf-8",{fatal:true}).decode(buffer);
      const first=text.replace(/^\uFEFF/,"").split(/\r?\n/,1)[0]??"";
      const delimiter=first.includes('"Nome Completo",') || first.startsWith("Nome Completo,")?",":";";
      return validateRows(parse(text,{bom:true,delimiter,skip_empty_lines:true,max_record_size:20000,relax_column_count:false}) as unknown[][]);
    }
    inspectXlsx(buffer);
    const {default:ExcelJS}=await import("exceljs");
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const workers=workbook.getWorksheet("Workers");
    if(!workers || workers.rowCount>MAX_IMPORT_ROWS+1 || workers.columnCount>13) fail();
    const rows:unknown[][]=[];
    workers!.eachRow({includeEmpty:true},row=>{rows.push(Array.from({length:Math.max(12,workers!.columnCount)},(_,i)=>row.getCell(i+1).value));});
    return validateRows(rows);
  } catch { return fail(); }
}

export interface TemplateContext { event:{id:string;name:string;startDate:Date;endDate:Date}; organisation:"AIA"|"PARKALGAR"; zones:{id:string;name:string}[]; roles:{id:string;name:string}[] }
export async function internalTemplate(context:TemplateContext) {
  const {default:ExcelJS}=await import("exceljs");
  const w=new ExcelJS.Workbook();w.creator="AIA";
  const workers=w.addWorksheet("Workers",{views:[{state:"frozen",ySplit:1}],properties:{defaultRowHeight:22}});
  workers.addRow([...importHeaders]);
  workers.columns=importHeaders.map((name,i)=>({header:name,width:[30,22,24,25,23,22,18,19,42,40,60,28,25][i]}));
  workers.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};workers.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF941F35"}};workers.getRow(1).height=32;
  workers.autoFilter={from:"A1",to:"M1"};
  for(let r=2;r<=MAX_IMPORT_ROWS+1;r++) {
    for(let c=1;c<=13;c++) workers.getCell(r,c).numFmt="@";
    workers.getCell(r,3).dataValidation={type:"list",allowBlank:true,formulae:['"PASSPORT,CARTAO_CIDADAO,CARTAO_RESIDENCIA"'],showErrorMessage:true,error:"Escolha um tipo da lista / Select a document type"};
    workers.getCell(r,8).dataValidation={type:"list",allowBlank:true,formulae:[`"${context.organisation}"`],showErrorMessage:true,error:"Use a organização selecionada / Use the selected organisation"};
    if(context.roles.length) workers.getCell(r,9).dataValidation={type:"list",allowBlank:true,formulae:["JobRoleIds"],showErrorMessage:true,error:"Use o UUID da função / Use the job role UUID"};
  }
  const zones=w.addWorksheet("Zones");zones.addRow(["Identificador UUID", "Zona / Zone", "Evento / Event"]);context.zones.forEach(z=>zones.addRow([z.id,z.name,context.event.name]));zones.columns=[{width:42},{width:32},{width:38}];
  const roles=w.addWorksheet("Roles");roles.addRow(["Identificador UUID", "Função / Role"]);context.roles.forEach(r=>roles.addRow([r.id,r.name]));roles.columns=[{width:42},{width:32}];
  const instructions=w.addWorksheet("Instructions");
  if(context.roles.length)w.definedNames.add(`Roles!$A$2:$A${context.roles.length+1}`,"JobRoleIds");
  const lines=["AIA — Importação interna / Internal import",`Evento / Event: ${context.event.name} (${context.event.id})`,`Organização / Organisation: ${context.organisation}`,`Dias do evento / Event dates: ${context.event.startDate.toISOString().slice(0,10)} — ${context.event.endDate.toISOString().slice(0,10)}`,"Datas: AAAA-MM-DD / Dates: YYYY-MM-DD. Documento e telemóvel: texto / Document and phone: text.","Organização: AIA ou PARKALGAR conforme a seleção / Organisation must match the selected organisation.","Função: copiar UUID de Roles / Job role: copy the UUID from Roles.","Dias de Trabalho: datas separadas por ; / Work days: dates separated by ;", "Zonas de Acesso: UUIDs de Zones separados por ;, diferentes por pessoa / Zones: separate UUIDs with ; for each person.","Sem zonas por defeito. Não use nomes nem códigos inventados / No default zones. Do not use names or invented codes.","Fotografia: referência opcional, apenas nome de ficheiro. Carregar depois em Trabalhadores / Optional filename only. Upload photographs later in Workers.","Referência Interna: código estável opcional, único na organização/evento / Optional stable reference, unique in the organisation/event.","Fotografia e confirmação do aviso de privacidade são obrigatórias para concluir / Photo and privacy-notice acknowledgement required for completion.","Registos existentes são ignorados; editar na aplicação / Existing records are skipped; edit in the application.","CSV: UTF-8 com cabeçalhos idênticos; valores com ; entre aspas / UTF-8 CSV with identical headers; quote values containing ;.","Importação cria rascunhos; a aprovação final AIA é sempre necessária / Imports create drafts; final AIA approval is always required."];
  lines.forEach(line=>instructions.addRow([line]));instructions.getColumn(1).width=115;instructions.getColumn(1).alignment={wrapText:true,vertical:"top"};instructions.eachRow(row=>{row.height=34;});
  for(const sheet of [zones,roles]) {sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];}
  return Buffer.from(await w.xlsx.writeBuffer());
}

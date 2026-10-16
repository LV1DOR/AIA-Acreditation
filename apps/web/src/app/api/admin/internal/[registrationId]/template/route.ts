import { downloadInternalTemplate, internalImportContext, importHeaders } from "@aia/domain";
import { session } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
export async function GET(request:Request,{params}:{params:Promise<{registrationId:string}>}) {
  const access=await session();
  if(access.status!=="GRANTED" || access.role!=="ADMIN") return new Response(null,{status:403});
  const {registrationId}=await params;
  try {
    const csv=new URL(request.url).searchParams.get("format")==="csv";
    if(csv) await internalImportContext(database(),access.context,registrationId);
    const body=csv?new TextEncoder().encode("\uFEFF"+importHeaders.map(x=>`"${x}"`).join(";")+"\r\n"):await downloadInternalTemplate(database(),access.context,registrationId);
    return new Response(new Uint8Array(body),{headers:{"Content-Type":csv?"text/csv; charset=utf-8":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="aia-workers-${registrationId}.${csv?"csv":"xlsx"}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch {return new Response(null,{status:403});}
}

import { DomainError, policeExportData, policeWorkbook, PoliceExportError } from "@aia/domain";
import { session } from "../../../../../../server/session.ts";
import { storageEnvironment } from "../../../../../../server/storage.ts";
import { database } from "../../../../../../server/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const access = await session();
    if (access.status !== "GRANTED" || access.role !== "ADMIN") return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
    const { eventId } = await params;
    const db = database(), key = storageEnvironment().DOCUMENT_ENCRYPTION_KEY;
    const rows = await policeExportData(db, access.context, eventId, key);
    const bytes = await policeWorkbook(rows);
    const current = await policeExportData(db, access.context, eventId, key);
    if (JSON.stringify(current) !== JSON.stringify(rows)) throw new DomainError("STALE_WRITE");
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Policia.xlsx"', "Content-Length": String(bytes.byteLength),
    } });
  } catch (error) {
    if (error instanceof PoliceExportError) return Response.json({ code: error.code }, { status: 409, headers });
    if (error instanceof DomainError) return Response.json({ code: error.code }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 409, headers });
    return Response.json({ code: "EXPORT_FAILED" }, { status: 500, headers });
  }
}

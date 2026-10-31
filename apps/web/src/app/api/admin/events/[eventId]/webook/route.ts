import { DomainError, weBookAttendees, weBookWorkbook, WeBookExportError } from "@aia/domain";
import { session } from "../../../../../../server/session.ts";
import { database } from "../../../../../../server/runtime.ts";
import { storageEnvironment } from "../../../../../../server/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const access = await session();
    if (access.status !== "GRANTED" || access.role !== "ADMIN") return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
    const { eventId } = await params;
    const db = database(), key = storageEnvironment().DOCUMENT_ENCRYPTION_KEY;
    const attendees = await weBookAttendees(db, access.context, eventId, key);
    const bytes = await weBookWorkbook(attendees);
    const current = await weBookAttendees(db, access.context, eventId, key);
    if (JSON.stringify(current) !== JSON.stringify(attendees)) throw new DomainError("STALE_WRITE");
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="WeBook.xlsx"',
      "Content-Length": String(bytes.byteLength),
    } });
  } catch (error) {
    if (error instanceof WeBookExportError) return Response.json({ code: error.code, attendeeName: error.attendeeName }, { status: 409, headers });
    if (error instanceof DomainError) return Response.json({ code: error.code }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 409, headers });
    return Response.json({ code: "EXPORT_FAILED" }, { status: 500, headers });
  }
}

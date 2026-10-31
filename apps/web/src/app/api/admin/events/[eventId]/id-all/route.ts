import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DomainError, IdAllExportError, idAllArchive, idAllAttendees } from "@aia/domain";
import { session } from "../../../../../../server/session.ts";
import { database } from "../../../../../../server/runtime.ts";
import { objectStorage, storageEnvironment } from "../../../../../../server/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function removeTemporaryArchive(directory: string) {
  // Only our one generated file; never recursively remove a computed directory.
  await rm(join(directory, "ID-ALL.zip"), { force: true });
  await rmdir(directory);
}

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  let directory: string | undefined;
  let downloading = false;
  try {
    const access = await session();
    if (access.status !== "GRANTED" || access.role !== "ADMIN") return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
    const { eventId } = await params;
    const db = database(), key = storageEnvironment().DOCUMENT_ENCRYPTION_KEY;
    const attendees = await idAllAttendees(db, access.context, eventId, key);
    const archive = await idAllArchive(attendees, objectStorage().getPhoto);
    // Finish the archive before offering a download: a missing photo must give
    // a useful error, never a successful but incomplete ZIP. This temporary file
    // is removed on completion, cancellation or failure; no export is retained.
    directory = await mkdtemp(join(tmpdir(), "aia-id-all-"));
    const path = join(directory, "ID-ALL.zip");
    await pipeline(archive, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal: request.signal });
    const current = await idAllAttendees(db, access.context, eventId, key);
    if (JSON.stringify(current) !== JSON.stringify(attendees)) throw new DomainError("STALE_WRITE");
    const size = (await stat(path)).size;
    const file = createReadStream(path);
    const cleanupDirectory = directory;
    const abort = () => file.destroy(new Error("DOWNLOAD_CANCELLED"));
    request.signal.addEventListener("abort", abort, { once: true });
    file.once("close", () => {
      request.signal.removeEventListener("abort", abort);
      void removeTemporaryArchive(cleanupDirectory).catch(() => console.error("ID_ALL_TEMP_CLEANUP_FAILED"));
    });
    const body = Readable.toWeb(file) as ReadableStream<Uint8Array>;
    if (request.signal.aborted) abort();
    downloading = true;
    return new Response(body, { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="ID-ALL.zip"', "Content-Length": String(size) } });
  } catch (error) {
    if (error instanceof IdAllExportError) return Response.json({ code: error.code, attendeeName: error.attendeeName }, { status: 409, headers });
    if (error instanceof DomainError) return Response.json({ code: error.code }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 409, headers });
    return Response.json({ code: "EXPORT_FAILED" }, { status: 500, headers });
  } finally {
    if (directory && !downloading) await removeTemporaryArchive(directory);
  }
}

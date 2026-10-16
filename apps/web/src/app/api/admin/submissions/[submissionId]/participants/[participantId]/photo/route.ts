import { adminSubmissionPhotoAccess } from "@aia/domain";
import { database } from "../../../../../../../../server/runtime.ts";
import { objectStorage, storageEnvironment } from "../../../../../../../../server/storage.ts";
import { session } from "../../../../../../../../server/session.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string; participantId: string }> }) {
  try {
    const access = await session();
    if (access.status !== "GRANTED" || access.role !== "ADMIN") return new Response(null, { status: 401 });
    const value = await params;
    const key = await adminSubmissionPhotoAccess(database(), access.context, value.submissionId, value.participantId, storageEnvironment().DOCUMENT_ENCRYPTION_KEY, new URL(_request.url).searchParams.get("original") === "1");
    const photo = await objectStorage().getPhoto(key);
    const body = new Uint8Array(photo.byteLength); body.set(photo);
    return new Response(body.buffer, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "Content-Disposition": "inline" } });
  } catch { return new Response(null, { status: 404 }); }
}

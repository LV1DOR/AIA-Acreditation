import { participantPhotoAccess } from "@aia/domain";
import { database } from "../../../../../server/runtime.ts";
import { objectStorage } from "../../../../../server/storage.ts";
import { session } from "../../../../../server/session.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const access = await session();
    if (access.status !== "GRANTED") return new Response(null, { status: 401 });
    const key = await participantPhotoAccess(database(), access.context, (await params).participantId);
    const photo = await objectStorage().getPhoto(key);
    const body = new Uint8Array(photo.byteLength); body.set(photo);
    return new Response(body.buffer, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "Content-Disposition": "inline" } });
  } catch { return new Response(null, { status: 404 }); }
}

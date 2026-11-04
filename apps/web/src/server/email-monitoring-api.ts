import { ZodError } from "zod";
import { DomainError } from "@aia/domain";
import { session } from "./session.ts";
import type { ActorContext } from "@aia/domain";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export async function adminEmailRead(read: (context: ActorContext) => Promise<unknown>) {
  try {
    const access = await session();
    if (access.status !== "GRANTED" || access.role !== "ADMIN") return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
    return Response.json(await read(access.context), { headers });
  } catch (error) {
    const status = error instanceof ZodError ? 400 : error instanceof DomainError && error.code === "FORBIDDEN" ? 403 : error instanceof DomainError && error.code === "NOT_FOUND" ? 404 : 503;
    return Response.json({ code: status === 400 ? "INVALID_QUERY" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "EMAIL_MONITORING_UNAVAILABLE" }, { status, headers });
  }
}

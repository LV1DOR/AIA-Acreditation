import { clerkMiddleware } from "@clerk/nextjs/server";
import { inspectAuthEnv } from "@aia/config";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { routing } from "./i18n/routing.ts";
const intl = createMiddleware(routing);
function route(request: NextRequest) {
  const response = request.nextUrl.pathname.startsWith("/api/") ? NextResponse.next() : intl(request);
  // Native form POSTs use Origin:null under no-referrer, which Next rejects.
  // Keep same-origin form origins while withholding referrers from other sites.
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Fast rejection before Clerk/route work. The streamed Server Action and ingress
  // limits remain required: a caller can omit or understate Content-Length.
  const declaredLength = request.headers.get("content-length");
  if (request.method === "POST" && declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > 9 * 1024 * 1024) {
    return new NextResponse("Request body too large", { status: 413, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const authEnvironment = inspectAuthEnv(process.env);
  if (authEnvironment.status !== "READY") return route(request);
  return clerkMiddleware((_auth, req) => route(req), {
    authorizedParties: [...new Set([
      authEnvironment.environment.APP_ORIGIN,
      ...authEnvironment.environment.AUTH_ADDITIONAL_ORIGINS,
    ])],
  })(request, event);
}
export const config = { matcher: [
  "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  "/(api|trpc)(.*)",
  "/__clerk/(.*)",
] };

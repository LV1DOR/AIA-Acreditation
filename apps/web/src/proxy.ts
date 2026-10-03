import { clerkMiddleware } from "@clerk/nextjs/server";
import { inspectAuthEnv } from "@aia/config";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { routing } from "./i18n/routing.ts";
const intl = createMiddleware(routing);
function route(request: NextRequest) {
  const response = request.nextUrl.pathname.startsWith("/api/") ? NextResponse.next() : intl(request);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export default function proxy(request: NextRequest, event: NextFetchEvent) {
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

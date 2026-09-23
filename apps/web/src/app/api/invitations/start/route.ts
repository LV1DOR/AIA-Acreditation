import { NextResponse, type NextRequest } from "next/server";
import { invitationAvailable } from "@aia/domain";
import { database } from "../../../../server/runtime.ts";
import { authConfiguration } from "../../../../server/auth-config.ts";
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "pt";
  const authentication = authConfiguration();
  const origin = authentication.status === "READY" ? authentication.environment.APP_ORIGIN : "http://127.0.0.1:3100";
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const available = authentication.status === "READY" && await invitationAvailable(database(), token);
  const response = NextResponse.redirect(new URL("/" + locale + "/invitation" + (available ? "" : "?error=unavailable"), origin), 303);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (!available) {
    response.cookies.delete("aia_leader_invitation");
    return response;
  }
  response.cookies.set("aia_leader_invitation", token, { httpOnly: true, secure: new URL(origin).protocol === "https:", sameSite: "lax", path: "/", maxAge: 1800 });
  return response;
}

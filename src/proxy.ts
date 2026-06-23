import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken } from "@/lib/gate";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Site-wide password gate
  if (process.env.ACCESS_PASSWORD) {
    const token = request.cookies.get(GATE_COOKIE)?.value;
    if (token !== gateToken()) {
      return NextResponse.redirect(new URL("/gate", request.url));
    }
  }

  // Lightweight session check for the dashboard; real enforcement
  // happens via auth() in server components and API routes.
  if (pathname.startsWith("/dashboard")) {
    const hasSession =
      request.cookies.has("authjs.session-token") ||
      request.cookies.has("__Secure-authjs.session-token");
    if (!hasSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything EXCEPT routes that external systems must reach:
  // - /u/* (unsubscribe links in sent emails)
  // - /api/process (daily Vercel cron, guarded by CRON_SECRET)
  // - /api/dispatch (10-min external cron sending due emails, guarded by CRON_SECRET)
  // - /gate (the password form itself), Next assets, favicon
  matcher: [
    "/((?!gate|u/|api/process|api/dispatch|_next/|favicon\\.ico).*)",
  ],
};

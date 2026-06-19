import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { buildAuthLink } from "@/lib/x/auth";

// Step 1 of connecting an X account: redirect to X's consent screen, stashing
// the PKCE verifier + state in short-lived httpOnly cookies. Admin-only, since
// it adds an account to the shared workspace. "Connect another" hits this too.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", origin));
  }
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.redirect(new URL("/dashboard/x?x=forbidden", origin));
  }

  let link: { url: string; state: string; codeVerifier: string };
  try {
    link = buildAuthLink();
  } catch {
    return NextResponse.redirect(new URL("/dashboard/x?x=error", origin));
  }

  const res = NextResponse.redirect(link.url);
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  res.cookies.set("x_oauth_state", link.state, opts);
  res.cookies.set("x_oauth_verifier", link.codeVerifier, opts);
  return res;
}

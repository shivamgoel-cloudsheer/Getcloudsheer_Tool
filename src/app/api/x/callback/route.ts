import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/x/auth";

// Step 2: X redirects the browser back here with ?code&state. Validate state
// against the cookie, exchange the code, upsert the X account by handle.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const jar = await cookies();
  const savedState = jar.get("x_oauth_state")?.value;
  const verifier = jar.get("x_oauth_verifier")?.value;

  if (!code || !state || !verifier || state !== savedState) {
    return NextResponse.redirect(new URL("/dashboard/x?x=error", origin));
  }

  const session = await auth();
  try {
    await exchangeCode({
      code,
      codeVerifier: verifier,
      connectedByUserId: session?.user?.id ?? null,
    });
  } catch (err) {
    // Surface token-exchange failures in Vercel logs instead of a blank error.
    console.error("X OAuth callback (token exchange) failed:", err);
    return NextResponse.redirect(new URL("/dashboard/x?x=error", origin));
  }

  const res = NextResponse.redirect(new URL("/dashboard/x?x=connected", origin));
  res.cookies.delete("x_oauth_state");
  res.cookies.delete("x_oauth_verifier");
  return res;
}

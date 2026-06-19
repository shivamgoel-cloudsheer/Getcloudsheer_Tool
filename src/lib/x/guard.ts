import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";

export type AuthedUser = { userId: string; email: string | null };

/** Returns the signed-in user, or a 401 Response to return from the route. */
export async function requireUser(): Promise<AuthedUser | Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  return { userId: session.user.id, email: session.user.email ?? null };
}

/** Like requireUser, but also requires an ADMIN_EMAILS membership (used for
 *  connecting/disconnecting X accounts, which affect the shared workspace). */
export async function requireAdmin(): Promise<AuthedUser | Response> {
  const u = await requireUser();
  if (u instanceof Response) return u;
  if (!isAdminEmail(u.email)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }
  return u;
}

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { GMAIL_SEND_SCOPE } from "@/auth";

/**
 * Returns a valid Google access token for the user, refreshing it via the
 * stored refresh_token when it is expired or about to expire.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")));

  if (!account?.access_token) {
    throw new Error("No Google account linked. Please sign in again.");
  }

  const expiresAtMs = (account.expires_at ?? 0) * 1000;
  const stillValid = expiresAtMs > Date.now() + 60_000;
  if (stillValid) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new Error(
      "Google session expired and no refresh token is stored. Please sign out and sign in again."
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });

  const tokens = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !tokens.access_token) {
    throw new Error(
      `Failed to refresh Google token: ${tokens.error ?? response.status} ${
        tokens.error_description ?? ""
      }`.trim()
    );
  }

  await db
    .update(accounts)
    .set({
      access_token: tokens.access_token,
      expires_at: Math.floor(Date.now() / 1000 + (tokens.expires_in ?? 3600)),
      // Google may rotate the refresh token; keep the old one otherwise
      refresh_token: tokens.refresh_token ?? account.refresh_token,
    })
    .where(
      and(
        eq(accounts.provider, "google"),
        eq(accounts.providerAccountId, account.providerAccountId)
      )
    );

  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// Sender mailbox -> linked Google account resolution. Sending happens as the
// mailbox owner (campaign fromAddress), not the campaign owner, so each
// sender must have signed in once with the gmail.send scope granted.
// ---------------------------------------------------------------------------

export class SenderNotLinkedError extends Error {
  constructor(senderEmail: string) {
    super(
      `${senderEmail} hasn't connected Google yet — have them sign in to the dashboard once.`
    );
    this.name = "SenderNotLinkedError";
  }
}

export class SenderScopeError extends Error {
  constructor(senderEmail: string) {
    super(
      `${senderEmail} needs to re-connect Google to grant send permission (sign out and sign in again).`
    );
    this.name = "SenderScopeError";
  }
}

export type SenderAccount = {
  userId: string;
  scope: string | null;
  hasRefreshToken: boolean;
};

/** Finds the linked Google account for a sender mailbox (users.email is the
 *  Google profile email, so the mailbox maps to its own user row). */
export async function getSenderAccount(
  senderEmail: string
): Promise<SenderAccount | null> {
  const [row] = await db
    .select({
      userId: accounts.userId,
      scope: accounts.scope,
      refreshToken: accounts.refresh_token,
    })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(
      and(
        eq(sql`lower(${users.email})`, senderEmail.trim().toLowerCase()),
        eq(accounts.provider, "google")
      )
    );
  if (!row) return null;
  return {
    userId: row.userId,
    scope: row.scope,
    hasRefreshToken: !!row.refreshToken,
  };
}

export function hasSendScope(scope: string | null): boolean {
  return !!scope?.split(" ").includes(GMAIL_SEND_SCOPE);
}

/** Valid access token for the mailbox itself; throws descriptive errors when
 *  the sender hasn't linked Google or hasn't granted gmail.send. */
export async function getAccessTokenForSender(
  senderEmail: string
): Promise<string> {
  const acct = await getSenderAccount(senderEmail);
  if (!acct) throw new SenderNotLinkedError(senderEmail);
  if (!hasSendScope(acct.scope)) throw new SenderScopeError(senderEmail);
  return getValidAccessToken(acct.userId);
}

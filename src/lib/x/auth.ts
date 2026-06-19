import { eq, isNull } from "drizzle-orm";
import { TwitterApi } from "twitter-api-v2";
import { db } from "@/db";
import { xAccounts } from "@/db/schema";

// OAuth 2.0 user-context scopes. offline.access is required to receive a
// refresh token (X access tokens expire after ~2h).
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

export class XNotConnectedError extends Error {
  constructor(
    message = "This X account is not connected. Reconnect it from the dashboard."
  ) {
    super(message);
    this.name = "XNotConnectedError";
  }
}

function callbackUrl(): string {
  const url = process.env.X_CALLBACK_URL;
  if (!url) throw new Error("X_CALLBACK_URL is not set.");
  return url;
}

/** Confidential app client used to mint links, exchange codes, and refresh. */
function appClient(): TwitterApi {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("X_CLIENT_ID / X_CLIENT_SECRET are not set.");
  }
  return new TwitterApi({ clientId, clientSecret });
}

/** Step 1 of connect: build the consent URL + the PKCE verifier/state to stash
 *  in cookies until the callback. Account-agnostic (the account is only known
 *  after the code exchange), so "connect another" reuses this unchanged. */
export function buildAuthLink(): { url: string; state: string; codeVerifier: string } {
  const { url, state, codeVerifier } = appClient().generateOAuth2AuthLink(
    callbackUrl(),
    { scope: [...X_SCOPES] }
  );
  // twitter-api-v2 emits the PKCE method lowercase ("s256"); OAuth 2.0 / RFC
  // 7636 and X require uppercase "S256". X rejects the lowercase form with
  // "You weren't able to give access to the App", so normalize it here.
  const fixedUrl = url.replace(
    "code_challenge_method=s256",
    "code_challenge_method=S256"
  );
  if (!fixedUrl.includes("code_challenge_method=S256")) {
    throw new Error("X authorize URL is missing the required S256 PKCE method.");
  }
  return { url: fixedUrl, state, codeVerifier };
}

/** Step 2 of connect: exchange the code, confirm the account via v2.me() (now
 *  mandatory - xUserId is the upsert key), and upsert a row by xUserId. Same
 *  handle -> tokens refresh + reconnected; new handle -> new row. */
export async function exchangeCode(args: {
  code: string;
  codeVerifier: string;
  connectedByUserId?: string | null;
}): Promise<{ xAccountId: string; username: string | null }> {
  const { client, accessToken, refreshToken, expiresIn, scope } =
    await appClient().loginWithOAuth2({
      code: args.code,
      codeVerifier: args.codeVerifier,
      redirectUri: callbackUrl(),
    });

  const me = await client.v2.me();
  const xUserId = me.data.id;
  const xUsername = me.data.username;

  const set = {
    xUsername,
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + (expiresIn ?? 7200),
    scope: Array.isArray(scope) ? scope.join(" ") : null,
    connectedByUserId: args.connectedByUserId ?? null,
    disconnectedAt: null,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(xAccounts)
    .values({ xUserId, ...set })
    .onConflictDoUpdate({ target: xAccounts.xUserId, set })
    .returning({ id: xAccounts.id });

  return { xAccountId: row.id, username: xUsername };
}

/** All currently-connected accounts (excludes soft-disconnected ones). */
export async function listXAccounts() {
  return db
    .select()
    .from(xAccounts)
    .where(isNull(xAccounts.disconnectedAt))
    .orderBy(xAccounts.createdAt);
}

export async function getXAccount(xAccountId: string) {
  const [row] = await db
    .select()
    .from(xAccounts)
    .where(eq(xAccounts.id, xAccountId));
  return row ?? null;
}

export async function disconnectXAccount(xAccountId: string): Promise<void> {
  await db
    .update(xAccounts)
    .set({ disconnectedAt: new Date(), updatedAt: new Date() })
    .where(eq(xAccounts.id, xAccountId));
}

/** Forces a token refresh for one account; persists the rotated refresh token.
 *  On failure (revoked grant) the account is soft-disconnected. */
export async function refreshXToken(xAccountId: string): Promise<string> {
  const acct = await getXAccount(xAccountId);
  if (!acct?.refreshToken) {
    throw new XNotConnectedError(
      "X session expired and no refresh token is stored. Reconnect the account."
    );
  }
  let refreshed;
  try {
    refreshed = await appClient().refreshOAuth2Token(acct.refreshToken);
  } catch (err) {
    await db
      .update(xAccounts)
      .set({ disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(xAccounts.id, xAccountId));
    throw new XNotConnectedError(
      `Could not refresh the X token; account disconnected, reconnect it. (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
  await db
    .update(xAccounts)
    .set({
      accessToken: refreshed.accessToken,
      // X rotates the refresh token on every refresh; keep the old one only if
      // a new one wasn't returned.
      refreshToken: refreshed.refreshToken ?? acct.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expiresIn ?? 7200),
      updatedAt: new Date(),
    })
    .where(eq(xAccounts.id, xAccountId));
  return refreshed.accessToken;
}

/** Live access token for one account, refreshing within 60s of expiry. */
export async function getValidXAccessToken(xAccountId: string): Promise<string> {
  const acct = await getXAccount(xAccountId);
  if (!acct || acct.disconnectedAt || !acct.accessToken) {
    throw new XNotConnectedError();
  }
  const expiresAtMs = (acct.expiresAt ?? 0) * 1000;
  if (expiresAtMs > Date.now() + 60_000) {
    return acct.accessToken;
  }
  return refreshXToken(xAccountId);
}

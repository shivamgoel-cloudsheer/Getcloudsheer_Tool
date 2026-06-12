import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

// Write access so campaign status can be synced back into the sheet
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
// Read-only inbox access for reply detection
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Send-as-the-user access; emails go out through the sender's own mailbox
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      authorization: {
        params: {
          // offline + consent guarantees a refresh_token on every sign-in,
          // which we need for server-side Sheets API calls
          access_type: "offline",
          prompt: "consent",
          scope: `openid email profile ${SHEETS_SCOPE} ${GMAIL_SCOPE} ${GMAIL_SEND_SCOPE}`,
        },
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // The Drizzle adapter only writes the account row on first link; on later
    // sign-ins the fresh tokens/scope (e.g. a newly granted gmail.send) would
    // be dropped without this upsert.
    async signIn({ account }) {
      if (account?.provider !== "google" || !account.access_token) return;
      await db
        .update(accounts)
        .set({
          access_token: account.access_token,
          // Google may omit the refresh token on re-consent; keep the old one
          ...(account.refresh_token
            ? { refresh_token: account.refresh_token }
            : {}),
          expires_at: account.expires_at,
          scope: account.scope,
        })
        .where(
          and(
            eq(accounts.provider, "google"),
            eq(accounts.providerAccountId, account.providerAccountId)
          )
        );
    },
  },
});

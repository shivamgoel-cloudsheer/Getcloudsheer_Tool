import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
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
          scope: `openid email profile ${SHEETS_SCOPE} ${GMAIL_SCOPE}`,
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
});

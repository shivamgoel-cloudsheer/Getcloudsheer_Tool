import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, users } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { isAllowedSenderEmail } from "@/lib/senders";

/**
 * WHERE condition limiting which campaigns a session may see in list/analytics
 * views.
 *
 * Non-admins only ever see their own campaigns. Admins (ADMIN_EMAILS) see every
 * campaign owned by a user on an ALLOWED sender domain - so on this
 * getcloudsheer instance the cloudsheer.com campaigns that share the same Neon
 * database (owned by the original outreach app) are never listed here. Self is
 * always included as a safety net.
 */
export async function visibleCampaignsWhere(
  userId: string,
  email: string | null | undefined
) {
  if (!isAdminEmail(email)) {
    return eq(campaigns.userId, userId);
  }
  const everyone = await db
    .select({ id: users.id, email: users.email })
    .from(users);
  const allowedIds = everyone
    .filter((u) => isAllowedSenderEmail(u.email))
    .map((u) => u.id);
  if (!allowedIds.includes(userId)) allowedIds.push(userId);
  return inArray(campaigns.userId, allowedIds);
}

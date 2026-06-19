import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { xPosts, xPostLog } from "@/db/schema";
import { postTweet, XPostError } from "./post";
import { getValidXAccessToken, refreshXToken } from "./auth";

// X API free tier: 17 posts/day PER ACCOUNT (and 500/month). The quota guard
// enforces the daily cap per account.
export const DAILY_CAP = 17;

export type DispatchResult = {
  claimed: number;
  posted: number;
  failed: number;
  skippedQuota: number;
  errors: string[];
  byAccount: Record<string, { posted: number; failed: number }>;
};

type XPost = typeof xPosts.$inferSelect;

function jitter(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
}

function utcDayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Per-account count of tweets already posted in the current UTC day. */
async function postsTodayByAccount(): Promise<Map<string, number>> {
  const rows = await db
    .select({ xAccountId: xPostLog.xAccountId, n: count() })
    .from(xPostLog)
    .where(gte(xPostLog.postedAt, utcDayStart()))
    .groupBy(xPostLog.xAccountId);
  return new Map(rows.map((r) => [r.xAccountId, Number(r.n)]));
}

async function releaseClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(xPosts)
    .set({ dispatchClaimedAt: null })
    .where(and(inArray(xPosts.id, ids), eq(xPosts.status, "scheduled")));
}

/**
 * Publishes claimed-and-due posts, grouped by X account, never exceeding each
 * account's free-tier daily cap. One rate-limited or disconnected account
 * never blocks the others.
 *
 * Rows are claimed with a single-statement UPDATE (one transaction on
 * neon-http) so overlapping cron pings can't double-post; a claim older than
 * 15 minutes is reclaimable since function maxDuration is 300s.
 */
export async function dispatchDue(): Promise<DispatchResult> {
  const result: DispatchResult = {
    claimed: 0,
    posted: 0,
    failed: 0,
    skippedQuota: 0,
    errors: [],
    byAccount: {},
  };

  const usedByAccount = await postsTodayByAccount();

  // Atomic claim across ALL accounts in one statement (neon-http friendly).
  // Generous upper bound; per-account caps trim it after grouping, over-claims
  // are released cleanly.
  const claimLimit = 200;
  const claimedRows = await db.execute<{ id: string }>(sql`
    UPDATE x_post SET dispatch_claimed_at = now()
    WHERE id IN (
      SELECT id FROM x_post
      WHERE status = 'scheduled'
        AND scheduled_for IS NOT NULL
        AND scheduled_for <= now()
        AND (dispatch_claimed_at IS NULL
             OR dispatch_claimed_at < now() - interval '15 minutes')
      ORDER BY scheduled_for
      LIMIT ${claimLimit}
      FOR UPDATE SKIP LOCKED
    )
    AND status = 'scheduled'
    AND (dispatch_claimed_at IS NULL
         OR dispatch_claimed_at < now() - interval '15 minutes')
    RETURNING id
  `);

  const claimedIds = claimedRows.rows.map((r) => r.id);
  result.claimed = claimedIds.length;
  if (claimedIds.length === 0) return result;

  const rows = await db
    .select()
    .from(xPosts)
    .where(inArray(xPosts.id, claimedIds));

  // Group claimed rows by account.
  const byAccount = new Map<string, XPost[]>();
  for (const r of rows) {
    const list = byAccount.get(r.xAccountId);
    if (list) list.push(r);
    else byAccount.set(r.xAccountId, [r]);
  }

  for (const [xAccountId, group] of byAccount) {
    // Thread heads before their replies so reply targets exist.
    group.sort(
      (a, b) =>
        (a.threadParentId ? 1 : 0) - (b.threadParentId ? 1 : 0) ||
        a.threadOrder - b.threadOrder
    );

    const used = usedByAccount.get(xAccountId) ?? 0;
    const remaining = DAILY_CAP - used;
    const acctStat = { posted: 0, failed: 0 };
    result.byAccount[xAccountId] = acctStat;

    if (remaining <= 0) {
      await releaseClaims(group.map((g) => g.id));
      result.skippedQuota += group.length;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await getValidXAccessToken(xAccountId);
    } catch (err) {
      // Disconnected / refresh failed: release this account's claims, move on.
      await releaseClaims(group.map((g) => g.id));
      result.errors.push(
        `${xAccountId}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    let tokenRetried = false;

    for (let i = 0; i < group.length; i++) {
      const p = group[i];

      if (acctStat.posted >= remaining) {
        await releaseClaims([p.id]);
        result.skippedQuota++;
        continue;
      }

      let inReplyToTweetId: string | undefined;
      if (p.threadParentId) {
        const [parent] = await db
          .select({ tweetId: xPosts.tweetId })
          .from(xPosts)
          .where(eq(xPosts.id, p.threadParentId));
        if (!parent?.tweetId) {
          await releaseClaims([p.id]);
          continue;
        }
        inReplyToTweetId = parent.tweetId;
      }

      try {
        const { tweetId } = await postTweet({
          accessToken,
          text: p.body,
          inReplyToTweetId,
        });

        const updated = await db
          .update(xPosts)
          .set({
            status: "posted",
            tweetId,
            postedAt: new Date(),
            dispatchClaimedAt: null,
            error: null,
          })
          .where(and(eq(xPosts.id, p.id), eq(xPosts.status, "scheduled")))
          .returning({ id: xPosts.id });

        if (updated.length > 0) {
          await db.insert(xPostLog).values({ xAccountId, tweetId });
          acctStat.posted++;
          result.posted++;
        }
      } catch (err) {
        if (err instanceof XPostError && err.tokenProblem && !tokenRetried) {
          tokenRetried = true;
          try {
            accessToken = await refreshXToken(xAccountId);
            i--;
            continue;
          } catch {
            // fall through to abort this account below
          }
        }

        if (err instanceof XPostError && !err.retryable && !err.tokenProblem) {
          // Post-level rejection (duplicate, policy, bad payload): fail this one.
          await db
            .update(xPosts)
            .set({ status: "failed", error: err.message, dispatchClaimedAt: null })
            .where(eq(xPosts.id, p.id));
          acctStat.failed++;
          result.failed++;
          continue;
        }

        // 429 / dead token / 5xx: stop THIS account, release its remaining
        // claims, continue to the next account.
        const remainingIds = group.slice(i).map((x) => x.id);
        await releaseClaims(remainingIds);
        result.errors.push(
          `${xAccountId}: ${err instanceof Error ? err.message : String(err)}`
        );
        break;
      }

      if (i < group.length - 1) await jitter();
    }
  }

  return result;
}

import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  xStyleProfiles,
  xPosts,
  xPostLog,
  type XStoredStyleProfile,
} from "@/db/schema";
import { getTrends } from "./trends";
import { generatePost } from "./generate";
import { DAILY_CAP } from "./dispatch";
import { listXAccounts } from "./auth";

export type ProcessSummary = {
  accounts: number;
  profiles: number;
  generated: number;
  scheduled: number;
  drafted: number;
  errors: string[];
};

/**
 * Spread `count` posts across roughly the next 12 hours, first one ~5 min out,
 * at least a few minutes apart, with jitter so they don't look robotic.
 */
export function scheduleTimes(count: number, fromMs = Date.now()): Date[] {
  if (count <= 0) return [];
  const windowMs = 12 * 60 * 60 * 1000;
  const gap = count > 1 ? Math.min(windowMs / count, 3 * 60 * 60 * 1000) : 0;
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const base = fromMs + 5 * 60 * 1000 + i * gap;
    const spread = Math.min(gap, 20 * 60 * 1000);
    const j = (Math.random() - 0.5) * spread;
    times.push(new Date(base + j));
  }
  return times;
}

function utcDayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function postsToday(xAccountId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(xPostLog)
    .where(
      and(eq(xPostLog.xAccountId, xAccountId), gte(xPostLog.postedAt, utcDayStart()))
    );
  return Number(value);
}

/**
 * Generate posts for one profile from current trends. When `schedule` is true
 * they go straight to `scheduled` (autonomous); otherwise they land as `draft`.
 * Inserted rows carry the profile's xAccountId. Returns the number created.
 */
async function generateForProfile(
  profile: typeof xStyleProfiles.$inferSelect,
  wanted: number,
  schedule: boolean
): Promise<number> {
  if (wanted <= 0 || !profile.profile) return 0;
  const trends = await getTrends(profile.niche, {
    limit: Math.max(wanted, 3),
    model: profile.model,
  });
  if (trends.length === 0) return 0;

  const n = Math.min(wanted, trends.length);
  const times = schedule ? scheduleTimes(n) : [];
  let created = 0;

  for (let i = 0; i < n; i++) {
    const t = trends[i];
    const body = await generatePost({
      profile: profile.profile as XStoredStyleProfile,
      topic: t.topic,
      whyNow: t.whyNow,
      niche: profile.niche,
      model: profile.model,
    });
    await db.insert(xPosts).values({
      xAccountId: profile.xAccountId,
      styleProfileId: profile.id,
      body,
      sourceTopic: t.topic,
      sourceUrl: t.sourceUrl,
      status: schedule ? "scheduled" : "draft",
      scheduledFor: schedule ? times[i] : null,
    });
    created++;
  }
  return created;
}

/**
 * Daily job: for every connected account, pull trends per analyzed profile and
 * generate posts. Autonomous profiles schedule directly (within the account's
 * remaining daily budget); the rest produce drafts. Budget is per account.
 */
export async function runDailyProcess(): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    accounts: 0,
    profiles: 0,
    generated: 0,
    scheduled: 0,
    drafted: 0,
    errors: [],
  };

  const accounts = await listXAccounts();
  for (const acct of accounts) {
    summary.accounts++;
    // Respect tweets already posted today so the daily job + 10-min dispatcher
    // don't jointly exceed the per-account cap.
    let budget = DAILY_CAP - (await postsToday(acct.id));
    const profs = await db
      .select()
      .from(xStyleProfiles)
      .where(eq(xStyleProfiles.xAccountId, acct.id));

    for (const prof of profs) {
      if (!prof.profile) continue; // not analyzed yet
      summary.profiles++;
      try {
        if (prof.autonomous) {
          const want = Math.max(0, Math.min(prof.postsPerDay, budget));
          const created = await generateForProfile(prof, want, true);
          summary.generated += created;
          summary.scheduled += created;
          budget -= created;
        } else {
          const created = await generateForProfile(prof, prof.postsPerDay, false);
          summary.generated += created;
          summary.drafted += created;
        }
      } catch (err) {
        summary.errors.push(
          `${acct.xUsername ?? acct.id} / ${prof.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  return summary;
}

/** Used by "Generate draft now": makes `count` drafts to review for a profile. */
export async function generateDrafts(
  profileId: string,
  count = 1
): Promise<number> {
  const [prof] = await db
    .select()
    .from(xStyleProfiles)
    .where(eq(xStyleProfiles.id, profileId));
  if (!prof) throw new Error("Profile not found.");
  if (!prof.profile) throw new Error("Profile has not been analyzed yet.");
  return generateForProfile(prof, count, false);
}

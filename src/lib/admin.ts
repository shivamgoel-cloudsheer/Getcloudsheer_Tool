/**
 * Manager/admin access. Emails listed in the ADMIN_EMAILS env var (comma-
 * separated) can see and control EVERY campaign - not just the ones they
 * created - so a manager can review, schedule, run, and delete the team's
 * campaigns from their own Google login. No password sharing required.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) return false;
  const admins = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

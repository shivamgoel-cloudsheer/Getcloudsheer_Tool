import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// Align the campaign's displayed schedule time with the actual first
// send time Resend has queued (stored on the recipient as last_email_at).
const updated = await sql`
  update campaign c
  set scheduled_at = sub.first_send
  from (
    select campaign_id, min(last_email_at) as first_send
    from recipient where status = 'scheduled' group by campaign_id
  ) sub
  where c.id = sub.campaign_id and c.status = 'scheduled'
  returning c.name, c.scheduled_at`;
console.log(JSON.stringify(updated, null, 1));

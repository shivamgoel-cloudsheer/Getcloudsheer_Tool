import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  select r.email, r.status, r.resend_email_id, r.last_email_at,
         c.name, c.status as campaign_status, c.scheduled_at
  from recipient r join campaign c on c.id = r.campaign_id
  where r.status = 'scheduled'
  order by c.created_at desc limit 5`;
console.log(JSON.stringify(rows, null, 1));
console.log("NOW_UTC:", new Date().toISOString());

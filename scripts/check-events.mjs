import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const events = await sql`
  select type, resend_email_id, created_at
  from email_event order by created_at desc limit 10`;
console.log("EVENTS:", JSON.stringify(events, null, 1));

const recipients = await sql`
  select email, status, resend_email_id, last_email_at
  from recipient order by last_email_at desc nulls last limit 5`;
console.log("RECIPIENTS:", JSON.stringify(recipients, null, 1));

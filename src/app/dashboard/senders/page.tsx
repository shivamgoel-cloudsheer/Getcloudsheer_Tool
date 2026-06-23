import { and, eq } from "drizzle-orm";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Mail,
  Plus,
} from "lucide-react";
import { auth, signIn } from "@/auth";
import { db } from "@/db";
import { users, accounts } from "@/db/schema";
import { hasSendScope } from "@/lib/google";
import { allowedSenderDomains, isAllowedSenderEmail } from "@/lib/senders";

export const dynamic = "force-dynamic";

export default async function SendersPage() {
  await auth(); // layout already redirects unauthenticated users

  // Every Google account that has signed in is a "connected mailbox". It can
  // send once its grant includes the gmail.send scope. Only show mailboxes on
  // a domain this instance is allowed to send from, so accounts belonging to
  // other apps that share this database (e.g. cloudsheer.com) don't appear.
  const allRows = await db
    .select({ email: users.email, name: users.name, scope: accounts.scope })
    .from(users)
    .innerJoin(
      accounts,
      and(eq(accounts.userId, users.id), eq(accounts.provider, "google"))
    );
  const rows = allRows.filter((r) => isAllowedSenderEmail(r.email));

  type Box = { email: string; name: string | null; sendReady: boolean };
  const byDomain = new Map<string, Box[]>();
  for (const r of rows) {
    if (!r.email) continue;
    const domain = r.email.split("@")[1]?.toLowerCase() ?? "unknown";
    const list = byDomain.get(domain) ?? [];
    list.push({
      email: r.email,
      name: r.name,
      sendReady: hasSendScope(r.scope),
    });
    byDomain.set(domain, list);
  }
  const domains = [...byDomain.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const totalMailboxes = rows.filter((r) => r.email).length;
  const readyCount = [...byDomain.values()]
    .flat()
    .filter((b) => b.sendReady).length;

  const policy = allowedSenderDomains();
  const openPolicy = policy.includes("*");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Mailboxes &amp; domains
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {totalMailboxes} mailbox{totalMailboxes === 1 ? "" : "es"} connected
            across {domains.length} domain{domains.length === 1 ? "" : "s"} ·{" "}
            {readyCount} ready to send
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard/senders" });
          }}
        >
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"
          >
            <Plus size={16} />
            Connect a mailbox
          </button>
        </form>
      </div>

      <p className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
        To connect a mailbox, click <strong>Connect a mailbox</strong> and sign
        in with the Google account you want to add (choose or add that account
        if you have more than one), then approve access. Each mailbox only needs
        to do this once.{" "}
        {openPolicy
          ? "Any mailbox in your Google Workspace can connect and send."
          : `Only these domains can send: ${policy.join(", ")}.`}
      </p>

      {domains.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Mail size={20} />
          </div>
          <p className="mt-4 font-medium text-slate-700">
            No mailboxes connected yet
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
            Connect the first one to start sending.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {domains.map(([domain, boxes]) => (
            <div
              key={domain}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <Globe size={15} className="text-indigo-600" />
                <span className="font-medium text-slate-900">{domain}</span>
                <span className="text-xs text-slate-400">
                  {boxes.length} mailbox{boxes.length === 1 ? "" : "es"}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {boxes
                  .sort((a, b) => a.email.localeCompare(b.email))
                  .map((b) => (
                    <li
                      key={b.email}
                      className="flex items-center justify-between gap-4 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {b.name ?? b.email.split("@")[0]}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {b.email}
                        </p>
                      </div>
                      {b.sendReady ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <CheckCircle2 size={12} />
                          Ready to send
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                          <AlertTriangle size={12} />
                          Needs reconnect
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-900">
          <Plus size={15} className="text-indigo-600" />
          Add a new domain
        </summary>
        <div className="mt-3 space-y-2 text-sm text-slate-600">
          <p>
            A domain is added in Google, not here - this tool can&apos;t create
            domains. Once a domain&apos;s mailboxes can sign in, they show up
            above automatically.
          </p>
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>
              In the Google Admin console (same Workspace as your other domains):{" "}
              <strong>
                Account &rarr; Domains &rarr; Manage domains &rarr; Add a domain
              </strong>{" "}
              (secondary domain), then verify ownership if asked.
            </li>
            <li>
              Set its mail DNS so it doesn&apos;t go to spam: <strong>MX</strong>{" "}
              to Google, <strong>SPF</strong>{" "}
              (<code>v=spf1 include:_spf.google.com ~all</code>),{" "}
              <strong>DKIM</strong> (Admin &rarr; Gmail &rarr; Authenticate
              email), and a <strong>DMARC</strong> record.
            </li>
            <li>Create the mailboxes as users on that domain.</li>
            <li>
              Each mailbox owner clicks <strong>Connect a mailbox</strong> above
              and signs in once.
            </li>
          </ol>
          <p className="text-xs text-slate-400">
            Keeping every domain inside one Google Workspace is what lets new
            mailboxes sign in without any extra setup.
          </p>
        </div>
      </details>
    </div>
  );
}

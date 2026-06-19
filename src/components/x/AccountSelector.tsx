"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Acct = { id: string; username: string | null };

/** URL-driven account filter (?xAccountId). Renders nothing when there's 0 or
 *  1 account (no switching needed). "All accounts" aggregates. */
export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("xAccountId") ?? "";
  const [accounts, setAccounts] = useState<Acct[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/x/accounts")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => {
        if (active) setAccounts(d.accounts ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function select(id: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    if (id) p.set("xAccountId", id);
    else p.delete("xAccountId");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  if (accounts.length <= 1) return null;

  return (
    <select
      value={current}
      onChange={(e) => select(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
    >
      <option value="">All accounts</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          @{a.username ?? a.id.slice(0, 6)}
        </option>
      ))}
    </select>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

// Triggers the full loop once (generate from trends, schedule, then dispatch)
// so the team can test without waiting for cron.
export function RunNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/x/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
      const gen = data.processed?.generated ?? 0;
      const posted = data.dispatched?.posted ?? 0;
      setMsg(`Generated ${gen}, posted ${posted}.`);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
        Run now
      </button>
    </div>
  );
}

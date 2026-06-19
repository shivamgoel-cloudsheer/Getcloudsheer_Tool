"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Wand2 } from "lucide-react";

const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 (cheapest)" },
  { id: "claude-opus-4-8", label: "Opus 4.8 (stronger)" },
  { id: "claude-fable-5", label: "Fable 5 (best voice)" },
];

type Acct = { id: string; username: string | null };

function NewProfileInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [xAccountId, setXAccountId] = useState(params.get("xAccountId") ?? "");
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [corpus, setCorpus] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [autonomous, setAutonomous] = useState(true);
  const [postsPerDay, setPostsPerDay] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/x/accounts")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => {
        if (!active) return;
        const list: Acct[] = d.accounts ?? [];
        setAccounts(list);
        if (!params.get("xAccountId") && list.length === 1) {
          setXAccountId(list[0].id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!xAccountId) {
      setError("Pick which X account this voice posts to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/x/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xAccountId,
          name,
          niche,
          corpus,
          model,
          autonomous,
          postsPerDay,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create voice");
      router.push(`/dashboard/x/profiles/${data.profile.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create voice");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/dashboard/x"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> X automation
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Create a voice</h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste 50-100 posts from the influencer you want to sound like. Claude
          analyzes the style once and reuses it for every post.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="X account this voice posts to">
          <select
            required
            value={xAccountId}
            onChange={(e) => setXAccountId(e.target.value)}
            className="input"
          >
            <option value="" disabled>
              Select an account...
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username ?? a.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Salesforce thought-leader voice"
            className="input"
          />
        </Field>

        <Field label="Niche / topic area">
          <input
            required
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. Salesforce, Agentforce, AI for enterprise CRM"
            className="input"
          />
          <p className="mt-1 text-xs text-slate-400">
            Used to pull trending topics each day.
          </p>
        </Field>

        <Field label="Example posts">
          <textarea
            required
            value={corpus}
            onChange={(e) => setCorpus(e.target.value)}
            rows={12}
            placeholder="Paste the influencer's posts here, one per line or separated by blank lines."
            className="input font-mono text-xs"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Model">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Posts per day">
            <input
              type="number"
              min={1}
              max={17}
              value={postsPerDay}
              onChange={(e) => setPostsPerDay(Number(e.target.value))}
              className="input"
            />
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <input
            type="checkbox"
            checked={autonomous}
            onChange={(e) => setAutonomous(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Post autonomously</span>
            <span className="block text-xs text-slate-500">
              When on, posts are generated and published on schedule with no
              review. Turn off to send drafts to the queue for approval first.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Analyzing style...
            </>
          ) : (
            <>
              <Wand2 size={15} /> Analyze &amp; create
            </>
          )}
        </button>
      </form>

      <style>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgb(203 213 225);
          background: white;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
          outline: none;
        }
        .input:focus {
          border-color: rgb(99 102 241);
          box-shadow: 0 0 0 2px rgb(99 102 241 / 0.3);
        }
      `}</style>
    </div>
  );
}

export default function NewProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
      <NewProfileInner />
    </Suspense>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

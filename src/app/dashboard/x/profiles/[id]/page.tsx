"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Sparkles, Trash2 } from "lucide-react";

type StyleProfile = {
  voice: string;
  sentenceStyle: string;
  emojiUse: string;
  hashtagUse: string;
  vocabulary: string[];
  avoid: string[];
};

type Profile = {
  id: string;
  name: string;
  niche: string;
  model: string;
  autonomous: boolean;
  postsPerDay: number;
  profile: StyleProfile | null;
};

export default function XProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/x/profiles/${id}`);
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/x/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setProfile(data.profile);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/x/profiles/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setMsg(`Created ${data.created} draft. Check the queue.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this voice? Posts already made are kept.")) return;
    await fetch(`/api/x/profiles/${id}`, { method: "DELETE" });
    router.push("/dashboard/x");
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-sm text-slate-500">Voice not found.</p>;
  }

  const sp = profile.profile;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/dashboard/x"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> X automation
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{profile.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{profile.niche}</p>
        </div>
        <button
          onClick={remove}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800">
            Post autonomously
            <span className="block text-xs font-normal text-slate-500">
              Generate and publish on schedule without review.
            </span>
          </span>
          <input
            type="checkbox"
            checked={profile.autonomous}
            disabled={busy}
            onChange={(e) => patch({ autonomous: e.target.checked })}
            className="h-5 w-5"
          />
        </label>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="text-sm font-medium text-slate-800">Posts per day</span>
          <input
            type="number"
            min={1}
            max={17}
            defaultValue={profile.postsPerDay}
            disabled={busy}
            onBlur={(e) => patch({ postsPerDay: Number(e.target.value) })}
            className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <button
            onClick={generate}
            disabled={busy || !sp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generate draft now
          </button>
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>
      </div>

      {sp && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Learned style</h2>
          <Row label="Voice" value={sp.voice} />
          <Row label="Sentences" value={sp.sentenceStyle} />
          <Row label="Emoji" value={sp.emojiUse} />
          <Row label="Hashtags" value={sp.hashtagUse} />
          {sp.vocabulary?.length > 0 && (
            <Row label="Vocabulary" value={sp.vocabulary.join(", ")} />
          )}
          {sp.avoid?.length > 0 && <Row label="Avoids" value={sp.avoid.join("; ")} />}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}

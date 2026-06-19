"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Trash2,
  Pencil,
  CalendarClock,
  X as XIcon,
  Check,
} from "lucide-react";
import { XStatusChip } from "@/components/x/status";
import { AccountSelector } from "@/components/x/AccountSelector";

type Post = {
  id: string;
  body: string;
  status: string;
  sourceTopic: string | null;
  scheduledFor: string | null;
  postedAt: string | null;
  tweetId: string | null;
  error: string | null;
  createdAt: string;
};

type StatusData = {
  counts: Record<string, number>;
  postedToday: number;
  dailyCap: number;
  posts: Post[];
};

function defaultSchedule(): string {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function PostsInner() {
  const params = useSearchParams();
  const xAccountId = params.get("xAccountId") ?? "";
  const [data, setData] = useState<StatusData | null>(null);

  const load = useCallback(async () => {
    const qs = xAccountId ? `?xAccountId=${xAccountId}` : "";
    const res = await fetch(`/api/x/posts/status${qs}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [xAccountId]);

  useEffect(() => {
    // load() only setStates after an awaited fetch; the 5s poll is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const counts = data?.counts ?? {};

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/x"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> X automation
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Post queue</h1>
        <div className="flex items-center gap-3">
          <AccountSelector />
          <div className="flex gap-2 text-xs text-slate-500">
            <Pill
              label="today"
              value={`${data?.postedToday ?? 0}/${data?.dailyCap ?? 17}`}
            />
            <Pill label="scheduled" value={counts.scheduled ?? 0} />
            <Pill label="drafts" value={counts.draft ?? 0} />
            <Pill label="posted" value={counts.posted ?? 0} />
            {counts.failed ? <Pill label="failed" value={counts.failed} /> : null}
          </div>
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : data.posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-600">
          Nothing here yet. Generate a draft from a voice, or let the daily job
          run.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {data.posts.map((p) => (
            <PostRow key={p.id} post={p} onChange={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function XPostsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
      <PostsInner />
    </Suspense>
  );
}

function PostRow({ post, onChange }: { post: Post; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [body, setBody] = useState(post.body);
  const [syncedBody, setSyncedBody] = useState(post.body);
  const [when, setWhen] = useState(defaultSchedule());
  const [busy, setBusy] = useState(false);

  // Keep the textarea in sync when the post changes underneath (poll refresh),
  // but not while editing. React-recommended: adjust state during render
  // rather than in an effect.
  if (!editing && post.body !== syncedBody) {
    setSyncedBody(post.body);
    setBody(post.body);
  }

  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/x/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEditing(false);
      setScheduling(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/x/posts/${post.id}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const canSchedule = post.status === "draft" || post.status === "approved";
  const overLimit = body.length > 280;

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-slate-800">
              {post.body}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <XStatusChip status={post.status} />
            {post.sourceTopic && <span>&middot; {post.sourceTopic}</span>}
            {post.status === "scheduled" && post.scheduledFor && (
              <span>&middot; for {new Date(post.scheduledFor).toLocaleString()}</span>
            )}
            {post.status === "posted" && post.postedAt && (
              <span>&middot; at {new Date(post.postedAt).toLocaleString()}</span>
            )}
            <span>&middot; {post.body.length} chars</span>
          </div>
          {post.error && <p className="mt-1.5 text-xs text-red-600">{post.error}</p>}
        </div>

        {post.status === "posted" && post.tweetId && (
          <a
            href={`https://x.com/i/web/status/${post.tweetId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
          >
            View <ExternalLink size={12} />
          </a>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <button
            disabled={busy || overLimit}
            onClick={() => action({ body })}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setBody(post.body);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          {overLimit && (
            <span className="text-xs text-red-600">Over 280 characters</span>
          )}
        </div>
      )}

      {scheduling && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <button
            disabled={busy}
            onClick={() =>
              action({
                action: "schedule",
                scheduledFor: new Date(when).toISOString(),
              })
            }
            className="inline-flex items-center gap-1 rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Check size={12} /> Confirm
          </button>
          <button
            onClick={() => setScheduling(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {!editing && !scheduling && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {canSchedule && (
            <Action
              onClick={() => setScheduling(true)}
              icon={<CalendarClock size={13} />}
              label="Schedule"
            />
          )}
          {(post.status === "draft" ||
            post.status === "approved" ||
            post.status === "failed") && (
            <Action
              onClick={() => setEditing(true)}
              icon={<Pencil size={13} />}
              label="Edit"
            />
          )}
          {post.status === "scheduled" && (
            <Action
              onClick={() => action({ action: "cancel" })}
              icon={<XIcon size={13} />}
              label="Cancel"
            />
          )}
          {post.status === "failed" && (
            <Action
              onClick={() => action({ action: "draft" })}
              icon={<Pencil size={13} />}
              label="Back to draft"
            />
          )}
          <Action
            onClick={remove}
            icon={<Trash2 size={13} />}
            label="Delete"
            danger
          />
        </div>
      )}
    </li>
  );
}

function Action({
  onClick,
  icon,
  label,
  danger = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-300 text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Pill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
      <span className="font-semibold text-slate-700">{value}</span> {label}
    </span>
  );
}

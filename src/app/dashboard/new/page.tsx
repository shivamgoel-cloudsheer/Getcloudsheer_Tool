"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  Loader2,
  PencilLine,
  Rocket,
} from "lucide-react";
import { renderTemplate } from "@/lib/template";

type Preview = {
  sheetId: string;
  headers: string[];
  emailColumn: string | null;
  totalRows: number;
  sampleRows: Record<string, string>[];
};

const STEPS = [
  { icon: FileSpreadsheet, label: "Connect sheet" },
  { icon: PencilLine, label: "Compose" },
  { icon: Rocket, label: "Review" },
];

const inputClass =
  "w-full rounded-xl border border-neutral-800 bg-neutral-950/60 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";

export default function NewCampaignPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [sheetUrl, setSheetUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRow = preview?.sampleRows[previewRowIndex];
  const renderedSubject = useMemo(
    () => (previewRow ? renderTemplate(subject, previewRow) : ""),
    [subject, previewRow]
  );
  const renderedBody = useMemo(
    () => (previewRow ? renderTemplate(body, previewRow) : ""),
    [body, previewRow]
  );

  async function loadSheet() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sheet");
      setPreview(data);
      setPreviewRowIndex(0);

      const headers: string[] = data.headers;
      const subjectCol = headers.find((h) =>
        h.toLowerCase().includes("subject")
      );
      const contentCol = headers.find(
        (h) =>
          h.toLowerCase().includes("content") ||
          h.toLowerCase().includes("body") ||
          h.toLowerCase().includes("message")
      );
      if (subjectCol && !subject) setSubject(`{{${subjectCol}}}`);
      if (contentCol && !body) setBody(`{{${contentCol}}}`);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Failed to load sheet");
    } finally {
      setLoading(false);
    }
  }

  async function createCampaign() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sheetUrl,
          subjectTemplate: subject,
          bodyTemplate: body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
      router.push(`/dashboard/campaigns/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create campaign");
      setCreating(false);
    }
  }

  const canCompose = !!preview?.emailColumn;
  const canReview = !!(name.trim() && subject.trim() && body.trim());

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition hover:text-neutral-300"
      >
        <ArrowLeft size={13} />
        Back to campaigns
      </Link>

      <h1 className="mt-3 text-xl font-semibold">New campaign</h1>

      {/* Stepper */}
      <div className="mt-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-center gap-2">
            <button
              onClick={() => {
                if (i === 0 || (i === 1 && canCompose) || (i === 2 && canCompose && canReview)) {
                  setStep(i);
                }
              }}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                step === i
                  ? "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/40"
                  : step > i
                    ? "text-emerald-400"
                    : "text-neutral-500"
              }`}
            >
              {step > i ? <Check size={13} /> : <s.icon size={13} />}
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 ${step > i ? "bg-emerald-500/40" : "bg-neutral-800"}`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Step 1: connect sheet */}
      {step === 0 && (
        <section className="mt-5 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-6">
          <h2 className="font-medium">Connect your Google Sheet</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Row 1 must be headers. An Email column is required; every other
            column becomes a placeholder.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              className={inputClass}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sheetUrl.trim() && loadSheet()}
            />
            <button
              onClick={loadSheet}
              disabled={loading || !sheetUrl.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? "Loading" : preview ? "Reload" : "Load sheet"}
            </button>
          </div>

          {preview && (
            <div className="mt-5">
              <div className="flex items-center gap-2 text-sm">
                <Check size={15} className="text-emerald-400" />
                <span className="text-neutral-300">
                  {preview.totalRows} rows loaded
                </span>
                {preview.emailColumn ? (
                  <span className="text-neutral-500">
                    · email column{" "}
                    <span className="font-medium text-emerald-400">
                      {preview.emailColumn}
                    </span>
                  </span>
                ) : (
                  <span className="text-red-400">
                    · no email column found - add one named Email
                  </span>
                )}
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-900 text-neutral-400">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="px-3 py-2.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-neutral-800/70">
                        {preview.headers.map((h) => (
                          <td
                            key={h}
                            className="max-w-50 truncate px-3 py-2 text-neutral-300"
                          >
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setStep(1)}
                  disabled={!canCompose}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40"
                >
                  Compose
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Step 2: compose */}
      {step === 1 && preview && (
        <section className="mt-5 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-6">
          <h2 className="font-medium">Compose your email</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Campaign name (only you see this)
              </label>
              <input
                className={inputClass}
                placeholder="June partner outreach"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Subject
              </label>
              <input
                className={inputClass}
                placeholder="Quick question, {{Name}}"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Body
              </label>
              <textarea
                className={`${inputClass} min-h-48 font-mono text-[13px] leading-relaxed`}
                placeholder={"Hi {{Name}},\n\n..."}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-neutral-600">Insert:</span>
                {preview.headers.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setBody((prev) => `${prev}{{${h}}}`)}
                    className="rounded-md border border-neutral-800 bg-neutral-950/60 px-2 py-1 font-mono text-[11px] text-neutral-400 transition hover:border-sky-500/50 hover:text-sky-300"
                  >
                    {`{{${h}}}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-600">
                An unsubscribe link is appended to every email automatically.
              </p>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStep(0)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!canReview}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40"
            >
              Review
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}

      {/* Step 3: review */}
      {step === 2 && preview && previewRow && (
        <section className="mt-5">
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">Preview</h2>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                Previewing row
                <select
                  value={previewRowIndex}
                  onChange={(e) => setPreviewRowIndex(Number(e.target.value))}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 outline-none"
                >
                  {preview.sampleRows.map((row, i) => (
                    <option key={i} value={i}>
                      {i + 1}: {row[preview.emailColumn ?? ""] ?? ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Email client mock */}
            <div className="mt-4 overflow-hidden rounded-xl border border-neutral-800 bg-white text-neutral-900 shadow-2xl">
              <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3.5">
                <p className="text-sm font-semibold">
                  {renderedSubject || "(no subject)"}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  to {previewRow[preview.emailColumn ?? ""] ?? ""}
                </p>
              </div>
              <div className="whitespace-pre-wrap px-5 py-5 text-sm leading-relaxed">
                {renderedBody || "(empty body)"}
              </div>
              <div className="border-t border-neutral-100 px-5 py-3 text-xs text-neutral-400">
                If you&apos;d prefer not to receive these emails, you can{" "}
                <span className="underline">unsubscribe here</span>.
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-sm text-neutral-400">
              This will create a draft for{" "}
              <span className="font-semibold text-neutral-200">
                {preview.totalRows} recipients
              </span>
              . Nothing sends until you press Send on the next screen.
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <button
              onClick={createCampaign}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:opacity-40"
            >
              {creating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Rocket size={15} />
              )}
              {creating ? "Creating draft..." : "Create draft"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

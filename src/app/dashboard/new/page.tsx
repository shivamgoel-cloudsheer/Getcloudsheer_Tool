"use client";

import { useEffect, useMemo, useState } from "react";
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
import { lintContent } from "@/lib/linter";

type Preview = {
  sheetId: string;
  tabs: string[];
  selectedTab: string | null;
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

const COMPANY = "CloudSheer Consulting";

const SENDERS = [
  {
    name: "Shubham",
    email: "shubham@cloudsheer.com",
    signature: `Regards,\nShubham\n${COMPANY}`,
  },
  {
    name: "Bharat",
    email: "bharat@cloudsheer.com",
    signature: `Regards,\nBharat\n${COMPANY}`,
  },
  {
    name: "Tushar",
    email: "tushar@cloudsheer.com",
    signature: `Regards,\nTushar\n${COMPANY}`,
  },
];

const defaultSignature = (name: string) =>
  name ? `Regards,\n${name}\n${COMPANY}` : `Regards,\n${COMPANY}`;

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const inputClass =
  "w-full rounded-xl border border-neutral-800 bg-neutral-950/60 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";

export default function NewCampaignPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [sheetUrl, setSheetUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheetTab, setSheetTab] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [abEnabled, setAbEnabled] = useState(false);
  const [subjectB, setSubjectB] = useState("");
  const [bodyB, setBodyB] = useState("");
  const [fromName, setFromName] = useState("Shubham");
  const [fromEmail, setFromEmail] = useState("shubham@cloudsheer.com");
  const [customSender, setCustomSender] = useState(false);
  const [signature, setSignature] = useState(SENDERS[0].signature);
  const [sigTouched, setSigTouched] = useState(false);
  // email -> can this mailbox send via Gmail right now?
  const [senderStatus, setSenderStatus] = useState<Map<
    string,
    { linked: boolean; sendReady: boolean }
  > | null>(null);

  useEffect(() => {
    fetch("/api/senders/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json?.senders) return;
        setSenderStatus(
          new Map(
            (json.senders as {
              email: string;
              linked: boolean;
              sendReady: boolean;
            }[]).map((s) => [s.email, s])
          )
        );
      })
      .catch(() => {});
  }, []);
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
  const lintWarnings = useMemo(
    () => lintContent({ subject, body }).map((w) => w.message),
    [subject, body]
  );

  async function loadSheet(tab?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl, ...(tab ? { sheetTab: tab } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sheet");
      setPreview(data);
      setSheetTab(data.selectedTab ?? null);
      setSelectedColumns(data.headers); // default: keep all columns
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
          ...(abEnabled && subjectB.trim()
            ? { subjectTemplateB: subjectB }
            : {}),
          ...(abEnabled && bodyB.trim() ? { bodyTemplateB: bodyB } : {}),
          ...(fromEmail.trim()
            ? { fromEmail: fromEmail.trim(), fromName: fromName.trim() }
            : {}),
          ...(signature.trim() ? { signature: signature.trim() } : {}),
          ...(sheetTab ? { sheetTab } : {}),
          selectedColumns,
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
  const canReview = !!(
    name.trim() &&
    subject.trim() &&
    body.trim() &&
    (!customSender || isEmail(fromEmail))
  );

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
              onClick={() => loadSheet()}
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

              {preview.tabs.length > 1 && (
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                    Worksheet
                  </label>
                  <select
                    className={inputClass}
                    value={sheetTab ?? ""}
                    disabled={loading}
                    onChange={(e) => loadSheet(e.target.value)}
                  >
                    {preview.tabs.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-neutral-400">
                    Columns to include ({selectedColumns.length}/
                    {preview.headers.length})
                  </label>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedColumns(preview.headers)}
                      className="text-sky-400 transition hover:text-sky-300"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedColumns(
                          preview.emailColumn ? [preview.emailColumn] : []
                        )
                      }
                      className="text-neutral-500 transition hover:text-neutral-300"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.headers.map((h) => {
                    const locked = h === preview.emailColumn;
                    const on = locked || selectedColumns.includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={locked}
                        title={
                          locked ? "Email column is always included" : undefined
                        }
                        onClick={() =>
                          setSelectedColumns((prev) =>
                            prev.includes(h)
                              ? prev.filter((c) => c !== h)
                              : [...prev, h]
                          )
                        }
                        className={`rounded-md border px-2 py-1 text-[11px] transition ${
                          on
                            ? "border-sky-500/50 bg-sky-500/10 text-sky-300"
                            : "border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300"
                        } ${locked ? "cursor-not-allowed opacity-80" : ""}`}
                      >
                        {h}
                        {locked ? " (required)" : ""}
                      </button>
                    );
                  })}
                </div>
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
                From
              </label>
              <select
                className={inputClass}
                value={customSender ? "custom" : fromEmail}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setCustomSender(true);
                    if (!sigTouched) setSignature(defaultSignature(fromName));
                    return;
                  }
                  setCustomSender(false);
                  const match = SENDERS.find((s) => s.email === e.target.value);
                  if (match) {
                    setFromEmail(match.email);
                    setFromName(match.name);
                    if (!sigTouched) setSignature(match.signature);
                  }
                }}
              >
                {SENDERS.map((s) => {
                  const st = senderStatus?.get(s.email);
                  const blocked = st ? !st.sendReady : false;
                  return (
                    <option key={s.email} value={s.email} disabled={blocked}>
                      {s.name} &lt;{s.email}&gt;
                      {st && !st.linked
                        ? " — not connected"
                        : st && !st.sendReady
                          ? " — needs Google re-connect"
                          : ""}
                    </option>
                  );
                })}
                <option value="custom">Custom address…</option>
              </select>
              {(() => {
                const st = senderStatus?.get(fromEmail);
                if (customSender || !st || st.sendReady) return null;
                return (
                  <p className="mt-1.5 text-xs text-amber-400/90">
                    {st.linked
                      ? `${fromEmail} needs to re-connect Google to grant send permission (sign out and back in once).`
                      : `${fromEmail} hasn't signed in to the dashboard yet — emails send through each person's own Gmail.`}
                  </p>
                );
              })()}
            </div>

            {customSender && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                    From name
                  </label>
                  <input
                    className={inputClass}
                    placeholder="Alex Rivera"
                    value={fromName}
                    onChange={(e) => {
                      setFromName(e.target.value);
                      if (!sigTouched)
                        setSignature(defaultSignature(e.target.value));
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                    From email
                  </label>
                  <input
                    className={inputClass}
                    placeholder="alex@yourdomain.com"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                  {fromEmail.trim() && !isEmail(fromEmail) && (
                    <p className="mt-1 text-xs text-red-400">
                      Enter a valid email address.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-neutral-600">
                    Emails send through this mailbox&apos;s own Gmail, so its
                    owner must have signed in to the dashboard with Google
                    once.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Signature
              </label>
              <textarea
                className={`${inputClass} min-h-20 whitespace-pre-wrap`}
                placeholder={"Regards,\nName\nCloudSheer Consulting"}
                value={signature}
                onChange={(e) => {
                  setSignature(e.target.value);
                  setSigTouched(true);
                }}
              />
              <p className="mt-1 text-xs text-neutral-600">
                Added automatically to every email (including follow-ups), above
                the footer. Leave blank for no signature.
              </p>
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
                {selectedColumns.map((h) => (
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
                Emails send as plain text - just your body and signature, no
                footer.
              </p>
            </div>

            {/* A/B testing */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={abEnabled}
                  onChange={(e) => setAbEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-sky-500"
                />
                <span className="text-sm font-medium text-neutral-200">
                  A/B test
                </span>
                <span className="text-xs text-neutral-500">
                  Half your recipients get variant B; compare results per
                  variant
                </span>
              </label>
              {abEnabled && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                      Subject B
                    </label>
                    <input
                      className={inputClass}
                      placeholder="Alternative subject line"
                      value={subjectB}
                      onChange={(e) => setSubjectB(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                      Body B (optional - leave empty to reuse body A)
                    </label>
                    <textarea
                      className={`${inputClass} min-h-28 font-mono text-[13px] leading-relaxed`}
                      placeholder="Alternative body"
                      value={bodyB}
                      onChange={(e) => setBodyB(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          {lintWarnings.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-xs font-semibold text-amber-300">
                Deliverability check
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-200/90">
                {lintWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-300/70">
                These are warnings, not blockers - you can still continue.
              </p>
            </div>
          )}

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
                  from {fromName ? `${fromName} ` : ""}&lt;
                  {fromEmail || "default sender"}&gt; · to{" "}
                  {previewRow[preview.emailColumn ?? ""] ?? ""}
                </p>
              </div>
              <div className="whitespace-pre-wrap px-5 py-5 text-sm leading-relaxed">
                {renderedBody || "(empty body)"}
                {signature.trim() && (
                  <div className="mt-4 text-neutral-700">{signature}</div>
                )}
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

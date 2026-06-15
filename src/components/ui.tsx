import { Send } from "lucide-react";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : "h-8 w-8 rounded-xl";
  const icon = size === "lg" ? 22 : 15;
  return (
    <span
      className={`flex ${box} items-center justify-center bg-linear-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25`}
    >
      <Send size={icon} strokeWidth={2.25} className="-translate-x-px translate-y-px" />
    </span>
  );
}

export const STATUS_CHIP: Record<string, string> = {
  // campaign statuses
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  sending: "bg-amber-50 text-amber-700 ring-amber-200",
  scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  // recipient statuses
  pending: "bg-slate-100 text-slate-600 ring-slate-200",
  suppressed: "bg-slate-100 text-slate-400 ring-slate-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  opened: "bg-violet-50 text-violet-700 ring-violet-200",
  clicked: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  replied: "bg-teal-50 text-teal-700 ring-teal-200",
  bounced: "bg-red-50 text-red-700 ring-red-200",
  complained: "bg-red-50 text-red-700 ring-red-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_CHIP[status] ?? STATUS_CHIP.pending
      }`}
    >
      {status}
    </span>
  );
}

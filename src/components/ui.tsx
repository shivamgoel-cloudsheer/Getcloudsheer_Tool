import { Send } from "lucide-react";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : "h-8 w-8 rounded-xl";
  const icon = size === "lg" ? 22 : 15;
  return (
    <span
      className={`flex ${box} items-center justify-center bg-linear-to-br from-sky-400 to-indigo-600 text-white shadow-lg shadow-sky-500/20`}
    >
      <Send size={icon} strokeWidth={2.25} className="-translate-x-px translate-y-px" />
    </span>
  );
}

export const STATUS_CHIP: Record<string, string> = {
  // campaign statuses
  draft: "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30",
  sending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  scheduled: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  // recipient statuses
  pending: "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30",
  suppressed: "bg-neutral-500/15 text-neutral-500 ring-neutral-500/30",
  delivered: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  opened: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  clicked: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  bounced: "bg-red-500/15 text-red-300 ring-red-500/30",
  complained: "bg-red-500/15 text-red-300 ring-red-500/30",
  failed: "bg-red-500/15 text-red-300 ring-red-500/30",
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

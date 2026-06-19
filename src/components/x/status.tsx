export const X_STATUS_CHIP: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  approved: "bg-sky-50 text-sky-700 ring-sky-200",
  scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  posting: "bg-violet-50 text-violet-700 ring-violet-200",
  posted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  cancelled: "bg-slate-100 text-slate-400 ring-slate-200",
};

export function XStatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        X_STATUS_CHIP[status] ?? X_STATUS_CHIP.draft
      }`}
    >
      {status}
    </span>
  );
}

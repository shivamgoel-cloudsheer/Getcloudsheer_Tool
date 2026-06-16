import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { GATE_COOKIE, gateToken } from "@/lib/gate";
import { Logo } from "@/components/ui";

async function unlock(formData: FormData) {
  "use server";

  const password = formData.get("password");
  if (
    typeof password !== "string" ||
    !process.env.ACCESS_PASSWORD ||
    password !== process.env.ACCESS_PASSWORD
  ) {
    redirect("/gate?error=1");
  }

  (await cookies()).set(GATE_COOKIE, gateToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  redirect("/");
}

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-slate-900">
          Outreach
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          This tool is for the Cloudsheer team. Enter the access password.
        </p>

        <form action={unlock} className="mt-6 space-y-3">
          <input
            type="password"
            name="password"
            autoFocus
            placeholder="Access password"
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-center text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
          {error && (
            <p className="text-xs text-red-600">
              Wrong password. Try again.
            </p>
          )}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-br from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"
          >
            <Lock size={14} />
            Unlock
          </button>
        </form>
      </div>
    </main>
  );
}

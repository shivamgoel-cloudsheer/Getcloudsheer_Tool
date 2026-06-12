import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { LogOut, AlertTriangle } from "lucide-react";
import { auth, signIn, signOut } from "@/auth";
import { Logo } from "@/components/ui";
import { getSenderAccount, hasSendScope } from "@/lib/google";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  // Sending goes through each sender's own Gmail; warn when the signed-in
  // user's stored grant predates the gmail.send scope.
  const ownAccount = session.user.email
    ? await getSenderAccount(session.user.email)
    : null;
  const needsRelink = !!ownAccount && !hasSendScope(ownAccount.scope);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-sm font-semibold tracking-wide">
              CloudSheer <span className="text-sky-400">Outreach</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-full ring-1 ring-neutral-700"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-300">
                  {(session.user.name ?? session.user.email ?? "?")
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
              <span className="text-xs text-neutral-400">
                {session.user.email}
              </span>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                title="Sign out"
                className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {needsRelink && (
        <div className="border-b border-amber-900/50 bg-amber-950/40">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-2.5">
            <p className="flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle size={14} className="shrink-0" />
              Sending now goes through your own Gmail. Re-connect Google to
              grant send access.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="whitespace-nowrap rounded-lg border border-amber-700/60 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-900/40"
              >
                Re-connect Google
              </button>
            </form>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

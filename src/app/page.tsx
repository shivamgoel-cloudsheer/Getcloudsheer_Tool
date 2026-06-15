import { redirect } from "next/navigation";
import { CalendarClock, FileSpreadsheet, Inbox, MessageSquareReply } from "lucide-react";
import { auth, signIn } from "@/auth";
import { Logo } from "@/components/ui";

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Sheet-native",
    text: "Your Google Sheet is the source of truth. No CSV exports, no imports - pick a tab and columns and go.",
  },
  {
    icon: Inbox,
    title: "Sent from your inbox",
    text: "Emails go out through your own Gmail, so they read as personal and land in the inbox - not a promo tab.",
  },
  {
    icon: CalendarClock,
    title: "Smart scheduling",
    text: "Drip-send in business hours, in each recipient's own timezone, with daily limits and warm-up built in.",
  },
  {
    icon: MessageSquareReply,
    title: "Reply-focused",
    text: "Track replies and bounces, run multi-step follow-ups, and auto-stop the moment someone responds.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-50 px-6 py-16">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-130 w-225 -translate-x-1/2 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-60 left-1/4 h-100 w-150 rounded-full bg-indigo-200/40 blur-3xl" />

      <div className="relative w-full max-w-3xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            CloudSheer Outreach
          </p>
          <h1 className="mt-3 max-w-xl text-balance text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
            Your Google Sheet, turned into a personalized campaign
          </h1>
          <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-slate-600">
            Sign in, point at a sheet, personalize with placeholders, and send
            from your own inbox - scheduled to each recipient&apos;s timezone,
            with replies and follow-ups handled for you.
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
                />
                <path
                  fill="#FF3D00"
                  d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
                />
              </svg>
              Continue with Google
            </button>
          </form>
          <p className="mt-4 text-xs text-slate-500">
            Includes read-only access to your Google Sheets and permission to
            send from your Gmail.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <f.icon size={18} className="text-indigo-600" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                {f.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

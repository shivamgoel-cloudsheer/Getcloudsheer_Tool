import { auth } from "@/auth";
import { SENDERS } from "@/lib/senders";
import { getSenderAccount, hasSendScope } from "@/lib/google";

// Link status for each configured sender mailbox, so the campaign form can
// disable senders that can't send yet.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const senders = await Promise.all(
    SENDERS.map(async (s) => {
      const account = await getSenderAccount(s.email);
      return {
        name: s.name,
        email: s.email,
        linked: !!account,
        sendReady: !!account && hasSendScope(account.scope),
      };
    })
  );

  return Response.json({ senders });
}

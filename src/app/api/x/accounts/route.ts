import { listXAccounts } from "@/lib/x/auth";
import { requireUser } from "@/lib/x/guard";

export async function GET() {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const accounts = await listXAccounts();
  return Response.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      username: a.xUsername,
      createdAt: a.createdAt,
    })),
  });
}

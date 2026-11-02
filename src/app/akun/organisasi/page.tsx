import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamManager } from "@/components/organisation/TeamManager";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrganisationCampaigns, listTeam, OrganisationTeamNotFoundError } from "@/lib/organisation-team";

export const dynamic = "force-dynamic";

/**
 * The organisation's Campaigns dashboard (ticket E4), read-only, for its
 * primary Fundraiser and its team members; the primary Fundraiser also manages
 * the team here. No amounts, balances, Payouts or Bank Accounts are shown to
 * anyone on this page. Everyone else, signed in or not, gets the 404 page.
 */
export default async function OrganisasiPage() {
  const session = await getServerSession();
  const userId = session?.user?.id;
  let dashboard;
  try {
    dashboard = await listOrganisationCampaigns(prisma, userId);
  } catch (error) {
    if (error instanceof OrganisationTeamNotFoundError) notFound();
    throw error;
  }
  const team = dashboard.access === "OWNER" ? await listTeam(prisma, userId) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold">{dashboard.organisationName}</h1>
      <p className="text-sm text-gray-600">
        {dashboard.access === "OWNER"
          ? "Akun Fundraiser utama organisasi."
          : "Anggota tim: Anda dapat melihat Campaign organisasi. Payout dan rekening bank hanya dikelola akun Fundraiser utama."}
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Campaign organisasi</h2>
        {dashboard.campaigns.length === 0 && <p className="text-sm">Belum ada Campaign.</p>}
        <ul className="space-y-2">
          {dashboard.campaigns.map((campaign) => (
            <li key={campaign.id} data-testid="organisation-campaign" className="rounded border p-3 text-sm">
              <p className="font-medium">{campaign.title}</p>
              <p className="text-xs text-gray-600">
                {campaign.kind} · {campaign.lifecycleStatus}
                {campaign.deadline && ` · sampai ${campaign.deadline.toISOString().slice(0, 10)}`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {team && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tim</h2>
          <TeamManager
            members={team.members.map((m) => ({ id: m.id, name: m.name, email: m.email, since: m.since.toISOString() }))}
            invitations={team.invitations.map((i) => ({
              id: i.id,
              email: i.email,
              status: i.status,
              expiresAt: i.expiresAt.toISOString(),
            }))}
          />
        </section>
      )}

      <Link href="/akun" className="text-sm underline">
        Kembali ke akun
      </Link>
    </div>
  );
}

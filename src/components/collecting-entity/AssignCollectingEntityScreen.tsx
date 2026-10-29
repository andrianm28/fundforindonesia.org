import { prisma } from "@/lib/prisma";
import { listableCampaignWhere } from "@/lib/subject-guard";
import { AssignCollectingEntityForm, type AssignableCampaign } from "./AssignCollectingEntityForm";

/**
 * The dedicated screen where an Admin or Verifier names the Collecting
 * Entity of an Active Campaign that has none, so it can take Donations
 * again (prd-compliance 10). Mounted under /admin and /moderasi, each behind
 * its own assignment. Each Campaign is offered only the organisations its
 * Fundraiser may collect under: their own organisation when their account
 * acts for one, else those accepting individual Campaigns.
 */
export async function AssignCollectingEntityScreen() {
  // includeDemo: this screen is behind an assignment, and an Admin or
  // Verifier works on every Campaign, not only the ones the public may
  // see (CONTEXT.md, Demo Campaign; prd-compliance 26). Whether a real
  // Campaign is Active changes nothing here.
  const listable = await listableCampaignWhere(prisma, new Date(), { includeDemo: true });
  const [campaigns, organisations] = await Promise.all([
    prisma.campaign.findMany({
      where: { ...listable, collectingEntityId: null },
      select: { slug: true, title: true, creatorId: true, creator: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.partnerOrganisation.findMany({
      select: { id: true, name: true, fundraiserId: true, acceptsIndividualCampaigns: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const assignable: AssignableCampaign[] = campaigns.map((campaign) => {
    const own = organisations.find((o) => o.fundraiserId === campaign.creatorId);
    const options = own ? [own] : organisations.filter((o) => o.acceptsIndividualCampaigns);
    return {
      slug: campaign.slug,
      title: campaign.title,
      fundraiserName: campaign.creator.name,
      options: options.map((o) => ({ id: o.id, name: o.name })),
    };
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">Collecting Entity</h1>
      <p className="text-sm text-[#424242]">
        Campaign Aktif berikut belum menyebutkan Collecting Entity, sehingga tidak menerima donasi sampai
        Collecting Entity ditetapkan dan Partner Organisation itu memegang Fundraising Permit yang berlaku.
      </p>
      {assignable.length === 0 ? (
        <p className="text-sm text-text-secondary">Semua Campaign Aktif sudah memiliki Collecting Entity.</p>
      ) : (
        assignable.map((campaign) => <AssignCollectingEntityForm key={campaign.slug} campaign={campaign} />)
      )}
    </div>
  );
}

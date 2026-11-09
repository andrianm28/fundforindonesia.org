import type { Kind, Prisma } from "@/generated/prisma/client";
import { listableCampaignWhere } from "./subject-guard";

/**
 * The public profile of a Partner Organisation (PKS Pasal 12(5); CONTEXT.md,
 * Partner Organisation, Fundraising Permit): its name, the Fundraising Permits
 * it has recorded with their status at `now`, and the Campaigns it collects
 * for that are listed to the public. Nothing else leaves this module: the
 * query selects these columns only, so no document, contact, Fundraiser
 * account or bank detail is ever read.
 *
 * Permits are shown exactly as stored. A lapsed or not-yet-valid permit is
 * labelled, never hidden or dressed up.
 */

type Db = Pick<Prisma.TransactionClient, "partnerOrganisation" | "campaign">;

export type PermitState = "valid" | "expired" | "not_yet_valid";

/**
 * - valid: at least one permit is valid now;
 * - none_valid: permits are on record but none is valid now;
 * - none: no permit is on record.
 */
export type OrganisationPermitStatus = "valid" | "none_valid" | "none";

export type PublicPermit = {
  id: string;
  number: string;
  issuer: string;
  kinds: Kind[];
  validFrom: Date;
  validTo: Date;
  status: PermitState;
};

export type OrganisationProfile = {
  id: string;
  name: string;
  permitStatus: OrganisationPermitStatus;
  permits: PublicPermit[];
  campaigns: { slug: string; title: string }[];
};

function permitState(validFrom: Date, validTo: Date, now: Date): PermitState {
  if (now.getTime() < validFrom.getTime()) return "not_yet_valid";
  if (now.getTime() > validTo.getTime()) return "expired";
  return "valid";
}

const STATE_ORDER: Record<PermitState, number> = { valid: 0, not_yet_valid: 1, expired: 2 };

export async function getOrganisationProfile(
  db: Db,
  id: string,
  now: Date
): Promise<OrganisationProfile | null> {
  const organisation = await db.partnerOrganisation.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      permits: {
        select: { id: true, number: true, issuer: true, kinds: true, validFrom: true, validTo: true },
      },
    },
  });
  if (!organisation) return null;

  const permits: PublicPermit[] = organisation.permits
    .map((p) => ({
      id: p.id,
      number: p.number,
      issuer: p.issuer,
      kinds: p.kinds,
      validFrom: p.validFrom,
      validTo: p.validTo,
      status: permitState(p.validFrom, p.validTo, now),
    }))
    .sort((a, b) => STATE_ORDER[a.status] - STATE_ORDER[b.status] || b.validTo.getTime() - a.validTo.getTime());

  const permitStatus: OrganisationPermitStatus =
    permits.length === 0 ? "none" : permits.some((p) => p.status === "valid") ? "valid" : "none_valid";

  const campaigns = await db.campaign.findMany({
    where: { AND: [{ collectingEntityId: organisation.id }, await listableCampaignWhere(db, now)] },
    select: { slug: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  return {
    id: organisation.id,
    name: organisation.name,
    permitStatus,
    permits,
    campaigns: campaigns.map((c) => ({ slug: c.slug, title: c.title })),
  };
}

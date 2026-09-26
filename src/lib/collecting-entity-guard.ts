import type { Kind, Prisma } from "@/generated/prisma/client";
import {
  CollectingEntityNotEligibleError,
  CollectingEntityRequiredError,
  FundraisingPermitRequiredError,
} from "./campaign-lifecycle-errors";
import { holdsValidPermit } from "./collecting-entity";

/**
 * Which Partner Organisation may be a Campaign's Collecting Entity, and
 * whether it may open (CONTEXT.md, Collecting Entity, Fundraising Permit;
 * ADR 0010). Server-side: it reads Partner Organisations in the caller's
 * transaction or client.
 *
 * - A Campaign created by an organisation's linked Fundraiser account always
 *   collects under that organisation.
 * - An individual Fundraiser picks one that accepts individual Campaigns;
 *   the Verifier confirms it by approving the Verification Request.
 * - Only a Partner Organisation can be named, so the Platform Operator,
 *   which is not one, never collects.
 */

type Db = Pick<Prisma.TransactionClient, "partnerOrganisation">;

type Organisation = { id: string; name: string; fundraiserId: string; acceptsIndividualCampaigns: boolean };

/** The Partner Organisation this user's account acts for, if any. */
export async function organisationOf(db: Db, userId: string): Promise<Organisation | null> {
  return db.partnerOrganisation.findUnique({ where: { fundraiserId: userId } });
}

function requireEligible(entity: Organisation, own: Organisation | null): void {
  if (own && entity.id !== own.id) {
    throw new CollectingEntityNotEligibleError(
      `Campaign dari akun ${own.name} selalu dihimpun atas nama ${own.name}.`
    );
  }
  if (!own && !entity.acceptsIndividualCampaigns) {
    throw new CollectingEntityNotEligibleError(
      `${entity.name} tidak menaungi Campaign Fundraiser perorangan. Pilih Partner Organisation lain.`
    );
  }
}

/**
 * The Collecting Entity a Campaign of `creatorId` gets when it is created or
 * edited with `requested` (an id, null to clear, or undefined for no choice):
 * the creator's own organisation whenever they act for one, else the
 * requested one once it is found eligible. Returns undefined when nothing is
 * requested and the creator acts for no organisation, so the caller leaves
 * the column as it is.
 */
export async function resolveCollectingEntity(
  db: Db,
  creatorId: string,
  requested: string | null | undefined
): Promise<string | null | undefined> {
  const own = await organisationOf(db, creatorId);
  if (own) {
    if (requested && requested !== own.id) requireEligible({ ...own, id: requested }, own);
    return own.id;
  }
  if (requested === undefined || requested === null) return requested;
  const entity = await db.partnerOrganisation.findUnique({ where: { id: requested } });
  if (!entity) throw new CollectingEntityNotEligibleError("Partner Organisation tidak ditemukan.");
  requireEligible(entity, own);
  return entity.id;
}

/**
 * Refuses a Campaign that may not open: no Collecting Entity, one it may not
 * have, or one holding no Fundraising Permit valid at `now` for its Kind.
 * Returns the entity. `action` words the permit refusal for submission or
 * approval.
 */
export async function requireOpenable(
  db: Db,
  campaign: { creatorId: string; kind: Kind; collectingEntityId: string | null },
  now: Date,
  action: "diajukan" | "diloloskan"
): Promise<Organisation> {
  if (!campaign.collectingEntityId) throw new CollectingEntityRequiredError();
  const entity = await db.partnerOrganisation.findUnique({
    where: { id: campaign.collectingEntityId },
    include: { permits: true },
  });
  if (!entity) throw new CollectingEntityRequiredError();
  requireEligible(entity, await organisationOf(db, campaign.creatorId));
  if (!holdsValidPermit(entity, campaign.kind, now)) {
    throw new FundraisingPermitRequiredError(entity.name, campaign.kind, action);
  }
  return entity;
}

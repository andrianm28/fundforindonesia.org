import type { PrismaClient } from "@/generated/prisma/client";
import { resolveOperations, zakatSwitchedOn } from "@/lib/operations";
import { COLLECTING_ENTITY_SELECT } from "@/lib/collecting-entity";
import { campaignAcceptsDonations } from "@/lib/campaign-lifecycle";

/**
 * The zakat module's gate (PKS pemenuhan 19, ADR 0028). Zakat adds no money
 * path: a zakat checkout is a Donation on a Campaign of Kind ZAKAT, through
 * POST /api/donations and its retry. This file holds the rule both apply, and
 * what the public zakat page needs to find the Campaign to pay into.
 */

type Db = Pick<PrismaClient, "siteSetting">;

export const ZAKAT_NOT_FOUND_MESSAGE = "Campaign tidak ditemukan";
export const ZAKAT_WRONG_RECIPIENT_MESSAGE =
  "Zakat hanya diterima melalui lembaga penerima zakat yang ditetapkan. Campaign ini tidak bisa menerimanya.";

export type ZakatRefusal = { status: 404 | 403; error: string };

/**
 * Why a Donation on `campaign` must be refused for zakat reasons, or null.
 * Only a Campaign of Kind ZAKAT is judged (null for every other Kind, with no
 * read). While the module is OFF a zakat Campaign answers exactly as one that
 * does not exist (404): the module's presence is not revealed. Once ON, the
 * Campaign must collect under the Admin-configured recipient. An unreadable
 * setting refuses like OFF (the default is off).
 */
export async function zakatCheckoutRefusal(
  db: Db,
  campaign: { kind: string; collectingEntity: { id: string } | null },
): Promise<ZakatRefusal | null> {
  if (campaign.kind !== "ZAKAT") return null;
  let zakat;
  try {
    zakat = (await resolveOperations(db)).zakat;
  } catch {
    return { status: 404, error: ZAKAT_NOT_FOUND_MESSAGE };
  }
  if (!zakat.enabled) return { status: 404, error: ZAKAT_NOT_FOUND_MESSAGE };
  if (zakat.recipientOrganisationId === null || campaign.collectingEntity?.id !== zakat.recipientOrganisationId) {
    return { status: 403, error: ZAKAT_WRONG_RECIPIENT_MESSAGE };
  }
  return null;
}

/**
 * Whether a Campaign of this Kind must be hidden from the public right now:
 * only a zakat Campaign, and only while the module is off (fail closed). The
 * public Campaign page, its detail API and the donate page answer it with the
 * same 404 as a Campaign that does not exist.
 */
export async function zakatCampaignHidden(db: Db, kind: string): Promise<boolean> {
  if (kind !== "ZAKAT") return false;
  return !(await zakatSwitchedOn(db));
}

type CheckoutDb =Db & Pick<PrismaClient, "campaign" | "partnerOrganisation">;

export type ZakatCheckout = {
  nisabAmount: number;
  recipientName: string;
  /** The Campaign a zakat payment is made to, or null when none can collect right now. */
  campaign: { slug: string; title: string } | null;
};

/**
 * What the public zakat page needs, or null while the module is off or its
 * setting cannot be read. The Campaign is the newest ACTIVE zakat Campaign of
 * the configured recipient whose permit and Kind Authorisation hold now: the
 * same judgement the donation route applies at checkout, so the page never
 * offers a button the route would refuse.
 */
export async function resolveZakatCheckout(db: CheckoutDb, now: Date): Promise<ZakatCheckout | null> {
  let zakat;
  try {
    zakat = (await resolveOperations(db)).zakat;
  } catch {
    return null;
  }
  if (!zakat.enabled || zakat.recipientOrganisationId === null) return null;

  const candidates = await db.campaign.findMany({
    where: {
      kind: "ZAKAT",
      collectingEntityId: zakat.recipientOrganisationId,
      lifecycleStatus: "ACTIVE",
      isDemo: false,
    },
    select: {
      slug: true,
      title: true,
      lifecycleStatus: true,
      deadline: true,
      kind: true,
      ...COLLECTING_ENTITY_SELECT,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const open = candidates.find((c) => campaignAcceptsDonations(c, now));
  const recipientName =
    open?.collectingEntity?.name ??
    (await db.partnerOrganisation.findUnique({ where: { id: zakat.recipientOrganisationId }, select: { name: true } }))?.name ??
    "";
  return {
    nisabAmount: zakat.nisabAmount,
    recipientName,
    campaign: open ? { slug: open.slug, title: open.title } : null,
  };
}

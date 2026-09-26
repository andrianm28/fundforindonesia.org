import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { effectiveStatus } from '@/lib/subject-guard';
import { isPubliclyViewable, mayViewCampaign } from '@/lib/campaign-visibility';

/**
 * The Cache-Control every answer that depends on who asks carries: the
 * 404 for a Campaign the viewer may not see, and any page of an
 * unapproved Campaign shown to its privileged viewers.
 */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/**
 * The one 404 a Campaign read gives, for a missing slug and for an
 * unapproved Campaign the viewer may not see alike, so the answer never
 * tells them apart. Never shared-cached: the same URL may answer 200 to the
 * Campaign's Fundraiser.
 */
export function campaignNotFound() {
  const response = NextResponse.json(
    { code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 },
    { status: 404 }
  );
  response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  return response;
}

/**
 * Resolves the Campaign behind a public sub-resource of
 * /api/campaigns/[slug] (updates, donations, disbursements) for the one
 * asking, under the same rule as the Campaign itself
 * (./campaign-visibility.ts). Null means answer campaignNotFound(): the slug
 * is missing, or the Campaign is unapproved and the viewer is not its
 * Fundraiser, a Verifier or an Admin.
 *
 * The session is read only for an unapproved Campaign, so an approved one's
 * answer stays the same for everyone. `isPublic` false means the answer
 * differs by viewer and must carry PRIVATE_CACHE_CONTROL.
 */
export async function findViewableCampaign(
  slug: string
): Promise<{ id: string; isPublic: boolean } | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, creatorId: true, lifecycleStatus: true, deadline: true },
  });
  if (!campaign) return null;

  const status = effectiveStatus(campaign, new Date());
  if (isPubliclyViewable(status)) return { id: campaign.id, isPublic: true };

  const session = await getServerSession();
  if (!mayViewCampaign({ status, fundraiserId: campaign.creatorId }, session?.user)) {
    return null;
  }
  return { id: campaign.id, isPublic: false };
}

/** Marks an unapproved Campaign's sub-resource answer as never shared-cached. */
export function withViewerCacheControl<R extends NextResponse>(
  response: R,
  campaign: { isPublic: boolean }
): R {
  if (!campaign.isPublic) response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  return response;
}

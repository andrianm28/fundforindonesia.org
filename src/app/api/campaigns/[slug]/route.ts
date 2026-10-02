import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { coverImageSchema } from '@/lib/cover-image';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refusalResponse, refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { CampaignStatus, CampaignStatusChangeAction, VerificationOutcome } from '@/generated/prisma/client';
import { donationBlock, effectiveStatus } from '@/lib/campaign-lifecycle';
import { COLLECTING_ENTITY_SELECT } from '@/lib/collecting-entity';
import {
  lockAndLoad,
  requireActiveContentFieldsEditable,
  requireCollectingEntityEditable,
  requireContentEditable,
  requireKindAndDeadlineEditable,
} from '@/lib/subject-guard';
import { organisationOf, requireDonationOnlyForIndividual, resolveCollectingEntity } from '@/lib/collecting-entity-guard';
import { KINDS } from '@/lib/campaign-kind';
import { isPubliclyViewable, mayViewCampaign } from '@/lib/campaign-visibility';
import { PRIVATE_CACHE_CONTROL, campaignNotFound } from '@/lib/campaign-visibility-route';
import { resolvePlatformFeeBasisForCampaign } from '@/lib/money/platform-fee-config';
import { ESCROW_HOLD_DAYS } from '@/lib/money/escrow';

// Rendered per request: a Suspended or unapproved Campaign's answer
// depends on who asks (suspensionReasonFor, mayViewCampaign), and reading the session inside a route Next
// had cached as static fails at runtime. Shared caching of everything else
// is left to the Cache-Control header set in GET.
export const dynamic = 'force-dynamic';

// The only columns a direct edit may write; zod strips every other key.
// Kind and deadline only before approval (requireKindAndDeadlineEditable).
// Status moves through src/lib/campaign-lifecycle.ts; target and category
// through a Verification Request or an Admin; money, ownership, and isDemo
// are never client-writable.
const editCampaignSchema = z.object({
  title: z.string().min(1, "Judul harus diisi").max(200, "Judul maksimal 200 karakter"),
  description: z.string().min(1, "Deskripsi harus diisi"),
  story: z.string().min(1, "Cerita campaign harus diisi"),
  coverImage: coverImageSchema,
  kind: z.enum(KINDS, { message: "Kind tidak dikenal" }),
  // null clears it, which only a wakaf Campaign may have.
  deadline: z.string().datetime().nullable(),
  // The sponsoring Partner Organisation, only before approval
  // (requireCollectingEntityEditable) and only one the Fundraiser may
  // collect under (resolveCollectingEntity).
  collectingEntityId: z.string().min(1),
}).partial();

/**
 * The reason recorded on the Campaign's latest SUSPENDED status change,
 * returned only to its owning Fundraiser (FFI-07b). Anyone else, an Admin
 * included, gets `undefined`, so the field is left out of the payload: an
 * unproven report is never published with the Campaign.
 */
async function suspensionReasonFor(campaign: {
  id: string;
  creatorId: string;
}): Promise<string | null | undefined> {
  const session = await getServerSession();
  if (!session?.user?.id || session.user.id !== campaign.creatorId) {
    return undefined;
  }
  const latest = await prisma.campaignStatusChange.findFirst({
    where: { campaignId: campaign.id, action: CampaignStatusChangeAction.SUSPENDED },
    orderBy: { createdAt: 'desc' },
    select: { reason: true },
  });
  return latest?.reason ?? null;
}

/**
 * The id of the PENDING Verification Request a Submitted Campaign waits on,
 * returned only to its owning Fundraiser (verification-request 10) so their
 * Campaign page can offer "Tarik pengajuan". Anyone else, a Verifier or
 * Admin included, gets `undefined`, so the field is left out of the
 * payload: viewing is not acting, and the withdraw button is the
 * Fundraiser's alone.
 */
async function pendingVerificationRequestIdFor(campaign: {
  id: string;
  creatorId: string;
}, lifecycleStatus: CampaignStatus): Promise<string | null | undefined> {
  if (lifecycleStatus !== CampaignStatus.SUBMITTED) return undefined;
  const session = await getServerSession();
  if (!session?.user?.id || session.user.id !== campaign.creatorId) {
    return undefined;
  }
  const pending = await prisma.verificationRequest.findFirst({
    where: { campaignId: campaign.id, outcome: VerificationOutcome.PENDING },
    select: { id: true },
  });
  return pending?.id ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        ...COLLECTING_ENTITY_SELECT,
        _count: {
          select: {
            donations: {
              where: {
                paymentStatus: 'confirmed',
              },
            },
          },
        },
      },
    });

    if (!campaign) return campaignNotFound();

    const now = new Date();
    const lifecycleStatus = effectiveStatus(campaign, now);
    const collectingEntity = campaign.collectingEntity ?? null;
    const isSuspended = lifecycleStatus === CampaignStatus.SUSPENDED;
    const isPublic = isPubliclyViewable(lifecycleStatus);

    // An unapproved Campaign is private to its Fundraiser, Verifiers and
    // Admins; anyone else gets the same 404 as a slug that never existed.
    if (!isPublic) {
      const session = await getServerSession();
      if (!mayViewCampaign({ status: lifecycleStatus, fundraiserId: campaign.creatorId }, session?.user)) {
        return campaignNotFound();
      }
    }

    const suspensionReason = isSuspended
      ? await suspensionReasonFor(campaign)
      : undefined;
    const pendingVerificationRequestId = await pendingVerificationRequestIdFor(campaign, lifecycleStatus);

    // The rate in force right now (prd-compliance 17), resolved the same
    // way as the public page and frozen the same way POST /api/donations
    // freezes it: Campaign, then Category, then Kind default.
    const { percentBps: platformFeePercentBps } = await resolvePlatformFeeBasisForCampaign(prisma, campaign);

    // The Escrow Hold length every new Payment freezes at creation
    // (CONTEXT.md, Escrow Hold; prd-compliance 18) -- there is no per-Kind/
    // Category/Campaign override yet, unlike Platform Fee, so this is the
    // one value in force everywhere.
    const escrowHoldDays = ESCROW_HOLD_DAYS;

    const response = NextResponse.json({
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        description: campaign.description,
        story: campaign.story,
        coverImage: campaign.coverImage,
        targetAmount: campaign.targetAmount,
        collectedAmount: campaign.collectedAmount,
        category: campaign.category,
        kind: campaign.kind,
        lifecycleStatus,
        isUrgent: campaign.isUrgent,
        isDemo: campaign.isDemo,
        deadline: campaign.deadline,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        creator: campaign.creator,
        // Who collects its money (ADR 0010), and, while it is Active, why it
        // cannot take a Donation right now: no Collecting Entity, or no
        // Fundraising Permit valid now for its Kind. Judged at read time.
        collectingEntity: collectingEntity && { id: collectingEntity.id, name: collectingEntity.name },
        donationBlock: donationBlock({ ...campaign, collectingEntity }, now),
        donationCount: campaign._count.donations,
        platformFeePercentBps,
        escrowHoldDays,
        ...(suspensionReason !== undefined && { suspensionReason }),
        ...(pendingVerificationRequestId !== undefined && { pendingVerificationRequestId }),
      },
    });

    // A Suspended Campaign's answer differs between its owner and everyone
    // else, and an unapproved one between its privileged viewers and
    // everyone else, so no shared cache may keep either version.
    response.headers.set(
      'Cache-Control',
      isSuspended || !isPublic
        ? PRIVATE_CACHE_CONTROL
        : 'public, s-maxage=60, stale-while-revalidate=300'
    );

    return response;
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return NextResponse.json(
      {
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan server',
        status: 500,
      },
      { status: 500 }
    );
  }
}


export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { slug } = await params;

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true, creatorId: true },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }

    const refusal = refuseUnlessFundraiserOrAdmin({ kind: "campaign", ownerId: campaign.creatorId }, session.user);
    if (refusal) return refusal;

    const body = await request.json();
    const result = editCampaignSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    // Whether the content may change is judged under the Campaign's row
    // lock, never on the read above: a submit committed in the meantime is
    // seen here, and one that comes after waits for this edit to commit.
    const updatedCampaign = await prisma.$transaction(async (tx) => {
      const state = await lockAndLoad(tx, { type: 'campaign', campaignId: campaign.id }, new Date());
      if (!state) return null;
      requireContentEditable(state);
      requireActiveContentFieldsEditable(state, result.data);
      const { deadline, collectingEntityId, ...fields } = result.data;
      const data = {
        ...fields,
        ...(deadline !== undefined && { deadline: deadline === null ? null : new Date(deadline) }),
      };
      requireKindAndDeadlineEditable(state, data);
      // An individual Fundraiser may only run Kind donation (CONTEXT.md,
      // Kind Authorisation; ADR 0013): refused here too, not only at
      // submission, so a Draft can never even be edited into one.
      if (data.kind !== undefined && state.kind === 'campaign') {
        requireDonationOnlyForIndividual(await organisationOf(tx, state.ownerId), data.kind);
      }
      if (collectingEntityId !== undefined && state.kind === 'campaign') {
        requireCollectingEntityEditable(state, { collectingEntityId });
        if (collectingEntityId !== state.collectingEntityId) {
          Object.assign(data, {
            collectingEntityId: await resolveCollectingEntity(tx, state.ownerId, collectingEntityId),
          });
        }
      }

      return tx.campaign.update({
        where: { id: campaign.id },
        data,
        // The legacy status string is never sent back (ticket 03 drops it).
        omit: { status: true },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      });
    });

    if (!updatedCampaign) {
      return NextResponse.json(
        { error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }

    return NextResponse.json({ campaign: updatedCampaign });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error updating campaign:', error);
    return NextResponse.json(
      { error: "Terjadi kesalahan server" },
      { status: 500 }
    );
  }
}

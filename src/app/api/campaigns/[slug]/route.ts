import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { CampaignStatus, CampaignStatusChangeAction } from '@/generated/prisma/client';
import { effectiveStatus } from '@/lib/campaign-lifecycle';

// Rendered per request: a Suspended Campaign's answer depends on who asks
// (see suspensionReasonFor), and reading the session inside a route Next
// had cached as static fails at runtime. Shared caching of everything else
// is left to the Cache-Control header set in GET.
export const dynamic = 'force-dynamic';

// The only columns a direct edit may write; zod strips every other key.
// Status moves through src/lib/campaign-lifecycle.ts; target, deadline, and
// category through a Verification Request or an Admin; money, ownership, and
// isDemo are never client-writable.
const editCampaignSchema = z.object({
  title: z.string().min(1, "Judul harus diisi").max(200, "Judul maksimal 200 karakter"),
  description: z.string().min(1, "Deskripsi harus diisi"),
  story: z.string().min(1, "Cerita campaign harus diisi"),
  coverImage: z.string().url("URL gambar tidak valid"),
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

    if (!campaign) {
      return NextResponse.json(
        {
          code: 'NOT_FOUND',
          message: 'Campaign tidak ditemukan',
          status: 404,
        },
        { status: 404 }
      );
    }

    const lifecycleStatus = effectiveStatus(campaign, new Date());
    const isSuspended = lifecycleStatus === CampaignStatus.SUSPENDED;
    const suspensionReason = isSuspended
      ? await suspensionReasonFor(campaign)
      : undefined;

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
        lifecycleStatus,
        isUrgent: campaign.isUrgent,
        isDemo: campaign.isDemo,
        deadline: campaign.deadline,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        creator: campaign.creator,
        donationCount: campaign._count.donations,
        ...(suspensionReason !== undefined && { suspensionReason }),
      },
    });

    // A Suspended Campaign's answer differs between its owner and everyone
    // else, so no shared cache may keep either version.
    response.headers.set(
      'Cache-Control',
      isSuspended
        ? 'private, no-store'
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

    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: result.data,
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

    return NextResponse.json({ campaign: updatedCampaign });
  } catch (error) {
    console.error('Error updating campaign:', error);
    return NextResponse.json(
      { error: "Terjadi kesalahan server" },
      { status: 500 }
    );
  }
}

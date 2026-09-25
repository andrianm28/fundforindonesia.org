import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

export const revalidate = 60;

// The only columns a direct edit may write; zod strips every other key.
// Status moves through /api/moderasi/campaigns/[id]; target, deadline, and
// category through a Verification Request or an Admin; money, ownership, and
// isDemo are never client-writable.
const editCampaignSchema = z.object({
  title: z.string().min(1, "Judul harus diisi").max(200, "Judul maksimal 200 karakter"),
  description: z.string().min(1, "Deskripsi harus diisi"),
  story: z.string().min(1, "Cerita campaign harus diisi"),
  coverImage: z.string().url("URL gambar tidak valid"),
}).partial();

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
            isVerified: true,
            verificationType: true,
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
        status: campaign.status,
        isUrgent: campaign.isUrgent,
        isDemo: campaign.isDemo,
        deadline: campaign.deadline,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        creator: campaign.creator,
        donationCount: campaign._count.donations,
      },
    });

    response.headers.set(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300'
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

    const userRole = (session.user.role as Role) ?? "DONOR";
    const isAdmin = userRole === "ADMIN";
    const isOwnerWithRole =
      isAtLeast(userRole, "CAMPAIGN_CREATOR") &&
      campaign.creatorId === session.user.id;

    if (!isAdmin && !isOwnerWithRole) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

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
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            avatar: true,
            isVerified: true,
            verificationType: true,
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

export async function DELETE(
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

    const userRole = (session.user.role as Role) ?? "DONOR";
    const isAdmin = userRole === "ADMIN";
    const isOwnerWithRole =
      isAtLeast(userRole, "CAMPAIGN_CREATOR") &&
      campaign.creatorId === session.user.id;

    if (!isAdmin && !isOwnerWithRole) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    await prisma.campaign.delete({
      where: { id: campaign.id },
    });

    return NextResponse.json({ message: "Campaign berhasil dihapus" });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    return NextResponse.json(
      { error: "Terjadi kesalahan server" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refuseUnlessFundraiser } from '@/lib/refusal-response';

const createUpdateSchema = z.object({
  title: z.string().min(1, 'Judul harus diisi').max(200, 'Judul maksimal 200 karakter'),
  content: z.string().min(1, 'Konten harus diisi'),
  images: z.array(z.string().url()).optional().default([]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const skip = (page - 1) * limit;

    // Resolve campaign by slug
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!campaign) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 },
        { status: 404 }
      );
    }

    const [updates, total] = await Promise.all([
      prisma.campaignUpdate.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          title: true,
          content: true,
          images: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaignUpdate.count({ where: { campaignId: campaign.id } }),
    ]);

    return NextResponse.json({
      updates,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching campaign updates:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Check authentication
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Anda harus login terlebih dahulu' },
        { status: 401 }
      );
    }

    // Resolve campaign by slug
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true, creatorId: true },
    });

    if (!campaign) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 },
        { status: 404 }
      );
    }

    // Only the Campaign's Fundraiser posts its updates (CONTEXT.md, Capacity).
    const refusal = refuseUnlessFundraiser({ kind: 'campaign', ownerId: campaign.creatorId }, session.user);
    if (refusal) return refusal;

    // Validate request body
    const body = await request.json();
    const result = createUpdateSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    const { title, content, images } = result.data;

    // Create campaign update
    const update = await prisma.campaignUpdate.create({
      data: {
        title,
        content,
        images,
        campaignId: campaign.id,
      },
      select: {
        id: true,
        title: true,
        content: true,
        images: true,
        createdAt: true,
      },
    });

    return NextResponse.json(update, { status: 201 });
  } catch (error) {
    console.error('Error creating campaign update:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}

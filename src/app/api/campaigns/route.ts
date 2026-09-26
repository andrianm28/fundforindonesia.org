import { NextRequest, NextResponse } from 'next/server';
import { CampaignStatus, type Prisma } from '@/generated/prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { listableCampaignWhere } from '@/lib/subject-guard';
import { deadlineRequiredMessage, KINDS, missingRequiredDeadline, parseKind } from '@/lib/campaign-kind';
import { organisationOf, requireDonationOnlyForIndividual, resolveCollectingEntity } from '@/lib/collecting-entity-guard';
import { refusalResponse } from '@/lib/refusal-response';

const createCampaignSchema = z.object({
  title: z.string().min(1, "Judul harus diisi").max(200, "Judul maksimal 200 karakter"),
  description: z.string().min(1, "Deskripsi harus diisi"),
  story: z.string().min(1, "Cerita campaign harus diisi"),
  coverImage: z.string().url("URL gambar tidak valid"),
  targetAmount: z.number().positive("Target donasi harus lebih dari 0"),
  category: z.string().min(1, "Kategori harus dipilih"),
  kind: z.enum(KINDS, { message: "Kind harus dipilih" }),
  deadline: z.string().datetime().optional(),
  // The sponsoring Partner Organisation an individual Fundraiser picks; an
  // organisation's linked account always gets its own (ADR 0010).
  collectingEntityId: z.string().min(1).optional(),
}).superRefine((body, ctx) => {
  // Every Kind but wakaf needs a deadline (CONTEXT.md, Campaign).
  if (missingRequiredDeadline(body)) {
    ctx.addIssue({
      code: 'custom',
      message: deadlineRequiredMessage(body.kind),
      path: ['deadline'],
    });
  }
});

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category');
    const kindParam = searchParams.get('kind');
    const search = searchParams.get('search');
    const urgent = searchParams.get('urgent');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));

    const skip = (page - 1) * limit;

    // Only effectively Active Campaigns are listed (CONTEXT.md, Campaign
    // Status); a `?status=` in the query is ignored.
    const where: Prisma.CampaignWhereInput = listableCampaignWhere(new Date());

    if (category) {
      where.category = category;
    }

    if (kindParam) {
      const kind = parseKind(kindParam);
      if (!kind) {
        return NextResponse.json({ error: 'Kind tidak dikenal' }, { status: 400 });
      }
      where.kind = kind;
    }

    if (urgent === 'true') {
      where.isUrgent = true;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        // The legacy status string is never sent; lifecycleStatus is the
        // one status field (spec legacy-status-contract).
        omit: { status: true },
        include: {
          creator: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaign.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const response = NextResponse.json({
      campaigns,
      total,
      page,
      limit,
      totalPages,
    });

    response.headers.set(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300'
    );

    return response;
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaigns' },
      { status: 500 }
    );
  }
}

// Anyone registered may create a Campaign (PRD FFI-04): no Role is asked
// for. It lands as a Draft; the Fundraiser submits it to a Verifier through
// POST /api/campaigns/[slug]/verification-requests, and the Verifier's
// approval is the gate.
export async function POST(request: NextRequest) {
  try {
    // 1. Get session: signing in is the only requirement
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const result = createCampaignSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    const { title, description, story, coverImage, targetAmount, category, kind, deadline } = result.data;

    // An individual Fundraiser may only run Kind donation (CONTEXT.md, Kind
    // Authorisation; ADR 0013); zakat, wakaf and hibah need an institution.
    requireDonationOnlyForIndividual(await organisationOf(prisma, session.user.id), kind);

    // The Collecting Entity it collects under (ADR 0010): the creator's own
    // organisation when their account acts for one, else the one they named,
    // if it accepts individual Campaigns. A Draft may name none yet;
    // submitting it to a Verifier requires one.
    const collectingEntityId = await resolveCollectingEntity(
      prisma,
      session.user.id,
      result.data.collectingEntityId
    );

    // 3. Generate unique slug
    const slug = generateSlug(title);

    // 4. Create campaign in database
    const campaign = await prisma.campaign.create({
      data: {
        slug,
        title,
        description,
        story,
        coverImage,
        targetAmount,
        category,
        kind,
        deadline: deadline ? new Date(deadline) : null,
        creatorId: session.user.id,
        collectingEntityId,
        // A new campaign is a Draft: visible only to its Fundraiser, and not
        // in the Verifier queue until they submit it, which opens its
        // Verification Request. Set explicitly rather than left to the schema
        // default, so publishing an unverified appeal for money can never
        // hinge on a default someone changes.
        lifecycleStatus: CampaignStatus.DRAFT,
      },
      // The legacy status string is never sent back (ticket 03 drops it).
      omit: { status: true },
      include: {
        creator: {
          select: {
            name: true,
          },
        },
      },
    });

    // 5. Return 201 with created campaign
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error creating campaign:', error);
    return NextResponse.json(
      { error: 'Gagal membuat campaign' },
      { status: 500 }
    );
  }
}

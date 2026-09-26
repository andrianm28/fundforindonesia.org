import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';

const createVolunteerTripSchema = z.object({
  title: z.string().min(1, 'Judul harus diisi').max(200, 'Judul maksimal 200 karakter'),
  description: z.string().min(1, 'Deskripsi harus diisi'),
  story: z.string().min(1, 'Cerita trip harus diisi'),
  coverImage: z.string().url('URL gambar tidak valid'),
  destination: z.string().min(1, 'Destinasi harus diisi'),
  itinerary: z.string().min(1, 'Itinerary harus diisi'),
  tripFeeAmount: z.number().positive('Trip Fee harus lebih dari 0'),
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

// Legacy CAMPAIGN_CREATOR Role gate, kept until who may create a Campaign or
// Volunteer Trip is decided (prd-compliance tickets 06-08).
export const POST = withRoleCheck('CAMPAIGN_CREATOR', async (request: NextRequest) => {
  try {
    const session = await getServerSession();

    const body = await request.json();
    const result = createVolunteerTripSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const slug = generateSlug(result.data.title);

    const trip = await prisma.volunteerTrip.create({
      data: {
        slug,
        ...result.data,
        fundraiserId: session!.user.id,
        status: 'DRAFT',
      },
    });

    return NextResponse.json(trip, { status: 201 });
  } catch (error) {
    console.error('Error creating volunteer trip:', error);
    return NextResponse.json({ error: 'Gagal membuat volunteer trip' }, { status: 500 });
  }
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));
    const skip = (page - 1) * limit;

    // Always ACTIVE, never a client-controllable status filter -- this route
    // is public and unauthenticated. A SUBMITTED or DRAFT Trip is only ever
    // visible through the Verifier-gated /api/moderasi/volunteer-trips queue.
    const where = { status: 'ACTIVE' as const };

    const [trips, total] = await Promise.all([
      prisma.volunteerTrip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.volunteerTrip.count({ where }),
    ]);

    return NextResponse.json({
      trips,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching volunteer trips:', error);
    return NextResponse.json({ error: 'Failed to fetch volunteer trips' }, { status: 500 });
  }
}

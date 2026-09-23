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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createRecurringDonation, listRecurringDonations, type CreateRecurringError } from '@/lib/recurring-donations/service';
import { MAX_DONATION_AMOUNT, MIN_DONATION_AMOUNT } from '@/lib/donations';
import { formatRupiah } from '@/lib/utils/currency';

export const dynamic = 'force-dynamic';

/**
 * A signed-in Donor's recurring donations (PKS pasal 4.7). Account only: a
 * Guest Donor has no inbox and no /akun to stop it from.
 *
 * The target is a Campaign. A Program takes no money online (CONTEXT.md,
 * Program), so there is nothing a bill could pay into.
 */

const createSchema = z.object({
  campaignId: z.string().min(1, 'Campaign harus dipilih'),
  amount: z
    .number('Nominal harus berupa angka')
    .int('Nominal harus bilangan bulat')
    .min(MIN_DONATION_AMOUNT, `Minimum donasi ${formatRupiah(MIN_DONATION_AMOUNT)}`)
    .max(MAX_DONATION_AMOUNT, `Maksimum donasi ${formatRupiah(MAX_DONATION_AMOUNT)}`),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'], { error: 'Periode tidak valid' }),
  // A calendar date; the first cycle is due on it.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal mulai tidak valid'),
});

const ERROR_COPY: Record<CreateRecurringError, { status: number; error: string }> = {
  amount_out_of_range: { status: 400, error: 'Nominal di luar batas donasi.' },
  start_in_past: { status: 400, error: 'Tanggal mulai tidak boleh sebelum hari ini.' },
  campaign_unavailable: { status: 400, error: 'Campaign ini tidak dapat menerima donasi rutin saat ini.' },
  too_many: { status: 409, error: 'Anda sudah memiliki terlalu banyak donasi rutin aktif. Hentikan sebagian dulu.' },
};

export async function GET() {
  const session = await getServerSession();
  const donorId = session?.user?.id;
  if (!donorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ recurringDonations: await listRecurringDonations(prisma, donorId) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  const donorId = session?.user?.id;
  if (!donorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Validasi gagal' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { campaignId, amount, period, startDate } = parsed.data;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors: { startDate: ['Tanggal mulai tidak valid'] } }, { status: 400 });
  }

  const created = await createRecurringDonation(prisma, { donorId, campaignId, amount, period, startDate: start, now: new Date() });
  if (!created.ok) {
    const { status, error } = ERROR_COPY[created.error];
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json({ id: created.id }, { status: 201 });
}

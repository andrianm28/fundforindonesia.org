import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { stopRecurringDonation } from '@/lib/recurring-donations/service';

export const dynamic = 'force-dynamic';

/**
 * A signed-in Donor stops one of their own recurring donations from /akun
 * (PKS pasal 4.7). Someone else's id answers the same 404 as a missing one.
 * The other way to stop, without a login, is the signed link in the bill email
 * (POST /api/donasi-rutin/berhenti/[token]).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  const donorId = session?.user?.id;
  if (!donorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const stopped = await stopRecurringDonation(prisma, { id, donorId });
  if (!stopped.ok) return NextResponse.json({ error: 'Donasi rutin tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ stopped: true });
}

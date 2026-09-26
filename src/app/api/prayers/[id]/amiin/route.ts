import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Validate prayer exists
    const prayer = await prisma.prayer.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!prayer) {
      return NextResponse.json(
        { error: 'Doa tidak ditemukan' },
        { status: 404 }
      );
    }

    // 2. Atomically increment amiinCount
    const updatedPrayer = await prisma.prayer.update({
      where: { id },
      data: { amiinCount: { increment: 1 } },
      select: { id: true, amiinCount: true },
    });

    // 3. Return new count
    return NextResponse.json({
      id: updatedPrayer.id,
      amiinCount: updatedPrayer.amiinCount,
    });
  } catch (error) {
    console.error('Error incrementing amiin count:', error);
    return NextResponse.json(
      { error: 'Gagal menambahkan amiin' },
      { status: 500 }
    );
  }
}

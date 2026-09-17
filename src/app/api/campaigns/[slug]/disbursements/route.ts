import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

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

    const disbursements = await prisma.disbursement.findMany({
      where: { campaignId: campaign.id },
      select: {
        id: true,
        amount: true,
        description: true,
        proofImage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      disbursements,
    });
  } catch (error) {
    console.error('Error fetching campaign disbursements:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}

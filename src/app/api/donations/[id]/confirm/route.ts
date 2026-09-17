import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Find donation by ID with related campaign and prayer
    const donation = await prisma.donation.findUnique({
      where: { id },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            targetAmount: true,
            collectedAmount: true,
            creatorId: true,
          },
        },
        prayer: true,
      },
    });

    if (!donation) {
      return NextResponse.json(
        { error: 'Donasi tidak ditemukan' },
        { status: 404 }
      );
    }

    // 2. Check donation status is "pending"
    if (donation.paymentStatus !== 'pending') {
      return NextResponse.json(
        { error: `Donasi sudah berstatus "${donation.paymentStatus}". Hanya donasi pending yang dapat dikonfirmasi.` },
        { status: 400 }
      );
    }

    // 3. Use Prisma transaction for atomicity
    const newCollectedAmount = donation.campaign.collectedAmount + donation.amount;
    const targetMet = newCollectedAmount >= donation.campaign.targetAmount;

    const result = await prisma.$transaction(async (tx) => {
      // 3a. Update donation status to "confirmed"
      const updatedDonation = await tx.donation.update({
        where: { id },
        data: { paymentStatus: 'confirmed' },
      });

      // 3b. Atomically increment campaign collectedAmount
      const updatedCampaign = await tx.campaign.update({
        where: { id: donation.campaign.id },
        data: {
          collectedAmount: { increment: donation.amount },
          // 3c. Update campaign status to "completed" if target is met
          ...(targetMet && { status: 'completed' }),
        },
      });

      return { updatedDonation, updatedCampaign };
    });

    // 4. Create notifications (outside transaction for performance)
    const formattedAmount = formatRupiah(donation.amount);
    const notifications = [];

    // 4a. Notification for donor (if donorId is set)
    if (donation.donorId) {
      notifications.push({
        type: 'donation_confirmed',
        title: 'Donasi Berhasil',
        message: `Donasi Anda sebesar ${formattedAmount} berhasil dikonfirmasi`,
        userId: donation.donorId,
        link: `/campaign/${donation.campaign.id}`,
      });
    }

    // 4b. Notification for campaign creator
    notifications.push({
      type: 'donation_confirmed',
      title: 'Donasi Baru',
      message: `Donasi baru sebesar ${formattedAmount} untuk campaign ${donation.campaign.title}`,
      userId: donation.campaign.creatorId,
      link: `/campaign/${donation.campaign.id}`,
    });

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }

    // 5. Return 200 with updated donation status
    return NextResponse.json({
      id: result.updatedDonation.id,
      paymentStatus: result.updatedDonation.paymentStatus,
      amount: result.updatedDonation.amount,
      campaignId: donation.campaign.id,
      campaignStatus: result.updatedCampaign.status,
      collectedAmount: result.updatedCampaign.collectedAmount,
    });
  } catch (error) {
    console.error('Error confirming donation:', error);
    return NextResponse.json(
      { error: 'Gagal mengkonfirmasi donasi' },
      { status: 500 }
    );
  }
}

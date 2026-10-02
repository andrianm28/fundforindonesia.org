import { NextRequest, NextResponse } from 'next/server';
import { readDonationGuestEmail, readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { receiptEmail, resolveReceiptRecipient } from '@/lib/mail/receipt';
import { publicUrl } from '@/lib/public-url';

/**
 * A Donor can ask for their Receipt again (CONTEXT.md, Receipt; prd-compliance
 * 21) from the print page, which a Guest Donor reaches with no account at
 * all -- so the token in the URL is this route's only gate, and it enforces
 * its own cooldown rather than trusting a caller not to hammer a Donor's
 * inbox with it.
 */
const RESEND_COOLDOWN_MS = 60_000;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { token },
    include: {
      donation: {
        include: {
          // Donation's own scalars (the guest email ciphertext and key id)
          // come with `include`; naming scalars inside it is a Prisma error.
          campaign: { include: { collectingEntity: true } },
          donor: { select: { id: true, name: true, ...SELECT_USER_EMAIL } },
        },
      },
    },
  });

  if (!receipt) {
    return NextResponse.json({ error: 'Bukti donasi tidak ditemukan' }, { status: 404 });
  }

  // Ticket 36: the address is gone by design. Say so, rather than a 500 that
  // reads as a fault, and never reach for a stale one.
  if (receipt.donation.anonymisedAt) {
    return NextResponse.json(
      { error: 'Identitas Donor sudah dianonimkan, bukti donasi tidak dapat dikirim ulang ke email' },
      { status: 409 },
    );
  }

  const lastSent = receipt.lastSentAt ?? receipt.sentAt;
  if (lastSent && Date.now() - lastSent.getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'Mohon tunggu sebentar sebelum mengirim ulang bukti donasi' },
      { status: 429 },
    );
  }

  const { donation } = receipt;
  const { campaign } = donation;
  // Decrypted for the address to send to; the stored form is the ciphertext
  // (ADR 0012). A registered Donor's account address still wins over the one
  // the Donation was made with, which is the fallback order resolveReceiptRecipient
  // already encodes.
  const resolved = resolveReceiptRecipient({
    donor: donation.donor
      ? { name: donation.donor.name, email: readUserEmail(donation.donor) }
      : null,
    guestEmail: readDonationGuestEmail(donation),
    guestName: donation.guestName,
    collectingEntityName: campaign.collectingEntity?.name ?? null,
  });

  if (!resolved.ok) {
    console.error(`[receipts/${token}/resend] could not resend: ${resolved.reason}`);
    return NextResponse.json({ error: 'Bukti donasi tidak dapat dikirim ulang' }, { status: 500 });
  }

  const delivered = await sendReportingFailure(
    receiptEmail({
      to: resolved.recipient.recipientEmail,
      donorName: resolved.recipient.donorName,
      campaignTitle: campaign.title,
      collectingEntityName: resolved.recipient.collectingEntityName,
      amount: donation.amount,
      paidAt: receipt.sentAt ?? receipt.createdAt,
      printUrl: publicUrl(`/receipt/${token}`),
    }),
    { mail: 'receipt_resend', donationId: donation.id, receiptId: receipt.id },
  );

  // A rejected or unconfigured Mailer must not look like a successful resend
  // to the Donor, and must not burn the cooldown either -- sendReportingFailure
  // already logged the failure for an operator to find and resend by hand.
  if (!delivered) {
    return NextResponse.json({ error: 'Bukti donasi gagal dikirim ulang' }, { status: 502 });
  }

  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { lastSentAt: new Date(), resendCount: receipt.resendCount + 1 },
  });

  return NextResponse.json({ sent: true }, { status: 200 });
}

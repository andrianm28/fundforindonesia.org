import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import {
  donationsEnabled,
  sandboxInProductionReason,
  DONATIONS_DISABLED_MESSAGE,
} from '@/lib/donations';
import { campaignAcceptsDonations, donationBlock, expireIfPastDeadline } from "@/lib/campaign-lifecycle";
import { COLLECTING_ENTITY_SELECT } from '@/lib/collecting-entity';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';
import { chargeDonation } from '@/lib/money/donation-charge';
import { VALID_PAYMENT_METHODS, PROVIDER_METHOD_FOR } from '@/lib/money/payment-method-map';

/** CONTEXT.md, "Minimum Rp20.000, dengan nominal cepat dan nominal bebas" (prd-compliance 18). */
const MIN_DONATION_AMOUNT = 20_000;

const createDonationSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID harus diisi"),
  amount: z.number().int().min(MIN_DONATION_AMOUNT, "Minimum donasi Rp20.000"),
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, {
    error: "Metode pembayaran tidak valid. Pilih: bank_transfer, qris, ewallet, atau credit_card",
  }),
  message: z.string().max(500, "Pesan maksimal 500 karakter").optional(),
  isAnonymous: z.boolean().optional().default(false),
  // A Guest Donor (CONTEXT.md, Guest Donor): email required, name and phone
  // optional, kept only for Receipt. Not required at all for a signed-in
  // Donor, whose email/name already exist on their account. Validated here
  // as a shape only -- the "required when there is no session" rule cannot
  // be expressed in this schema, because whether there IS a session is not
  // known until after the session is read below, so it is enforced there.
  guestEmail: z.string().trim().email("Email tidak valid").optional(),
  guestName: z.string().trim().min(1).max(100, "Nama maksimal 100 karakter").optional(),
  guestPhone: z.string().trim().min(1).max(20, "Nomor telepon maksimal 20 karakter").optional(),
});

export async function POST(request: NextRequest) {
  // The switch, checked before the body is parsed, before the session is
  // read, before anything is written.
  if (!donationsEnabled()) {
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

  // The interlock behind the switch. Sandbox credentials in production take
  // real rupiah into an account that settles nowhere, and no deploy
  // checklist survives contact with a rushed release, so the refusal lives
  // in code. See sandboxInProductionReason (src/lib/donations.ts).
  const blocked = sandboxInProductionReason();
  if (blocked) {
    console.error(`[donations] refusing every donation: ${blocked}`);
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const result = createDonationSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    const { campaignId, amount, paymentMethod, message, isAnonymous, guestEmail, guestName, guestPhone } =
      result.data;

    // 2. Verify campaign exists and is active
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        lifecycleStatus: true,
        deadline: true,
        title: true,
        isDemo: true,
        kind: true,
        category: true,
        ...COLLECTING_ENTITY_SELECT,
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign tidak ditemukan' },
        { status: 404 }
      );
    }

    // Demo campaigns are sample content that predates the money layer and
    // must never take real money -- refused here, before the status check,
    // before the provider is built, before anything is written. A label on
    // the card (CampaignCard.tsx) is not the mechanism; this is.
    if (campaign.isDemo) {
      return NextResponse.json(
        { error: 'Ini adalah campaign contoh dan tidak dapat menerima donasi.' },
        { status: 403 }
      );
    }

    const now = new Date();
    // An Active Campaign whose Collecting Entity cannot collect for its Kind
    // right now (none named, or no permit valid now) is refused as such,
    // judged lazily: nothing is recorded when a permit lapses (ADR 0010).
    if (donationBlock(campaign, now)) {
      return NextResponse.json({ error: COLLECTING_ENTITY_REFUSAL }, { status: 403 });
    }
    if (!campaignAcceptsDonations(campaign, now)) {
      // If the refusal is a deadline that has passed, record the expiry the
      // way every lifecycle command does (capacity SYSTEM, the Fundraiser
      // told), committed on its own so it survives this refusal. It decides
      // for itself whether there is anything to record. Failing to record it
      // must not change the answer: the Donation is refused either way, and
      // the next actor or the scheduled expiry job records it.
      try {
        await expireIfPastDeadline(prisma, campaign.id, now);
      } catch (err) {
        console.error(`[donations] lazy expiry failed for campaign ${campaign.id}:`, err);
      }
      return NextResponse.json(
        { error: 'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.' },
        { status: 400 }
      );
    }

    // 3. Get session (optional -- donorId can be null for a Guest Donor)
    const session = await getServerSession();
    const donorId = session?.user?.id || null;

    // A Guest Donor must leave an email -- the minimum data needed for a
    // Receipt (CONTEXT.md, Guest Donor). A signed-in Donor's email already
    // lives on their account, so this is refused only when there is no
    // session at all, before anything is written.
    if (!donorId && !guestEmail) {
      return NextResponse.json(
        { error: 'Email harus diisi untuk donasi tanpa akun', fieldErrors: { guestEmail: ['Email harus diisi'] } },
        { status: 400 },
      );
    }

    // 4. Build the provider before touching the database. If it is not
    // configured, nothing has been written yet -- there is no half-created
    // donation to clean up.
    let provider;
    try {
      provider = getPaymentProvider();
    } catch (err) {
      if (err instanceof PaymentProviderNotConfiguredError) {
        return NextResponse.json(
          { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
          { status: 503 }
        );
      }
      throw err;
    }

    // 5. Ask the provider whether it can serve what the donor picked, BEFORE
    // anything is written and before a charge exists anywhere. Checking
    // afterwards would leave an abandoned charge at the provider -- a live
    // payment link a donor could still find and pay into, with nothing on
    // this side expecting the money. chargeDonation repeats this same check
    // right before it charges, as defense in depth against a future caller
    // that skips this one -- but that check runs after the Donation row
    // already exists, so it alone is not enough here.
    const wantedMethod = PROVIDER_METHOD_FOR[paymentMethod];
    if (wantedMethod === null || wantedMethod !== provider.method) {
      return NextResponse.json(
        { error: 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.' },
        { status: 503 }
      );
    }

    // 6. Create the Donation, commit, and only then call the provider.
    //
    // The charge used to run inside this transaction so a failed charge
    // rolled the Donation back. That was safe only while the provider did no
    // I/O: a real adapter makes this an HTTP round trip, and holding a
    // pooled connection and row locks across one is how provider latency
    // exhausts the pool and takes the whole site down.
    //
    // What the transaction actually protected is still protected. A Payment
    // without its Donation is money with no owner; that cannot happen now,
    // because the Donation is committed first. The case this opens instead
    // is a Donation with no Payment, which is a donation nobody can pay --
    // recoverable, visible, and explicitly marked failed below.
    //
    // No ledger entries here either: a pending payment has moved no money,
    // and posting on creation is how a campaign would show funds for a
    // donation that was never paid.
    const donation = await prisma.donation.create({
      data: {
        amount,
        isAnonymous,
        paymentMethod,
        paymentStatus: 'pending',
        message: message || null,
        campaignId,
        donorId,
        // A signed-in Donor's contact details live on their User row; a
        // Guest Donor's live here instead, protected the same way
        // (src/lib/field-protection.ts, ADR 0012).
        ...(donorId
          ? {}
          : { guestEmail, guestName: guestName || null, guestPhone: guestPhone || null }),
      },
    });

    // The donation id IS the provider's order id -- the webhook gets only an
    // order id back and finds this Payment by providerRef, so the two must be
    // the same value from the start.
    const charged = await chargeDonation({
      db: prisma,
      provider,
      campaign,
      donationId: donation.id,
      amount,
      orderId: donation.id,
      paymentMethod: wantedMethod,
    });

    if (!charged.ok) {
      // The Donation is already committed. Left at 'pending' it would sit in
      // the donor's history as an unfinished payment they can neither
      // complete nor understand, so it is closed out here.
      console.error(`[donations] charge failed for donation ${donation.id}: ${charged.reason}`);
      await prisma.donation.update({
        where: { id: donation.id },
        data: { paymentStatus: 'failed' },
      });
      const errorMessage =
        charged.reason === 'method_unavailable'
          ? 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.'
          : 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.';
      return NextResponse.json({ error: errorMessage }, { status: 503 });
    }

    const charge = charged.charge;

    // 7. If message is provided, create a Prayer record linked to the donation
    if (message) {
      await prisma.prayer.create({
        data: {
          text: message,
          donationId: donation.id,
          campaignId,
          userId: donorId,
        },
      });
    }

    // 8. Return 201 with the instructions the provider actually issued --
    // never ones invented locally.
    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt }
        : { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };

    return NextResponse.json(
      {
        donationId: donation.id,
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        paymentStatus: donation.paymentStatus,
        campaignTitle: campaign.title,
        paymentInstructions,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating donation:', error);
    return NextResponse.json(
      { error: 'Gagal membuat donasi' },
      { status: 500 }
    );
  }
}

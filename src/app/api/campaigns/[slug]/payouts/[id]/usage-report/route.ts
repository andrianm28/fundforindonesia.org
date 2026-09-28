import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse, refuseUnlessFundraiser } from '@/lib/refusal-response';
import { submitUsageReport, disputeUsageReport } from '@/lib/usage-reports';

const lineItemSchema = z.object({
  label: z.string().min(1, 'Nama pos harus diisi').max(200, 'Nama pos maksimal 200 karakter'),
  amount: z.number().int('Nominal harus bilangan bulat').min(1, 'Nominal harus lebih dari 0'),
});

const submitSchema = z.object({
  narrative: z.string().min(1, 'Narasi harus diisi').max(5000, 'Narasi maksimal 5000 karakter'),
  lineItems: z.array(lineItemSchema).min(1, 'Rincian pemakaian dana harus punya minimal satu pos'),
  beneficiaryCount: z
    .number()
    .int('Jumlah penerima manfaat harus bilangan bulat')
    .min(1, 'Jumlah penerima manfaat harus minimal 1'),
  photos: z.array(z.string().url('Setiap foto harus berupa URL yang valid')).min(1, 'Minimal satu foto bukti harus dilampirkan'),
});

const disputeSchema = z.object({
  reason: z.string().min(1, 'Alasan dipertanyakan harus diisi').max(1000, 'Alasan maksimal 1000 karakter'),
});

type RouteContext = { params: Promise<{ slug: string; id: string }> };

/**
 * POST /api/campaigns/[slug]/payouts/[id]/usage-report -- the owning
 * Fundraiser's account of one of their own COMPLETED Payouts (ticket 22; PRD
 * FFI-07a; CONTEXT.md, Usage Report). Public the instant it is sent: nothing
 * here holds it for review before it is readable on the Campaign page
 * (GET /api/campaigns/[slug]/disbursements).
 *
 * Ownership is asked the same way the Payout request route asks it
 * (refuseUnlessFundraiser on the Campaign's own creatorId); the Payout's own
 * status, and the one-report-per-Payout rule, are submitUsageReport's job
 * (@/lib/usage-reports.ts).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, creatorId: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }
  const refusal = refuseUnlessFundraiser({ kind: 'campaign', ownerId: campaign.creatorId }, session.user);
  if (refusal) return refusal;

  const payout = await prisma.payout.findUnique({ where: { id }, select: { campaignId: true } });
  if (!payout || payout.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  try {
    const report = await submitUsageReport(prisma, {
      payoutId: id,
      submittedById: userId,
      narrative: parsed.data.narrative,
      lineItems: parsed.data.lineItems,
      beneficiaryCount: parsed.data.beneficiaryCount,
      photos: parsed.data.photos,
    });

    return NextResponse.json(
      {
        id: report.id,
        payoutId: report.payoutId,
        narrative: report.narrative,
        lineItems: report.lineItems,
        beneficiaryCount: report.beneficiaryCount,
        photos: report.photos,
        createdAt: report.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    // Every refusal (not-completed, already-exists, the line item arithmetic)
    // carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error submitting usage report:', error);
    return NextResponse.json({ error: 'Gagal mengirim Usage Report' }, { status: 500 });
  }
}

/**
 * PATCH /api/campaigns/[slug]/payouts/[id]/usage-report -- an Admin marks
 * this Payout's Usage Report "dipertanyakan" (PRD FFI-07a), with a reason
 * that is public beside the report from that point on. There is no
 * corresponding "un-dispute": nothing in the spec describes lifting one.
 *
 * `withAssignmentCheck(Assignment.ADMIN)` gates on the assignment only, so
 * `getServerSession` is called again to learn who is disputing --
 * `disputeUsageReport` refuses that Admin if they are also this Campaign's
 * own Fundraiser (CONTEXT.md, Admin), the same rule approving or completing
 * a Payout on your own Campaign is refused by.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: RouteContext) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const disputedById = session!.user!.id as string;

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const payout = await prisma.payout.findUnique({
    where: { id },
    select: { campaignId: true, usageReport: { select: { id: true } } },
  });
  if (!payout || payout.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }
  if (!payout.usageReport) {
    return NextResponse.json({ error: 'Usage Report tidak ditemukan' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = disputeSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  try {
    const report = await disputeUsageReport(prisma, {
      usageReportId: payout.usageReport.id,
      disputedById,
      reason: parsed.data.reason,
    });

    return NextResponse.json({
      id: report.id,
      disputedAt: report.disputedAt,
      disputedReason: report.disputedReason,
      disputedById: report.disputedById,
    });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error disputing usage report:', error);
    return NextResponse.json({ error: 'Gagal menandai Usage Report dipertanyakan' }, { status: 500 });
  }
});

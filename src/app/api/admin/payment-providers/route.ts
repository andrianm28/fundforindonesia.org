import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import {
  paymentProviderSettingErrorToHttp,
  setPaymentProviderSetting,
} from '@/lib/payments/active-provider';

/**
 * POST /api/admin/payment-providers: an Admin chooses which Payment Provider
 * takes new charges and through which methods, without a deploy (prd-compliance
 * 39, PRD FFI-18). Body is `{ provider, methods }`, `methods` being PaymentMethod
 * values (`bank_transfer_va`, `qris_redirect`, `ewallet_redirect`) the provider
 * supports.
 *
 * An insert, never an edit (src/lib/payments/active-provider.ts): the choice in
 * force stays attributable to an Admin and a time. It changes only where NEW
 * charges go. Webhooks are verified by the provider in their own URL, so a
 * Payment made before a switch still settles, and credentials are never
 * accepted here -- a provider with no environment credentials is refused (409).
 *
 * ADMIN only.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  const actorId = session!.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  const { provider, methods } = parsed as Record<string, unknown>;
  try {
    const setting = await setPaymentProviderSetting(prisma, { provider, methods, actorId });
    return NextResponse.json({ setting }, { status: 201 });
  } catch (error) {
    const refusal = paymentProviderSettingErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});

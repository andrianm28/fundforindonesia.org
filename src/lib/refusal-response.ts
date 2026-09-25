import { NextResponse } from 'next/server';
import { domainErrorToHttp } from '@/lib/domain-errors';

/**
 * The HTTP answer for a typed refusal (its status, Indonesian message and
 * code, through `domainErrorToHttp`), or null for anything else, which the
 * route logs and answers as its own 500. Shared by the Payout and Refund
 * routes so none of them maps a money error by hand.
 */
export function refusalResponse(error: unknown): NextResponse | null {
  const refusal = domainErrorToHttp(error);
  return refusal ? NextResponse.json(refusal.body, { status: refusal.status }) : null;
}

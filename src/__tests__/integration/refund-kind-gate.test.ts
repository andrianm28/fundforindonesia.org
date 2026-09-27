import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Assignment, Kind } from '@/generated/prisma/client';

/**
 * The Refund route against the per-Kind rule (PRD §196; ADR 0013).
 *
 * Reachability, and why this file mocks what it mocks. The route is the only
 * caller of `createRefund` for a Campaign, and it is Admin-only, so an Admin's
 * POST is the whole externally reachable shape of this bug -- and on a fresh
 * database it is a real one: prisma/seed.ts writes Active zakat Campaigns with
 * settled Payments and real ledger entries behind them, so the request this
 * test refuses is one that used to succeed against seeded data for real
 * rupiah. The gate itself is proved at its own seam in
 * src/lib/money/refunds.test.ts, with the seeded shape (zakat, Rp 1_000_000,
 * an ordinary request) and no mock of it.
 *
 * What is left to prove HERE is the route's own half, and it is not nothing:
 * `reason` is free text off the wire, so a route that normalised, defaulted or
 * rewrote it would quietly launder the one input the gate reads, and a route
 * that let the refusal fall through to its `catch` would answer 500 and hide
 * the rule behind an "Error creating refund". So `createRefund` is mocked to
 * refuse the way the real one refuses -- with the real error class, imported
 * from ./money/errors, which is not mocked -- and these tests pin that the
 * request body's reason reaches the domain verbatim and that the refusal comes
 * back as itself.
 */

const createRefund = vi.fn();
vi.mock('@/lib/money/refunds', () => ({ createRefund: (...args: unknown[]) => createRefund(...args) }));

const campaignFindUnique = vi.fn();
const paymentFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: (...args: unknown[]) => campaignFindUnique(...args) },
    payment: { findUnique: (...args: unknown[]) => paymentFindUnique(...args) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb('tx')),
  },
}));

const getServerSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getServerSession: () => getServerSession() }));

import { RefundNotAllowedForKindError } from '@/lib/money/errors';
import { POST } from '@/app/api/campaigns/[slug]/refunds/route';

const slug = 'zakat-fitrah-untuk-mustahik-sekitar-kita';
const campaignId = 'campaign-zakat-1';

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/campaigns/${slug}/refunds`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

describe('POST /api/campaigns/[slug]/refunds, against the per-Kind rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({
      user: { id: 'admin-1', assignments: [Assignment.ADMIN] },
    });
    // The seeded shape: an Active Campaign that a Payment was donated to. The
    // route reads only its id, because the Kind is the money layer's business,
    // read under the subject lock where it cannot be stale.
    campaignFindUnique.mockResolvedValue({ id: campaignId });
    paymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId } });
  });

  it('refuses an ordinary donor request on a zakat Campaign, and does not create the Refund', async () => {
    createRefund.mockRejectedValue(
      new RefundNotAllowedForKindError(Kind.ZAKAT, ['salah bayar', 'bayar ganda', 'dana masuk setelah Campaign ditutup']),
    );

    const response = await post({ paymentId: 'payment-1', amount: 1_000_000, reason: 'Permintaan donatur' });

    // 403 with its own code, not the route's 500: a rule that hides behind
    // "Gagal membuat refund" is a rule nobody can see working.
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'REFUND_NOT_ALLOWED_FOR_KIND' });
  });

  it('hands the reason to the money layer exactly as the Admin typed it -- no default, no rewrite', async () => {
    // The gate reads one free-text field, so a route that tidied it up would be
    // laundering the only input there is. This is the assertion that keeps the
    // two halves honest: whatever the Admin sends is what gets judged.
    createRefund.mockRejectedValue(new RefundNotAllowedForKindError(Kind.ZAKAT, ['salah bayar']));

    await post({ paymentId: 'payment-1', amount: 1_000_000, reason: '  Permintaan donatur  ' });

    expect(createRefund).toHaveBeenCalledWith(
      'tx',
      expect.objectContaining({ reason: '  Permintaan donatur  ', amount: 1_000_000, requestedById: 'admin-1' }),
    );
  });

  it('still creates the Refund when the money layer permits it', async () => {
    // The other direction, so the pair cannot pass by the route refusing
    // everything: an allowed request reaches the money layer and its row comes
    // back as the 201 it always was.
    createRefund.mockResolvedValue({
      id: 'refund-1',
      paymentId: 'payment-1',
      amount: 1_000_000,
      reason: 'salah bayar',
      status: 'REQUESTED',
      createdAt: new Date('2026-09-27'),
    });

    const response = await post({ paymentId: 'payment-1', amount: 1_000_000, reason: 'salah bayar' });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'refund-1', status: 'REQUESTED' });
  });
});

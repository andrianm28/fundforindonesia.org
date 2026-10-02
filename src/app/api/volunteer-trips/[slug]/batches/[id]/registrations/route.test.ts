import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    paymentProviderSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    payment: { create: vi.fn() },
    chargeWriteFailure: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: vi.fn(),
  PaymentProviderNotConfiguredError: class extends Error {},
}));

vi.mock('@/lib/volunteer/trip', () => ({
  holdRegistration: vi.fn(),
}));

vi.mock('@/lib/donations', () => ({
  donationsEnabled: vi.fn(),
  sandboxInProductionReason: vi.fn(),
  DONATIONS_DISABLED_MESSAGE:
    'Donasi sedang tidak tersedia karena sistem pembayaran sedang disiapkan.',
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';
import { holdRegistration } from '@/lib/volunteer/trip';
import { donationsEnabled, sandboxInProductionReason } from '@/lib/donations';
import {
  AlreadyRegisteredError,
  BatchFullError,
  BatchNotFoundError,
  BatchNotTakingRegistrationsError,
  RegistrationDeadlinePassedError,
  TripNotTakingRegistrationsError,
} from '@/lib/volunteer-trip-errors';
import { ESCROW_HOLD_DAYS } from '@/lib/money/escrow';
import { POST } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPaymentCreate = prisma.payment.create as unknown as Mock;
const mockChargeWriteFailureCreate = prisma.chargeWriteFailure.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;
const mockHoldRegistration = holdRegistration as unknown as Mock;
const mockDonationsEnabled = donationsEnabled as unknown as Mock;
const mockSandboxInProductionReason = sandboxInProductionReason as unknown as Mock;

function createRequest(body: unknown = { paymentMethod: 'qris' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches/batch-1/registrations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug', id = 'batch-1') {
  return { params: Promise.resolve({ slug, id }) };
}

describe('POST /api/volunteer-trips/[slug]/batches/[id]/registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', 'true');
    mockDonationsEnabled.mockReturnValue(true);
    mockSandboxInProductionReason.mockReturnValue(null);
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'qris_redirect',
      createCharge: vi.fn().mockResolvedValue({
        method: 'qris_redirect',
        redirectUrl: 'https://pay.sumopod.com/x',
        expiresAt: new Date('2026-12-01'),
      }),
    });
    mockHoldRegistration.mockResolvedValue({
      registration: { id: 'registration-1', volunteerId: 'volunteer-1', batchId: 'batch-1', status: 'HOLD' },
      tripFeeAmount: 1_500_000,
    });
  });

  it.each([[undefined], ['false'], ['TRUE'], ['1']])(
    'refuses with a clear message when NEXT_PUBLIC_VOLUNTEER_ENABLED is %s (ticket 36), before the session, the Trip or any hold',
    async (value) => {
      if (value === undefined) vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', '');
      else vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', value);
      const createCharge = vi.fn();
      mockGetPaymentProvider.mockReturnValue({ name: 'sumopod', method: 'qris_redirect', createCharge });

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(503);
      expect((await response.json()).error).toMatch(/Pendaftaran Volunteer Trip belum dibuka/);
      expect(mockGetServerSession).not.toHaveBeenCalled();
      expect(mockTripFindUnique).not.toHaveBeenCalled();
      expect(mockHoldRegistration).not.toHaveBeenCalled();
      expect(createCharge).not.toHaveBeenCalled();
      expect(mockPaymentCreate).not.toHaveBeenCalled();
    },
  );

  it('refuses to charge the Trip Fee when the money kill switch is off, holding nothing', async () => {
    // Owner decision 2026-09-28: Trip Fee is stopped by the SAME switch as
    // Donation -- one emergency switch stops all incoming money, not two
    // switches that can drift out of sync.
    mockDonationsEnabled.mockReturnValue(false);
    const createCharge = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ name: 'sumopod', method: 'qris_redirect', createCharge });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
    expect(createCharge).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('refuses to charge the Trip Fee when sandbox-in-production blocks it, holding nothing', async () => {
    mockSandboxInProductionReason.mockReturnValue('PAYMENT_PROVIDER=mock in production');
    const createCharge = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ name: 'sumopod', method: 'qris_redirect', createCharge });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
    expect(createCharge).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('returns 404 when no Trip has the URL slug, holding nothing', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext('wrong-slug'));
    expect(response.status).toBe(404);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('asks the module to hold a seat on the Batch of the URL Trip for the signed-in Volunteer', async () => {
    await POST(createRequest(), routeContext());
    expect(mockTripFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'some-slug' } }));
    expect(mockHoldRegistration).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-1',
    });
  });

  it('charges the Trip Fee the hold named and records a PENDING Payment for it', async () => {
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(201);
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationId: 'registration-1',
          donationId: undefined,
          amount: 1_500_000,
          status: 'PENDING',
        }),
      }),
    );
    expect(await response.json()).toMatchObject({ registrationId: 'registration-1', amount: 1_500_000 });
  });

  it('stores the QRIS link on the Payment so "Lanjutkan pembayaran" can show it again (ticket 37)', async () => {
    await POST(createRequest(), routeContext());
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ redirectUrl: 'https://pay.sumopod.com/x', vaNumber: null }),
      }),
    );
  });

  it.each([
    ['plain http', 'http://pay.sumopod.com/x'],
    ['a foreign host', 'https://evil.example/x'],
    ['javascript:', 'javascript:alert(1)'],
  ])('stores no link when the provider answers %s, so the HOLD falls back to cancel-and-reregister', async (_, redirectUrl) => {
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'qris_redirect',
      createCharge: vi.fn().mockResolvedValue({ method: 'qris_redirect', redirectUrl, expiresAt: new Date('2026-12-01') }),
    });
    const response = await POST(createRequest(), routeContext());
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ redirectUrl: null }) }),
    );
    expect(JSON.stringify(await response.json())).not.toContain(redirectUrl);
  });

  it('stores the Virtual Account number on the Payment for a bank transfer charge (ticket 37)', async () => {
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'bank_transfer_va',
      createCharge: vi.fn().mockResolvedValue({
        method: 'bank_transfer_va',
        vaNumber: '8808123456',
        expiresAt: new Date('2026-12-01'),
      }),
    });
    await POST(createRequest({ paymentMethod: 'bank_transfer' }), routeContext());
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ redirectUrl: null, vaNumber: '8808123456' }),
      }),
    );
  });

  it('records the provider under the one name the registry knows, whatever the adapter calls itself', async () => {
    // The same column, the same rule as a Donation's Payment: it is a join key
    // the Provider Balance groups by, so "SumoPod" and "sumopod" would file one
    // provider's money as two pots, each reconciling exactly against nothing.
    // The registry locks its builder keys, not the adapters' `name`, so the
    // spelling has to be resolved where the row is written.
    for (const name of ['SumoPod', 'sumopod']) {
      vi.clearAllMocks();
      mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
      mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
      mockGetPaymentProvider.mockReturnValue({
        name,
        method: 'qris_redirect',
        createCharge: vi.fn().mockResolvedValue({
          method: 'qris_redirect',
          redirectUrl: 'https://pay.sumopod.com/x',
          expiresAt: new Date('2026-12-01'),
        }),
      });
      mockHoldRegistration.mockResolvedValue({
        registration: { id: 'registration-1', volunteerId: 'volunteer-1', batchId: 'batch-1', status: 'HOLD' },
        tripFeeAmount: 1_500_000,
      });

      await POST(createRequest(), routeContext());

      expect(mockPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ provider: 'sumopod' }) }),
      );
    }
  });

  it('refuses an adapter whose name names no provider, before a charge exists at one', async () => {
    // Ahead of createCharge, for the same reason as the method check below it: a
    // charge created and then abandoned is a live payment link a Volunteer can
    // still pay into with nothing here expecting the money. And it is a defect
    // in the build rather than an outcome this Registration can be marked for,
    // so it is the route's 500 rather than a refusal with a code.
    const createCharge = vi.fn();
    mockGetPaymentProvider.mockReturnValue({
      name: 'zendesk',
      method: 'qris_redirect',
      createCharge,
    });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expect(createCharge).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('freezes the Escrow Hold length in force right now, the same one chargeDonation freezes on a Campaign Donation', async () => {
    await POST(createRequest(), routeContext());
    // Asserted against the shared constant rather than the literal 7, so that
    // moving the number to configuration moves this Payment with it. A test
    // pinning 7 here would still pass on the day Trip Fee silently starts
    // releasing on a different schedule than Donation, which is the exact
    // failure this guards against.
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ escrowHoldDays: ESCROW_HOLD_DAYS }),
      }),
    );
  });

  it.each([
    ['BatchNotFoundError', new BatchNotFoundError('batch-1'), 404, 'BATCH_NOT_FOUND'],
    ['TripNotTakingRegistrationsError', new TripNotTakingRegistrationsError('SUSPENDED'), 400, 'TRIP_NOT_TAKING_REGISTRATIONS'],
    ['BatchNotTakingRegistrationsError', new BatchNotTakingRegistrationsError('CLOSED'), 400, 'BATCH_NOT_TAKING_REGISTRATIONS'],
    ['RegistrationDeadlinePassedError', new RegistrationDeadlinePassedError(), 400, 'REGISTRATION_DEADLINE_PASSED'],
    ['BatchFullError', new BatchFullError(), 400, 'BATCH_FULL'],
    ['AlreadyRegisteredError', new AlreadyRegisteredError(), 400, 'ALREADY_REGISTERED'],
  ])('answers %s with %i through domainErrorToHttp, charging nothing', async (_name, error, status, code) => {
    mockHoldRegistration.mockRejectedValue(error);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('returns 503 when the payment provider is not configured, holding nothing', async () => {
    const { PaymentProviderNotConfiguredError } = await import('@/lib/payments');
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('PAYMENT_PROVIDER');
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(503);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown payment method, holding nothing', async () => {
    const response = await POST(createRequest({ paymentMethod: 'cash' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  // Ticket 52: the provider holds a live charge, this database holds no Payment
  // for it. The failure must be recorded so the charge can be reconciled.
  it('records a ChargeWriteFailure when the charge succeeded but the Payment write failed', async () => {
    mockPaymentCreate.mockRejectedValue(new Error('connection reset'));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mockChargeWriteFailureCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sumopod',
        providerRef: 'registration-1',
        subjectType: 'registration',
        subjectId: 'registration-1',
        amount: 1_500_000,
        errorMessage: expect.stringContaining('connection reset'),
      }),
    });
  });

  it('never logs a raw Error or an email when the charge or the route fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockGetPaymentProvider.mockReturnValue({
        name: 'sumopod',
        method: 'qris_redirect',
        createCharge: vi.fn().mockRejectedValue(new Error('rejected payer volunteer@example.com')),
      });
      const charged = await POST(createRequest(), routeContext());
      expect(charged.status).toBe(503);

      mockHoldRegistration.mockRejectedValue(new Error('db failure for volunteer@example.com'));
      const failed = await POST(createRequest(), routeContext());
      expect(failed.status).toBe(500);

      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
      const args = spy.mock.calls.flat();
      expect(args.some((a) => a instanceof Error)).toBe(false);
      expect(args.some((a) => typeof a === 'string' && a.includes('@'))).toBe(false);
      expect(args.join(' ')).toContain('registration-1');
    } finally {
      spy.mockRestore();
    }
  });

  it('still answers 503 when recording the ChargeWriteFailure fails too', async () => {
    mockPaymentCreate.mockRejectedValue(new Error('db down'));
    mockChargeWriteFailureCreate.mockRejectedValue(new Error('db still down'));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(503);
  });
});

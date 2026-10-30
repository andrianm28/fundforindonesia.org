import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emailPayoutStatus,
  emailRefundOutcome,
  emailRegistrationConfirmed,
  emailSuspension,
  emailTripFeeRefundApproved,
} from './status-emails';
import { sealDonationGuestEmail, sealUserEmail } from './contact-fields';
import { MockMailer, type Mailer } from './mail';

/**
 * Who each ticket-68 email reaches, read after the change has committed, and
 * that nothing here ever throws back into the money path: a missing
 * recipient, a failed read and a failed send are each logged, by record id
 * and never by address.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const failing: Mailer = {
  name: 'failing',
  send: async () => {
    throw new Error('relay down');
  },
};

function payoutRow(overrides: Record<string, unknown> = {}) {
  return {
    amount: 750_000,
    requestedById: 'fundraiser-1',
    volunteerTripId: null,
    requestedBy: { name: 'Siti', ...sealUserEmail('siti@example.test') },
    bankAccount: { bankCode: 'BNI' },
    campaign: { title: 'Sumur Desa', slug: 'sumur-desa' },
    ...overrides,
  };
}

function prismaWith(rows: {
  payout?: unknown;
  trip?: unknown;
  refund?: unknown;
  registration?: unknown;
  campaign?: unknown;
  user?: unknown;
}) {
  return {
    payout: { findUnique: vi.fn().mockResolvedValue(rows.payout ?? null) },
    volunteerTrip: { findUnique: vi.fn().mockResolvedValue(rows.trip ?? null) },
    refund: { findUnique: vi.fn().mockResolvedValue(rows.refund ?? null) },
    registration: { findUnique: vi.fn().mockResolvedValue(rows.registration ?? null) },
    campaign: { findUnique: vi.fn().mockResolvedValue(rows.campaign ?? null) },
    user: { findUnique: vi.fn().mockResolvedValue(rows.user ?? null) },
  };
}

function logged(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

describe('emailPayoutStatus', () => {
  it('emails the Fundraiser who requested the Payout, linking their Campaign payout screen', async () => {
    const mailer = new MockMailer();
    await emailPayoutStatus(prismaWith({ payout: payoutRow() }) as never, { payoutId: 'p-1', event: 'approved' }, mailer);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('siti@example.test');
    expect(mailer.sent[0].text).toContain('Campaign "Sumur Desa"');
    expect(mailer.sent[0].text).toContain('rekening BNI');
    expect(mailer.sent[0].text).toContain('/akun/kampanye-saya/sumur-desa/pencairan');
  });

  it('names the Volunteer Trip of a Trip Payout and links the Trip screen', async () => {
    const mailer = new MockMailer();
    const prisma = prismaWith({
      payout: payoutRow({ campaign: null, volunteerTripId: 'trip-1' }),
      trip: { title: 'Trip Lombok', slug: 'trip-lombok' },
    });
    await emailPayoutStatus(prisma as never, { payoutId: 'p-1', event: 'completed', proofReference: 'TRX-9' }, mailer);

    expect(mailer.sent[0].text).toContain('Volunteer Trip "Trip Lombok"');
    expect(mailer.sent[0].text).toContain('TRX-9');
    expect(mailer.sent[0].text).toContain('/akun/volunteer-trip/trip-lombok');
  });

  it('logs and sends nothing when the Fundraiser has no readable address', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer = new MockMailer();
    const prisma = prismaWith({
      payout: payoutRow({ requestedBy: { name: 'Siti', emailCiphertext: null, emailKeyId: null } }),
    });
    await emailPayoutStatus(prisma as never, { payoutId: 'p-1', event: 'approved' }, mailer);

    expect(mailer.sent).toEqual([]);
    expect(logged(errors)).toEqual([expect.objectContaining({ event: 'mail_skipped', mail: 'payout_approved', payoutId: 'p-1' })]);
  });

  it('never throws: a failed read and a failed send are each logged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { payout: { findUnique: vi.fn().mockRejectedValue(new Error('db gone')) } };
    await expect(
      emailPayoutStatus(broken as never, { payoutId: 'p-1', event: 'approved' }, new MockMailer()),
    ).resolves.toBeUndefined();
    await expect(
      emailPayoutStatus(prismaWith({ payout: payoutRow() }) as never, { payoutId: 'p-2', event: 'approved' }, failing),
    ).resolves.toBeUndefined();

    const lines = logged(errors);
    expect(lines.map((l) => l.event)).toEqual(['mail_compose_failed', 'mail_send_failed']);
    expect(JSON.stringify(lines)).not.toContain('siti@example.test');
  });
});

describe('emailRefundOutcome', () => {
  function refundFor(payment: Record<string, unknown>) {
    return { amount: 100_000, payment: { amount: 100_000, donation: null, registration: null, ...payment } };
  }
  const campaign = { title: 'Sumur Desa' };

  it("emails a registered Donor at their account's address", async () => {
    const mailer = new MockMailer();
    const refund = refundFor({
      donation: {
        anonymisedAt: null,
        guestName: null,
        guestEmailCiphertext: null,
        guestEmailKeyId: null,
        donor: { name: 'Budi', ...sealUserEmail('budi@example.test') },
        campaign,
      },
    });
    await emailRefundOutcome(prismaWith({ refund }) as never, { refundId: 'r-1', outcome: 'completed' }, mailer);

    expect(mailer.sent[0].to).toBe('budi@example.test');
    expect(mailer.sent[0].text).toContain('Halo Budi,');
    expect(mailer.sent[0].text).toContain('"Sumur Desa"');
  });

  it('emails a Guest Donor at the address on the Donation', async () => {
    const mailer = new MockMailer();
    const refund = refundFor({
      donation: { anonymisedAt: null, guestName: 'Tamu', ...sealDonationGuestEmail('tamu@example.test'), donor: null, campaign },
    });
    await emailRefundOutcome(prismaWith({ refund }) as never, { refundId: 'r-1', outcome: 'failed' }, mailer);

    expect(mailer.sent[0].to).toBe('tamu@example.test');
    expect(mailer.sent[0].subject).toContain('belum berhasil');
  });

  it('emails the Volunteer whose Trip Fee a Registration Refund returns', async () => {
    const mailer = new MockMailer();
    const refund = refundFor({
      registration: {
        volunteer: { name: 'Rina', ...sealUserEmail('rina@example.test') },
        batch: { trip: { title: 'Trip Lombok', slug: 'lombok' } },
      },
    });
    await emailRefundOutcome(prismaWith({ refund }) as never, { refundId: 'r-1', outcome: 'completed' }, mailer);

    expect(mailer.sent[0].to).toBe('rina@example.test');
    expect(mailer.sent[0].text).toContain('"Trip Lombok"');
    expect(mailer.sent[0].subject).toBe('Refund Trip Fee "Trip Lombok" sudah ditransfer');
    expect(mailer.sent[0].text).toContain('penuh');
  });

  it('words a half Trip Fee Refund by its tier when it is completed', async () => {
    const mailer = new MockMailer();
    const refund = {
      amount: 50_000,
      payment: {
        amount: 100_000,
        donation: null,
        registration: {
          volunteer: { name: 'Rina', ...sealUserEmail('rina@example.test') },
          batch: { trip: { title: 'Trip Lombok', slug: 'lombok' } },
        },
      },
    };
    await emailRefundOutcome(prismaWith({ refund }) as never, { refundId: 'r-1', outcome: 'completed' }, mailer);

    expect(mailer.sent[0].text).toContain('separuh');
  });

  it('sends nothing for an anonymised Donation', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer = new MockMailer();
    const refund = refundFor({
      donation: {
        anonymisedAt: new Date(),
        guestName: null,
        guestEmailCiphertext: null,
        guestEmailKeyId: null,
        donor: null,
        campaign,
      },
    });
    await emailRefundOutcome(prismaWith({ refund }) as never, { refundId: 'r-1', outcome: 'completed' }, mailer);

    expect(mailer.sent).toEqual([]);
    expect(logged(errors)[0]).toMatchObject({ event: 'mail_skipped', refundId: 'r-1' });
  });
});

describe('emailSuspension', () => {
  it("emails the Campaign's Fundraiser with the reason", async () => {
    const mailer = new MockMailer();
    const prisma = prismaWith({
      campaign: { title: 'Sumur Desa', creatorId: 'fundraiser-1' },
      user: { name: 'Siti', ...sealUserEmail('siti@example.test') },
    });
    await emailSuspension(prisma as never, { campaignId: 'c-1', event: 'suspended', reason: 'Dokumen palsu' }, mailer);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fundraiser-1' } }));
    expect(mailer.sent[0].to).toBe('siti@example.test');
    expect(mailer.sent[0].text).toContain('Alasan: Dokumen palsu');
  });

  it('never throws when the send fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = prismaWith({
      campaign: { title: 'Sumur Desa', creatorId: 'fundraiser-1' },
      user: { name: 'Siti', ...sealUserEmail('siti@example.test') },
    });
    await expect(
      emailSuspension(prisma as never, { campaignId: 'c-1', event: 'lifted', reason: 'OK', statusLabel: 'Active' }, failing),
    ).resolves.toBeUndefined();
    expect(logged(errors)[0]).toMatchObject({ event: 'mail_send_failed', mail: 'suspension_lifted', campaignId: 'c-1' });
  });
});

describe('emailRegistrationConfirmed', () => {
  const registration = {
    volunteer: { name: 'Rina', ...sealUserEmail('rina@example.test') },
    payment: { amount: 500_000 },
    batch: {
      startDate: new Date('2026-12-01T00:00:00+07:00'),
      endDate: new Date('2026-12-05T23:59:59+07:00'),
      trip: { title: 'Trip Lombok', slug: 'lombok' },
    },
  };

  it('emails the Volunteer, linking the Trip page', async () => {
    const mailer = new MockMailer();
    await emailRegistrationConfirmed(prismaWith({ registration }) as never, { registrationId: 'reg-1' }, mailer);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('rina@example.test');
    expect(mailer.sent[0].subject).toBe('Pendaftaran "Trip Lombok" dikonfirmasi');
    expect(mailer.sent[0].text).toContain('/volunteer-trip/lombok');
  });

  it('never throws and logs by id when the Registration is gone or the send fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      emailRegistrationConfirmed(prismaWith({}) as never, { registrationId: 'reg-0' }, new MockMailer()),
    ).resolves.toBeUndefined();
    await expect(
      emailRegistrationConfirmed(prismaWith({ registration }) as never, { registrationId: 'reg-1' }, failing),
    ).resolves.toBeUndefined();

    const lines = logged(errors);
    expect(lines[0]).toMatchObject({ event: 'mail_skipped', mail: 'registration_confirmed', registrationId: 'reg-0' });
    expect(lines[1]).toMatchObject({ event: 'mail_send_failed', registrationId: 'reg-1' });
    expect(JSON.stringify(lines)).not.toContain('rina@example.test');
  });
});

describe('emailTripFeeRefundApproved', () => {
  const volunteerRefund = {
    amount: 250_000,
    payment: {
      amount: 500_000,
      registration: {
        volunteer: { name: 'Rina', ...sealUserEmail('rina@example.test') },
        batch: { trip: { title: 'Trip Lombok', slug: 'lombok' } },
      },
    },
  };

  it('emails the Volunteer, worded by the tier of the amount', async () => {
    const mailer = new MockMailer();
    await emailTripFeeRefundApproved(prismaWith({ refund: volunteerRefund }) as never, { refundId: 'r-1' }, mailer);

    expect(mailer.sent[0].to).toBe('rina@example.test');
    expect(mailer.sent[0].subject).toBe('Refund Trip Fee "Trip Lombok" disetujui');
    expect(mailer.sent[0].text).toContain('separuh');
  });

  it('sends and logs nothing for a Refund of a Donation', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer = new MockMailer();
    const refund = { amount: 1, payment: { amount: 1, registration: null } };
    await emailTripFeeRefundApproved(prismaWith({ refund }) as never, { refundId: 'r-2' }, mailer);

    expect(mailer.sent).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('never throws when the send fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      emailTripFeeRefundApproved(prismaWith({ refund: volunteerRefund }) as never, { refundId: 'r-1' }, failing),
    ).resolves.toBeUndefined();
    expect(logged(errors)[0]).toMatchObject({ event: 'mail_send_failed', mail: 'trip_fee_refund_approved', refundId: 'r-1' });
  });
});

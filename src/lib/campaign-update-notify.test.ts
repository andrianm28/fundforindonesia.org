import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyDonorsOfCampaignUpdate } from './campaign-update-notify';
import { sealDonationGuestEmail, sealUserEmail } from './contact-fields';
import { MockMailer, type Mailer } from './mail';

afterEach(() => {
  vi.restoreAllMocks();
});

const UPDATE = {
  id: 'upd-1',
  title: 'Sumur sudah jadi',
  content: 'Dana sudah disalurkan ke lokasi.',
  campaignId: 'c-1',
  campaign: { title: 'Sumur Desa', slug: 'sumur-desa' },
};

function registered(id: string, email: string, over: Record<string, unknown> = {}) {
  const sealed = sealUserEmail(email);
  return {
    id,
    isAnonymous: false,
    guestName: null,
    guestEmailHmac: null,
    guestEmailCiphertext: null,
    guestEmailKeyId: null,
    donor: {
      name: 'Siti',
      emailHmac: sealed.emailHmac,
      emailCiphertext: sealed.emailCiphertext,
      emailKeyId: sealed.emailKeyId,
    },
    ...over,
  };
}

function guest(id: string, email: string, over: Record<string, unknown> = {}) {
  const sealed = sealDonationGuestEmail(email);
  return {
    id,
    isAnonymous: false,
    guestName: 'Budi',
    guestEmailHmac: sealed.guestEmailHmac,
    guestEmailCiphertext: sealed.guestEmailCiphertext,
    guestEmailKeyId: sealed.guestEmailKeyId,
    donor: null,
    ...over,
  };
}

function prismaWith(donations: unknown[], update: unknown = UPDATE) {
  const findMany = vi.fn().mockResolvedValueOnce(donations).mockResolvedValue([]);
  return {
    prisma: {
      campaignUpdate: { findUnique: vi.fn().mockResolvedValue(update) },
      donation: { findMany },
    },
    findMany,
  };
}

describe('notifyDonorsOfCampaignUpdate', () => {
  it('emails registered and Guest Donors, each their own message linking the Campaign', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([registered('d1', 'siti@example.test'), guest('d2', 'budi@example.test')]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(result).toEqual({ recipients: 2, sent: 2 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['budi@example.test', 'siti@example.test']);
    for (const mail of mailer.sent) {
      expect(mail.subject).toContain('Sumur Desa');
      expect(mail.text).toContain('/campaign/sumur-desa');
      expect(mail.text).toContain('Sumur sudah jadi');
    }
  });

  it('asks only for confirmed, real-money, non-anonymised Donations', async () => {
    const { prisma, findMany } = prismaWith([]);
    await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, new MockMailer());

    expect(findMany.mock.calls[0][0].where).toEqual({
      campaignId: 'c-1',
      paymentStatus: 'confirmed',
      anonymisedAt: null,
      payments: { some: { status: 'PAID', sandbox: false } },
    });
  });

  it('sends one email per address however many Donations, registered or guest, carry it', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      registered('d1', 'siti@example.test'),
      registered('d2', 'siti@example.test'),
      guest('d3', 'budi@example.test'),
      guest('d4', 'Budi@Example.test'),
    ]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(result.recipients).toBe(2);
    expect(mailer.sent).toHaveLength(2);
  });

  it('still reaches an anonymous Donor, greeted without a name, and never names another Donor', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      registered('d1', 'siti@example.test', { isAnonymous: true }),
      guest('d2', 'budi@example.test'),
    ]);

    await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    const toSiti = mailer.sent.find((m) => m.to === 'siti@example.test')!;
    expect(toSiti.text.startsWith('Halo,')).toBe(true);
    expect(toSiti.text).not.toContain('Siti');
    const toBudi = mailer.sent.find((m) => m.to === 'budi@example.test')!;
    expect(toBudi.text.startsWith('Halo Budi,')).toBe(true);
    for (const mail of mailer.sent) {
      expect(mail.text).not.toContain('example.test');
      expect(mail.html).not.toContain('example.test');
    }
  });

  it('skips a Donation whose address is gone, without stopping the rest', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      guest('d1', 'x@example.test', { guestEmailHmac: null, guestEmailCiphertext: null, guestEmailKeyId: null }),
      guest('d2', 'budi@example.test'),
    ]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(result).toEqual({ recipients: 1, sent: 1 });
  });

  it('keeps going and never throws when one send fails, logging ids and not addresses', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: Mailer = {
      name: 'failing',
      send: async () => {
        throw new Error('relay down');
      },
    };
    const { prisma } = prismaWith([registered('d1', 'siti@example.test'), guest('d2', 'budi@example.test')]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, failing);

    expect(result).toEqual({ recipients: 2, sent: 0 });
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => JSON.parse(l).event === 'mail_send_failed' && !l.includes('example.test'))).toBe(true);
  });

  it('logs and returns when the update is missing or the query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer = new MockMailer();

    await notifyDonorsOfCampaignUpdate(prismaWith([], null).prisma as never, { updateId: 'gone' }, mailer);
    const broken = {
      campaignUpdate: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
      donation: { findMany: vi.fn() },
    };
    await expect(notifyDonorsOfCampaignUpdate(broken as never, { updateId: 'upd-1' }, mailer)).resolves.toEqual({
      recipients: 0,
      sent: 0,
    });

    expect(mailer.sent).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

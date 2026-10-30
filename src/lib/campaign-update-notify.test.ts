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
  createdAt: new Date('2026-10-30T10:00:00Z'),
  campaign: { title: 'Sumur Desa', slug: 'sumur-desa', lifecycleStatus: 'ACTIVE' },
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

function prismaWith(donations: unknown[], update: unknown = UPDATE, recentUpdates = 0) {
  const findMany = vi.fn().mockResolvedValueOnce(donations).mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(recentUpdates);
  const campaignFind = vi.fn().mockResolvedValue({ lifecycleStatus: 'ACTIVE' });
  return {
    campaignFind,
    prisma: {
      campaign: { findUnique: campaignFind },
      campaignUpdate: { findUnique: vi.fn().mockResolvedValue(update), count },
      donation: { findMany },
    },
    findMany,
    count,
  };
}

describe('notifyDonorsOfCampaignUpdate', () => {
  it('emails registered Donors, each their own message linking the Campaign', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([registered('d1', 'siti@example.test'), registered('d2', 'ani@example.test')]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(result).toEqual({ recipients: 2, sent: 2 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['ani@example.test', 'siti@example.test']);
    for (const mail of mailer.sent) {
      expect(mail.subject).toContain('Sumur Desa');
      expect(mail.text).toContain('/campaign/sumur-desa');
      expect(mail.text).toContain('Sumur sudah jadi');
    }
  });

  it('does not email Guest Donors (no opt-out yet), neither in the query nor if one slips through', async () => {
    const mailer = new MockMailer();
    const { prisma, findMany } = prismaWith([guest('d1', 'budi@example.test'), registered('d2', 'siti@example.test')]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(findMany.mock.calls[0][0].where.donorId).toEqual({ not: null });
    expect(result).toEqual({ recipients: 1, sent: 1 });
    expect(mailer.sent.map((m) => m.to)).toEqual(['siti@example.test']);
  });

  it('asks only for confirmed, real-money, non-anonymised Donations', async () => {
    const { prisma, findMany } = prismaWith([]);
    await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, new MockMailer());

    expect(findMany.mock.calls[0][0].where).toEqual({
      campaignId: 'c-1',
      paymentStatus: 'confirmed',
      anonymisedAt: null,
      donorId: { not: null },
      payments: { some: { status: 'PAID', sandbox: false } },
    });
  });

  it('sends one email per address however many Donations carry it', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      registered('d1', 'siti@example.test'),
      registered('d2', 'siti@example.test'),
      registered('d3', 'budi@example.test'),
      registered('d4', 'Budi@Example.test'),
    ]);

    const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

    expect(result.recipients).toBe(2);
    expect(mailer.sent).toHaveLength(2);
  });

  it('still reaches an anonymous Donor, greeted without a name, and never names another Donor', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      registered('d1', 'siti@example.test', { isAnonymous: true }),
      registered('d2', 'budi@example.test', { donor: { ...registered('x', 'budi@example.test').donor, name: 'Budi' } }),
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

  it('skips a Donor whose address is gone, without stopping the rest', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([
      registered('d1', 'x@example.test', {
        donor: { name: 'X', emailHmac: null, emailCiphertext: null, emailKeyId: null },
      }),
      registered('d2', 'budi@example.test'),
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
    const { prisma } = prismaWith([registered('d1', 'siti@example.test'), registered('d2', 'ani@example.test')]);

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

  it('names the reason for the email: the Donor supports this Campaign', async () => {
    const mailer = new MockMailer();
    const { prisma } = prismaWith([registered('d1', 'siti@example.test')]);
    await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);
    expect(mailer.sent[0].text).toContain('karena Anda mendukung Campaign ini');
  });

  it('a Donor with an anonymous and a named Donation is greeted without a name, whichever comes first', async () => {
    for (const order of [[true, false], [false, true]]) {
      const mailer = new MockMailer();
      const { prisma } = prismaWith(order.map((anon, i) => registered(`d${i}`, 'siti@example.test', { isAnonymous: anon })));
      await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].text.startsWith('Halo,')).toBe(true);
    }
  });

  describe('frequency limit (one emailed update per Campaign per WIB calendar day)', () => {
    it('counts the Campaign\'s earlier updates since the start of this update\'s WIB day', async () => {
      const { prisma, count } = prismaWith([]);
      await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, new MockMailer());
      // 10:00Z on 30 Oct = 17:00 WIB on 30 Oct; the WIB day began 29 Oct 17:00Z.
      expect(count).toHaveBeenCalledWith({
        where: {
          campaignId: 'c-1',
          id: { not: 'upd-1' },
          createdAt: { gte: new Date('2026-10-29T17:00:00Z'), lt: UPDATE.createdAt },
        },
      });
    });

    it('moves the day boundary at 17:00Z (midnight WIB)', async () => {
      for (const [at, from] of [
        ['2026-10-30T16:59:00Z', '2026-10-29T17:00:00Z'],
        ['2026-10-30T17:00:00Z', '2026-10-30T17:00:00Z'],
      ]) {
        const { prisma, count } = prismaWith([], { ...UPDATE, createdAt: new Date(at) });
        await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, new MockMailer());
        expect(count.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(from));
      }
    });

    it('sends nothing when an earlier update exists on the same WIB day', async () => {
      const mailer = new MockMailer();
      const { prisma, findMany } = prismaWith([registered('d1', 'siti@example.test')], UPDATE, 1);
      const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);
      expect(result).toEqual({ recipients: 0, sent: 0 });
      expect(mailer.sent).toHaveLength(0);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('still emails an update 23 hours after the previous one when that falls on another WIB day', async () => {
      // previous update 30 Oct 16:30Z (23:30 WIB, the 30th); this one is 1 hour later, 00:30 WIB on the 31st.
      const mailer = new MockMailer();
      const update = { ...UPDATE, createdAt: new Date('2026-10-30T17:30:00Z') }; // 00:30 WIB on the 31st
      const { prisma, count } = prismaWith([registered('d1', 'siti@example.test')], update, 0);
      const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);
      expect(count.mock.calls[0][0].where.createdAt.gte).toEqual(new Date('2026-10-30T17:00:00Z'));
      expect(result.sent).toBe(1);
    });
  });

  describe('circuit breaker', () => {
    it('stops after 5 consecutive failures and logs one line without addresses', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const send = vi.fn().mockRejectedValue(new Error('relay down'));
      const failing: Mailer = { name: 'failing', send };
      const donations = Array.from({ length: 9 }, (_, i) => registered(`d${i}`, `donor${i}@example.test`));
      const { prisma } = prismaWith(donations);

      const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, failing);

      expect(send).toHaveBeenCalledTimes(5);
      expect(result.sent).toBe(0);
      const aborted = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('campaign_update_notify_aborted'));
      expect(aborted).toHaveLength(1);
      expect(aborted[0]).not.toContain('example.test');
      expect(JSON.parse(aborted[0])).toMatchObject({ updateId: 'upd-1', consecutiveFailures: 5 });
    });

    it('a success resets the count', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      let n = 0;
      const send = vi.fn().mockImplementation(async () => {
        n += 1;
        if (n % 5 !== 0) throw new Error('flaky');
      });
      const donations = Array.from({ length: 12 }, (_, i) => registered(`d${i}`, `donor${i}@example.test`));
      const { prisma } = prismaWith(donations);

      await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, { name: 'flaky', send });

      expect(send).toHaveBeenCalledTimes(12);
    });
  });

  describe('state at send time', () => {
    it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'SUSPENDED', 'CANCELLED'])('sends nothing for a %s Campaign', async (status) => {
      const mailer = new MockMailer();
      const update = { ...UPDATE, campaign: { ...UPDATE.campaign, lifecycleStatus: status } };
      const { prisma, findMany } = prismaWith([registered('d1', 'siti@example.test')], update);
      const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);
      expect(result).toEqual({ recipients: 0, sent: 0 });
      expect(mailer.sent).toHaveLength(0);
      expect(findMany).not.toHaveBeenCalled();
    });

    it.each(['ACTIVE', 'COMPLETED', 'EXPIRED'])('sends for a %s Campaign', async (status) => {
      const mailer = new MockMailer();
      const update = { ...UPDATE, campaign: { ...UPDATE.campaign, lifecycleStatus: status } };
      const { prisma } = prismaWith([registered('d1', 'siti@example.test')], update);
      expect((await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer)).sent).toBe(1);
    });

    it('re-reads the status every 50 recipients and stops when the Campaign is suspended meanwhile', async () => {
      const mailer = new MockMailer();
      const donations = Array.from({ length: 120 }, (_, i) => registered(`d${i}`, `donor${i}@example.test`));
      const { prisma, campaignFind } = prismaWith(donations);
      campaignFind.mockResolvedValue({ lifecycleStatus: 'SUSPENDED' });

      const result = await notifyDonorsOfCampaignUpdate(prisma as never, { updateId: 'upd-1' }, mailer);

      expect(result.sent).toBe(50);
      expect(result.recipients).toBe(120);
    });
  });
});

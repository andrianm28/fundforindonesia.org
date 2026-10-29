import { describe, it, expect, vi, afterEach } from 'vitest';
import { liftSuspension, suspendCampaign } from './campaign-lifecycle';
import { sealUserEmail } from './contact-fields';
import { MockMailer, type Mailer } from './mail';
import { campaignRow, makeCampaignDb, userRow } from '../../tests/support/in-memory-campaign-db';

/**
 * The Fundraiser is emailed when a Suspension is imposed and when it is
 * lifted (ticket rilis-1-benda/68). The email goes out only once the change
 * has committed, and a failed send never undoes it.
 */
const NOW = new Date('2026-09-25T10:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');
const adminA = { userId: 'admin-a', assignments: ['ADMIN' as const] };
const adminB = { userId: 'admin-b', assignments: ['ADMIN' as const] };

const failing: Mailer = {
  name: 'failing',
  send: async () => {
    throw new Error('relay down');
  },
};

function seeded() {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: FUTURE })],
    users: [userRow({ id: 'creator-1', ...sealUserEmail('siti@example.test'), name: 'Siti' })],
  });
}

function suspend(db: ReturnType<typeof seeded>, mailer: Mailer) {
  return suspendCampaign(db.prisma as never, {
    campaignId: 'campaign-1',
    actor: adminA,
    reason: 'Laporan penipuan terverifikasi',
    now: NOW,
    mailer,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Suspension emails', () => {
  it('emails the Fundraiser the Suspension and its reason', async () => {
    const db = seeded();
    const mailer = new MockMailer();

    await suspend(db, mailer);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'siti@example.test' });
    expect(mailer.sent[0].subject).toContain('dibekukan');
    expect(mailer.sent[0].text).toContain('Alasan: Laporan penipuan terverifikasi');
  });

  it('emails the Fundraiser when a different Admin lifts it, naming the status it returned to', async () => {
    const db = seeded();
    await suspend(db, new MockMailer());
    const mailer = new MockMailer();

    await liftSuspension(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: adminB,
      reason: 'Klarifikasi diterima',
      now: NOW,
      mailer,
    });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toContain('dicabut');
    expect(mailer.sent[0].text).toContain('Alasan: Klarifikasi diterima');
    expect(mailer.sent[0].text).toMatch(/Campaign kini \S+\./);
  });

  it('keeps the Suspension when the email cannot be sent, and logs it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = seeded();

    await expect(suspend(db, failing)).resolves.toMatchObject({ campaign: { lifecycleStatus: 'SUSPENDED' } });

    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUSPENDED' });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"event":"mail_send_failed"'));
  });

  it('sends nothing when the Suspension is refused', async () => {
    const db = seeded();
    const mailer = new MockMailer();
    await suspend(db, new MockMailer());

    await expect(suspend(db, mailer)).rejects.toThrow();

    expect(mailer.sent).toEqual([]);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { decideVerificationRequest } from './campaign-lifecycle';
import { MockMailer, MailerNotConfiguredError, type Mailer } from './mail';
import {
  campaignRow,
  makeCampaignDb,
  userRow,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * The Fundraiser learns the outcome of their Verification Request by email
 * (prd-compliance 13). The email goes out only once the decision is
 * committed, and a failed send never undoes the decision: it is reported to
 * the operator instead.
 */

const NOW = new Date('2026-09-25T10:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const CHECKLIST = [{ id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: false }];

function seeded() {
  return makeCampaignDb({
    campaigns: [campaignRow()],
    verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: CHECKLIST })],
    users: [userRow({ id: 'creator-1', email: 'siti@example.test', name: 'Siti' })],
  });
}

function approve(db: ReturnType<typeof seeded>, mailer: Mailer, ticked: string[] = ['item-1']) {
  return decideVerificationRequest(db.prisma as never, {
    campaignId: 'campaign-1',
    requestId: 'verification-open',
    actor: verifier,
    decision: 'approve',
    ticked,
    now: NOW,
    mailer,
  });
}

function reject(db: ReturnType<typeof seeded>, mailer: Mailer) {
  return decideVerificationRequest(db.prisma as never, {
    campaignId: 'campaign-1',
    requestId: 'verification-open',
    actor: verifier,
    decision: 'reject',
    reason: 'Foto KTP tidak terbaca.',
    now: NOW,
    mailer,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('decideVerificationRequest emails the Fundraiser', () => {
  it('on approval, tells them their Campaign was diloloskan, with its link', async () => {
    const mailer = new MockMailer();

    await approve(seeded(), mailer);

    expect(mailer.sent).toHaveLength(1);
    const [email] = mailer.sent;
    expect(email.to).toBe('siti@example.test');
    expect(email.subject).toBe('Campaign "Bantu Korban Banjir" diloloskan');
    expect(email.text).toContain('Halo Siti,');
    expect(email.text).toMatch(/\/campaign\/bantu-korban-banjir/);
  });

  it('on rejection, tells them it was ditolak and why', async () => {
    const mailer = new MockMailer();

    await reject(seeded(), mailer);

    expect(mailer.sent).toHaveLength(1);
    const [email] = mailer.sent;
    expect(email.to).toBe('siti@example.test');
    expect(email.subject).toBe('Campaign "Bantu Korban Banjir" ditolak');
    expect(email.text).toContain('Alasan: Foto KTP tidak terbaca.');
  });

  it('sends only after the decision is committed', async () => {
    const db = seeded();
    const seenAtSend: string[] = [];
    const mailer: Mailer = {
      name: 'observing',
      send: async () => {
        seenAtSend.push(db.campaign().lifecycleStatus);
      },
    };

    await approve(db, mailer);

    expect(seenAtSend).toEqual(['ACTIVE']);
  });

  it('sends nothing when the decision is refused', async () => {
    const mailer = new MockMailer();

    await expect(approve(seeded(), mailer, [])).rejects.toThrow();

    expect(mailer.sent).toEqual([]);
  });
});

describe('decideVerificationRequest when the email fails', () => {
  const failing: Mailer = {
    name: 'failing',
    send: async () => {
      throw new Error('535 Authentication failed');
    },
  };

  it('keeps the decision, because the email is a report of it, not part of it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = seeded();

    const result = await approve(db, failing);

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(db.verificationRequests[0].outcome).toBe('APPROVED');
  });

  it('logs a structured error an operator can find, naming the request and the Fundraiser but not their address', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reject(seeded(), failing);

    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(error.mock.calls[0][0]));
    expect(logged).toMatchObject({
      event: 'mail_send_failed',
      mail: 'verification_outcome',
      provider: 'failing',
      campaignId: 'campaign-1',
      verificationRequestId: 'verification-open',
      userId: 'creator-1',
      error: '535 Authentication failed',
    });
    expect(JSON.stringify(logged)).not.toContain('siti@example.test');
  });
});

describe('decideVerificationRequest with no Mailer configured', () => {
  it('refuses to decide in production rather than decide in silence', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const key of ['MAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM']) {
      vi.stubEnv(key, '');
    }
    const db = seeded();

    await expect(
      decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ['item-1'],
        now: NOW,
      }),
    ).rejects.toThrow(MailerNotConfiguredError);

    expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
  });

  it('uses the mock Mailer by default outside production', async () => {
    const db = seeded();

    const result = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked: ['item-1'],
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
  });
});

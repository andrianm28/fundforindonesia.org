// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { sealUserEmail } from '@/lib/contact-fields';

/**
 * Organisation team members against a REAL Postgres (ticket E4; owner decision
 * 2026-10-04): the organisation's primary Fundraiser invites people by email, a
 * signed-in person with that verified address accepts once, a member reads the
 * organisation's Campaigns and nothing else, and no member can request a Payout
 * or hold a Bank Account. Same setup as tim-csr-real-db.test.ts: a throwaway
 * database migrated by replaying every migration, and a visible skip when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('organisation team members -- against real Postgres (E4)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[org team] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `org_team_${process.pid}`;
  let prisma: PrismaClient;
  let session: { user: { id: string; assignments: string[] } } | null = null;
  let lib: typeof import('@/lib/organisation-team');
  let payouts: typeof import('@/lib/money/payouts');
  let bankAccounts: typeof import('@/lib/bank-account-verification');
  let teamRoute: typeof import('@/app/api/organisation/team/route');
  let invitationsRoute: typeof import('@/app/api/organisation/team/invitations/route');
  let invitationRoute: typeof import('@/app/api/organisation/team/invitations/[id]/route');
  let memberRoute: typeof import('@/app/api/organisation/team/members/[id]/route');
  let acceptRoute: typeof import('@/app/api/organisation/team/accept/route');
  let campaignsRoute: typeof import('@/app/api/organisation/campaigns/route');
  let mails: Array<{ to: string; subject: string; text: string }> = [];
  let mailsDeliver = true;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    const url = databaseUrlFor(databaseName);
    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    try {
      const dirs = readdirSync(MIGRATIONS_DIR)
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    vi.doMock('@/lib/auth', () => ({ getServerSession: async () => session }));
    vi.doMock('@/lib/mail', async (importOriginal) => {
      const original = await importOriginal<typeof import('@/lib/mail')>();
      return {
        ...original,
        sendReportingFailure: async (message: { to: string; subject: string; text: string }) => {
          if (!mailsDeliver) return false;
          mails.push({ to: message.to, subject: message.subject, text: message.text });
          return true;
        },
      };
    });
    lib = await import('@/lib/organisation-team');
    payouts = await import('@/lib/money/payouts');
    bankAccounts = await import('@/lib/bank-account-verification');
    teamRoute = await import('@/app/api/organisation/team/route');
    invitationsRoute = await import('@/app/api/organisation/team/invitations/route');
    invitationRoute = await import('@/app/api/organisation/team/invitations/[id]/route');
    memberRoute = await import('@/app/api/organisation/team/members/[id]/route');
    acceptRoute = await import('@/app/api/organisation/team/accept/route');
    campaignsRoute = await import('@/app/api/organisation/campaigns/route');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let counter = 0;

  async function makeUser(email: string, opts: { verified?: boolean; name?: string } = {}): Promise<string> {
    const id = `u-${process.pid}-${counter++}`;
    await prisma.user.create({
      data: {
        id,
        name: opts.name ?? `Orang ${id}`,
        ...sealUserEmail(email),
        emailVerifiedAt: opts.verified === false ? null : new Date('2026-10-01T00:00:00Z'),
      },
    });
    return id;
  }

  /** An organisation with its primary Fundraiser account and one Campaign of each status given. */
  async function makeOrganisation(name: string, campaignTitles: string[] = []) {
    const registrar = await makeUser(`verifier-${counter}@platform.example`);
    const fundraiserId = await makeUser(`owner-${counter}@${name.toLowerCase().replace(/\W+/g, '')}.example`);
    const organisation = await prisma.partnerOrganisation.create({
      data: { name, fundraiserId, registeredById: registrar },
    });
    for (const title of campaignTitles) {
      await prisma.campaign.create({
        data: {
          slug: `${name}-${title}-${counter++}`.toLowerCase().replace(/\W+/g, '-'),
          title,
          description: 'd',
          story: 's',
          coverImage: '/c.png',
          targetAmount: 1_000_000,
          collectedAmount: 777_000,
          category: 'kesehatan',
          lifecycleStatus: 'ACTIVE',
          creatorId: fundraiserId,
          collectingEntityId: organisation.id,
        },
      });
    }
    return { organisationId: organisation.id, fundraiserId };
  }

  function as(userId: string | null) {
    session = userId ? { user: { id: userId, assignments: [] } } : null;
  }

  function jsonRequest(method: string, path: string, body?: unknown) {
    return new NextRequest(`http://localhost${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  function params(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  async function invite(ownerId: string | null, email: string) {
    as(ownerId);
    mails = [];
    return invitationsRoute.POST(jsonRequest('POST', '/api/organisation/team/invitations', { email }));
  }

  function tokenFromLastMail(): string {
    const link = mails.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/);
    if (!link) throw new Error('no invitation link was mailed');
    return link[1];
  }

  async function accept(userId: string | null, token: string) {
    as(userId);
    return acceptRoute.POST(jsonRequest('POST', '/api/organisation/team/accept', { token }));
  }

  describe('inviting', () => {
    it('the primary Fundraiser invites by email: a mail with a link goes out and only a hash of the token is stored', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Satu');
      const res = await invite(fundraiserId, 'Rani@Example.org');
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.invitation).toMatchObject({ delivered: true });
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe('rani@example.org');
      expect(mails[0].subject).toContain('Yayasan Satu');

      const token = tokenFromLastMail();
      const row = await prisma.organisationInvitation.findFirstOrThrow({ where: { partnerOrganisationId: organisationId } });
      expect(row.tokenHash).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('rani@example.org');
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(row.role).toBe('VIEWER');
    });

    it('a bad address is a 400 and nothing is stored', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Dua');
      expect((await invite(fundraiserId, 'bukan-email')).status).toBe(400);
      expect(await prisma.organisationInvitation.count({ where: { partnerOrganisationId: organisationId } })).toBe(0);
    });

    it('a mail that cannot be sent still leaves a usable invitation, reported as not delivered', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Tiga');
      mailsDeliver = false;
      try {
        const res = await invite(fundraiserId, 'eko@example.org');
        expect(res.status).toBe(201);
        expect((await res.json()).invitation.delivered).toBe(false);
      } finally {
        mailsDeliver = true;
      }
      expect(await prisma.organisationInvitation.count({ where: { partnerOrganisationId: organisationId, revokedAt: null } })).toBe(1);
    });

    it('inviting the same address again replaces the pending invitation, so the old link stops working', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Empat');
      const user = await makeUser('fitri@example.org');
      await invite(fundraiserId, 'fitri@example.org');
      const oldToken = tokenFromLastMail();
      await invite(fundraiserId, 'fitri@example.org');
      const newToken = tokenFromLastMail();
      expect((await accept(user, oldToken)).status).toBe(404);
      expect((await accept(user, newToken)).status).toBe(200);
    });

    it('a team member, a stranger and an anonymous visitor all get a literal 404 from the team routes', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Lima');
      const member = await makeUser('gita@example.org');
      await invite(fundraiserId, 'gita@example.org');
      await accept(member, tokenFromLastMail());
      const stranger = await makeUser('hadi@example.org');

      for (const who of [member, stranger, null]) {
        as(who);
        for (const res of [
          await teamRoute.GET(),
          await invitationsRoute.POST(jsonRequest('POST', '/api/organisation/team/invitations', { email: 'x@example.org' })),
          await invitationRoute.DELETE(jsonRequest('DELETE', '/x'), params('whatever')),
          await memberRoute.DELETE(jsonRequest('DELETE', '/x'), params('whatever')),
        ]) {
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: 'Not Found' });
        }
      }
    });
  });

  describe('accepting', () => {
    it('a signed-in person with the invited verified address joins, once', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Enam');
      const user = await makeUser('indra@example.org');
      await invite(fundraiserId, 'indra@example.org');
      const token = tokenFromLastMail();

      const res = await accept(user, token);
      expect(res.status).toBe(200);
      expect((await res.json()).membership).toMatchObject({ organisationName: 'Yayasan Enam' });
      const member = await prisma.organisationMember.findUniqueOrThrow({ where: { userId: user } });
      expect(member).toMatchObject({ partnerOrganisationId: organisationId, role: 'VIEWER', addedById: fundraiserId });

      // The same link, even from the same person, is spent.
      expect((await accept(user, token)).status).toBe(404);
      const other = await makeUser('indra2@example.org');
      expect((await accept(other, token)).status).toBe(404);
    });

    it('an anonymous visitor gets 401 and the invitation survives', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Tujuh');
      await invite(fundraiserId, 'joko@example.org');
      const token = tokenFromLastMail();
      expect((await accept(null, token)).status).toBe(401);
      const user = await makeUser('joko@example.org');
      expect((await accept(user, token)).status).toBe(200);
    });

    it('a different signed-in person cannot use the link: the same 404 as a link that does not exist, and the link stays usable', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Delapan');
      await invite(fundraiserId, 'kiki@example.org');
      const token = tokenFromLastMail();
      const thief = await makeUser('pencuri@example.org');
      const wrong = await accept(thief, token);
      const missing = await accept(thief, 'A'.repeat(43));
      expect(wrong.status).toBe(404);
      expect(await wrong.text()).toBe(await missing.text());
      expect(await prisma.organisationMember.count({ where: { userId: thief } })).toBe(0);
      const rightful = await makeUser('kiki@example.org');
      expect((await accept(rightful, token)).status).toBe(200);
    });

    it('an address that is not verified cannot accept, and can once it is', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Sembilan');
      await invite(fundraiserId, 'lina@example.org');
      const token = tokenFromLastMail();
      const user = await makeUser('lina@example.org', { verified: false });
      expect((await accept(user, token)).status).toBe(403);
      expect(await prisma.organisationMember.count({ where: { userId: user } })).toBe(0);
      await prisma.user.update({ where: { id: user }, data: { emailVerifiedAt: new Date() } });
      expect((await accept(user, token)).status).toBe(200);
    });

    it('an expired invitation is a 404', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Sepuluh');
      await invite(fundraiserId, 'maya@example.org');
      const token = tokenFromLastMail();
      await prisma.organisationInvitation.updateMany({
        where: { partnerOrganisationId: organisationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const user = await makeUser('maya@example.org');
      expect((await accept(user, token)).status).toBe(404);
    });

    it('a revoked invitation is a 404', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Sebelas');
      await invite(fundraiserId, 'nina@example.org');
      const token = tokenFromLastMail();
      const pending = await prisma.organisationInvitation.findFirstOrThrow({ where: { partnerOrganisationId: organisationId } });
      as(fundraiserId);
      expect((await invitationRoute.DELETE(jsonRequest('DELETE', '/x'), params(pending.id))).status).toBe(200);
      const user = await makeUser('nina@example.org');
      expect((await accept(user, token)).status).toBe(404);
    });

    it('two people racing for one link: exactly one joins', async () => {
      const { fundraiserId, organisationId } = await makeOrganisation('Yayasan Dua Belas');
      await invite(fundraiserId, 'omar@example.org');
      const token = tokenFromLastMail();
      const user = await makeUser('omar@example.org');
      const results = await Promise.all([accept(user, token), accept(user, token), accept(user, token)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.organisationMember.count({ where: { partnerOrganisationId: organisationId } })).toBe(1);
    });

    it('a person already on a team, and an organisation\'s own Fundraiser, cannot join another (409)', async () => {
      const first = await makeOrganisation('Yayasan Tiga Belas');
      const second = await makeOrganisation('Yayasan Empat Belas');
      const user = await makeUser('putri@example.org');
      await invite(first.fundraiserId, 'putri@example.org');
      await accept(user, tokenFromLastMail());
      await invite(second.fundraiserId, 'putri@example.org');
      const secondToken = tokenFromLastMail();
      expect((await accept(user, secondToken)).status).toBe(409);

      // The other organisation's primary account is invited to this one under its own address.
      await prisma.user.update({ where: { id: second.fundraiserId }, data: { ...sealUserEmail('ketua@example.org') } });
      await invite(first.fundraiserId, 'ketua@example.org');
      expect((await accept(second.fundraiserId, tokenFromLastMail())).status).toBe(409);
      expect(await prisma.organisationMember.count({ where: { userId: second.fundraiserId } })).toBe(0);
    });
  });

  describe('the team', () => {
    it('the primary Fundraiser sees members and pending invitations, with addresses', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Lima Belas');
      const member = await makeUser('qori@example.org', { name: 'Qori' });
      await invite(fundraiserId, 'qori@example.org');
      await accept(member, tokenFromLastMail());
      await invite(fundraiserId, 'rudi@example.org');

      as(fundraiserId);
      const body = await (await teamRoute.GET()).json();
      expect(body.organisationName).toBe('Yayasan Lima Belas');
      expect(body.members).toHaveLength(1);
      expect(body.members[0]).toMatchObject({ name: 'Qori', email: 'qori@example.org', role: 'VIEWER' });
      expect(body.invitations).toHaveLength(1);
      expect(body.invitations[0]).toMatchObject({ email: 'rudi@example.org', status: 'PENDING' });
    });

    it('removing a member ends their access at once', async () => {
      const { fundraiserId } = await makeOrganisation('Yayasan Enam Belas', ['Sumur']);
      const member = await makeUser('sari@example.org');
      await invite(fundraiserId, 'sari@example.org');
      await accept(member, tokenFromLastMail());
      as(member);
      expect((await campaignsRoute.GET()).status).toBe(200);

      const row = await prisma.organisationMember.findUniqueOrThrow({ where: { userId: member } });
      as(fundraiserId);
      expect((await memberRoute.DELETE(jsonRequest('DELETE', '/x'), params(row.id))).status).toBe(200);
      as(member);
      expect((await campaignsRoute.GET()).status).toBe(404);
    });

    it('one organisation cannot remove or revoke another\'s people, and learns nothing doing so', async () => {
      const mine = await makeOrganisation('Yayasan Tujuh Belas');
      const theirs = await makeOrganisation('Yayasan Delapan Belas');
      const theirMember = await makeUser('tono@example.org');
      await invite(theirs.fundraiserId, 'tono@example.org');
      await accept(theirMember, tokenFromLastMail());
      await invite(theirs.fundraiserId, 'umar@example.org');

      const memberRow = await prisma.organisationMember.findUniqueOrThrow({ where: { userId: theirMember } });
      const invitationRow = await prisma.organisationInvitation.findFirstOrThrow({
        where: { partnerOrganisationId: theirs.organisationId, acceptedAt: null, revokedAt: null },
      });
      as(mine.fundraiserId);
      expect((await memberRoute.DELETE(jsonRequest('DELETE', '/x'), params(memberRow.id))).status).toBe(404);
      expect((await invitationRoute.DELETE(jsonRequest('DELETE', '/x'), params(invitationRow.id))).status).toBe(404);
      expect(await prisma.organisationMember.count({ where: { id: memberRow.id } })).toBe(1);
      expect((await prisma.organisationInvitation.findUniqueOrThrow({ where: { id: invitationRow.id } })).revokedAt).toBeNull();

      const text = await (await teamRoute.GET()).text();
      expect(text).not.toContain('tono@example.org');
      expect(text).not.toContain('umar@example.org');
      expect(text).not.toContain('Yayasan Delapan Belas');
    });
  });

  describe('what a member sees', () => {
    it('only the organisation\'s own Campaigns, read-only, with no amounts', async () => {
      const mine = await makeOrganisation('Yayasan Sembilan Belas', ['Sumur Desa', 'Klinik Keliling']);
      const theirs = await makeOrganisation('Yayasan Dua Puluh', ['Rahasia Mereka']);
      const member = await makeUser('vina@example.org');
      await invite(mine.fundraiserId, 'vina@example.org');
      await accept(member, tokenFromLastMail());

      as(member);
      const res = await campaignsRoute.GET();
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body.organisationName).toBe('Yayasan Sembilan Belas');
      expect(body.access).toBe('MEMBER');
      expect(body.campaigns.map((c: { title: string }) => c.title).sort()).toEqual(['Klinik Keliling', 'Sumur Desa']);
      expect(text).not.toContain('Rahasia Mereka');
      expect(text).not.toContain(theirs.organisationId);
      expect(text).not.toMatch(/collectedAmount|targetAmount|777000|balance|bank/i);
    });

    it('the primary Fundraiser reads the same dashboard as OWNER; a stranger and an anonymous visitor get 404', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Satu', ['Satu']);
      as(mine.fundraiserId);
      expect((await (await campaignsRoute.GET()).json()).access).toBe('OWNER');
      const stranger = await makeUser('wawan@example.org');
      for (const who of [stranger, null]) {
        as(who);
        const res = await campaignsRoute.GET();
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found' });
      }
    });

    it('a member has no organisation id to pass: the organisation is always their own', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Dua', ['Milik Saya']);
      await makeOrganisation('Yayasan Dua Puluh Tiga', ['Milik Mereka']);
      const member = await makeUser('xena@example.org');
      await invite(mine.fundraiserId, 'xena@example.org');
      await accept(member, tokenFromLastMail());
      as(member);
      // GET takes no input at all: there is nowhere to name an organisation.
      expect(campaignsRoute.GET.length).toBe(0);
      const text = await (await campaignsRoute.GET()).text();
      expect(text).toContain('Milik Saya');
      expect(text).not.toContain('Milik Mereka');
    });
  });

  describe('no money access, enforced in the domain', () => {
    it('a team member cannot request a Payout even on a Campaign and a verified account of their own', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Empat');
      const member = await makeUser('yani@example.org');
      await invite(mine.fundraiserId, 'yani@example.org');
      await accept(member, tokenFromLastMail());
      const campaign = await prisma.campaign.create({
        data: {
          slug: `milik-anggota-${counter++}`,
          title: 'Milik anggota',
          description: 'd',
          story: 's',
          coverImage: '/c.png',
          targetAmount: 1_000_000,
          category: 'kesehatan',
          lifecycleStatus: 'ACTIVE',
          creatorId: member,
        },
      });
      const account = await prisma.bankAccount.create({
        data: { ownerId: member, bankCode: 'bca', accountName: 'Yani', accountNumberCiphertext: 'x', accountNumberKeyId: 'k', verifiedAt: new Date() },
      });
      await expect(
        prisma.$transaction((tx) =>
          payouts.requestPayout(tx, {
            subject: { type: 'campaign', campaignId: campaign.id },
            requestedById: member,
            bankAccountId: account.id,
            amount: 1000,
            description: 'x',
          }),
        ),
      ).rejects.toMatchObject({ code: 'TEAM_MEMBER_NO_MONEY_ACCESS' });
      expect(await prisma.payout.count({ where: { requestedById: member } })).toBe(0);
    });

    it('a team member cannot request a Payout on the organisation\'s Campaign using the primary account\'s bank account', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Lima', ['Dana Organisasi']);
      const member = await makeUser('zaki@example.org');
      await invite(mine.fundraiserId, 'zaki@example.org');
      await accept(member, tokenFromLastMail());
      const campaign = await prisma.campaign.findFirstOrThrow({ where: { creatorId: mine.fundraiserId } });
      const account = await prisma.bankAccount.create({
        data: { ownerId: mine.fundraiserId, bankCode: 'bca', accountName: 'Org', accountNumberCiphertext: 'x', accountNumberKeyId: 'k', verifiedAt: new Date() },
      });
      await expect(
        prisma.$transaction((tx) =>
          payouts.requestPayout(tx, {
            subject: { type: 'campaign', campaignId: campaign.id },
            requestedById: member,
            bankAccountId: account.id,
            amount: 1000,
            description: 'x',
          }),
        ),
      ).rejects.toMatchObject({ code: 'TEAM_MEMBER_NO_MONEY_ACCESS' });
    });

    it('a stranger who is not on the team is refused the organisation\'s Campaign by the ownership rule', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Enam', ['Dana Organisasi']);
      const stranger = await makeUser('aldo@example.org');
      const campaign = await prisma.campaign.findFirstOrThrow({ where: { creatorId: mine.fundraiserId } });
      const account = await prisma.bankAccount.create({
        data: { ownerId: stranger, bankCode: 'bca', accountName: 'Aldo', accountNumberCiphertext: 'x', accountNumberKeyId: 'k', verifiedAt: new Date() },
      });
      await expect(
        prisma.$transaction((tx) =>
          payouts.requestPayout(tx, {
            subject: { type: 'campaign', campaignId: campaign.id },
            requestedById: stranger,
            bankAccountId: account.id,
            amount: 1000,
            description: 'x',
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    });

    it('an accept waits for an in-flight money transaction of the same person: the two cannot interleave', async () => {
      const mine = await makeOrganisation('Yayasan Race');
      const person = await makeUser('race@example.org');
      await invite(mine.fundraiserId, 'race@example.org');
      const token = tokenFromLastMail();
      const { requireNotTeamMemberLocked } = await import('@/lib/organisation-member-guard');

      let acceptDone = false;
      let acceptPromise: Promise<Response> | undefined;
      await prisma.$transaction(async (tx) => {
        // The money write's side: not a member yet, lock held until commit.
        await requireNotTeamMemberLocked(tx, person);
        acceptPromise = accept(person, token).then((r) => {
          acceptDone = true;
          return r;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(acceptDone).toBe(false);
      });
      expect((await acceptPromise!).status).toBe(200);

      // And once the membership exists, the locked check refuses.
      await expect(prisma.$transaction((tx) => requireNotTeamMemberLocked(tx, person))).rejects.toMatchObject({
        code: 'TEAM_MEMBER_NO_MONEY_ACCESS',
      });
    });

    it('a team member cannot add a Bank Account, and the primary Fundraiser still can', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Tujuh');
      const member = await makeUser('bella@example.org');
      await invite(mine.fundraiserId, 'bella@example.org');
      await accept(member, tokenFromLastMail());
      const input = { bankCode: 'bca', accountName: 'Nama', accountNumber: '1234567890' };
      await expect(bankAccounts.createBankAccount(prisma, { ownerId: member, ...input })).rejects.toMatchObject({
        code: 'TEAM_MEMBER_NO_MONEY_ACCESS',
      });
      expect(await prisma.bankAccount.count({ where: { ownerId: member } })).toBe(0);
      await expect(bankAccounts.createBankAccount(prisma, { ownerId: mine.fundraiserId, ...input })).resolves.toMatchObject({
        ownerId: mine.fundraiserId,
      });
    });

    it('a team member cannot change the primary account\'s Bank Account, and it is untouched', async () => {
      const mine = await makeOrganisation('Yayasan Dua Puluh Delapan');
      const account = await bankAccounts.createBankAccount(prisma, {
        ownerId: mine.fundraiserId,
        bankCode: 'bca',
        accountName: 'Org',
        accountNumber: '1234567890',
      });
      const member = await makeUser('citra@example.org');
      await invite(mine.fundraiserId, 'citra@example.org');
      await accept(member, tokenFromLastMail());
      await expect(bankAccounts.deleteBankAccount(prisma, { accountId: account.id, ownerId: member })).rejects.toMatchObject({
        code: 'TEAM_MEMBER_NO_MONEY_ACCESS',
      });
      expect(await prisma.bankAccount.count({ where: { id: account.id } })).toBe(1);
    });
  });

  describe('the migration', () => {
    it('is additive: the new tables start empty beside existing organisations', async () => {
      const { organisationId } = await makeOrganisation('Yayasan Dua Puluh Sembilan');
      expect(await prisma.organisationMember.count({ where: { partnerOrganisationId: organisationId } })).toBe(0);
      expect(await prisma.organisationInvitation.count({ where: { partnerOrganisationId: organisationId } })).toBe(0);
    });
  });

  it('exports the access judgement for pages', async () => {
    const mine = await makeOrganisation('Yayasan Tiga Puluh');
    expect(await lib.organisationAccessOf(prisma, mine.fundraiserId)).toMatchObject({ access: 'OWNER', organisationName: 'Yayasan Tiga Puluh' });
    expect(await lib.organisationAccessOf(prisma, undefined)).toBeNull();
  });
});

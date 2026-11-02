import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import {
  readInvitationEmail,
  readUserEmail,
  sealInvitationEmail,
  lookupInvitationEmail,
  SELECT_INVITATION_EMAIL,
  SELECT_USER_EMAIL,
} from './contact-fields';
import { sendReportingFailure } from './mail';
import { organisationInvitationEmail } from './mail/organisation-invitation';
import { publicUrl } from './public-url';

/**
 * The team of a Partner Organisation (ticket E4; CONTEXT.md, Anggota tim; owner
 * decision 2026-10-04):
 *
 * (a) The organisation's primary Fundraiser account
 *     (`PartnerOrganisation.fundraiserId`) stays the owner. It invites people
 *     by email, revokes invitations and removes members. It is never a team row.
 * (b) A team member is an ordinary User with an `OrganisationMember` row, one
 *     team per person. It is NOT an Assignment (ADR 0005). The only role is
 *     VIEWER: it reads the organisation's Campaigns dashboard and nothing else.
 * (c) NO MONEY ACCESS. A member cannot request a Payout or add or change a
 *     Bank Account. That is enforced where the money is handled, not here and
 *     not in the UI: `requestPayout` (./money/payouts.ts) and the Bank Account
 *     commands (./bank-account-verification.ts) call `requireNotTeamMember`
 *     (./organisation-member-guard.ts). Payout approval and completion are
 *     untouched: they never consult a team, so the two-person rule and the
 *     segregation of duties are what they were.
 * (d) An invitation carries a random token of which only the SHA-256 is
 *     stored, expires after INVITATION_TTL_MS, is spent once, and can be
 *     revoked. Accepting needs a signed-in account whose VERIFIED email equals
 *     the invited address; the address is sealed like every contact (ADR 0012).
 *
 * PRIVACY. Every function here starts from the caller's own id and finds the
 * organisation through the caller's own ownership or membership; none takes an
 * organisation id from a caller, and an id of a member or invitation (to
 * remove or revoke) is only honoured inside the caller's own organisation.
 * Every caller who may not do the thing, signed in or not, gets
 * OrganisationTeamNotFoundError, which routes answer as a literal 404 (owner
 * rule), so a stranger cannot tell "no such organisation" from "not yours".
 */

// ==================== Refusals ====================

/** Not the organisation's owner (or member, where members may read). Always answered as 404. */
export class OrganisationTeamNotFoundError extends Error {
  constructor() {
    super('Not Found');
    this.name = 'OrganisationTeamNotFoundError';
  }
}

/** A malformed invitation request; `field` names the input. */
export class InvalidTeamInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'InvalidTeamInputError';
  }
}

/** The invited address is not verified on the accepting account yet. */
export class InvitationEmailNotVerifiedError extends Error {
  constructor() {
    super('Verifikasi email Anda dulu sebelum menerima undangan ini.');
    this.name = 'InvitationEmailNotVerifiedError';
  }
}

/** The account is already on a team, or is an organisation's own Fundraiser account. */
export class AlreadyOnTeamError extends Error {
  constructor() {
    super('Akun ini sudah terhubung dengan sebuah organisasi.');
    this.name = 'AlreadyOnTeamError';
  }
}

/** Too many pending invitations or members. */
export class TeamLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamLimitError';
  }
}

export function teamErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof OrganisationTeamNotFoundError) return { status: 404, error: 'Not Found' };
  if (error instanceof InvalidTeamInputError) return { status: 400, error: error.message };
  if (error instanceof InvitationEmailNotVerifiedError) return { status: 403, error: error.message };
  if (error instanceof AlreadyOnTeamError || error instanceof TeamLimitError) return { status: 409, error: error.message };
  return null;
}

// ==================== Limits ====================

/** A week: long enough for an inbox, short enough that a forgotten link dies. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITATIONS = 20;
export const MAX_TEAM_MEMBERS = 25;

const TOKEN_BYTES = 32;
/** base64url of TOKEN_BYTES random bytes: 43 characters, no padding. */
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 4) / 3);
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normaliseEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (email === '' || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvalidTeamInputError('Masukkan alamat email yang valid.', 'email');
  }
  return email;
}

// ==================== Access ====================

export type OrganisationAccess = {
  organisationId: string;
  organisationName: string;
  /** OWNER: the primary Fundraiser account. MEMBER: a VIEWER on the team. */
  access: 'OWNER' | 'MEMBER';
};

type Db = Pick<PrismaClient, 'partnerOrganisation' | 'organisationMember'>;

/**
 * The organisation the caller belongs to and how, or null. The one place a
 * caller's organisation is found; everything below starts here.
 */
export async function organisationAccessOf(db: Db, userId: string | null | undefined): Promise<OrganisationAccess | null> {
  if (!userId) return null;
  const owned = await db.partnerOrganisation.findUnique({
    where: { fundraiserId: userId },
    select: { id: true, name: true },
  });
  if (owned) return { organisationId: owned.id, organisationName: owned.name, access: 'OWNER' };
  const member = await db.organisationMember.findUnique({
    where: { userId },
    select: { partnerOrganisation: { select: { id: true, name: true } } },
  });
  if (!member) return null;
  return {
    organisationId: member.partnerOrganisation.id,
    organisationName: member.partnerOrganisation.name,
    access: 'MEMBER',
  };
}

async function requireOwner(db: Db, userId: string | null | undefined): Promise<OrganisationAccess> {
  const access = await organisationAccessOf(db, userId);
  if (!access || access.access !== 'OWNER') throw new OrganisationTeamNotFoundError();
  return access;
}

// ==================== Inviting ====================

export type InvitationResult = { id: string; expiresAt: Date; delivered: boolean };

/**
 * The owner invites an address. Any pending invitation to the same address is
 * revoked first, so a resend kills the old link. The mail is best effort: a
 * message that cannot be sent leaves the invitation in place, reported with
 * `delivered: false`, so the owner can revoke it or invite again.
 */
export async function inviteMember(
  prisma: PrismaClient,
  userId: string | null | undefined,
  input: { email: unknown },
  now: Date = new Date(),
): Promise<InvitationResult> {
  const { organisationId, organisationName } = await requireOwner(prisma, userId);
  const email = normaliseEmail(input.email);
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    // The same lock the owner row gives every invite of this organisation, so
    // two invitations racing past the limit cannot both slip through.
    await tx.$queryRaw`SELECT id FROM "PartnerOrganisation" WHERE id = ${organisationId} FOR UPDATE`;
    await tx.organisationInvitation.updateMany({
      where: { partnerOrganisationId: organisationId, ...lookupInvitationEmail(email), acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const pending = await tx.organisationInvitation.count({
      where: { partnerOrganisationId: organisationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    });
    if (pending >= MAX_PENDING_INVITATIONS) {
      throw new TeamLimitError(`Maksimal ${MAX_PENDING_INVITATIONS} undangan yang masih menunggu. Cabut sebagian dulu.`);
    }
    return tx.organisationInvitation.create({
      data: {
        partnerOrganisationId: organisationId,
        invitedById: userId!,
        ...sealInvitationEmail(email),
        tokenHash: hashToken(token),
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
  });

  const delivered = await sendReportingFailure(
    organisationInvitationEmail({
      to: email,
      organisationName,
      acceptUrl: publicUrl(`/akun/organisasi/terima?token=${token}`),
      expiresOn: expiresAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }),
    }),
    { mail: 'organisation_invitation', invitationId: invitation.id },
  );
  return { id: invitation.id, expiresAt: invitation.expiresAt, delivered };
}

/** The owner withdraws a pending invitation of their own organisation. Another organisation's is a 404. */
export async function revokeInvitation(
  prisma: PrismaClient,
  userId: string | null | undefined,
  invitationId: string,
  now: Date = new Date(),
): Promise<void> {
  const { organisationId } = await requireOwner(prisma, userId);
  const revoked = await prisma.organisationInvitation.updateMany({
    where: { id: invitationId, partnerOrganisationId: organisationId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) throw new OrganisationTeamNotFoundError();
}

/** The owner removes a member of their own organisation; their access ends with the row. */
export async function removeMember(
  prisma: PrismaClient,
  userId: string | null | undefined,
  memberId: string,
): Promise<void> {
  const { organisationId } = await requireOwner(prisma, userId);
  const removed = await prisma.organisationMember.deleteMany({ where: { id: memberId, partnerOrganisationId: organisationId } });
  if (removed.count !== 1) throw new OrganisationTeamNotFoundError();
}

// ==================== Reading the team ====================

export type TeamView = {
  organisationName: string;
  members: Array<{ id: string; name: string; email: string | null; role: 'VIEWER'; since: Date }>;
  invitations: Array<{ id: string; email: string | null; status: 'PENDING' | 'EXPIRED'; expiresAt: Date; createdAt: Date }>;
};

/** The owner's view of the team: members, and invitations still waiting (or lapsed). */
export async function listTeam(
  prisma: PrismaClient,
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<TeamView> {
  const { organisationId, organisationName } = await requireOwner(prisma, userId);
  const [members, invitations] = await Promise.all([
    prisma.organisationMember.findMany({
      where: { partnerOrganisationId: organisationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, createdAt: true, user: { select: { name: true, ...SELECT_USER_EMAIL } } },
    }),
    prisma.organisationInvitation.findMany({
      where: { partnerOrganisationId: organisationId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, createdAt: true, ...SELECT_INVITATION_EMAIL },
    }),
  ]);
  return {
    organisationName,
    members: members.map((m) => ({
      id: m.id,
      name: m.user.name,
      email: readUserEmail(m.user),
      role: m.role,
      since: m.createdAt,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: readInvitationEmail(i),
      status: i.expiresAt.getTime() > now.getTime() ? ('PENDING' as const) : ('EXPIRED' as const),
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    })),
  };
}

// ==================== Accepting ====================

class AcceptRefused extends Error {}

/**
 * Spends an invitation for the signed-in account. Every refusal about the LINK
 * (malformed, unknown, spent, revoked, expired, issued for another address) is
 * the same OrganisationTeamNotFoundError, so a caller learns nothing by
 * guessing and a stranger holding someone else's link learns nothing about
 * the organisation. Only the holder of the invited address is told that
 * verifying the email is what is missing.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  userId: string,
  token: unknown,
  now: Date = new Date(),
): Promise<{ organisationName: string }> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new OrganisationTeamNotFoundError();

  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.organisationInvitation.findUnique({
        where: { tokenHash: hashToken(token) },
        select: {
          id: true,
          partnerOrganisationId: true,
          invitedById: true,
          role: true,
          acceptedAt: true,
          revokedAt: true,
          expiresAt: true,
          ...SELECT_INVITATION_EMAIL,
          partnerOrganisation: { select: { name: true } },
        },
      });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt.getTime() <= now.getTime()) {
        throw new AcceptRefused();
      }

      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { emailVerifiedAt: true, ...SELECT_USER_EMAIL },
      });
      const accountEmail = account ? readUserEmail(account) : null;
      const invitedEmail = readInvitationEmail(invitation);
      if (!account || accountEmail === null || invitedEmail === null || accountEmail.trim().toLowerCase() !== invitedEmail) {
        throw new AcceptRefused();
      }
      if (account.emailVerifiedAt === null) throw new InvitationEmailNotVerifiedError();

      if (
        (await tx.partnerOrganisation.findUnique({ where: { fundraiserId: userId }, select: { id: true } })) ||
        (await tx.organisationMember.findUnique({ where: { userId }, select: { id: true } }))
      ) {
        throw new AlreadyOnTeamError();
      }
      await tx.$queryRaw`SELECT id FROM "PartnerOrganisation" WHERE id = ${invitation.partnerOrganisationId} FOR UPDATE`;
      if ((await tx.organisationMember.count({ where: { partnerOrganisationId: invitation.partnerOrganisationId } })) >= MAX_TEAM_MEMBERS) {
        throw new TeamLimitError('Tim organisasi ini sudah penuh.');
      }

      // The guard is in the where: of two opens of one link exactly one updates a row.
      const spent = await tx.organisationInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now, acceptedById: userId },
      });
      if (spent.count !== 1) throw new AcceptRefused();

      await tx.organisationMember.create({
        data: {
          partnerOrganisationId: invitation.partnerOrganisationId,
          userId,
          role: invitation.role,
          addedById: invitation.invitedById,
        },
      });
      return { organisationName: invitation.partnerOrganisation.name };
    });
  } catch (error) {
    if (error instanceof AcceptRefused) throw new OrganisationTeamNotFoundError();
    // Two accepts by one person racing: the unique userId keeps the first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AlreadyOnTeamError();
    throw error;
  }
}

// ==================== The member's dashboard ====================

export type OrganisationCampaignRow = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  lifecycleStatus: string;
  deadline: Date | null;
  createdAt: Date;
};

export type OrganisationDashboard = OrganisationAccess & { campaigns: OrganisationCampaignRow[] };

/**
 * The organisation's Campaigns dashboard, read-only, for its owner and its
 * members. The organisation is the caller's own. The Campaigns are the ones its
 * primary Fundraiser account created, and the rows carry no amounts, balances,
 * Payouts or Bank Accounts: a member has no money access, so the dashboard
 * does not show money either.
 */
export async function listOrganisationCampaigns(
  prisma: PrismaClient,
  userId: string | null | undefined,
): Promise<OrganisationDashboard> {
  const access = await organisationAccessOf(prisma, userId);
  if (!access) throw new OrganisationTeamNotFoundError();
  const organisation = await prisma.partnerOrganisation.findUniqueOrThrow({
    where: { id: access.organisationId },
    select: { fundraiserId: true },
  });
  const campaigns = await prisma.campaign.findMany({
    where: { creatorId: organisation.fundraiserId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, slug: true, title: true, kind: true, lifecycleStatus: true, deadline: true, createdAt: true },
  });
  return { ...access, campaigns };
}

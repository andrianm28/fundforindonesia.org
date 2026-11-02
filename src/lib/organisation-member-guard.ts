import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { TeamMemberMoneyAccessError } from './money/errors';

/**
 * The one question the money layer asks about an organisation's team (ticket
 * E4; CONTEXT.md, Anggota tim): is this person on one? A person on a Partner
 * Organisation's team holds no money access (owner decision 2026-10-04): they
 * cannot request a Payout or add or change a Bank Account. The primary
 * Fundraiser account of the organisation is never a team row, so it is
 * unaffected.
 *
 * Kept apart from ./organisation-team.ts, which sends mail and reads
 * Campaigns, so the Payout and Bank Account commands depend on this one
 * query and nothing else. The check reads `OrganisationMember.userId`, the
 * unique key, so it is a single index lookup.
 */
type Db = Pick<PrismaClient, 'organisationMember'> | Pick<Prisma.TransactionClient, 'organisationMember'>;

/** Read-only check, for a caller that holds no transaction. Money writes use the locked form below. */
export async function requireNotTeamMember(db: Db, userId: string): Promise<void> {
  const member = await db.organisationMember.findUnique({ where: { userId }, select: { id: true } });
  if (member) throw new TeamMemberMoneyAccessError();
}

/**
 * The same check inside the transaction that does the money write, after a
 * row lock on the User. Accepting an invitation takes the same lock before it
 * creates the membership (./organisation-team.ts), so a Payout request or Bank
 * Account write and an accept for one person cannot interleave: either the
 * accept commits first and this refuses, or this commits first and the accept
 * then runs after it.
 */
export async function requireNotTeamMemberLocked(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  await requireNotTeamMember(tx, userId);
}

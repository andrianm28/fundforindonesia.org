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

export async function requireNotTeamMember(db: Db, userId: string): Promise<void> {
  const member = await db.organisationMember.findUnique({ where: { userId }, select: { id: true } });
  if (member) throw new TeamMemberMoneyAccessError();
}

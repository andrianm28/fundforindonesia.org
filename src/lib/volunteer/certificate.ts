import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';

/**
 * Sertifikat Keikutsertaan (ticket 37; prd-audit/issues/10). The only place a
 * certificate is created: completeBatch calls `issueCertificates` inside its
 * own transaction, so a certificate exists exactly when the Batch was
 * completed with that Volunteer marked attended.
 */

type Tx = Prisma.TransactionClient;

const CODE_BYTES = 16;
/** base64url of 16 bytes, no padding: 22 characters of [A-Za-z0-9_-]. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * An unguessable public reference: 128 random bits from the OS CSPRNG. It is
 * the only thing standing between the public page and a stranger, so it is
 * never derived from an id, a counter or a time.
 */
export function generateCertificateCode(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

/** Cheap shape check, so a malformed code is a 404 without touching the database. */
export function isWellFormedCertificateCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Everything the public page may show, and nothing else. */
export type PublicCertificate = {
  code: string;
  volunteerName: string;
  tripTitle: string;
  destination: string;
  batchStartDate: Date;
  batchEndDate: Date;
  organizerName: string;
  issuedAt: Date;
};

/**
 * The public page's one read. Selects only the frozen copy on the certificate
 * row: it never joins the Registration, the Volunteer or the Trip, so no
 * email, phone or later profile change can reach the page. A malformed code
 * and an unknown code are the same null.
 */
export async function getCertificateByCode(
  prisma: Pick<PrismaClient, 'volunteerCertificate'>,
  code: string,
): Promise<PublicCertificate | null> {
  if (!isWellFormedCertificateCode(code)) return null;
  return prisma.volunteerCertificate.findUnique({
    where: { code },
    select: {
      code: true,
      volunteerName: true,
      tripTitle: true,
      destination: true,
      batchStartDate: true,
      batchEndDate: true,
      organizerName: true,
      issuedAt: true,
    },
  });
}

/**
 * Issue a certificate for each of `registrationIds`, which the caller has
 * already proved are CONFIRMED Registrations of `batch` marked attended.
 * Idempotent on the unique Registration: an existing certificate is left as
 * it was (name frozen at the first issue), never replaced or duplicated. Writes
 * no Refund and no ledger row.
 */
export async function issueCertificates(
  tx: Tx,
  params: {
    registrationIds: readonly string[];
    batch: { id: string; tripId: string; startDate: Date; endDate: Date };
    now: Date;
  },
): Promise<void> {
  const { registrationIds, batch, now } = params;
  if (registrationIds.length === 0) return;

  const trip = await tx.volunteerTrip.findUniqueOrThrow({ where: { id: batch.tripId } });
  const registrations = await tx.registration.findMany({
    where: { id: { in: [...registrationIds] }, batchId: batch.id },
  });
  const people = await tx.user.findMany({
    where: { id: { in: [...new Set([trip.fundraiserId, ...registrations.map((r) => r.volunteerId)])] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  await tx.volunteerCertificate.createMany({
    data: registrations.map((r) => ({
      registrationId: r.id,
      code: generateCertificateCode(),
      volunteerName: nameOf.get(r.volunteerId) ?? '',
      tripTitle: trip.title,
      destination: trip.destination,
      batchStartDate: batch.startDate,
      batchEndDate: batch.endDate,
      organizerName: nameOf.get(trip.fundraiserId) ?? '',
      issuedAt: now,
    })),
    skipDuplicates: true,
  });
}

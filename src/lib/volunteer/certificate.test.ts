import { describe, it, expect, vi } from 'vitest';
import { completeBatch } from './trip';
import { issueCertificates } from './certificate';
import { CertificateNameMissingError } from '@/lib/volunteer-trip-errors';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { generateCertificateCode, getCertificateByCode, isWellFormedCertificateCode } from './certificate';
import { batchRow, makeTripDb, registrationRow, tripRow } from '../../../tests/support/in-memory-trip-db';

const NOW = new Date('2026-09-26T10:00:00Z');
const fundraiser = { userId: 'fundraiser-1', assignments: [] };

const seed = () =>
  makeTripDb({
    users: [
      { id: 'fundraiser-1', name: 'Yayasan Penyelenggara' },
      { id: 'v-r1', name: 'Siti Aminah' },
      { id: 'v-r2', name: 'Budi Santoso' },
      { id: 'v-r3', name: 'Tidak Hadir' },
      { id: 'v-r4', name: 'Dibatalkan' },
    ],
    trips: [tripRow({ status: 'ACTIVE', title: 'Mengajar di Sumba', destination: 'Sumba' })],
    batches: [batchRow({ endDate: new Date('2026-09-20T00:00:00Z'), startDate: new Date('2026-09-15T00:00:00Z') })],
    registrations: [
      registrationRow({ id: 'r1', volunteerId: 'v-r1' }),
      registrationRow({ id: 'r2', volunteerId: 'v-r2' }),
      registrationRow({ id: 'r3', volunteerId: 'v-r3' }),
      registrationRow({ id: 'r4', volunteerId: 'v-r4', status: 'CANCELLED' }),
    ],
  });
const complete = (db: ReturnType<typeof seed>, ids: string[]) =>
  completeBatch(db.prisma as never, {
    tripId: 'trip-1',
    batchId: 'batch-1',
    actor: fundraiser,
    attendedRegistrationIds: ids,
    now: NOW,
  });

describe('Sertifikat Keikutsertaan issued by completeBatch (ticket 37)', () => {
  it('issues one certificate per attended CONFIRMED Registration and none for the others', async () => {
    const db = seed();
    await complete(db, ['r1', 'r2']);
    expect(db.certificates.map((c) => c.registrationId).sort()).toEqual(['r1', 'r2']);
  });

  it('freezes the names, Trip, destination, Batch dates and organizer at issue', async () => {
    const db = seed();
    await complete(db, ['r1']);
    expect(db.certificates).toEqual([
      expect.objectContaining({
        registrationId: 'r1',
        volunteerName: 'Siti Aminah',
        tripTitle: 'Mengajar di Sumba',
        destination: 'Sumba',
        batchStartDate: new Date('2026-09-15T00:00:00Z'),
        batchEndDate: new Date('2026-09-20T00:00:00Z'),
        organizerName: 'Yayasan Penyelenggara',
      }),
    ]);
  });

  it('issues nothing when nobody attended', async () => {
    const db = seed();
    await complete(db, []);
    expect(db.certificates).toEqual([]);
  });

  it('writes no Refund and no ledger row', async () => {
    const db = seed();
    await complete(db, ['r1', 'r2']);
    expect(db.refunds).toEqual([]);
    expect(db.ledgerEntries).toEqual([]);
  });

  it('gives every certificate a distinct, well-formed code', async () => {
    const db = seed();
    await complete(db, ['r1', 'r2', 'r3']);
    const codes = db.certificates.map((c) => c.code);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) expect(isWellFormedCertificateCode(code)).toBe(true);
  });

  it('issues nothing when the whole completion is refused (same transaction)', async () => {
    const db = seed();
    await complete(db, ['r1', 'r4']).catch(() => undefined);
    expect(db.certificates).toEqual([]);
  });

  it('does not issue twice when the Batch is completed again: the second call is refused and the certificate stays', async () => {
    const db = seed();
    await complete(db, ['r1']);
    const [first] = db.certificates;
    await expect(complete(db, ['r1', 'r2'])).rejects.toThrow();
    expect(db.certificates).toEqual([first]);
  });
});

describe('a certificate is never frozen with a blank name (ticket 37 review)', () => {
  const seedWith = (volunteerName: string, organizerName = 'Yayasan Penyelenggara') => {
    const db = seed();
    for (const u of db.users) {
      if (u.id === 'v-r1') u.name = volunteerName;
      if (u.id === 'fundraiser-1') u.name = organizerName;
    }
    return db;
  };

  it.each([[''], ['   '], ['\t\n']])('refuses to complete the Batch when a Volunteer name is %j, naming the fix', async (name) => {
    const db = seedWith(name);
    const error = await complete(db, ['r1', 'r2']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CertificateNameMissingError);
    expect(domainErrorToHttp(error)?.status).toBe(422);
    expect((error as Error).message).toMatch(/nama Volunteer/i);
    expect((error as Error).message).toMatch(/lengkapi/i);
    // All or nothing: no certificate for r2 either, and the Batch is still OPEN.
    expect(db.certificates).toEqual([]);
    expect(db.batches.find((b) => b.id === 'batch-1')?.status).toBe('OPEN');
  });

  it('refuses when the organizer (Fundraiser) name is blank', async () => {
    const db = seedWith('Siti Aminah', '  ');
    const error = await complete(db, ['r1']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CertificateNameMissingError);
    expect((error as Error).message).toMatch(/penyelenggara/i);
    expect(db.certificates).toEqual([]);
  });

  it('does not mind a blank name of a Volunteer who did not attend', async () => {
    const db = seedWith('');
    await complete(db, ['r2']);
    expect(db.certificates.map((c) => c.registrationId)).toEqual(['r2']);
  });

  it('freezes the name trimmed', async () => {
    const db = seedWith('  Siti Aminah ');
    await complete(db, ['r1']);
    expect(db.certificates[0].volunteerName).toBe('Siti Aminah');
  });
});

describe('issueCertificates defends itself (ticket 37 review)', () => {
  const batch = { id: 'batch-1', tripId: 'trip-1', startDate: new Date('2026-09-15T00:00:00Z'), endDate: new Date('2026-09-20T00:00:00Z') };

  it('throws for a Registration that is not CONFIRMED even if the caller let it through', async () => {
    const db = seed();
    await expect(
      db.prisma.$transaction((tx) => issueCertificates(tx as never, { registrationIds: ['r1', 'r4'], batch, now: NOW })),
    ).rejects.toThrow(/sertifikat/i);
    expect(db.certificates).toEqual([]);
  });

  it('throws for an id that names no Registration of the Batch', async () => {
    const db = seed();
    await expect(
      db.prisma.$transaction((tx) => issueCertificates(tx as never, { registrationIds: ['r1', 'nope'], batch, now: NOW })),
    ).rejects.toThrow(/sertifikat/i);
  });

  it('is idempotent: a Registration that already has its certificate is skipped, not an error', async () => {
    const db = seed();
    const run = () =>
      db.prisma.$transaction((tx) => issueCertificates(tx as never, { registrationIds: ['r1', 'r2'], batch, now: NOW }));
    await run();
    const first = db.certificates.map((c) => ({ ...c }));
    await run();
    expect(db.certificates).toEqual(first);
  });
});

describe('getCertificateByCode', () => {
  const stored = {
    code: 'abcdefghijklmnopqrstuv',
    volunteerName: 'Siti Aminah',
    tripTitle: 'Mengajar di Sumba',
    destination: 'Sumba',
    batchStartDate: new Date('2026-09-15T00:00:00Z'),
    batchEndDate: new Date('2026-09-20T00:00:00Z'),
    organizerName: 'Yayasan Penyelenggara',
    issuedAt: new Date('2026-09-26T10:00:00Z'),
  };

  it('asks only for the frozen copy: never the Registration, the Volunteer or any contact', async () => {
    const findUnique = vi.fn().mockResolvedValue(stored);
    const found = await getCertificateByCode({ volunteerCertificate: { findUnique } } as never, stored.code);
    expect(found).toEqual(stored);
    const args = findUnique.mock.calls[0][0];
    expect(args.where).toEqual({ code: stored.code });
    expect(Object.keys(args.select).sort()).toEqual(Object.keys(stored).sort());
    expect(args.include).toBeUndefined();
  });

  it('is null for an unknown code and for a malformed one, without querying for the latter', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = { volunteerCertificate: { findUnique } } as never;
    expect(await getCertificateByCode(db, stored.code)).toBeNull();
    findUnique.mockClear();
    expect(await getCertificateByCode(db, "x'; DROP TABLE")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('generateCertificateCode', () => {
  it('is long enough to be unguessable: 128 bits of randomness', () => {
    const code = generateCertificateCode();
    expect(code).toHaveLength(22);
    expect(isWellFormedCertificateCode(code)).toBe(true);
  });

  it('is not sequential or repeated across many draws', () => {
    const codes = Array.from({ length: 500 }, () => generateCertificateCode());
    expect(new Set(codes).size).toBe(500);
    // No shared prefix that a counter or timestamp would produce.
    expect(new Set(codes.map((c) => c.slice(0, 4))).size).toBeGreaterThan(450);
  });

  it('rejects malformed codes before any lookup', () => {
    for (const bad of ['', 'abc', 'x'.repeat(21), 'x'.repeat(23), `${'a'.repeat(21)}!`, `${'a'.repeat(21)} `]) {
      expect(isWellFormedCertificateCode(bad)).toBe(false);
    }
  });
});

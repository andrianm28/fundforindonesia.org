// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { findPrismaFieldReferences } from '../../tests/support/prisma-field-references';

/**
 * The Role hierarchy and the self-claimed verification are retired (spec
 * retire-role-hierarchy, ADR 0005). Authority comes from assignments and the
 * Capacity judgement; nothing reads or writes User `role`, `isVerified` or
 * `verificationType`. The columns stay, nullable and ignored, until ticket 03
 * drops them. This guard keeps it that way for application code and the seed.
 */
const SEED = 'prisma/seed.ts';
const CANARY = 'tests/support/user-role-canary.ts';
const RETIRED = ['role', 'isVerified', 'verificationType'];

describe('the retired User columns role, isVerified and verificationType', () => {
  let references: string[] = [];

  // Type-checks all of src, which takes a few seconds (more under load).
  beforeAll(() => {
    references = findPrismaFieldReferences({ model: 'User', fields: RETIRED, alsoScan: [SEED, CANARY] });
  }, 120_000);

  it('are named by no src file', () => {
    expect(references.filter((ref) => ref.startsWith('src/'))).toEqual([]);
  });

  it('are named nowhere in the seed', () => {
    expect(references.filter((ref) => ref.startsWith(`${SEED}:`))).toEqual([]);
  });

  // Proves the detector still sees the columns: if a change to Prisma's
  // generated types blinded it, the two tests above would pass vacuously.
  it('are still found in the canary that names them on purpose', () => {
    const canaryHits = references.filter((ref) => ref.startsWith(`${CANARY}:`));
    expect(canaryHits).toHaveLength(3);
  });
});

function applicationFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'generated' || entry === '__tests__' ? [] : applicationFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

// The type checker only sees Prisma's own types. A self-claimed verification
// can also travel as a hand-written field (a session, a view type, a JSON
// payload), and the session and JWT index signatures accept any key, so
// these are pinned by name.
describe('application code', () => {
  const files = [...applicationFiles('src'), SEED];
  const naming = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(file, 'utf8')));

  it('carries no self-claimed verification field anywhere', () => {
    expect(naming(/\b(isVerified|verificationType)\b/)).toEqual([]);
  });

  it('keeps no Role hierarchy helper', () => {
    expect(naming(/\b(withRoleCheck|isAtLeast|ROLE_LEVELS|hasRole|requireRole)\b|@\/lib\/roles/)).toEqual([]);
  });

  // With no route module, Next answers the old PATCH with 404: nothing can
  // set a Role any more. Assignments are edited through ../assignments.
  it('has no Role route under /api/admin/users/[id]', () => {
    expect(existsSync('src/app/api/admin/users/[id]/role')).toBe(false);
    expect(existsSync('src/app/api/admin/users/[id]/assignments/route.ts')).toBe(true);
  });

  it('puts no role in the session or the JWT', () => {
    expect(naming(/\brole\b/).filter((file) => ['src/lib/auth.ts', 'src/types/next-auth.d.ts'].includes(file))).toEqual([]);
  });
});

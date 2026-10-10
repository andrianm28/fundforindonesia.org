// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The Role hierarchy and the self-claimed verification are retired (spec
 * retire-role-hierarchy, ADR 0005). Authority comes from assignments and the
 * Capacity judgement. The columns are dropped (ticket 03; see
 * user-role-dropped.test.ts); this guard keeps the hand-written fields and
 * helpers out of application code and the seed.
 */
const SEED = 'prisma/seed.ts';

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

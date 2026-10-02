// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * ADR 0020: `User.emailVerifiedAt` confirms ONE address. Any write that sets
 * `email` or `emailHmac` on a User must set `emailVerifiedAt` in the same
 * `data`, or an account keeps a confirmation for an address it never proved
 * and can claim someone else's Guest Donor history.
 *
 * A cheap textual guard: it scans every non-test file under src/ for
 * `user.update` / `user.updateMany` / `user.upsert` calls and fails when the
 * call's argument writes `email` or `emailHmac` without `emailVerifiedAt`.
 * `user.create` is out of scope (a new User is born unverified).
 */

/** Files allowed to write the address without resetting verification, with the reason. */
const ALLOWLIST: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The balanced bracketed text starting at the opening bracket at `open`. */
function balanced(source: string, open: number, up: string, down: string): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === up) depth++;
    else if (source[i] === down && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

function offendingCalls(source: string): string[] {
  const calls = [...source.matchAll(/\buser\s*\.\s*(?:update|updateMany|upsert)\s*\(/g)];
  return calls
    .map((match) => balanced(source, match.index! + match[0].length - 1, '(', ')'))
    .filter((arg) => /\b(?:email|emailHmac)\s*:/.test(dataOf(arg)) && !/\bemailVerifiedAt\b/.test(arg));
}

/** Only the `data`/`update`/`create` payloads: a `where: { email: ... }` is a read, not a write. */
function dataOf(arg: string): string {
  return [...arg.matchAll(/\b(?:data|update|create)\s*:\s*\{/g)]
    .map((m) => balanced(arg, m.index! + m[0].length - 1, '{', '}'))
    .join('\n');
}

describe('ADR 0020: a write that changes a User email resets emailVerifiedAt', () => {
  it('no user.update in src/ writes email or emailHmac without emailVerifiedAt', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !(file.replace(/\\/g, '/') in ALLOWLIST))
      .filter((file) => offendingCalls(readFileSync(file, 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });

  describe('the scanner itself', () => {
    it('flags a write of email that leaves emailVerifiedAt alone', () => {
      expect(offendingCalls(`await prisma.user.update({ where: { id }, data: { email: next } })`)).toHaveLength(1);
      expect(offendingCalls(`await tx.user.updateMany({ where: { id }, data: { emailHmac: h } })`)).toHaveLength(1);
    });

    it('accepts a write that resets emailVerifiedAt alongside', () => {
      expect(
        offendingCalls(`await prisma.user.update({ where: { id }, data: { email: next, emailVerifiedAt: null } })`),
      ).toHaveLength(0);
    });

    it('does not mistake a where on email, or an unrelated write, for a change of address', () => {
      expect(offendingCalls(`await prisma.user.update({ where: { emailHmac: h }, data: { name: 'x' } })`)).toHaveLength(0);
      expect(offendingCalls(`await prisma.user.update({ where: { id }, data: { emailVerifiedAt: now } })`)).toHaveLength(0);
    });
  });
});

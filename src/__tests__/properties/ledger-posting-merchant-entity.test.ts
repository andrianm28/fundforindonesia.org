// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * pks-pemenuhan/04 (PKS 4.1(2), 10(4); ADR 0027): every ledger posting carries
 * the merchant entity. The type already makes `merchantEntity` a required
 * PostOptions field and postTransaction refuses a missing one at runtime; this
 * scan is the third lock, in the same shape as sandbox-mode.test.ts's: a call
 * site that satisfied the compiler through a spread of an untyped object, or a
 * cast, would still have to NAME the entity in the text of its call.
 *
 * It also pins that the one writer of ledger rows is postTransaction: nothing
 * else in src/ creates LedgerEntry rows, so there is no second path that could
 * skip the entity.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function callText(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

const files = sourceFiles('src');

describe('every ledger posting names its merchant entity', () => {
  const calls: Array<{ file: string; text: string }> = [];
  for (const file of files.filter((f) => !f.endsWith(join('money', 'ledger.ts')))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bpostTransaction\(/g)) {
      calls.push({ file, text: callText(source, match.index! + match[0].length - 1) });
    }
  }

  it('finds the call sites at all', () => {
    expect(new Set(calls.map((c) => c.file)).size).toBeGreaterThanOrEqual(7);
  });

  it.each(calls.map((c, i) => [`${c.file} #${i}`, c.text]))('%s passes `merchantEntity`', (_name, text) => {
    expect(text).toMatch(/\bmerchantEntity\b/);
  });
});

describe('postTransaction is the only writer of ledger rows', () => {
  it('no other source file calls ledgerEntry.create / createMany', () => {
    const writers = files.filter((f) => {
      if (f.endsWith(join('money', 'ledger.ts'))) return false;
      return /\bledgerEntry\.(create|createMany|createManyAndReturn|upsert)\b/.test(readFileSync(f, 'utf8'));
    });
    expect(writers).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { countTscErrors, countLintErrors, compare } from '../../ci/ratchet-counts.mjs';

describe('CI ratchet counts', () => {
  it('counts tsc error lines and ignores generated .next types', () => {
    const output = [
      "src/a.ts(1,1): error TS2345: Argument of type 'x'.",
      '  Type info continues on an indented line.',
      "src/b.test.ts(3,7): error TS2339: Property 'y'.",
      ".next/types/app/api/upload/route.ts(8,13): error TS2344: Type 'z'.",
      '',
    ].join('\n');
    expect(countTscErrors(output)).toBe(2);
  });

  it('sums ESLint errorCount, not warnings', () => {
    const json = JSON.stringify([
      { filePath: 'a.ts', errorCount: 2, warningCount: 5 },
      { filePath: 'b.ts', errorCount: 0, warningCount: 1 },
      { filePath: 'c.ts', errorCount: 3, warningCount: 0 },
    ]);
    expect(countLintErrors(json)).toBe(5);
  });

  it('fails a count above its baseline and names both numbers', () => {
    const [tsc] = compare({ tsc: 50 }, { tsc: 49 });
    expect(tsc.ok).toBe(false);
    expect(tsc.message).toContain('50');
    expect(tsc.message).toContain('49');
  });

  it('passes a count below its baseline and asks to lower it', () => {
    const [lint] = compare({ lint: 190 }, { lint: 194 });
    expect(lint.ok).toBe(true);
    expect(lint.message).toContain('Lower ci/baselines.json "lint" to 190');
  });

  it('passes a count at its baseline', () => {
    expect(compare({ tsc: 49, lint: 194 }, { tsc: 49, lint: 194 }).every((v: { ok: boolean }) => v.ok)).toBe(true);
  });
});

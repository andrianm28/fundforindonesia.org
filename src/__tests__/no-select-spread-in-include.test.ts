// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for the bug fixed in PR #171 (4e55f3b): a `...SELECT_*` spread
 * (a bag of scalar names, see src/lib/contact-fields.ts) placed directly in a
 * Prisma `include: { ... }`. `include` takes relations, not scalars, so Prisma
 * rejects the query at validation time -- and a mock-Prisma test never sees it.
 * A spread is fine inside a `select: { ... }`, including one nested in an
 * `include`.
 *
 * Text based, no TypeScript parser: comments and string literals are blanked,
 * then braces are tracked on a stack, each frame labelled with the `key:` that
 * opened it. A `...SELECT_` is a violation when the innermost open frame is
 * labelled `include`.
 */

export function findSelectSpreadInInclude(source: string): number[] {
  const text = blank(source);
  const lines: number[] = [];
  const stack: Array<string | null> = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    else if (ch === '{') {
      const label = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(text.slice(Math.max(0, i - 80), i));
      stack.push(label ? label[1] : null);
    } else if (ch === '}') stack.pop();
    else if (ch === '.' && text.startsWith('...SELECT_', i) && stack[stack.length - 1] === 'include') {
      lines.push(line);
    }
  }
  return lines;
}

/** Replaces comments and string/template literal contents with spaces, keeping newlines. */
function blank(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; ) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') (out += ' '), i++;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) out += source[i] === '\n' ? '\n' : ' ';
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      out += quote;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') (out += ' '), i++;
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += quote;
      i++;
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'generated' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Explicit exceptions, as `path:line` -- empty on purpose; add with a reason.
const ALLOWLIST: string[] = [];

describe('no ...SELECT_ spread directly inside a Prisma include', () => {
  it('flags a spread directly in include, and only there', () => {
    const bad = `prisma.x.findMany({ include: {\n  donation: { include: { campaign: true, ...SELECT_DONATION_GUEST_EMAIL } },\n} })`;
    expect(findSelectSpreadInInclude(bad)).toEqual([2]);
    expect(findSelectSpreadInInclude(`x({ include: { ...SELECT_A } })`)).toEqual([1]);

    const fine = [
      `x({ select: { id: true, ...SELECT_A } })`,
      `x({ include: { donor: { select: { id: true, ...SELECT_USER_EMAIL } } } })`,
      `x({ include: { a: true } }); const s = { ...SELECT_B };`,
      `// include: { ...SELECT_C }\nconst t = "include: { ...SELECT_D }";`,
    ];
    for (const src of fine) expect(findSelectSpreadInInclude(src)).toEqual([]);
  });

  it('finds none in src/', () => {
    const root = join(process.cwd(), 'src');
    const violations = sourceFiles(root).flatMap((file) =>
      findSelectSpreadInInclude(readFileSync(file, 'utf8')).map((n) => `${relative(process.cwd(), file)}:${n}`),
    );
    expect(violations.filter((v) => !ALLOWLIST.includes(v))).toEqual([]);
  });
});

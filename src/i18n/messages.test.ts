import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { messages, NAMESPACES } from './messages';

const root = join(process.cwd(), 'src/messages');
const filesOf = (locale: string) => readdirSync(join(root, locale)).filter((f) => f.endsWith('.json')).sort();

/** `Namespace.nested.key` -> ICU argument names used by its message. */
function flatten(value: unknown, prefix = ''): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (typeof value === 'string') {
    const args = [...value.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    out.set(prefix, [...new Set(args)].sort());
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      for (const [fk, fv] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(fk, fv);
    }
  }
  return out;
}

describe('message catalogues (ADR 0024 section 5)', () => {
  it('has the same files in both languages', () => {
    expect(filesOf('en')).toEqual(filesOf('id'));
  });

  it('has the same keys, and the same ICU arguments per key, in both languages', () => {
    for (const file of filesOf('id')) {
      const read = (l: string) => JSON.parse(readFileSync(join(root, l, file), 'utf8'));
      const id = flatten(read('id'));
      const en = flatten(read('en'));
      expect([...en.keys()].sort(), file).toEqual([...id.keys()].sort());
      for (const [key, args] of id) expect(en.get(key), `${file}:${key}`).toEqual(args);
    }
  });

  it('loads every file as a namespace named after it, for each language', () => {
    expect([...NAMESPACES].sort()).toEqual(filesOf('id').map((f) => f.replace(/\.json$/, '')).sort());
    for (const locale of ['id', 'en'] as const) {
      expect(Object.keys(messages[locale]).sort()).toEqual([...NAMESPACES].sort());
    }
    expect(messages.id.Common.currentLanguage).toBe('Indonesia');
    expect(messages.en.Common.currentLanguage).toBe('English');
  });
});

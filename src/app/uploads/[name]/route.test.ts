// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

const { dir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'), os = require('os'), path = require('path');
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-')) as string };
});
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads')>()),
  UPLOAD_DIR: dir,
}));

import { GET } from './route';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function get(name: string) {
  return GET(new NextRequest(`http://localhost:3000/uploads/${encodeURIComponent(name)}`), {
    params: Promise.resolve({ name }),
  });
}

/**
 * Next's production server lists public/ once at startup, so a cover written
 * to public/uploads after the container started answered 404 until a
 * restart (UAT Beta produksi 2026-10-16). This route serves those files.
 */
describe('GET /uploads/[name]', () => {
  beforeAll(() => {
    writeFileSync(join(dir, 'mvalw0gd-pf004k2hw5k.png'), PNG);
    writeFileSync(join(dir, 'abc-def.html'), '<script>alert(1)</script>');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves an image written after startup, with its type and no sniffing', async () => {
    const res = await get('mvalw0gd-pf004k2hw5k.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('answers 404 for a file that does not exist', async () => {
    expect((await get('nope-nope.png')).status).toBe(404);
  });

  it('never serves a non-image extension, even when the file exists', async () => {
    expect((await get('abc-def.html')).status).toBe(404);
  });

  it.each(['../secret.png', '..%2Fsecret.png', 'a/b.png', '.hidden.png', 'x.png\0.html'])(
    'refuses a name outside the upload pattern: %s',
    async (name) => {
      expect((await get(name)).status).toBe(404);
    },
  );
});

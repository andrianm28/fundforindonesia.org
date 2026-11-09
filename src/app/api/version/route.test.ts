import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET, dynamic } from './route';

/**
 * Which commit this process runs. The deploy gate reads it from staging to
 * refuse a production deploy of a commit staging is not healthy on.
 */
describe('GET /api/version', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('answers the commit the image was built from, uncached', async () => {
    vi.stubEnv('APP_REVISION', 'a'.repeat(40));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 'a'.repeat(40) });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(dynamic).toBe('force-dynamic');
  });

  it('answers null for anything but a full commit SHA (a local build, a tampered env)', async () => {
    for (const value of ['', 'main', 'a'.repeat(39), `${'a'.repeat(40)}\n`]) {
      vi.stubEnv('APP_REVISION', value);
      expect(await (await GET()).json()).toEqual({ revision: null });
    }
  });
});

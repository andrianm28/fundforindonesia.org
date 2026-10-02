import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

describe('next.config headers', () => {
  it('sends Referrer-Policy: no-referrer on the email-confirmation page, whose URL carries a token', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === '/akun/verifikasi-email');
    expect(rule?.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
  });
});

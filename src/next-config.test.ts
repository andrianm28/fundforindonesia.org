import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

describe('next.config headers', () => {
  it('sends Referrer-Policy: no-referrer on the email-confirmation page, whose URL carries a token', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === '/akun/verifikasi-email');
    expect(rule?.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
  });

  it('sends Referrer-Policy: no-referrer on the password reset page, whose URL carries a token', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === '/reset-password');
    expect(rule?.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
  });
});

describe('next.config hardening', () => {
  it('does not send the X-Powered-By header', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe('next.config security headers on every response (audit 2026-10-16)', () => {
  async function headersFor(source: string) {
    const rules = await nextConfig.headers!();
    return rules.find((r) => r.source === source)?.headers ?? [];
  }
  const valueOf = (headers: { key: string; value: string }[], key: string) =>
    headers.find((h) => h.key === key)?.value;

  it('sends nosniff, DENY framing, a referrer policy, a permissions policy and HSTS on every path', async () => {
    const headers = await headersFor('/:path*');
    expect(valueOf(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf(headers, 'X-Frame-Options')).toBe('DENY');
    expect(valueOf(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valueOf(headers, 'Permissions-Policy')).toContain('camera=()');
    expect(valueOf(headers, 'Strict-Transport-Security')).toMatch(/^max-age=\d+/);
  });

  it('sends the CSP in report-only mode only, never enforced yet (go-live-ops 05)', async () => {
    const headers = await headersFor('/:path*');
    const csp = valueOf(headers, 'Content-Security-Policy-Report-Only');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const rules = await nextConfig.headers!();
    expect(rules.flatMap((r) => r.headers).some((h) => h.key === 'Content-Security-Policy')).toBe(false);
  });

  it('puts the site-wide rule first, so a token page rule overrides its Referrer-Policy rather than being overridden', async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe('/:path*');
  });

  it.each(['/receipt/:token', '/akad-wakaf/:token', '/sertifikat/:code', '/reset-password', '/akun/verifikasi-email'])(
    'keeps the token in %s out of the Referer and out of search engines',
    async (source) => {
      const headers = await headersFor(source);
      expect(valueOf(headers, 'Referrer-Policy')).toBe('no-referrer');
      expect(valueOf(headers, 'X-Robots-Tag')).toBe('noindex, nofollow');
    },
  );
});

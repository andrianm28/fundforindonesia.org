import { describe, it, expect } from 'vitest';
import { scrub, scrubString } from './scrub';

describe('scrub', () => {
  it('removes email addresses', () => {
    expect(scrubString('failed for budi.santoso+x@example.test today')).toBe('failed for [email] today');
  });

  it('removes bank account numbers, plain and grouped', () => {
    const out = scrubString('rek 1234567890123 and 1234-5678-9012 ok, amount 5000');
    expect(out).not.toMatch(/1234/);
    expect(out).toContain('amount 5000');
  });

  it('removes receipt, akad and reset tokens from URLs', () => {
    expect(scrubString('/receipt/abc123SECRETtoken/pdf')).toBe('/receipt/[redacted]/pdf');
    expect(scrubString('GET /akad-wakaf/zzTOKENzz')).toBe('GET /akad-wakaf/[redacted]');
    expect(scrubString('/reset-password/tok_9?x=1')).toBe('/reset-password/[redacted]?x=1');
    expect(scrubString('/verify?token=abcdef&next=/home')).toBe('/verify?token=[redacted]&next=/home');
    expect(scrubString('GET /api/receipts/shortTok9')).toBe('GET /api/receipts/[redacted]');
  });

  it('removes bearer tokens and svix signatures', () => {
    expect(scrubString('Authorization failed: Bearer eyJhbGciOi.payload.sig')).not.toContain('eyJ');
    const sig = 'v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2/gZ4U8WCNFA1PY=';
    expect(scrubString(`svix ${sig}`)).not.toContain('K5oZ');
  });

  it('removes long opaque tokens', () => {
    expect(scrubString('token 0123456789abcdef0123456789abcdef seen')).toBe('token [redacted] seen');
    // base64url tokens may start or end with - or _, where \b would leave a tail.
    expect(scrubString('x -0123456789abcdef0123456789abcdef_ y')).toBe('x [redacted] y');
  });

  it('drops Authorization and Cookie headers and request bodies, deeply', () => {
    const out = scrub({
      headers: { Authorization: 'Bearer x', Cookie: 'session=1', 'content-type': 'application/json' },
      request: { body: { email: 'a@b.test' }, data: 'raw', url: '/api/x' },
    });
    expect(out.headers.Authorization).toBe('[redacted]');
    expect(out.headers.Cookie).toBe('[redacted]');
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.request.body).toBe('[redacted]');
    expect(out.request.data).toBe('[redacted]');
    expect(out.request.url).toBe('/api/x');
  });

  it('survives cycles and leaves non-strings alone', () => {
    const a: Record<string, unknown> = { n: 5, ok: true };
    a.self = a;
    const out = scrub(a);
    expect(out.n).toBe(5);
    expect(out.self).toBe('[redacted]');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { safePaymentLink } from './payment-link';

describe('safePaymentLink', () => {
  afterEach(() => {
    delete process.env.PAYMENT_LINK_ALLOWED_HOSTS;
  });

  it('accepts an https link on the provider host and its subdomains', () => {
    expect(safePaymentLink('https://pay.sumopod.com/p/abc')).toBe('https://pay.sumopod.com/p/abc');
    expect(safePaymentLink('https://sumopod.com/p/abc')).toBe('https://sumopod.com/p/abc');
  });

  it('refuses http', () => {
    expect(safePaymentLink('http://pay.sumopod.com/p/abc')).toBeNull();
  });

  it('refuses a foreign host, including look-alikes and embedded credentials', () => {
    expect(safePaymentLink('https://evil.example/p/abc')).toBeNull();
    expect(safePaymentLink('https://sumopod.com.evil.example/p')).toBeNull();
    expect(safePaymentLink('https://notsumopod.com/p')).toBeNull();
    expect(safePaymentLink('https://sumopod.com@evil.example/p')).toBeNull();
  });

  it('refuses javascript:, data:, relative and malformed values and null', () => {
    expect(safePaymentLink('javascript:alert(1)')).toBeNull();
    expect(safePaymentLink('data:text/html,hi')).toBeNull();
    expect(safePaymentLink('/relative')).toBeNull();
    expect(safePaymentLink('not a url')).toBeNull();
    expect(safePaymentLink(null)).toBeNull();
    expect(safePaymentLink(undefined)).toBeNull();
  });

  it('can be overridden through PAYMENT_LINK_ALLOWED_HOSTS', () => {
    process.env.PAYMENT_LINK_ALLOWED_HOSTS = 'pay.example.id, other.example.id';
    expect(safePaymentLink('https://pay.example.id/x')).toBe('https://pay.example.id/x');
    expect(safePaymentLink('https://pay.sumopod.com/x')).toBeNull();
  });
});

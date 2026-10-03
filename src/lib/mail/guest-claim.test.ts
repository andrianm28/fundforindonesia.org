import { describe, it, expect } from 'vitest';
import { guestClaimEmail } from './guest-claim';

describe('guestClaimEmail', () => {
  const base = {
    to: 'sari@example.com',
    name: 'Sari <b>',
    claimUrl: 'https://fundforindonesia.org/akun/klaim-donasi?token=abc',
  };

  it('goes to the account address and carries the claim link in both bodies', () => {
    const email = guestClaimEmail(base);

    expect(email.to).toBe('sari@example.com');
    expect(email.text).toContain(base.claimUrl);
    expect(email.html).toContain(base.claimUrl);
  });

  it('escapes the typed name in the HTML body', () => {
    const email = guestClaimEmail(base);

    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('Sari &lt;b&gt;');
  });
});
